import { randomUUID } from 'node:crypto'
import { createLogger, SparkError } from '@spark/shared'
import {
  ACCOUNT_SYNC_CATEGORIES,
  type AccountSyncCategory,
  type AccountSyncCategoryResult,
  type AccountSyncConflictDetail,
  type AccountSyncConflictSide,
  type AccountSyncConflictSideInfo,
  type AccountSyncExecuteRequestBody,
  type AccountSyncExecuteRequest,
  type AccountSyncExecuteResponse,
  type AccountSyncExecuteResult,
  type AccountSyncGetPreferencesResponse,
  type AccountSyncHistoryItem,
  type AccountSyncItem,
  type AccountSyncListHistoryResponse,
  type AccountSyncPreferences,
  type AccountSyncPreviewResult,
  type AccountSyncUpdatePreferencesRequest,
} from '@spark/protocol'
import { SettingsRepository, type SparkDatabase } from '@spark/storage'
import { AccountSyncAdapters } from './sync-adapters.js'
import { createSafeSyncItem, hashSyncItems, type AccountSyncCollectResult } from './sync-policy.js'

const log = createLogger('account-sync')
const PREFERENCES_CATEGORY = 'account-sync.preferences'
const STATE_CATEGORY = 'account-sync.state'
const DEVICE_CATEGORY = 'account-sync.device'
const SCHEMA_VERSION = 1

type AccountSyncCategoryState = {
  revision: number
  baseHashes: Record<string, string>
  tombstones: Record<string, string>
  pendingApply?: boolean
  lastErrorCodes?: string[]
}

type CollectedCategory = {
  category: AccountSyncCategory
  collected: AccountSyncCollectResult
  protectedIds: Set<string>
  state: AccountSyncCategoryState
  request: AccountSyncExecuteRequestBody['categories'][number]
}

type CollectionFailure = {
  category: AccountSyncCategory
  state: AccountSyncCategoryState
  errorCode: 'SYNC_LOCAL_COLLECT_FAILED'
}

export interface AccountSyncAdapterGateway {
  collect(category: AccountSyncCategory): Promise<AccountSyncCollectResult>
  apply(
    result: AccountSyncCategoryResult,
    protectedIds: ReadonlySet<string>,
  ): Promise<{ errorCodes: string[]; appearance?: Record<string, unknown> }>
}

function defaultSelection(): AccountSyncPreferences['categories'] {
  return {
    customCommands: false,
    prompts: false,
    memory: false,
    assistants: false,
    workflows: false,
    appearance: false,
    promptLibrary: false,
  }
}

function defaultPreferences(): AccountSyncPreferences {
  return { enabled: false, categories: defaultSelection() }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function invalidServerResponse(message = '同步服务返回了无效响应'): never {
  throw new SparkError('UNKNOWN', message)
}

function isSyncCategory(value: unknown): value is AccountSyncCategory {
  return ACCOUNT_SYNC_CATEGORIES.some((category) => category === value)
}

function normalizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalidServerResponse()
  }
  return value
}

function normalizeStats(value: unknown): AccountSyncExecuteResult['stats'] {
  if (!isRecord(value)) return invalidServerResponse()
  return {
    uploaded: normalizeCount(value.uploaded),
    downloaded: normalizeCount(value.downloaded),
    conflicts: normalizeCount(value.conflicts),
    skipped: normalizeCount(value.skipped),
  }
}

function normalizeStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit) return invalidServerResponse()
  return value.map((item) => {
    if (typeof item !== 'string') return invalidServerResponse()
    return item.slice(0, 128)
  })
}

function normalizeIsoDate(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) {
    return invalidServerResponse()
  }
  return new Date(value).toISOString()
}

export interface AccountSyncAuthGateway {
  getCurrentUserId(): string | null
  getEduClient(): { getBaseUrl(): string }
  platformGet<T>(path: string): Promise<T>
  platformPost<T>(path: string, body?: unknown): Promise<T>
}

export class AccountSyncService {
  private readonly settings: SettingsRepository
  private readonly adapters: AccountSyncAdapterGateway
  private inFlight: { userId: string; promise: Promise<AccountSyncExecuteResponse> } | null = null
  private previewInFlight: { userId: string; promise: Promise<AccountSyncPreviewResult> } | null =
    null

  constructor(
    db: SparkDatabase,
    private readonly auth: AccountSyncAuthGateway,
    adapters?: AccountSyncAdapterGateway,
  ) {
    this.settings = new SettingsRepository(db)
    this.adapters = adapters ?? new AccountSyncAdapters(db)
  }

  getPreferences(): AccountSyncGetPreferencesResponse {
    const userId = this.auth.getCurrentUserId()
    return {
      authenticated: userId != null,
      preferences: userId == null ? defaultPreferences() : this.readPreferences(userId),
    }
  }

  updatePreferences(input: AccountSyncUpdatePreferencesRequest): AccountSyncGetPreferencesResponse {
    const userId = this.requireUserId()
    const current = this.readPreferences(userId)
    const next: AccountSyncPreferences = {
      ...current,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      categories: {
        ...current.categories,
        ...(input.categories ?? {}),
      },
    }
    this.settings.set(PREFERENCES_CATEGORY, `user:${userId}`, next)
    return { authenticated: true, preferences: next }
  }

  execute(input?: AccountSyncExecuteRequest): Promise<AccountSyncExecuteResponse> {
    const userId = this.requireUserId()
    if (this.inFlight != null) {
      if (this.inFlight.userId === userId) return this.inFlight.promise
      return Promise.reject(
        new SparkError('VALIDATION_FAILED', '账号已切换，请等待当前同步结束后重试'),
      )
    }
    const promise = this.executeOnce(userId, input?.conflictChoices).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = null
    })
    this.inFlight = { userId, promise }
    return promise
  }

  /**
   * 冲突预览：只向服务端请求三方合并计算，不落库、不 ack、不写本地状态。
   * 与 execute 的 inFlight 相互独立，预览为只读操作，可随时发起。
   */
  preview(): Promise<AccountSyncPreviewResult> {
    const userId = this.requireUserId()
    if (this.previewInFlight != null) {
      if (this.previewInFlight.userId === userId) return this.previewInFlight.promise
      return Promise.reject(
        new SparkError('VALIDATION_FAILED', '账号已切换，请在当前账号下重新预览'),
      )
    }
    const promise = this.previewOnce(userId).finally(() => {
      if (this.previewInFlight?.promise === promise) this.previewInFlight = null
    })
    this.previewInFlight = { userId, promise }
    return promise
  }

  async listHistory(page = 1, pageSize = 20): Promise<AccountSyncListHistoryResponse> {
    this.requireUserId()
    const response = await this.auth.platformGet<unknown>(
      `/desktop-sync/history?page=${Math.max(1, page)}&pageSize=${Math.max(
        1,
        Math.min(100, pageSize),
      )}`,
    )
    if (!isRecord(response) || !Array.isArray(response.list)) return invalidServerResponse()
    const total = normalizeCount(response.total)
    const normalizedPage = normalizeCount(response.page)
    const normalizedPageSize = normalizeCount(response.pageSize)
    if (normalizedPage < 1 || normalizedPageSize < 1 || normalizedPageSize > 100) {
      return invalidServerResponse()
    }
    const list = response.list.map((rawItem) => this.normalizeHistoryItem(rawItem))
    if (list.length > normalizedPageSize) return invalidServerResponse()
    return {
      list,
      total,
      page: normalizedPage,
      pageSize: normalizedPageSize,
    }
  }

  private async executeOnce(
    userId: string,
    conflictChoices?: Record<string, AccountSyncConflictSide>,
  ): Promise<AccountSyncExecuteResponse> {
    const preferences = this.readPreferences(userId)
    if (!preferences.enabled) {
      throw new SparkError('VALIDATION_FAILED', '请先开启账号同步')
    }
    const selected = ACCOUNT_SYNC_CATEGORIES.filter((category) => preferences.categories[category])
    if (selected.length === 0) {
      throw new SparkError('VALIDATION_FAILED', '请至少选择一个同步类别')
    }
    this.assertSecureEndpoint()

    const operationId = randomUUID()
    const now = new Date().toISOString()
    const { collected, failures: collectionFailures } = await this.collectAll(
      userId,
      selected,
      operationId,
      now,
    )
    if (this.auth.getCurrentUserId() !== userId) {
      throw new SparkError('VALIDATION_FAILED', '同步期间账号已切换，请在当前账号下重新同步')
    }
    if (collected.length === 0) {
      return this.finishCollectionFailure(userId, preferences, operationId, collectionFailures)
    }
    const request: AccountSyncExecuteRequestBody = {
      operationId,
      device: this.getDeviceIdentity(),
      categories: collected.map((item) => item.request),
      ...(conflictChoices != null && Object.keys(conflictChoices).length > 0
        ? { conflictChoices }
        : {}),
    }

    log.info(
      `manual sync execute operation=${operationId} categories=${selected.join(',')} items=${request.categories.reduce(
        (count, category) => count + category.records.length,
        0,
      )}`,
    )

    let serverResult: AccountSyncExecuteResult
    let unsupportedServerCategory = false
    try {
      serverResult = await this.auth.platformPost<AccountSyncExecuteResult>(
        '/desktop-sync/execute',
        request,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('404') || message.includes('请求失败 (404)')) {
        throw new SparkError('UNKNOWN', '当前服务端暂不支持账号同步，请升级服务端后重试')
      }
      // 旧版服务端不识别 promptLibrary 类别会整单拒绝（SYNC_INVALID_CATEGORY）：
      // 剔除该类别后重试一次，其余类别正常收敛，不因单点类别阻断全部同步。
      if (
        message.includes('SYNC_INVALID_CATEGORY') &&
        selected.includes('promptLibrary') &&
        (conflictChoices == null || Object.keys(conflictChoices).length === 0)
      ) {
        unsupportedServerCategory = true
        log.warn(
          `server does not support promptLibrary category, retrying without it operation=${operationId}`,
        )
        serverResult = await this.auth.platformPost<AccountSyncExecuteResult>(
          '/desktop-sync/execute',
          {
            operationId,
            device: request.device,
            categories: request.categories.filter((item) => item.category !== 'promptLibrary'),
          },
        )
      } else {
        throw error
      }
    }

    const normalized = this.normalizeServerResult(
      operationId,
      serverResult,
      unsupportedServerCategory
        ? collected.map((item) => item.category).filter((category) => category !== 'promptLibrary')
        : collected.map((item) => item.category),
    )
    if (this.auth.getCurrentUserId() !== userId) {
      throw new SparkError('VALIDATION_FAILED', '同步期间账号已切换，请在当前账号下重新同步')
    }
    const collectedByCategory = new Map(collected.map((item) => [item.category, item]))
    const localErrorCodes: string[] = collectionFailures.map((failure) => failure.errorCode)
    if (unsupportedServerCategory) localErrorCodes.push('SYNC_CATEGORY_UNSUPPORTED')
    normalized.categories.push(
      ...collectionFailures.map((failure) => this.collectionFailureResult(failure)),
    )
    let successfullyAppliedCategories = 0
    let appliedAppearance: Record<string, unknown> | undefined
    const applyOrder: AccountSyncCategory[] = [
      'workflows',
      'prompts',
      'assistants',
      'customCommands',
      'memory',
      'appearance',
      'promptLibrary',
    ]

    for (const category of applyOrder) {
      const categoryResult = normalized.categories.find((item) => item.category === category)
      const local = collectedByCategory.get(category)
      if (categoryResult == null || local == null || categoryResult.errorCode != null) continue

      const clientSkipped = local.collected.skippedItems
      categoryResult.skippedItems = [...categoryResult.skippedItems, ...clientSkipped]
      categoryResult.stats.skipped += clientSkipped.length
      normalized.stats.skipped += clientSkipped.length

      const safeCanonical = this.sanitizeCanonicalResult(categoryResult)
      categoryResult.records = safeCanonical.records
      categoryResult.hashes = hashSyncItems(safeCanonical.records)
      if (safeCanonical.errorCodes.length > 0) {
        localErrorCodes.push(...safeCanonical.errorCodes)
      }

      let applied: Awaited<ReturnType<AccountSyncAdapterGateway['apply']>>
      try {
        applied = await this.adapters.apply(categoryResult, local.protectedIds)
      } catch (error) {
        log.warn(
          `local sync apply failed operation=${operationId} category=${category}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        applied = { errorCodes: ['SYNC_LOCAL_APPLY_FAILED'] }
      }
      if (applied.appearance != null) appliedAppearance = applied.appearance
      if (applied.errorCodes.length > 0 || safeCanonical.errorCodes.length > 0) {
        const errors = [...applied.errorCodes, ...safeCanonical.errorCodes]
        localErrorCodes.push(...applied.errorCodes)
        this.writeCategoryState(userId, category, {
          ...local.state,
          pendingApply: true,
          lastErrorCodes: Array.from(new Set(errors)),
        })
        continue
      }
      this.writeCategoryState(userId, category, {
        revision: categoryResult.revision,
        baseHashes: categoryResult.hashes,
        tombstones: categoryResult.records.reduce<Record<string, string>>((tombstones, item) => {
          if (item.deleted) tombstones[item.id] = item.updatedAt
          return tombstones
        }, {}),
      })
      successfullyAppliedCategories += 1
    }

    const uniqueLocalErrors = Array.from(new Set(localErrorCodes))
    // SYNC_CATEGORY_UNSUPPORTED 表示整类因服务端版本限制未参与，属于提示而非失败：
    // 仍展示在 errorCodes 中，但不把整体状态降级为 partial/failed。
    const statusAffectingErrors = uniqueLocalErrors.filter(
      (code) => code !== 'SYNC_CATEGORY_UNSUPPORTED',
    )
    if (uniqueLocalErrors.length > 0) {
      normalized.errorCodes = Array.from(new Set([...normalized.errorCodes, ...uniqueLocalErrors]))
    }
    if (statusAffectingErrors.length > 0) {
      normalized.status = successfullyAppliedCategories === 0 ? 'failed' : 'partial'
    }

    try {
      await this.auth.platformPost(`/desktop-sync/operations/${operationId}/ack`, {
        status: normalized.status,
        errorCodes: uniqueLocalErrors,
      })
    } catch (error) {
      log.warn(
        `sync ack failed operation=${operationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    const nextPreferences: AccountSyncPreferences = {
      ...preferences,
      lastOperation: {
        operationId,
        status: normalized.status,
        finishedAt: new Date().toISOString(),
      },
    }
    this.settings.set(PREFERENCES_CATEGORY, `user:${userId}`, nextPreferences)
    return {
      result: normalized,
      ...(appliedAppearance != null ? { appliedAppearance } : {}),
    }
  }

  /**
   * 冲突预览执行：采集 → 请求服务端以 preview 模式计算三方合并。
   * 不写 preferences、不 ack、不更新任何类别状态；本地采集失败的类别
   * 并入 categories 并标记 errorCode，不影响其他类别。
   */
  private async previewOnce(userId: string): Promise<AccountSyncPreviewResult> {
    const preferences = this.readPreferences(userId)
    if (!preferences.enabled) {
      throw new SparkError('VALIDATION_FAILED', '请先开启账号同步')
    }
    const selected = ACCOUNT_SYNC_CATEGORIES.filter((category) => preferences.categories[category])
    if (selected.length === 0) {
      throw new SparkError('VALIDATION_FAILED', '请至少选择一个同步类别')
    }
    this.assertSecureEndpoint()

    const operationId = randomUUID()
    const now = new Date().toISOString()
    const { collected, failures } = await this.collectAll(userId, selected, operationId, now)
    if (this.auth.getCurrentUserId() !== userId) {
      throw new SparkError('VALIDATION_FAILED', '同步期间账号已切换，请在当前账号下重新预览')
    }
    if (collected.length === 0) {
      return {
        mode: 'preview',
        operationId,
        status: 'failed',
        categories: failures.map((failure) => ({
          category: failure.category,
          conflictCount: 0,
          errorCode: failure.errorCode,
        })),
        conflicts: [],
        totalConflicts: 0,
      }
    }
    const request: AccountSyncExecuteRequestBody = {
      operationId,
      device: this.getDeviceIdentity(),
      categories: collected.map((item) => item.request),
      mode: 'preview',
    }

    log.info(`manual sync preview operation=${operationId} categories=${selected.join(',')}`)

    let serverResult: unknown
    try {
      serverResult = await this.auth.platformPost('/desktop-sync/execute', request)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('404') || message.includes('请求失败 (404)')) {
        throw new SparkError('UNKNOWN', '当前服务端暂不支持冲突预览，请升级服务端后重试')
      }
      throw error
    }

    const preview = this.normalizePreviewResult(
      operationId,
      serverResult,
      collected.map((item) => item.category),
    )
    preview.categories.push(
      ...failures.map((failure) => ({
        category: failure.category,
        conflictCount: 0,
        errorCode: failure.errorCode,
      })),
    )
    if (failures.length > 0 && preview.status !== 'failed') {
      preview.status = 'partial'
    }
    return preview
  }

  private finishCollectionFailure(
    userId: string,
    preferences: AccountSyncPreferences,
    operationId: string,
    failures: CollectionFailure[],
  ): AccountSyncExecuteResponse {
    const finishedAt = new Date().toISOString()
    const result: AccountSyncExecuteResult = {
      operationId,
      status: 'failed',
      categories: failures.map((failure) => this.collectionFailureResult(failure)),
      stats: { uploaded: 0, downloaded: 0, conflicts: 0, skipped: 0 },
      errorCodes: ['SYNC_LOCAL_COLLECT_FAILED'],
    }
    this.settings.set(PREFERENCES_CATEGORY, `user:${userId}`, {
      ...preferences,
      lastOperation: { operationId, status: result.status, finishedAt },
    } satisfies AccountSyncPreferences)
    return { result }
  }

  private collectionFailureResult(failure: CollectionFailure): AccountSyncCategoryResult {
    return {
      category: failure.category,
      schemaVersion: SCHEMA_VERSION,
      revision: failure.state.revision,
      records: [],
      hashes: failure.state.baseHashes,
      stats: { uploaded: 0, downloaded: 0, conflicts: 0, skipped: 0 },
      skippedItems: [],
      errorCode: failure.errorCode,
    }
  }

  /** 采集所有选中类别，单个类别失败不中断其他类别，失败详情单独返回 */
  private async collectAll(
    userId: string,
    selected: AccountSyncCategory[],
    operationId: string,
    now: string,
  ): Promise<{ collected: CollectedCategory[]; failures: CollectionFailure[] }> {
    const results = await Promise.all(
      selected.map(async (category) => {
        try {
          return { collected: await this.collectCategory(userId, category, now) }
        } catch (error) {
          log.warn(
            `local sync collect failed operation=${operationId} category=${category}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
          return {
            failure: {
              category,
              state: this.readCategoryState(userId, category),
              errorCode: 'SYNC_LOCAL_COLLECT_FAILED',
            } satisfies CollectionFailure,
          }
        }
      }),
    )
    return {
      collected: results.flatMap((item) => (item.collected != null ? [item.collected] : [])),
      failures: results.flatMap((item) => (item.failure != null ? [item.failure] : [])),
    }
  }

  private async collectCategory(
    userId: string,
    category: AccountSyncCategory,
    deletedAt: string,
  ): Promise<CollectedCategory> {
    const state = this.readCategoryState(userId, category)
    const collected = await this.adapters.collect(category)
    const protectedIds = new Set(collected.skippedItems.map((item) => item.id))
    const records = [...collected.records]
    for (const baseId of Object.keys(state.baseHashes)) {
      if (collected.seenIds.has(baseId) || protectedIds.has(baseId)) continue
      records.push({
        id: baseId,
        updatedAt: state.tombstones[baseId] ?? deletedAt,
        deleted: true,
      })
    }
    return {
      category,
      collected,
      protectedIds,
      state,
      request: {
        category,
        schemaVersion: SCHEMA_VERSION,
        baseRevision: state.revision,
        baseHashes: state.baseHashes,
        records,
      },
    }
  }

  private sanitizeCanonicalResult(result: AccountSyncCategoryResult): {
    records: AccountSyncItem[]
    errorCodes: string[]
  } {
    const records: AccountSyncItem[] = []
    const errorCodes: string[] = []
    for (const item of result.records.slice(0, 2_000)) {
      if (
        !isRecord(item) ||
        typeof item.id !== 'string' ||
        item.id.trim().length === 0 ||
        item.id.trim().length > 256 ||
        typeof item.updatedAt !== 'string' ||
        !Number.isFinite(new Date(item.updatedAt).getTime()) ||
        typeof item.deleted !== 'boolean'
      ) {
        errorCodes.push('SYNC_SERVER_ITEM_INVALID')
        continue
      }
      if (item.deleted) {
        records.push({
          id: item.id.trim(),
          updatedAt: new Date(item.updatedAt).toISOString(),
          deleted: true,
        })
        continue
      }
      if (!isRecord(item.value)) {
        errorCodes.push('SYNC_SERVER_ITEM_INVALID')
        continue
      }
      const safe = createSafeSyncItem(result.category, {
        id: item.id,
        updatedAt: item.updatedAt,
        value: item.value,
      })
      if (safe.item != null) records.push(safe.item)
      else errorCodes.push('SYNC_SERVER_ITEM_REJECTED')
    }
    if (result.records.length > 2_000) errorCodes.push('SYNC_SERVER_ITEM_LIMIT_EXCEEDED')
    return { records, errorCodes: Array.from(new Set(errorCodes)) }
  }

  private normalizeHistoryItem(value: unknown): AccountSyncHistoryItem {
    if (!isRecord(value)) return invalidServerResponse()
    if (
      typeof value.operationId !== 'string' ||
      typeof value.deviceLabel !== 'string' ||
      (value.status !== 'success' && value.status !== 'partial' && value.status !== 'failed') ||
      (value.ackStatus !== 'pending' &&
        value.ackStatus !== 'success' &&
        value.ackStatus !== 'partial' &&
        value.ackStatus !== 'failed') ||
      !Array.isArray(value.categories)
    ) {
      return invalidServerResponse()
    }
    const categories = value.categories.map((category) => {
      if (!isSyncCategory(category)) return invalidServerResponse()
      return category
    })
    if (new Set(categories).size !== categories.length) return invalidServerResponse()
    return {
      operationId: value.operationId.slice(0, 64),
      deviceLabel: value.deviceLabel.slice(0, 64),
      status: value.status,
      categories,
      stats: normalizeStats(value.stats),
      errorCodes: normalizeStringList(value.errorCodes, 64),
      ackStatus: value.ackStatus,
      ackErrorCodes: normalizeStringList(value.ackErrorCodes, 64),
      durationMs: normalizeCount(value.durationMs),
      createdAt: normalizeIsoDate(value.createdAt) as string,
      finishedAt: normalizeIsoDate(value.finishedAt, true),
    }
  }

  private normalizeServerResult(
    operationId: string,
    result: AccountSyncExecuteResult,
    selected: AccountSyncCategory[],
  ): AccountSyncExecuteResult {
    if (
      !isRecord(result) ||
      result.operationId !== operationId ||
      !Array.isArray(result.categories) ||
      !isRecord(result.stats) ||
      !Array.isArray(result.errorCodes)
    ) {
      throw new SparkError('UNKNOWN', '同步服务返回了无效响应')
    }
    if (result.status !== 'success' && result.status !== 'partial' && result.status !== 'failed') {
      return invalidServerResponse()
    }
    const selectedSet = new Set(selected)
    const seenCategories = new Set<AccountSyncCategory>()
    const categories: AccountSyncCategoryResult[] = []
    for (const rawCategory of result.categories) {
      if (
        !isRecord(rawCategory) ||
        !isSyncCategory(rawCategory.category) ||
        !selectedSet.has(rawCategory.category) ||
        seenCategories.has(rawCategory.category) ||
        rawCategory.schemaVersion !== SCHEMA_VERSION ||
        typeof rawCategory.revision !== 'number' ||
        !Number.isSafeInteger(rawCategory.revision) ||
        rawCategory.revision < 0 ||
        !Array.isArray(rawCategory.records) ||
        !isRecord(rawCategory.hashes) ||
        !Array.isArray(rawCategory.skippedItems)
      ) {
        return invalidServerResponse('同步服务返回的类别不完整或重复')
      }
      const hashes = Object.fromEntries(
        Object.entries(rawCategory.hashes).filter(
          (entry): entry is [string, string] =>
            entry[0].length > 0 &&
            entry[0].length <= 256 &&
            typeof entry[1] === 'string' &&
            /^[a-f0-9]{64}$/.test(entry[1]),
        ),
      )
      if (Object.keys(hashes).length !== Object.keys(rawCategory.hashes).length) {
        return invalidServerResponse()
      }
      const skippedItems = rawCategory.skippedItems.slice(0, 2_000).map((item) => {
        if (!isRecord(item) || typeof item.id !== 'string' || typeof item.reasonCode !== 'string') {
          return invalidServerResponse()
        }
        return { id: item.id.slice(0, 256), reasonCode: item.reasonCode.slice(0, 128) }
      })
      if (rawCategory.skippedItems.length > 2_000) return invalidServerResponse()
      if (rawCategory.errorCode !== undefined && typeof rawCategory.errorCode !== 'string') {
        return invalidServerResponse()
      }
      seenCategories.add(rawCategory.category)
      categories.push({
        category: rawCategory.category,
        schemaVersion: SCHEMA_VERSION,
        revision: rawCategory.revision,
        records: rawCategory.records as AccountSyncItem[],
        hashes,
        stats: normalizeStats(rawCategory.stats),
        skippedItems,
        ...(typeof rawCategory.errorCode === 'string'
          ? { errorCode: rawCategory.errorCode.slice(0, 128) }
          : {}),
      })
    }
    if (seenCategories.size !== selected.length) {
      return invalidServerResponse('同步服务返回的类别不完整或重复')
    }
    const errorCodes = result.errorCodes.map((code) => {
      if (typeof code !== 'string') return invalidServerResponse()
      return code.slice(0, 128)
    })
    return {
      operationId,
      categories,
      status: result.status,
      stats: normalizeStats(result.stats),
      errorCodes: errorCodes.slice(0, 64),
      ...(result.replayed === true ? { replayed: true } : {}),
    }
  }

  private normalizePreviewResult(
    operationId: string,
    result: unknown,
    selected: AccountSyncCategory[],
  ): AccountSyncPreviewResult {
    if (
      !isRecord(result) ||
      result.mode !== 'preview' ||
      result.operationId !== operationId ||
      (result.status !== 'success' && result.status !== 'partial' && result.status !== 'failed') ||
      !Array.isArray(result.categories) ||
      !Array.isArray(result.conflicts)
    ) {
      return invalidServerResponse('同步服务返回了无效的冲突预览')
    }
    const selectedSet = new Set(selected)
    const seenCategories = new Set<AccountSyncCategory>()
    const categories: AccountSyncPreviewResult['categories'] = []
    let totalFromCategories = 0
    for (const rawCategory of result.categories) {
      if (
        !isRecord(rawCategory) ||
        !isSyncCategory(rawCategory.category) ||
        !selectedSet.has(rawCategory.category) ||
        seenCategories.has(rawCategory.category) ||
        typeof rawCategory.conflictCount !== 'number' ||
        !Number.isSafeInteger(rawCategory.conflictCount) ||
        rawCategory.conflictCount < 0
      ) {
        return invalidServerResponse('同步服务返回的类别不完整或重复')
      }
      if (rawCategory.errorCode !== undefined && typeof rawCategory.errorCode !== 'string') {
        return invalidServerResponse()
      }
      seenCategories.add(rawCategory.category)
      categories.push({
        category: rawCategory.category,
        conflictCount: rawCategory.conflictCount,
        ...(typeof rawCategory.errorCode === 'string'
          ? { errorCode: rawCategory.errorCode.slice(0, 128) }
          : {}),
      })
      totalFromCategories += rawCategory.conflictCount
    }
    if (seenCategories.size !== selected.length) {
      return invalidServerResponse('同步服务返回的类别不完整或重复')
    }

    const conflicts: AccountSyncPreviewResult['conflicts'] = []
    const conflictCategorySet = new Set<AccountSyncCategory>()
    let totalFromItems = 0
    for (const rawGroup of result.conflicts) {
      if (
        !isRecord(rawGroup) ||
        !isSyncCategory(rawGroup.category) ||
        !selectedSet.has(rawGroup.category) ||
        conflictCategorySet.has(rawGroup.category) ||
        !Array.isArray(rawGroup.items)
      ) {
        return invalidServerResponse()
      }
      if (rawGroup.items.length > 2_000) return invalidServerResponse()
      conflictCategorySet.add(rawGroup.category)
      const items = rawGroup.items.map((rawItem) => this.normalizeConflictDetail(rawItem))
      conflicts.push({ category: rawGroup.category, items })
      totalFromItems += items.length
    }
    if (totalFromItems !== totalFromCategories || result.totalConflicts !== totalFromCategories) {
      return invalidServerResponse()
    }
    return {
      mode: 'preview',
      operationId,
      status: result.status,
      categories,
      conflicts,
      totalConflicts: totalFromCategories,
    }
  }

  private normalizeConflictDetail(value: unknown): AccountSyncConflictDetail {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      value.id.trim().length === 0 ||
      value.id.length > 256
    ) {
      return invalidServerResponse()
    }
    const local = value.local == null ? null : this.normalizeConflictSideInfo(value.local)
    const cloud = value.cloud == null ? null : this.normalizeConflictSideInfo(value.cloud)
    if (local == null && cloud == null) return invalidServerResponse()
    return { id: value.id.trim(), local, cloud }
  }

  private normalizeConflictSideInfo(value: unknown): AccountSyncConflictSideInfo {
    if (
      !isRecord(value) ||
      typeof value.deleted !== 'boolean' ||
      typeof value.summary !== 'string' ||
      typeof value.preview !== 'string'
    ) {
      return invalidServerResponse()
    }
    const updatedAt = normalizeIsoDate(value.updatedAt)
    if (updatedAt == null) return invalidServerResponse()
    return {
      updatedAt,
      deleted: value.deleted,
      summary: value.summary.slice(0, 256),
      preview: value.preview.slice(0, 512),
    }
  }

  private readPreferences(userId: string): AccountSyncPreferences {
    const raw = this.settings.get(PREFERENCES_CATEGORY, `user:${userId}`)
    if (!isRecord(raw)) return defaultPreferences()
    const rawCategories = isRecord(raw.categories) ? raw.categories : {}
    const preferences: AccountSyncPreferences = {
      enabled: raw.enabled === true,
      categories: ACCOUNT_SYNC_CATEGORIES.reduce<AccountSyncPreferences['categories']>(
        (categories, category) => {
          categories[category] = rawCategories[category] === true
          return categories
        },
        defaultSelection(),
      ),
    }
    if (isRecord(raw.lastOperation)) {
      const status = raw.lastOperation.status
      if (
        typeof raw.lastOperation.operationId === 'string' &&
        typeof raw.lastOperation.finishedAt === 'string' &&
        (status === 'success' || status === 'partial' || status === 'failed')
      ) {
        preferences.lastOperation = {
          operationId: raw.lastOperation.operationId,
          status,
          finishedAt: raw.lastOperation.finishedAt,
        }
      }
    }
    return preferences
  }

  private readCategoryState(
    userId: string,
    category: AccountSyncCategory,
  ): AccountSyncCategoryState {
    const raw = this.settings.get(STATE_CATEGORY, `${userId}:${category}`)
    if (!isRecord(raw)) return { revision: 0, baseHashes: {}, tombstones: {} }
    const baseHashes = isRecord(raw.baseHashes)
      ? Object.fromEntries(
          Object.entries(raw.baseHashes).filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === 'string' && /^[a-f0-9]{64}$/.test(entry[1]),
          ),
        )
      : {}
    const tombstones = isRecord(raw.tombstones)
      ? Object.fromEntries(
          Object.entries(raw.tombstones).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {}
    return {
      revision:
        typeof raw.revision === 'number' && Number.isSafeInteger(raw.revision) && raw.revision >= 0
          ? raw.revision
          : 0,
      baseHashes,
      tombstones,
      ...(raw.pendingApply === true ? { pendingApply: true } : {}),
      ...(Array.isArray(raw.lastErrorCodes)
        ? {
            lastErrorCodes: raw.lastErrorCodes.filter(
              (code): code is string => typeof code === 'string',
            ),
          }
        : {}),
    }
  }

  private writeCategoryState(
    userId: string,
    category: AccountSyncCategory,
    state: AccountSyncCategoryState,
  ): void {
    this.settings.set(STATE_CATEGORY, `${userId}:${category}`, state)
  }

  private getDeviceIdentity(): { id: string; label: string } {
    const raw = this.settings.get(DEVICE_CATEGORY, 'installation')
    const id = isRecord(raw) && typeof raw.id === 'string' ? raw.id : randomUUID()
    if (!isRecord(raw) || raw.id !== id) {
      this.settings.set(DEVICE_CATEGORY, 'installation', { id })
    }
    const platform =
      process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'
    return { id, label: `${platform} #${id.slice(-4)}` }
  }

  private assertSecureEndpoint(): void {
    const baseUrl = new URL(this.auth.getEduClient().getBaseUrl())
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname)
    if (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && loopback)) {
      throw new SparkError('VALIDATION_FAILED', '账号同步仅允许 HTTPS 服务端或本机开发地址')
    }
  }

  private requireUserId(): string {
    const userId = this.auth.getCurrentUserId()
    if (userId == null) throw new SparkError('VALIDATION_FAILED', '请先登录 SparkWork 账号')
    return userId
  }
}
