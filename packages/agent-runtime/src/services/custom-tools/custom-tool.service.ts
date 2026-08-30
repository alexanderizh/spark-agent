/**
 * CustomToolService — 自定义工具 CRUD / 密钥 / 测试运行 / 导入导出
 *
 * 变更事件驱动两条下游：
 * 1. renderer 流事件（stream:custom-tools:changed）刷新列表
 * 2. 原生 Runtime Catalog 版本刷新 → 下一 turn 获取新的工具快照
 */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {
  CustomToolDraft,
  CustomToolDetails,
  CustomToolInvocationSource,
  CustomToolInvocationStatus,
  CustomToolInvocationTrace,
  CustomToolOrigin,
  CustomToolRecord,
  CustomToolSummary,
  CustomToolWorkspace,
  CustomToolsExportPayload,
  CustomToolTestRunResult,
  CustomToolType,
} from '@spark/protocol'
import {
  CUSTOM_TOOL_EXPORT_MAX,
  CustomToolsExportPayloadSchema,
  RISK_ORDER,
  toCustomToolSummary,
} from '@spark/protocol'
import { CustomToolRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { KeystoreRef } from '@spark/shared/keystore'
import { deleteSecret, getSecret, hasSecret, setSecret } from '@spark/shared/keystore'
import { createLogger } from '@spark/shared'
import { CustomToolError, isCustomToolError } from './custom-tool-errors.js'
import { executeCustomTool } from './custom-tool-executor.js'
import type { ExecutorResult } from './custom-tool-executor.js'

const log = createLogger('custom-tools')
const TRACE_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1_000

export interface CustomToolChangeEvent {
  change:
    | 'created'
    | 'updated'
    | 'deleted'
    | 'enabled'
    | 'imported'
    | 'draft'
    | 'published'
    | 'rolled-back'
  id?: string
  /** false 表示只刷新管理界面，不刷新下一 turn 的 Runtime Catalog。 */
  runtimeChanged?: boolean
}

export type CustomToolSecretStatus = Record<string, boolean>

/** 原生可执行适配器；SQL/command/prompt 保留协议兼容但尚未进入稳定运行面。 */
const AVAILABLE_TYPES: ReadonlySet<CustomToolType> = new Set(['http', 'code', 'provider-vision'])
const MAX_COMPOSED_TOOL_DEPTH = 8

function decodeComposedToolOutput(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function secretKeystoreRef(toolId: string, name: string): KeystoreRef {
  return `custom-tool:${toolId}:${name}` as KeystoreRef
}

/** 泛型保持判别联合成员类型，避免 `{...union}` 展宽导致不可赋值 */
function withPersistence<D extends CustomToolDraft>(
  draft: D,
  fields: {
    enabled: boolean
    origin: CustomToolOrigin
    publishedVersion: number | null
    draftVersion: number
    lastTestAt: string | null
    createdAt: string
    updatedAt: string
  },
): CustomToolRecord {
  return { ...draft, ...fields }
}

export class CustomToolService {
  private readonly repository: CustomToolRepository
  private readonly db: SparkDatabase
  private readonly listeners = new Set<(event: CustomToolChangeEvent) => void>()
  private lastTracePruneAt = 0

  constructor(db: SparkDatabase) {
    this.db = db
    this.repository = new CustomToolRepository(db)
    this.repository.ensureVersionHistory()
  }

  onChange(listener: (event: CustomToolChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: CustomToolChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        log.warn('custom tool change listener failed', { error: String(error) })
      }
    }
  }

  // ─── 查询 ──────────────────────────────────────────────────────────

  list(query?: string): CustomToolSummary[] {
    return this.repository.list(query).map(toCustomToolSummary)
  }

  async get(id: string): Promise<CustomToolDetails> {
    const record = this.requireRecord(id)
    const secretStatus: CustomToolSecretStatus = {}
    for (const name of Object.keys(record.secretRefs ?? {})) {
      secretStatus[name] = await hasSecret(secretKeystoreRef(id, name))
    }
    return { ...record, secretStatus }
  }

  async getWorkspace(id: string): Promise<CustomToolWorkspace> {
    const record = this.requireRecord(id)
    const draft = this.repository.getDraft(id)
    if (draft == null) {
      throw new CustomToolError('EXECUTION_FAILED', `工具 ${id} 的草稿版本缺失`)
    }
    const published = this.repository.getPublished(id)
    if (published === undefined) {
      throw new CustomToolError('NOT_FOUND', `工具 ${id} 不存在`)
    }
    const secretNames = new Set([
      ...Object.keys(record.secretRefs ?? {}),
      ...Object.keys(draft.secretRefs ?? {}),
    ])
    const secretStatus: CustomToolSecretStatus = {}
    for (const name of secretNames) {
      secretStatus[name] = await hasSecret(secretKeystoreRef(id, name))
    }
    return {
      tool: { ...record, secretStatus },
      draft,
      published,
      versions: this.repository.listVersions(id),
    }
  }

  /** 桥的 list_tools 数据源：仅启用的工具 */
  listEnabledRecords(): CustomToolRecord[] {
    return this.repository.listEnabled()
  }

  // ─── 增删改 ────────────────────────────────────────────────────────

  async create(draft: CustomToolDraft): Promise<CustomToolRecord> {
    this.assertTypeAvailable(draft.type)
    if (this.repository.exists(draft.id)) {
      throw new CustomToolError('ALREADY_EXISTS', `工具 ${draft.id} 已存在`)
    }
    this.assertCodeDependencies(draft, true)
    const now = new Date().toISOString()
    const hasToolSecrets = Object.keys(draft.secretRefs ?? {}).length > 0
    const record = withPersistence(draft, {
      // A tool must not enter the Agent tool surface before every referenced
      // Keychain value has been written. The renderer enables it after the
      // create + secret-write sequence completes.
      enabled: !hasToolSecrets,
      origin: 'local',
      publishedVersion: 1,
      draftVersion: 1,
      lastTestAt: null,
      createdAt: now,
      updatedAt: now,
    })
    this.repository.create(record)
    log.info('custom tool created', { id: record.id, type: record.type })
    this.emit({ change: 'created', id: record.id })
    return record
  }

  async createDraft(draft: CustomToolDraft): Promise<CustomToolWorkspace> {
    this.assertTypeAvailable(draft.type)
    if (this.repository.exists(draft.id)) {
      throw new CustomToolError('ALREADY_EXISTS', `工具 ${draft.id} 已存在`)
    }
    const now = new Date().toISOString()
    const record = withPersistence(draft, {
      enabled: false,
      origin: 'local',
      publishedVersion: null,
      draftVersion: 1,
      lastTestAt: null,
      createdAt: now,
      updatedAt: now,
    })
    this.repository.create(record, 'draft')
    this.emit({ change: 'draft', id: record.id, runtimeChanged: false })
    return this.getWorkspace(record.id)
  }

  async saveDraft(id: string, draft: CustomToolDraft): Promise<CustomToolWorkspace> {
    const existing = this.requireRecord(id)
    if (existing.type !== draft.type) {
      throw new CustomToolError('INVALID_INPUT', '工具类型创建后不可修改')
    }
    this.assertTypeAvailable(draft.type)
    const updated = this.repository.saveDraft(id, draft)
    if (updated == null) throw new CustomToolError('NOT_FOUND', `工具 ${id} 不存在`)
    this.emit({ change: 'draft', id, runtimeChanged: false })
    return this.getWorkspace(id)
  }

  async publish(id: string, expectedDraftVersion?: number): Promise<CustomToolWorkspace> {
    const before = this.requireRecord(id)
    const draft = this.repository.getDraft(id)
    if (draft == null) throw new CustomToolError('EXECUTION_FAILED', `工具 ${id} 的草稿版本缺失`)
    this.assertCodeDependencies(draft, before.publishedVersion == null || before.enabled)
    const missingSecrets = await this.missingSecrets(id, draft)
    if (missingSecrets.length > 0) {
      throw new CustomToolError(
        'SECRET_MISSING',
        `工具 ${id} 缺少密钥：${missingSecrets.join('、')}`,
      )
    }
    let published: CustomToolRecord | undefined
    try {
      published = this.repository.publishDraft(id, expectedDraftVersion)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'CUSTOM_TOOL_DRAFT_CONFLICT') {
        throw new CustomToolError('INVALID_INPUT', '草稿已在其他窗口更新，请刷新后重试')
      }
      if (message === 'CUSTOM_TOOL_NO_PENDING_DRAFT') {
        throw new CustomToolError('INVALID_INPUT', '当前没有待发布草稿')
      }
      throw error
    }
    if (published == null) throw new CustomToolError('NOT_FOUND', `工具 ${id} 不存在`)
    await this.cleanupOrphanSecretsSafely(before, draft)
    this.emit({ change: 'published', id, runtimeChanged: true })
    return this.getWorkspace(id)
  }

  async rollback(id: string, version: number): Promise<CustomToolWorkspace> {
    const before = this.requireRecord(id)
    if (before.publishedVersion == null || before.draftVersion !== before.publishedVersion) {
      throw new CustomToolError('INVALID_INPUT', '请先发布或放弃当前草稿，再执行回滚')
    }
    if (version === before.publishedVersion) {
      throw new CustomToolError('INVALID_INPUT', '目标版本已经是当前发布版本')
    }
    const target = this.repository.getVersionDraft(id, version)
    if (target == null) {
      throw new CustomToolError('NOT_FOUND', `工具 ${id} 的版本 v${version} 不存在`)
    }
    this.assertCodeDependencies(target, before.enabled)
    const missingSecrets = await this.missingSecrets(id, target)
    if (missingSecrets.length > 0) {
      throw new CustomToolError(
        'SECRET_MISSING',
        `工具 ${id} 的历史版本 v${version} 缺少密钥：${missingSecrets.join('、')}`,
      )
    }
    let rolledBack: CustomToolRecord | undefined
    try {
      rolledBack = this.repository.rollback(id, version)
    } catch (error) {
      if (error instanceof Error && error.message === 'CUSTOM_TOOL_VERSION_MISSING') {
        throw new CustomToolError('NOT_FOUND', `工具 ${id} 的版本 v${version} 不存在`)
      }
      throw error
    }
    if (rolledBack == null) throw new CustomToolError('NOT_FOUND', `工具 ${id} 不存在`)
    await this.cleanupOrphanSecretsSafely(before, rolledBack)
    this.emit({ change: 'rolled-back', id, runtimeChanged: true })
    return this.getWorkspace(id)
  }

  async update(id: string, draft: CustomToolDraft): Promise<CustomToolRecord> {
    const existing = this.requireRecord(id)
    if (existing.type !== draft.type) {
      throw new CustomToolError('INVALID_INPUT', '工具类型创建后不可修改')
    }
    this.assertTypeAvailable(draft.type)
    this.assertCodeDependencies(draft, existing.enabled)
    const existingSecretNames = new Set(Object.keys(existing.secretRefs ?? {}))
    const introducesSecret = Object.keys(draft.secretRefs ?? {}).some(
      (name) => !existingSecretNames.has(name),
    )
    // 单条 UPDATE 原子重写整行（含信封），避免 delete+create 之间的数据丢失窗口；
    // enabled/origin/lastTestAt/createdAt 不在字段内，原样保留
    const updated = this.repository.publishImmediate(id, draft)
    if (updated == null) throw new CustomToolError('NOT_FOUND', `工具 ${id} 不存在`)
    if (existing.enabled && introducesSecret) {
      this.repository.update(id, { enabled: false })
    }
    await this.cleanupOrphanSecretsSafely(existing, draft)
    log.info('custom tool updated', { id })
    this.emit({ change: 'updated', id })
    return this.requireRecord(id)
  }

  async delete(id: string): Promise<void> {
    const record = this.requireRecord(id)
    const draft = this.repository.getDraft(id)
    // Disable before crossing the SQLite/Keychain boundary. If Keychain is
    // temporarily unavailable, the record remains visible and retryable but
    // can no longer be invoked by an Agent.
    if (record.enabled) {
      this.repository.update(id, { enabled: false })
      this.emit({ change: 'enabled', id })
    }
    try {
      const secretNames = new Set([
        ...Object.keys(record.secretRefs ?? {}),
        ...Object.keys(draft?.secretRefs ?? {}),
      ])
      for (const name of secretNames) {
        await deleteSecret(secretKeystoreRef(id, name))
      }
    } catch (error) {
      log.warn('custom tool Keychain cleanup failed; tool remains disabled', {
        id,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new CustomToolError(
        'EXECUTION_FAILED',
        '工具已停用，但 Keychain 密钥清理失败；请稍后重试删除',
        { cause: error },
      )
    }
    this.repository.deleteById(id)
    log.info('custom tool deleted', { id })
    this.emit({ change: 'deleted', id })
  }

  async setEnabled(id: string, enabled: boolean): Promise<CustomToolRecord> {
    const record = this.requireRecord(id)
    if (enabled) {
      if (record.publishedVersion == null) {
        throw new CustomToolError('DENIED', `工具 ${record.id} 尚未发布，不能启用`)
      }
      this.assertCodeDependencies(record, true)
      // 未发布草稿可能声明新密钥，但它不能影响当前稳定版本的启停。
      const missingSecrets = await this.missingSecrets(id, record)
      if (missingSecrets.length > 0) {
        throw new CustomToolError(
          'SECRET_MISSING',
          `工具 ${record.id} 缺少密钥：${missingSecrets.join('、')}`,
        )
      }
    }
    const updated = this.repository.update(id, { enabled })
    if (updated == null) throw new CustomToolError('NOT_FOUND', `工具 ${id} 不存在`)
    this.emit({ change: 'enabled', id })
    return updated
  }

  // ─── 密钥 ──────────────────────────────────────────────────────────

  async writeSecret(id: string, name: string, value: string): Promise<void> {
    const record = this.requireRecord(id)
    const draft = this.repository.getDraft(id)
    const refs = { ...(record.secretRefs ?? {}), ...(draft?.secretRefs ?? {}) }
    if (!(name in refs)) {
      throw new CustomToolError('INVALID_INPUT', `工具 ${id} 未声明密钥位 ${name}`)
    }
    await setSecret(secretKeystoreRef(id, name), value)
    log.info('custom tool secret written', { id, name })
  }

  async secretStatus(id: string): Promise<CustomToolSecretStatus> {
    const record = this.requireRecord(id)
    const draft = this.repository.getDraft(id)
    const status: CustomToolSecretStatus = {}
    const names = new Set([
      ...Object.keys(record.secretRefs ?? {}),
      ...Object.keys(draft?.secretRefs ?? {}),
    ])
    for (const name of names) {
      status[name] = await hasSecret(secretKeystoreRef(id, name))
    }
    return status
  }

  /** 执行期密钥解析：缺失即报 SECRET_MISSING（Runtime Catalog 与 test-run 共用） */
  async resolveSecrets(record: CustomToolRecord): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {}
    for (const name of Object.keys(record.secretRefs ?? {})) {
      const value = await getSecret(secretKeystoreRef(record.id, name))
      if (value == null) {
        throw new CustomToolError(
          'SECRET_MISSING',
          `工具 ${record.id} 的密钥 ${name} 尚未写入密钥库`,
        )
      }
      resolved[name] = value
    }
    return resolved
  }

  // ─── 测试运行 ──────────────────────────────────────────────────────

  async testRun(params: {
    toolId?: string
    draftSpec?: CustomToolDraft
    input: Record<string, unknown>
    signal?: AbortSignal
  }): Promise<CustomToolTestRunResult> {
    let record: CustomToolRecord
    let traceToolVersion: number | null = null
    const persistedRecord = params.toolId != null ? this.requireRecord(params.toolId) : null
    if (params.draftSpec != null) {
      this.assertTypeAvailable(params.draftSpec.type)
      if (persistedRecord != null) {
        if (params.draftSpec.id !== persistedRecord.id) {
          throw new CustomToolError('INVALID_INPUT', '测试草稿与密钥来源工具 ID 不一致')
        }
        if (params.draftSpec.type !== persistedRecord.type) {
          throw new CustomToolError('INVALID_INPUT', '测试草稿与已保存工具类型不一致')
        }
        const persistedDraft = this.repository.getDraft(persistedRecord.id)
        if (persistedDraft != null && isDeepStrictEqual(params.draftSpec, persistedDraft)) {
          traceToolVersion = persistedRecord.draftVersion
        }
        const persistedSecretNames = new Set([
          ...Object.keys(persistedRecord.secretRefs ?? {}),
          ...Object.keys(persistedDraft?.secretRefs ?? {}),
        ])
        const undeclaredSecret = Object.keys(params.draftSpec.secretRefs ?? {}).find(
          (name) => !persistedSecretNames.has(name),
        )
        if (undeclaredSecret != null) {
          throw new CustomToolError(
            'INVALID_INPUT',
            `测试草稿引用了未保存的密钥位 ${undeclaredSecret}`,
          )
        }
      } else if (
        params.draftSpec.secretRefs != null &&
        Object.keys(params.draftSpec.secretRefs).length > 0
      ) {
        throw new CustomToolError('INVALID_INPUT', '引用密钥的工具请先保存并写入密钥后再测试运行')
      }
      const now = new Date().toISOString()
      record = withPersistence(params.draftSpec, {
        enabled: false,
        origin: 'local',
        publishedVersion: persistedRecord?.draftVersion ?? null,
        draftVersion: persistedRecord?.draftVersion ?? 1,
        lastTestAt: null,
        createdAt: now,
        updatedAt: now,
      })
    } else if (persistedRecord != null) {
      record = persistedRecord
      traceToolVersion = persistedRecord.publishedVersion
    } else {
      throw new CustomToolError('INVALID_INPUT', 'testRun 需要 toolId 或 draftSpec')
    }

    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), record.timeoutMs)
    const onOuterAbort = () => controller.abort()
    const outerSignal = params.signal
    if (outerSignal != null) {
      if (outerSignal.aborted) controller.abort()
      else outerSignal.addEventListener('abort', onOuterAbort, { once: true })
    }

    try {
      const secrets = await this.resolveSecrets(record)
      const result: ExecutorResult = await executeCustomTool(record, params.input, {
        signal: controller.signal,
        database: this.db,
        resolveSecret: async (name) => {
          const value = secrets[name]
          if (value == null) {
            throw new CustomToolError('SECRET_MISSING', `密钥 ${name} 未解析`)
          }
          return value
        },
        invokeTool: async (toolId, input) => {
          const nested = await this.executeEnabled({
            toolId,
            input,
            source: 'direct',
            signal: controller.signal,
            callStack: [record.id],
          })
          return decodeComposedToolOutput(nested.text)
        },
      })
      const traceId = this.recordInvocationSafely({
        record,
        toolVersion: traceToolVersion,
        input: params.input,
        source: 'direct',
        status: 'ok',
        durationMs: result.meta.durationMs,
        outputBytes: result.meta.bytes,
      })
      return {
        ok: true,
        text: result.text,
        meta: result.meta,
        ...(traceId != null ? { traceId } : {}),
      }
    } catch (error) {
      const toolCode = isCustomToolError(error) ? error.toolCode : 'EXECUTION_FAILED'
      const message = error instanceof Error ? error.message : String(error)
      const durationMs = Date.now() - startedAt
      const traceId = this.recordInvocationSafely({
        record,
        toolVersion: traceToolVersion,
        input: params.input,
        source: 'direct',
        status: controller.signal.aborted ? 'timeout' : 'error',
        durationMs,
        errorCode: toolCode,
      })
      return {
        ok: false,
        text: message,
        meta: { durationMs, bytes: 0, truncated: false },
        errorCode: toolCode,
        ...(traceId != null ? { traceId } : {}),
      }
    } finally {
      // 无论成败都记录最近测试时间（UI 展示“最近测试状态”）
      if (params.toolId != null) {
        this.repository.update(params.toolId, { lastTestAt: new Date().toISOString() })
      }
      clearTimeout(timer)
      outerSignal?.removeEventListener('abort', onOuterAbort)
    }
  }

  /** Native runtime entry: unlike testRun, disabled tools are rejected and the
   * editor-only lastTestAt field is not mutated. */
  async executeEnabled(params: {
    toolId: string
    input: Record<string, unknown>
    sessionId?: string
    turnId?: string
    source?: CustomToolInvocationSource
    signal?: AbortSignal
    /** Internal recursion guard for native code-tool composition. */
    callStack?: string[]
  }): Promise<ExecutorResult> {
    const callStack = params.callStack ?? []
    if (callStack.includes(params.toolId)) {
      throw new CustomToolError(
        'DENIED',
        `检测到自定义工具循环调用：${[...callStack, params.toolId].join(' → ')}`,
      )
    }
    if (callStack.length >= MAX_COMPOSED_TOOL_DEPTH) {
      throw new CustomToolError('DENIED', `自定义工具组合调用深度超过 ${MAX_COMPOSED_TOOL_DEPTH}`)
    }
    const record = this.requireRecord(params.toolId)
    if (!record.enabled) {
      const traceId = this.recordInvocationSafely({
        record,
        input: params.input,
        source: params.source ?? 'model',
        status: 'denied',
        durationMs: 0,
        errorCode: 'DENIED',
        ...(params.sessionId != null ? { sessionId: params.sessionId } : {}),
        ...(params.turnId != null ? { turnId: params.turnId } : {}),
      })
      throw new CustomToolError('DENIED', `工具 ${record.id} 已停用`).attachTraceId(traceId)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), record.timeoutMs)
    const onOuterAbort = () => controller.abort()
    const startedAt = Date.now()
    if (params.signal != null) {
      if (params.signal.aborted) controller.abort()
      else params.signal.addEventListener('abort', onOuterAbort, { once: true })
    }
    try {
      const secrets = await this.resolveSecrets(record)
      const result = await executeCustomTool(record, params.input, {
        signal: controller.signal,
        database: this.db,
        ...(params.sessionId != null ? { sessionId: params.sessionId } : {}),
        resolveSecret: async (name) => {
          const value = secrets[name]
          if (value == null) throw new CustomToolError('SECRET_MISSING', `密钥 ${name} 未解析`)
          return value
        },
        invokeTool: async (toolId, input) => {
          const nested = await this.executeEnabled({
            toolId,
            input,
            ...(params.sessionId != null ? { sessionId: params.sessionId } : {}),
            ...(params.turnId != null ? { turnId: params.turnId } : {}),
            source: params.source ?? 'model',
            signal: controller.signal,
            callStack: [...callStack, record.id],
          })
          return decodeComposedToolOutput(nested.text)
        },
      })
      const traceId = this.recordInvocationSafely({
        record,
        input: params.input,
        source: params.source ?? 'model',
        status: 'ok',
        durationMs: result.meta.durationMs,
        outputBytes: result.meta.bytes,
        ...(params.sessionId != null ? { sessionId: params.sessionId } : {}),
        ...(params.turnId != null ? { turnId: params.turnId } : {}),
      })
      return { ...result, ...(traceId != null ? { traceId } : {}) }
    } catch (error) {
      const errorCode = isCustomToolError(error) ? error.toolCode : 'EXECUTION_FAILED'
      const traceId = this.recordInvocationSafely({
        record,
        input: params.input,
        source: params.source ?? 'model',
        status: errorCode === 'DENIED' ? 'denied' : controller.signal.aborted ? 'timeout' : 'error',
        durationMs: Date.now() - startedAt,
        errorCode,
        ...(params.sessionId != null ? { sessionId: params.sessionId } : {}),
        ...(params.turnId != null ? { turnId: params.turnId } : {}),
      })
      if (isCustomToolError(error)) throw error.attachTraceId(traceId)
      throw new CustomToolError(
        'EXECUTION_FAILED',
        error instanceof Error ? error.message : String(error),
        { cause: error },
      ).attachTraceId(traceId)
    } finally {
      clearTimeout(timer)
      params.signal?.removeEventListener('abort', onOuterAbort)
    }
  }

  listInvocations(params: {
    toolId?: string
    status?: CustomToolInvocationStatus
    limit?: number
  }): CustomToolInvocationTrace[] {
    this.pruneInvocationHistoryIfDue(true)
    return this.repository.listInvocations(params)
  }

  getInvocationRetentionDays(): number {
    return this.repository.getInvocationRetentionDays()
  }

  setInvocationRetentionDays(retentionDays: number): { retentionDays: number; deleted: number } {
    const normalized = this.repository.setInvocationRetentionDays(retentionDays)
    const deleted = this.pruneInvocationHistoryIfDue(true)
    return { retentionDays: normalized, deleted }
  }

  clearInvocations(toolId?: string): number {
    return this.repository.deleteInvocations(toolId)
  }

  // ─── 导入导出 ──────────────────────────────────────────────────────

  export(ids?: string[]): CustomToolsExportPayload {
    const records =
      ids == null || ids.length === 0
        ? this.repository.list()
        : ids.map((id) => this.requireRecord(id))
    if (records.length > CUSTOM_TOOL_EXPORT_MAX) {
      throw new CustomToolError('INVALID_INPUT', `导出数量超过上限 ${CUSTOM_TOOL_EXPORT_MAX}`)
    }
    return {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      tools: records.map((record) => {
        const {
          enabled: _enabled,
          origin: _origin,
          publishedVersion: _publishedVersion,
          draftVersion: _draftVersion,
          lastTestAt: _lastTestAt,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          ...draft
        } = record
        return {
          spec: draft,
          ...(Object.keys(draft.secretRefs ?? {}).length > 0
            ? { secretNames: Object.keys(draft.secretRefs ?? {}) }
            : {}),
        }
      }),
    }
  }

  async import(
    payload: unknown,
  ): Promise<{ imported: CustomToolSummary[]; skipped: Array<{ id: string; reason: string }> }> {
    const parsed = CustomToolsExportPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      throw new CustomToolError(
        'INVALID_INPUT',
        `导入文件结构不合法：${parsed.error.issues[0]?.message ?? '未知错误'}`,
      )
    }
    const imported: CustomToolSummary[] = []
    const skipped: Array<{ id: string; reason: string }> = []
    const now = new Date().toISOString()

    for (const entry of parsed.data.tools) {
      const draft = entry.spec
      this.assertImportableType(draft.type, draft.id, skipped)
      if (skipped.some((item) => item.id === draft.id)) continue
      if (this.repository.exists(draft.id)) {
        skipped.push({ id: draft.id, reason: '已存在同名工具' })
        continue
      }
      const record = withPersistence(draft, {
        enabled: false,
        origin: 'imported',
        publishedVersion: null,
        draftVersion: 1,
        lastTestAt: null,
        createdAt: now,
        updatedAt: now,
      })
      this.repository.create(record, 'draft')
      imported.push(toCustomToolSummary(record))
    }

    if (imported.length > 0) {
      log.info('custom tools imported', { count: imported.length })
      this.emit({ change: 'imported', runtimeChanged: false })
    }
    return { imported, skipped }
  }

  // ─── 内部工具 ──────────────────────────────────────────────────────

  private requireRecord(id: string): CustomToolRecord {
    const record = this.repository.get(id)
    if (record == null) throw new CustomToolError('NOT_FOUND', `工具 ${id} 不存在`)
    return record
  }

  private assertTypeAvailable(type: CustomToolType): void {
    if (!AVAILABLE_TYPES.has(type)) {
      throw new CustomToolError(
        'NOT_IMPLEMENTED',
        `「${type}」类型工具尚未开放（当前版本支持 http、code、provider-vision）`,
      )
    }
  }

  private assertCodeDependencies(draft: CustomToolDraft, requireEnabled: boolean): void {
    if (draft.type !== 'code') return
    const visiting: string[] = []
    const longestPath = new Map<string, number>()

    const visit = (toolId: string): number => {
      const cycleStart = visiting.indexOf(toolId)
      if (cycleStart >= 0) {
        throw new CustomToolError(
          'INVALID_INPUT',
          `检测到自定义工具循环依赖：${[...visiting.slice(cycleStart), toolId].join(' → ')}`,
        )
      }
      const cached = longestPath.get(toolId)
      if (cached != null) return cached

      const dependency = toolId === draft.id ? draft : this.repository.get(toolId)
      if (
        dependency == null ||
        ('publishedVersion' in dependency && dependency.publishedVersion == null)
      ) {
        throw new CustomToolError('INVALID_INPUT', `代码工具依赖 ${toolId} 不存在或尚未发布`)
      }
      if (toolId !== draft.id && requireEnabled && 'enabled' in dependency && !dependency.enabled) {
        throw new CustomToolError('DENIED', `代码工具依赖 ${toolId} 当前已停用`)
      }
      if (toolId !== draft.id && RISK_ORDER[draft.risk] < RISK_ORDER[dependency.risk]) {
        throw new CustomToolError(
          'INVALID_INPUT',
          `代码工具风险等级不能低于依赖 ${toolId}（${dependency.risk}）`,
        )
      }

      visiting.push(toolId)
      let depth = 1
      if (dependency.type === 'code') {
        for (const nestedId of dependency.spec.permissions.toolIds) {
          depth = Math.max(depth, 1 + visit(nestedId))
        }
      }
      visiting.pop()
      longestPath.set(toolId, depth)
      return depth
    }

    const depth = visit(draft.id)
    if (depth > MAX_COMPOSED_TOOL_DEPTH) {
      throw new CustomToolError(
        'INVALID_INPUT',
        `自定义工具组合依赖深度超过 ${MAX_COMPOSED_TOOL_DEPTH}`,
      )
    }
  }

  private assertImportableType(
    type: CustomToolType,
    id: string,
    skipped: Array<{ id: string; reason: string }>,
  ): void {
    if (!AVAILABLE_TYPES.has(type)) {
      skipped.push({ id, reason: `类型 ${type} 当前版本不支持` })
    }
  }

  /** 更新后清理不再被引用的密钥位 */
  private async cleanupOrphanSecrets(
    before: CustomToolRecord,
    after: CustomToolDraft,
  ): Promise<void> {
    const kept = new Set(Object.keys(after.secretRefs ?? {}))
    for (const name of Object.keys(before.secretRefs ?? {})) {
      if (!kept.has(name)) {
        await deleteSecret(secretKeystoreRef(before.id, name))
      }
    }
  }

  private async cleanupOrphanSecretsSafely(
    before: CustomToolRecord,
    after: CustomToolDraft,
  ): Promise<void> {
    try {
      await this.cleanupOrphanSecrets(before, after)
    } catch (error) {
      log.warn('custom tool orphan secret cleanup failed after stable mutation', {
        toolId: before.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async missingSecrets(id: string, draft: CustomToolDraft): Promise<string[]> {
    const missing: string[] = []
    for (const name of Object.keys(draft.secretRefs ?? {})) {
      if (!(await hasSecret(secretKeystoreRef(id, name)))) missing.push(name)
    }
    return missing
  }

  private recordInvocationSafely(input: {
    record: CustomToolRecord
    toolVersion?: number | null
    input: Record<string, unknown>
    source: CustomToolInvocationSource
    status: CustomToolInvocationStatus
    durationMs: number
    outputBytes?: number
    errorCode?: string
    sessionId?: string
    turnId?: string
  }): number | undefined {
    try {
      this.pruneInvocationHistoryIfDue()
      return this.repository.recordInvocation({
        toolId: input.record.id,
        toolVersion:
          input.toolVersion === undefined ? input.record.publishedVersion : input.toolVersion,
        inputSha256: createHash('sha256').update(JSON.stringify(input.input)).digest('hex'),
        source: input.source,
        status: input.status,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        ...(input.outputBytes != null ? { outputBytes: input.outputBytes } : {}),
        ...(input.errorCode != null ? { errorCode: input.errorCode } : {}),
        ...(input.sessionId != null ? { sessionId: input.sessionId } : {}),
        ...(input.turnId != null ? { turnId: input.turnId } : {}),
      })
    } catch (error) {
      log.warn('custom tool trace write failed', {
        toolId: input.record.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  private pruneInvocationHistoryIfDue(force = false): number {
    const now = Date.now()
    if (!force && now - this.lastTracePruneAt < TRACE_PRUNE_INTERVAL_MS) return 0
    const deleted = this.repository.pruneInvocations(now)
    this.lastTracePruneAt = now
    return deleted
  }
}
