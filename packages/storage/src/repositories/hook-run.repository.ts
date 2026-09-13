import { randomUUID } from 'node:crypto'
import type {
  HookBindingV1,
  HookDefinitionV1,
  HookEventEnvelopeV1,
  HookEventNameV1,
  HookErrorCodeV1,
  HookRunStatusV1,
  HookRunV1,
  HookScopeKindV1,
} from '@spark/protocol'
import type { SparkDatabase } from '../database.js'
import { BaseRepository } from './base.repository.js'

export interface HookRunRow {
  id: string
  event_id: string
  event_name: string
  hook_id: string
  hook_revision: number
  binding_id: string
  scope_kind: string
  session_id: string
  turn_id: string
  definition_snapshot_json: string
  binding_snapshot_json: string
  envelope_json: string
  mapped_input_json: string | null
  status: HookRunStatusV1
  attempt_count: number
  available_at: string
  lease_owner: string | null
  lease_expires_at: string | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  error_code: string | null
  error_message: string | null
  input_summary_json: string | null
  output_summary_json: string | null
  correlation_id: string | null
  invocation_id: string | null
  is_test: number
  created_at: string
  updated_at: string
}

export interface CreateHookRunParams {
  id?: string
  eventId: string
  eventName: HookEventNameV1
  hookId: string
  hookRevision: number
  bindingId: string
  scopeKind: HookScopeKindV1
  sessionId: string
  turnId: string
  definitionSnapshot: HookDefinitionV1
  bindingSnapshot: HookBindingV1
  envelope: HookEventEnvelopeV1
  mappedInput?: Record<string, unknown>
  status?: HookRunStatusV1
  errorCode?: HookErrorCodeV1
  errorMessage?: string
  availableAt?: string
  /** §14 测试运行：用户显式确认后的独立试运行。 */
  isTest?: boolean
}

export interface FinishHookRunParams {
  status: HookRunStatusV1
  errorCode?: HookErrorCodeV1
  errorMessage?: string
  durationMs?: number
  mappedInput?: Record<string, unknown>
  inputSummary?: Record<string, unknown>
  outputSummary?: Record<string, unknown>
  correlationId?: string
  invocationId?: string
}

function toDomain(row: HookRunRow): HookRunV1 {
  const inputSummary =
    row.input_summary_json != null
      ? (JSON.parse(row.input_summary_json) as Record<string, unknown>)
      : undefined
  const outputSummary =
    row.output_summary_json != null
      ? (JSON.parse(row.output_summary_json) as Record<string, unknown>)
      : undefined
  return {
    id: row.id,
    eventId: row.event_id,
    eventName: row.event_name as HookEventNameV1,
    hookId: row.hook_id,
    hookRevision: row.hook_revision,
    bindingId: row.binding_id,
    scopeKind: row.scope_kind as HookScopeKindV1,
    sessionId: row.session_id,
    turnId: row.turn_id,
    status: row.status,
    attemptCount: row.attempt_count,
    availableAt: row.available_at,
    ...(row.started_at != null ? { startedAt: row.started_at } : {}),
    ...(row.finished_at != null ? { finishedAt: row.finished_at } : {}),
    ...(row.duration_ms != null ? { durationMs: row.duration_ms } : {}),
    ...(row.error_code != null ? { errorCode: row.error_code as HookErrorCodeV1 } : {}),
    ...(row.error_message != null ? { errorMessage: row.error_message } : {}),
    ...(inputSummary != null ? { inputSummary } : {}),
    ...(outputSummary != null ? { outputSummary } : {}),
    ...(row.correlation_id != null ? { correlationId: row.correlation_id } : {}),
    ...(row.invocation_id != null ? { invocationId: row.invocation_id } : {}),
    isTest: row.is_test === 1,
    definitionSnapshot: JSON.parse(row.definition_snapshot_json) as HookDefinitionV1,
    bindingSnapshot: JSON.parse(row.binding_snapshot_json) as HookBindingV1,
    envelope: JSON.parse(row.envelope_json) as HookEventEnvelopeV1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class HookRunRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'hook_runs')
  }

  /** (event_id, hook_id) 唯一约束保证同一事件同一 Hook 只有一条运行记录。 */
  insertIfAbsent(params: CreateHookRunParams): HookRunV1 | null {
    const id = params.id ?? randomUUID()
    const now = new Date().toISOString()
    const result = this.raw
      .prepare(
        `INSERT OR IGNORE INTO hook_runs (
          id, event_id, event_name, hook_id, hook_revision, binding_id, scope_kind,
          session_id, turn_id, definition_snapshot_json, binding_snapshot_json, envelope_json,
          mapped_input_json, status, attempt_count, available_at, error_code, error_message,
          is_test, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.eventId,
        params.eventName,
        params.hookId,
        params.hookRevision,
        params.bindingId,
        params.scopeKind,
        params.sessionId,
        params.turnId,
        JSON.stringify(params.definitionSnapshot),
        JSON.stringify(params.bindingSnapshot),
        JSON.stringify(params.envelope),
        params.mappedInput != null ? JSON.stringify(params.mappedInput) : null,
        params.status ?? 'queued',
        params.availableAt ?? now,
        params.errorCode ?? null,
        params.errorMessage ?? null,
        params.isTest === true ? 1 : 0,
        now,
        now,
      )
    if (result.changes === 0) return null
    return this.get(id)
  }

  get(id: string): HookRunV1 | null {
    const row = this.raw.prepare('SELECT * FROM hook_runs WHERE id = ?').get(id) as
      | HookRunRow
      | undefined
    return row != null ? toDomain(row) : null
  }

  getByEventAndHook(eventId: string, hookId: string): HookRunV1 | null {
    const row = this.raw
      .prepare('SELECT * FROM hook_runs WHERE event_id = ? AND hook_id = ?')
      .get(eventId, hookId) as HookRunRow | undefined
    return row != null ? toDomain(row) : null
  }

  list(
    filters: {
      sessionId?: string
      hookId?: string
      status?: HookRunStatusV1
      eventId?: string
      eventName?: HookEventNameV1
      scopeKind?: HookScopeKindV1
      /** created_at >= from（ISO）。 */
      from?: string
      /** created_at <= to（ISO）。 */
      to?: string
      limit?: number
    } = {},
  ): HookRunV1[] {
    const conditions: string[] = []
    const values: unknown[] = []
    if (filters.sessionId != null) {
      conditions.push('session_id = ?')
      values.push(filters.sessionId)
    }
    if (filters.hookId != null) {
      conditions.push('hook_id = ?')
      values.push(filters.hookId)
    }
    if (filters.status != null) {
      conditions.push('status = ?')
      values.push(filters.status)
    }
    if (filters.eventId != null) {
      conditions.push('event_id = ?')
      values.push(filters.eventId)
    }
    if (filters.eventName != null) {
      conditions.push('event_name = ?')
      values.push(filters.eventName)
    }
    if (filters.scopeKind != null) {
      conditions.push('scope_kind = ?')
      values.push(filters.scopeKind)
    }
    if (filters.from != null) {
      conditions.push('created_at >= ?')
      values.push(filters.from)
    }
    if (filters.to != null) {
      conditions.push('created_at <= ?')
      values.push(filters.to)
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = Math.min(filters.limit ?? 50, 200)
    const rows = this.raw
      .prepare(`SELECT * FROM hook_runs ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...values, limit) as HookRunRow[]
    return rows.map(toDomain)
  }

  /**
   * 领取下一条可执行运行：queued 且 available_at 已到。
   * serial_per_session 快照要求同 Hook 同会话严格串行——只要存在更早的
   * queued/running（含等待重试）运行，后续运行不得越过。
   */
  claimNextRunnable(owner: string, leaseMs: number): HookRunV1 | null {
    const now = new Date().toISOString()
    const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString()
    const claim = this.raw.transaction((): HookRunV1 | null => {
      // rowid 是插入序（≈事件发生序），同一毫秒内 created_at 相同也能保证确定性排队。
      const candidates = this.raw
        .prepare(
          `SELECT rowid AS ordering_rowid, * FROM hook_runs
           WHERE status = 'queued' AND available_at <= ?
           ORDER BY rowid LIMIT 32`,
        )
        .all(now) as (HookRunRow & { ordering_rowid: number })[]
      for (const candidate of candidates) {
        const snapshot = JSON.parse(candidate.definition_snapshot_json) as HookDefinitionV1
        if (snapshot.concurrencyPolicy === 'serial_per_session') {
          const blocker = this.raw
            .prepare(
              `SELECT id FROM hook_runs
               WHERE hook_id = ? AND session_id = ? AND rowid != ?
                 AND status IN ('queued', 'running')
                 AND rowid < ?
               LIMIT 1`,
            )
            .get(
              candidate.hook_id,
              candidate.session_id,
              candidate.ordering_rowid,
              candidate.ordering_rowid,
            )
          if (blocker != null) continue
        }
        this.raw
          .prepare(
            `UPDATE hook_runs SET status = 'running', lease_owner = ?, lease_expires_at = ?,
             attempt_count = attempt_count + 1, started_at = COALESCE(started_at, ?),
             updated_at = ?
             WHERE id = ? AND status = 'queued'`,
          )
          .run(owner, leaseExpiresAt, now, now, candidate.id)
        return this.get(candidate.id)
      }
      return null
    })
    return claim()
  }

  renewLease(id: string, owner: string, leaseMs: number): void {
    this.raw
      .prepare(
        `UPDATE hook_runs SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ?`,
      )
      .run(owner, new Date(Date.now() + leaseMs).toISOString(), new Date().toISOString(), id, owner)
  }

  finish(id: string, params: FinishHookRunParams): HookRunV1 | null {
    const now = new Date().toISOString()
    const startedAt = this.raw.prepare('SELECT started_at FROM hook_runs WHERE id = ?').get(id) as
      | { started_at: string | null }
      | undefined
    const durationMs =
      params.durationMs ??
      (startedAt?.started_at != null ? Date.now() - Date.parse(startedAt.started_at) : undefined)
    this.raw
      .prepare(
        `UPDATE hook_runs SET
           status = ?, error_code = ?, error_message = ?, finished_at = ?, duration_ms = ?,
           mapped_input_json = COALESCE(?, mapped_input_json),
           input_summary_json = COALESCE(?, input_summary_json),
           output_summary_json = COALESCE(?, output_summary_json),
           correlation_id = COALESCE(?, correlation_id),
           invocation_id = COALESCE(?, invocation_id),
           lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        params.status,
        params.errorCode ?? null,
        params.errorMessage?.slice(0, 2000) ?? null,
        now,
        durationMs ?? null,
        params.mappedInput != null ? JSON.stringify(params.mappedInput) : null,
        params.inputSummary != null ? JSON.stringify(params.inputSummary) : null,
        params.outputSummary != null ? JSON.stringify(params.outputSummary) : null,
        params.correlationId ?? null,
        params.invocationId ?? null,
        now,
        id,
      )
    return this.get(id)
  }

  /** 用户显式重试：终态 failed/blocked/cancelled/outcome_unknown 的运行重新入队。 */
  requeueForManualRetry(id: string): HookRunV1 | null {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `UPDATE hook_runs SET status = 'queued', available_at = ?, error_code = NULL,
         error_message = NULL, finished_at = NULL, duration_ms = NULL, updated_at = ?
         WHERE id = ? AND status IN ('failed', 'blocked', 'cancelled', 'outcome_unknown')`,
      )
      .run(now, now, id)
    return this.get(id)
  }

  /** 自动重试入队：按退避策略延后领取，保留尝试计数与最近一次错误信息。 */
  requeueForAutoRetry(
    id: string,
    availableAt: string,
    errorCode: HookErrorCodeV1,
    errorMessage: string,
  ): HookRunV1 | null {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `UPDATE hook_runs SET status = 'queued', available_at = ?, error_code = ?,
         error_message = ?, finished_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
         updated_at = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(availableAt, errorCode, errorMessage.slice(0, 2000), now, id)
    return this.get(id)
  }

  cancelPending(id: string): HookRunV1 | null {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `UPDATE hook_runs SET status = 'cancelled', finished_at = ?, updated_at = ?
         WHERE id = ? AND status = 'queued'`,
      )
      .run(now, now, id)
    return this.get(id)
  }

  /**
   * 应用启动时的租约回收：过期的 running 运行进入终态 outcome_unknown——
   * 外部副作用可能已发生，不得自动重投；用户可在看到重复副作用警告后显式重试。
   * 返回回收数量。
   */
  recoverExpiredLeasesToOutcomeUnknown(): number {
    const result = this.raw
      .prepare(
        `UPDATE hook_runs SET status = 'outcome_unknown', error_code = 'outcome_unknown',
         finished_at = ?, updated_at = ?, lease_owner = NULL, lease_expires_at = NULL
         WHERE status = 'running'
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
      )
      .run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString())
    return result.changes
  }

  countByStatus(status: HookRunStatusV1): number {
    const row = this.raw
      .prepare('SELECT COUNT(*) AS n FROM hook_runs WHERE status = ?')
      .get(status) as { n: number }
    return row.n
  }

  listRunning(): HookRunV1[] {
    const rows = this.raw
      .prepare("SELECT * FROM hook_runs WHERE status = 'running' ORDER BY created_at")
      .all() as HookRunRow[]
    return rows.map(toDomain)
  }
}
