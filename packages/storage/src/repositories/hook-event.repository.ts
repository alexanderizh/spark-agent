import type { HookEventEnvelopeV1, HookEventNameV1 } from '@spark/protocol'
import type { SparkDatabase } from '../database.js'
import { BaseRepository } from './base.repository.js'

export type HookEventStatus = 'pending' | 'resolving' | 'resolved' | 'failed'

export interface HookEventRow {
  event_id: string
  schema_version: number
  event_name: string
  session_id: string
  turn_id: string
  agent_id: string | null
  primary_workspace_id: string | null
  envelope_json: string
  status: HookEventStatus
  available_at: string
  lease_owner: string | null
  lease_expires_at: string | null
  created_at: string
  resolved_at: string | null
  last_error: string | null
}

export interface InsertHookEventParams {
  eventId: string
  eventName: HookEventNameV1
  sessionId: string
  turnId: string
  agentId?: string | null
  primaryWorkspaceId?: string | null
  envelope: HookEventEnvelopeV1
  availableAt?: string
}

function toDomain(row: HookEventRow): HookEventRow {
  return row
}

export class HookEventRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'hook_events')
  }

  /**
   * 幂等写入 outbox：event_id 为主键，重放/重试保持不变时忽略重复插入。
   * 返回是否为新插入（false = 已存在，调用方可据此跳过重复派发）。
   */
  insertIfAbsent(params: InsertHookEventParams): boolean {
    const now = new Date().toISOString()
    const result = this.raw
      .prepare(
        `INSERT OR IGNORE INTO hook_events (
          event_id, schema_version, event_name, session_id, turn_id, agent_id,
          primary_workspace_id, envelope_json, status, available_at, created_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        params.eventId,
        params.eventName,
        params.sessionId,
        params.turnId,
        params.agentId ?? null,
        params.primaryWorkspaceId ?? null,
        JSON.stringify(params.envelope),
        params.availableAt ?? now,
        now,
      )
    return result.changes > 0
  }

  get(eventId: string): HookEventRow | null {
    const row = this.raw.prepare('SELECT * FROM hook_events WHERE event_id = ?').get(eventId) as
      | HookEventRow
      | undefined
    return row != null ? toDomain(row) : null
  }

  /** 短租约领取一条 pending 事件（available_at 已到）。 */
  claimNextPending(owner: string, leaseMs: number): HookEventRow | null {
    const now = new Date().toISOString()
    const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString()
    const claim = this.raw.transaction((): HookEventRow | null => {
      const candidate = this.raw
        .prepare(
          `SELECT event_id FROM hook_events
           WHERE status = 'pending' AND available_at <= ?
           ORDER BY created_at, event_id LIMIT 1`,
        )
        .get(now) as { event_id: string } | undefined
      if (candidate == null) return null
      this.raw
        .prepare(
          `UPDATE hook_events SET status = 'resolving', lease_owner = ?, lease_expires_at = ?
           WHERE event_id = ?`,
        )
        .run(owner, leaseExpiresAt, candidate.event_id)
      return this.get(candidate.event_id)
    })
    return claim()
  }

  markResolved(eventId: string): void {
    this.raw
      .prepare(
        `UPDATE hook_events SET status = 'resolved', resolved_at = ?, lease_owner = NULL,
         lease_expires_at = NULL WHERE event_id = ?`,
      )
      .run(new Date().toISOString(), eventId)
  }

  markFailed(eventId: string, error: string): void {
    this.raw
      .prepare(
        `UPDATE hook_events SET status = 'failed', last_error = ?, resolved_at = ?,
         lease_owner = NULL, lease_expires_at = NULL WHERE event_id = ?`,
      )
      .run(error.slice(0, 2000), new Date().toISOString(), eventId)
  }

  /**
   * 回收过期的 resolving 租约（应用重启 / Worker 崩溃）：事件回到 pending 重派。
   * 返回回收数量。
   */
  requeueExpiredLeases(): number {
    const result = this.raw
      .prepare(
        `UPDATE hook_events SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL
         WHERE status = 'resolving'
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
      )
      .run(new Date().toISOString())
    return result.changes
  }

  countByStatus(status: HookEventStatus): number {
    const row = this.raw
      .prepare('SELECT COUNT(*) AS n FROM hook_events WHERE status = ?')
      .get(status) as { n: number }
    return row.n
  }
}
