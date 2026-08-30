/**
 * CustomToolService — 自定义工具 CRUD / 密钥 / 测试运行 / 导入导出
 *
 * 变更事件驱动两条下游：
 * 1. renderer 流事件（stream:custom-tools:changed）刷新列表
 * 2. McpService 外部变更通知 → mcpVersion bump → 下一 turn 工具面生效（§4.3）
 */

import type {
  CustomToolDraft,
  CustomToolDetails,
  CustomToolOrigin,
  CustomToolRecord,
  CustomToolSummary,
  CustomToolsExportPayload,
  CustomToolTestRunResult,
  CustomToolType,
} from '@spark/protocol'
import {
  CUSTOM_TOOL_EXPORT_MAX,
  CustomToolsExportPayloadSchema,
  toCustomToolSummary,
} from '@spark/protocol'
import { CustomToolRepository } from '@spark/storage'
import type { CustomToolSpecEnvelope, SparkDatabase } from '@spark/storage'
import type { KeystoreRef } from '@spark/shared/keystore'
import { deleteSecret, getSecret, hasSecret, setSecret } from '@spark/shared/keystore'
import { createLogger } from '@spark/shared'
import { CustomToolError, isCustomToolError } from './custom-tool-errors.js'
import { executeCustomTool } from './custom-tool-executor.js'
import type { ExecutorResult } from './custom-tool-executor.js'

const log = createLogger('custom-tools')

export interface CustomToolChangeEvent {
  change: 'created' | 'updated' | 'deleted' | 'enabled' | 'imported'
  id?: string
}

export type CustomToolSecretStatus = Record<string, boolean>

/** M1 仅开放 http 执行器；sql/command(M2)、prompt(M3) 协议契约先行、创建时拦截 */
const AVAILABLE_TYPES: ReadonlySet<CustomToolType> = new Set(['http'])

function secretKeystoreRef(toolId: string, name: string): KeystoreRef {
  return `custom-tool:${toolId}:${name}` as KeystoreRef
}

/** 泛型保持判别联合成员类型，避免 `{...union}` 展宽导致不可赋值 */
function withPersistence<D extends CustomToolDraft>(
  draft: D,
  fields: {
    enabled: boolean
    origin: CustomToolOrigin
    lastTestAt: string | null
    createdAt: string
    updatedAt: string
  },
): CustomToolRecord {
  return { ...draft, ...fields }
}

export class CustomToolService {
  private readonly repository: CustomToolRepository
  private readonly listeners = new Set<(event: CustomToolChangeEvent) => void>()

  constructor(db: SparkDatabase) {
    this.repository = new CustomToolRepository(db)
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
    const now = new Date().toISOString()
    const record = withPersistence(draft, {
      enabled: true,
      origin: 'local',
      lastTestAt: null,
      createdAt: now,
      updatedAt: now,
    })
    this.repository.create(record)
    log.info('custom tool created', { id: record.id, type: record.type })
    this.emit({ change: 'created', id: record.id })
    return record
  }

  async update(id: string, draft: CustomToolDraft): Promise<CustomToolRecord> {
    const existing = this.requireRecord(id)
    if (existing.type !== draft.type) {
      throw new CustomToolError('INVALID_INPUT', '工具类型创建后不可修改')
    }
    this.assertTypeAvailable(draft.type)
    const envelope: CustomToolSpecEnvelope = {
      spec: draft.spec,
      ...(draft.secretRefs != null && Object.keys(draft.secretRefs).length > 0
        ? { secretRefs: draft.secretRefs }
        : {}),
    }
    // 单条 UPDATE 原子重写整行（含信封），避免 delete+create 之间的数据丢失窗口；
    // enabled/origin/lastTestAt/createdAt 不在字段内，原样保留
    const updated = this.repository.update(id, {
      title: draft.title,
      description: draft.description,
      inputSchema: draft.inputSchema,
      envelope,
      risk: draft.risk,
      effect: draft.effect,
      idempotency: draft.idempotency,
      timeoutMs: draft.timeoutMs,
    })
    if (updated == null) throw new CustomToolError('NOT_FOUND', `工具 ${id} 不存在`)
    await this.cleanupOrphanSecrets(existing, draft)
    log.info('custom tool updated', { id })
    this.emit({ change: 'updated', id })
    return updated
  }

  async delete(id: string): Promise<void> {
    const record = this.requireRecord(id)
    this.repository.deleteById(id)
    for (const name of Object.keys(record.secretRefs ?? {})) {
      await deleteSecret(secretKeystoreRef(id, name))
    }
    log.info('custom tool deleted', { id })
    this.emit({ change: 'deleted', id })
  }

  setEnabled(id: string, enabled: boolean): CustomToolRecord {
    this.requireRecord(id)
    const updated = this.repository.update(id, { enabled })
    if (updated == null) throw new CustomToolError('NOT_FOUND', `工具 ${id} 不存在`)
    this.emit({ change: 'enabled', id })
    return updated
  }

  // ─── 密钥 ──────────────────────────────────────────────────────────

  async writeSecret(id: string, name: string, value: string): Promise<void> {
    const record = this.requireRecord(id)
    const refs = record.secretRefs ?? {}
    if (!(name in refs)) {
      throw new CustomToolError('INVALID_INPUT', `工具 ${id} 未声明密钥位 ${name}`)
    }
    await setSecret(secretKeystoreRef(id, name), value)
    log.info('custom tool secret written', { id, name })
  }

  async secretStatus(id: string): Promise<CustomToolSecretStatus> {
    const record = this.requireRecord(id)
    const status: CustomToolSecretStatus = {}
    for (const name of Object.keys(record.secretRefs ?? {})) {
      status[name] = await hasSecret(secretKeystoreRef(id, name))
    }
    return status
  }

  /** 执行期密钥解析：缺失即报 SECRET_MISSING（桥与 test-run 共用） */
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
    if (params.toolId != null) {
      record = this.requireRecord(params.toolId)
    } else if (params.draftSpec != null) {
      this.assertTypeAvailable(params.draftSpec.type)
      if (
        params.draftSpec.secretRefs != null &&
        Object.keys(params.draftSpec.secretRefs).length > 0
      ) {
        throw new CustomToolError('INVALID_INPUT', '引用密钥的工具请先保存并写入密钥后再测试运行')
      }
      const now = new Date().toISOString()
      record = withPersistence(params.draftSpec, {
        enabled: false,
        origin: 'local',
        lastTestAt: null,
        createdAt: now,
        updatedAt: now,
      })
    } else {
      throw new CustomToolError('INVALID_INPUT', 'testRun 需要 toolId 或 draftSpec')
    }

    const secrets = await this.resolveSecrets(record)
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
      const result: ExecutorResult = await executeCustomTool(record, params.input, {
        signal: controller.signal,
        resolveSecret: async (name) => {
          const value = secrets[name]
          if (value == null) {
            throw new CustomToolError('SECRET_MISSING', `密钥 ${name} 未解析`)
          }
          return value
        },
      })
      return { ok: true, text: result.text, meta: result.meta }
    } catch (error) {
      const toolCode = isCustomToolError(error) ? error.toolCode : 'EXECUTION_FAILED'
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        text: message,
        meta: { durationMs: Date.now() - startedAt, bytes: 0, truncated: false },
        errorCode: toolCode,
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
        lastTestAt: null,
        createdAt: now,
        updatedAt: now,
      })
      this.repository.create(record)
      imported.push(toCustomToolSummary(record))
    }

    if (imported.length > 0) {
      log.info('custom tools imported', { count: imported.length })
      this.emit({ change: 'imported' })
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
        `「${type}」类型工具尚未开放（当前版本支持 http）`,
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
}
