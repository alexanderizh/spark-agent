/**
 * @module execution-run.repository
 *
 * execution_runs 仓储 — 可恢复根任务/子任务 + 租约。
 *
 * 状态机守卫（方案 §6.6）编码在本仓储的 UPDATE ... WHERE status IN (...) 中，
 * 而不是依赖调用方约定：
 *   accepted → running → pausing/paused/waiting/completed/failed/cancelled
 *   租约过期后 running/pausing/recovering → orphaned → recovering
 *   只有持有当前 leaseEpoch 的 Worker 可推进；终态不可回退。
 */

import { BaseRepository } from '../base.repository.js'
import type { SparkDatabase } from '../../database.js'
import type {
  ExecutionRunCreateParams,
  ExecutionRunKind,
  ExecutionRunRecord,
  ExecutionRunStatus,
  RecoveryLevel,
  RequestedRecoveryMode,
} from '@spark/protocol'
import {
  ACTIVE_EXECUTION_RUN_STATUSES,
} from '@spark/protocol'

interface ExecutionRunRow {
  id: string
  session_id: string | null
  root_turn_id: string | null
  parent_run_id: string | null
  parent_step_id: string | null
  kind: string
  status: string
  requested_recovery_mode: string
  capability_ceiling: number
  current_guaranteed_level: number
  input_ref: string
  runtime_kind: string
  runtime_binding_json: string | null
  definition_fingerprint: string
  latest_checkpoint_id: string | null
  latest_recovery_plan_id: string | null
  lease_owner: string | null
  lease_epoch: number
  lease_expires_at: string | null
  heartbeat_at: string | null
  attempt: number
  interruption_reason: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

function rowToRecord(row: ExecutionRunRow): ExecutionRunRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    rootTurnId: row.root_turn_id,
    parentRunId: row.parent_run_id,
    parentStepId: row.parent_step_id,
    kind: row.kind as ExecutionRunKind,
    status: row.status as ExecutionRunStatus,
    requestedRecoveryMode: row.requested_recovery_mode as RequestedRecoveryMode,
    capabilityCeiling: row.capability_ceiling as RecoveryLevel,
    currentGuaranteedLevel: row.current_guaranteed_level as RecoveryLevel,
    inputRef: row.input_ref,
    runtimeKind: row.runtime_kind,
    runtimeBindingJson: row.runtime_binding_json == null ? null : safeParse(row.runtime_binding_json),
    definitionFingerprint: row.definition_fingerprint,
    latestCheckpointId: row.latest_checkpoint_id,
    latestRecoveryPlanId: row.latest_recovery_plan_id,
    leaseOwner: row.lease_owner,
    leaseEpoch: row.lease_epoch,
    leaseExpiresAt: row.lease_expires_at,
    heartbeatAt: row.heartbeat_at,
    attempt: row.attempt,
    interruptionReason: row.interruption_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

export class ExecutionRunRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'execution_runs')
  }

  create(params: ExecutionRunCreateParams): ExecutionRunRecord {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `
      INSERT INTO execution_runs (
        id, session_id, root_turn_id, parent_run_id, parent_step_id, kind, status,
        requested_recovery_mode, capability_ceiling, current_guaranteed_level,
        input_ref, runtime_kind, runtime_binding_json, definition_fingerprint,
        latest_checkpoint_id, latest_recovery_plan_id,
        lease_owner, lease_epoch, lease_expires_at, heartbeat_at,
        attempt, interruption_reason, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, NULL, NULL, ?, NULL, ?, ?, NULL)
    `,
      )
      .run(
        params.id,
        params.sessionId ?? null,
        params.rootTurnId ?? null,
        params.parentRunId ?? null,
        params.parentStepId ?? null,
        params.kind,
        params.requestedRecoveryMode ?? 'auto',
        params.capabilityCeiling ?? 1,
        params.currentGuaranteedLevel ?? params.capabilityCeiling ?? 1,
        params.inputRef ?? '',
        params.runtimeKind,
        params.runtimeBindingJson == null ? null : JSON.stringify(params.runtimeBindingJson),
        params.definitionFingerprint ?? '',
        params.attempt ?? 1,
        now,
        now,
      )
    return this.getOrFail(params.id)
  }

  get(id: string): ExecutionRunRecord | null {
    const row = this.findById<ExecutionRunRow>(id)
    return row == null ? null : rowToRecord(row)
  }

  private getOrFail(id: string): ExecutionRunRecord {
    const record = this.get(id)
    if (record == null) throw new Error(`execution_run not found after insert: ${id}`)
    return record
  }

  listByStatuses(statuses: readonly ExecutionRunStatus[], limit?: number): ExecutionRunRecord[] {
    if (statuses.length === 0) return []
    const placeholders = statuses.map(() => '?').join(',')
    const base = `SELECT * FROM execution_runs WHERE status IN (${placeholders})`
    const rows =
      limit == null
        ? (this.raw.prepare(`${base} ORDER BY created_at ASC, id ASC`).all(...statuses) as ExecutionRunRow[])
        : (this.raw
            .prepare(`${base} ORDER BY updated_at DESC LIMIT ?`)
            .all(...statuses, limit) as ExecutionRunRow[])
    return rows.map(rowToRecord)
  }

  listActive(): ExecutionRunRecord[] {
    return this.listByStatuses(ACTIVE_EXECUTION_RUN_STATUSES)
  }

  listNonTerminalRecent(limit = 100): ExecutionRunRecord[] {
    const placeholders = ACTIVE_EXECUTION_RUN_STATUSES.map(() => '?').join(',')
    const rows = this.raw
      .prepare(
        `
        SELECT * FROM execution_runs
        WHERE status IN (${placeholders})
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      )
      .all(...ACTIVE_EXECUTION_RUN_STATUSES, limit) as ExecutionRunRow[]
    return rows.map(rowToRecord)
  }

  listBySession(sessionId: string, limit = 50): ExecutionRunRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT * FROM execution_runs WHERE session_id = ? ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(sessionId, limit) as ExecutionRunRow[]
    return rows.map(rowToRecord)
  }

  findByRootTurnId(turnId: string): ExecutionRunRecord | null {
    const row = this.raw
      .prepare(`SELECT * FROM execution_runs WHERE root_turn_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(turnId) as ExecutionRunRow | undefined
    return row == null ? null : rowToRecord(row)
  }

  /* ---------------------------------------------------- */
  /* 状态机（守卫式转换；每个转换一个带 WHERE 守卫的方法）      */
  /* ---------------------------------------------------- */

  /** accepted → running（Worker 领取租约后调用；也用于 recovering → running）。 */
  markRunning(
    id: string,
    from: readonly ExecutionRunStatus[] = ['accepted', 'recovering'],
  ): boolean {
    const placeholders = from.map(() => '?').join(',')
    const result = this.raw
      .prepare(
        `UPDATE execution_runs SET status = 'running', updated_at = ? WHERE id = ? AND status IN (${placeholders})`,
      )
      .run(new Date().toISOString(), id, ...from)
    return result.changes > 0
  }

  markPausing(id: string, reason: string | null): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_runs SET status = 'pausing', interruption_reason = ?, updated_at = ? WHERE id = ? AND status IN ('running', 'recovering')`,
      )
      .run(reason, new Date().toISOString(), id)
    return result.changes > 0
  }

  markPaused(id: string, reason: string | null): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_runs SET status = 'paused', interruption_reason = ?, updated_at = ? WHERE id = ? AND status IN ('running', 'pausing', 'recovering', 'accepted', 'orphaned')`,
      )
      .run(reason, new Date().toISOString(), id)
    return result.changes > 0
  }

  markWaiting(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_runs SET status = 'waiting', updated_at = ? WHERE id = ? AND status IN ('running', 'recovering')`,
      )
      .run(new Date().toISOString(), id)
    return result.changes > 0
  }

  markOrphaned(id: string, reason: string | null): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_runs SET status = 'orphaned', interruption_reason = ?, updated_at = ? WHERE id = ? AND status IN ('running', 'pausing', 'recovering', 'waiting')`,
      )
      .run(reason, new Date().toISOString(), id)
    return result.changes > 0
  }

  markRecovering(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_runs SET status = 'recovering', updated_at = ? WHERE id = ? AND status IN ('orphaned', 'paused', 'needs_attention')`,
      )
      .run(new Date().toISOString(), id)
    return result.changes > 0
  }

  markNeedsAttention(id: string, reason: string | null): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_runs SET status = 'needs_attention', interruption_reason = ?, updated_at = ? WHERE id = ? AND status IN ('accepted', 'orphaned', 'recovering', 'paused', 'running', 'waiting')`,
      )
      .run(reason, new Date().toISOString(), id)
    return result.changes > 0
  }

  /**
   * 终态写入：completed/failed/cancelled；同时释放租约。
   *
   * fence（epoch fencing）：Worker 路径必须传当前持有的租约；租约已被
   * 新 Worker 顶掉（epoch 递增）时写入被拒，防止旧 Worker 把新租约下
   * 正在执行的 Run 写成终态。宿主权威路径（恢复中心取消/放弃、goal/
   * workflow 生命周期收口）不传 fence，仅受状态守卫约束。
   */
  finishTerminal(
    id: string,
    status: 'completed' | 'failed' | 'cancelled',
    reason: string | null = null,
    fence?: { owner: string; epoch: number } | null,
  ): boolean {
    const active = [...ACTIVE_EXECUTION_RUN_STATUSES, 'needs_attention' as const]
    const placeholders = active.map(() => '?').join(',')
    const now = new Date().toISOString()
    const setResult = `
        UPDATE execution_runs
        SET status = ?, interruption_reason = ?, lease_owner = NULL,
            lease_expires_at = NULL, heartbeat_at = NULL,
            completed_at = COALESCE(completed_at, ?), updated_at = ?
        WHERE id = ? AND status IN (${placeholders})`
    const result =
      fence == null
        ? this.raw.prepare(setResult).run(status, reason, now, now, id, ...active)
        : this.raw
            .prepare(`${setResult} AND lease_owner = ? AND lease_epoch = ?`)
            .run(status, reason, now, now, id, ...active, fence.owner, fence.epoch)
    return result.changes > 0
  }

  /* ---------------------------------------------------- */
  /* 租约（CAS + epoch fencing）                            */
  /* ---------------------------------------------------- */

  /**
   * CAS 领取租约：只有 Run 处于 from 状态时才能领取；成功则递增 leaseEpoch。
   * 未过期的有效租约不能被抢占（防止恢复路径抢走仍在执行的 Worker 的
   * 租约造成双执行器）；orphaned 状态例外 —— 启动扫描已判定原 Worker
   * 不存在，可立即领取。旧 Worker 即使晚到，也不能再用旧 epoch 提交
   * 结果（方案 §6.1/§9.2）。
   */
  acquireLease(
    id: string,
    owner: string,
    leaseDurationMs: number,
    from: readonly ExecutionRunStatus[] = ['accepted', 'orphaned', 'recovering', 'paused'],
  ): { ok: true; record: ExecutionRunRecord } | { ok: false } {
    const placeholders = from.map(() => '?').join(',')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + leaseDurationMs).toISOString()
    const result = this.raw
      .prepare(
        `
        UPDATE execution_runs
        SET lease_owner = ?, lease_epoch = lease_epoch + 1, lease_expires_at = ?,
            heartbeat_at = ?, updated_at = ?
        WHERE id = ? AND status IN (${placeholders})
          AND (
            status = 'orphaned'
            OR lease_owner IS NULL
            OR lease_expires_at IS NULL
            OR lease_expires_at <= ?
          )
      `,
      )
      .run(owner, expiresAt, now.toISOString(), now.toISOString(), id, ...from, now.toISOString())
    if (result.changes === 0) return { ok: false }
    const record = this.get(id)
    if (record == null) return { ok: false }
    return { ok: true, record }
  }

  /** 心跳续租：必须持有当前 epoch 且租约未过期。 */
  renewLease(id: string, owner: string, epoch: number, leaseDurationMs: number): boolean {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + leaseDurationMs).toISOString()
    const result = this.raw
      .prepare(
        `
        UPDATE execution_runs
        SET lease_expires_at = ?, heartbeat_at = ?, updated_at = ?
        WHERE id = ? AND lease_owner = ? AND lease_epoch = ?
          AND (lease_expires_at IS NULL OR lease_expires_at > ?)
      `,
      )
      .run(expiresAt, now.toISOString(), now.toISOString(), id, owner, epoch, now.toISOString())
    return result.changes > 0
  }

  /** 释放租约（保留 epoch 不回退）。 */
  releaseLease(id: string, owner: string, epoch: number): boolean {
    const result = this.raw
      .prepare(
        `
        UPDATE execution_runs
        SET lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL, updated_at = ?
        WHERE id = ? AND lease_owner = ? AND lease_epoch = ?
      `,
      )
      .run(new Date().toISOString(), id, owner, epoch)
    return result.changes > 0
  }

  /** 校验调用方仍持有有效租约（提交副作用前的 fencing 检查）。 */
  isLeaseValid(id: string, owner: string, epoch: number): boolean {
    const row = this.raw
      .prepare(
        `
        SELECT 1 FROM execution_runs
        WHERE id = ? AND lease_owner = ? AND lease_epoch = ?
          AND lease_expires_at IS NOT NULL AND lease_expires_at > ?
      `,
      )
      .get(id, owner, epoch, new Date().toISOString())
    return row != null
  }

  /** 更新 latestCheckpointId（仅活跃 Run；由 checkpoint 写入事务调用，终态 Run 不得再推进）。 */
  advanceCheckpointRef(id: string, checkpointId: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_runs SET latest_checkpoint_id = ?, updated_at = ?
         WHERE id = ? AND status NOT IN ('completed', 'failed', 'cancelled')`,
      )
      .run(checkpointId, new Date().toISOString(), id)
    return result.changes > 0
  }

  advanceRecoveryPlanRef(id: string, planId: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_runs SET latest_recovery_plan_id = ?, updated_at = ?
         WHERE id = ? AND status NOT IN ('completed', 'failed', 'cancelled')`,
      )
      .run(planId, new Date().toISOString(), id)
    return result.changes > 0
  }

  /** currentGuaranteedLevel 只能单调下降（方案 §6.1）。 */
  lowerGuaranteedLevel(id: string, level: RecoveryLevel): boolean {
    const result = this.raw
      .prepare(
        `
        UPDATE execution_runs
        SET current_guaranteed_level = ?, updated_at = ?
        WHERE id = ? AND current_guaranteed_level > ?
      `,
      )
      .run(level, new Date().toISOString(), id, level)
    return result.changes > 0
  }

  /** 清理基线（方案 §6.7）：按状态与时间批量删除终态 Run。 */
  deleteTerminalBefore(beforeIso: string, batchSize = 500): number {
    const rows = this.raw
      .prepare(
        `
        SELECT id FROM execution_runs
        WHERE status IN ('completed', 'failed', 'cancelled')
          AND updated_at < ?
          AND id NOT IN (SELECT parent_run_id FROM execution_runs WHERE parent_run_id IS NOT NULL)
        ORDER BY updated_at ASC
        LIMIT ?
      `,
      )
      .all(beforeIso, batchSize) as Array<{ id: string }>
    if (rows.length === 0) return 0
    const placeholders = rows.map(() => '?').join(',')
    const result = this.raw
      .prepare(`DELETE FROM execution_runs WHERE id IN (${placeholders})`)
      .run(...rows.map((row) => row.id))
    return result.changes
  }
}
