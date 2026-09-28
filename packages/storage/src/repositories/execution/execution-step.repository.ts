/**
 * @module execution-step.repository
 *
 * execution_steps 仓储 — 稳定步骤（模型/工具/子 Agent/工作流节点/审批/产物）。
 *
 * 守卫：planned → running → committed/failed/cancelled；在途不明时 running → uncertain。
 * UNIQUE(run_id, stable_key, attempt) 防止同一次逻辑步骤被重复登记。
 */

import { BaseRepository } from '../base.repository.js'
import type { SparkDatabase } from '../../database.js'
import type { ExecutionStepKind, ExecutionStepRecord, ExecutionStepStatus, ToolReplayPolicy } from '@spark/protocol'

interface ExecutionStepRow {
  id: string
  run_id: string
  stable_key: string
  parent_step_id: string | null
  kind: string
  status: string
  attempt: number
  input_hash: string | null
  result_ref: string | null
  replay_policy: string | null
  started_at: string | null
  committed_at: string | null
  created_at: string
  updated_at: string
}

function rowToRecord(row: ExecutionStepRow): ExecutionStepRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stableKey: row.stable_key,
    parentStepId: row.parent_step_id,
    kind: row.kind as ExecutionStepKind,
    status: row.status as ExecutionStepStatus,
    attempt: row.attempt,
    inputHash: row.input_hash,
    resultRef: row.result_ref,
    replayPolicy: (row.replay_policy as ToolReplayPolicy | null) ?? null,
    startedAt: row.started_at,
    committedAt: row.committed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface ExecutionStepCreateParams {
  id: string
  runId: string
  stableKey: string
  parentStepId?: string | null
  kind: ExecutionStepKind
  attempt?: number
  inputHash?: string | null
  replayPolicy?: ToolReplayPolicy | null
}

export class ExecutionStepRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'execution_steps')
  }

  /** 幂等创建：同 (runId, stableKey, attempt) 已存在时返回既有记录。 */
  ensure(params: ExecutionStepCreateParams): ExecutionStepRecord {
    const existing = this.findByStableKey(params.runId, params.stableKey, params.attempt ?? 1)
    if (existing != null) return existing
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `
      INSERT OR IGNORE INTO execution_steps (
        id, run_id, stable_key, parent_step_id, kind, status, attempt,
        input_hash, result_ref, replay_policy, started_at, committed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, NULL, ?, NULL, NULL, ?, ?)
    `,
      )
      .run(
        params.id,
        params.runId,
        params.stableKey,
        params.parentStepId ?? null,
        params.kind,
        params.attempt ?? 1,
        params.inputHash ?? null,
        params.replayPolicy ?? null,
        now,
        now,
      )
    const record = this.findByStableKey(params.runId, params.stableKey, params.attempt ?? 1)
    if (record == null) throw new Error(`execution_step insert failed: ${params.id}`)
    return record
  }

  findByStableKey(runId: string, stableKey: string, attempt = 1): ExecutionStepRecord | null {
    const row = this.raw
      .prepare(
        `SELECT * FROM execution_steps WHERE run_id = ? AND stable_key = ? AND attempt = ?`,
      )
      .get(runId, stableKey, attempt) as ExecutionStepRow | undefined
    return row == null ? null : rowToRecord(row)
  }

  get(id: string): ExecutionStepRecord | null {
    const row = this.findById<ExecutionStepRow>(id)
    return row == null ? null : rowToRecord(row)
  }

  listByRun(runId: string): ExecutionStepRecord[] {
    const rows = this.raw
      .prepare(`SELECT * FROM execution_steps WHERE run_id = ? ORDER BY created_at ASC, id ASC`)
      .all(runId) as ExecutionStepRow[]
    return rows.map(rowToRecord)
  }

  /** planned → running（派发前；fail-closed：仅 planned 可进入执行）。 */
  markRunning(id: string): boolean {
    const now = new Date().toISOString()
    const result = this.raw
      .prepare(
        `UPDATE execution_steps SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND status IN ('planned', 'running')`,
      )
      .run(now, now, id)
    return result.changes > 0
  }

  /** running → committed（与 checkpoint 同事务提交；resultRef 必填）。 */
  commit(id: string, resultRef: string): boolean {
    const now = new Date().toISOString()
    const result = this.raw
      .prepare(
        `UPDATE execution_steps SET status = 'committed', result_ref = ?, committed_at = ?, updated_at = ? WHERE id = ? AND status IN ('running', 'planned')`,
      )
      .run(resultRef, now, now, id)
    return result.changes > 0
  }

  markFailed(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_steps SET status = 'failed', updated_at = ? WHERE id = ? AND status IN ('planned', 'running', 'uncertain')`,
      )
      .run(new Date().toISOString(), id)
    return result.changes > 0
  }

  markCancelled(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_steps SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('planned', 'running', 'waiting')`,
      )
      .run(new Date().toISOString(), id)
    return result.changes > 0
  }

  /** running → uncertain（请求可能已到达外部系统但没有可靠结果）。 */
  markUncertain(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_steps SET status = 'uncertain', updated_at = ? WHERE id = ? AND status IN ('running', 'planned')`,
      )
      .run(new Date().toISOString(), id)
    return result.changes > 0
  }

  /** running → waiting / waiting → running（HITL 边界）。 */
  markWaiting(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_steps SET status = 'waiting', updated_at = ? WHERE id = ? AND status IN ('running', 'planned')`,
      )
      .run(new Date().toISOString(), id)
    return result.changes > 0
  }

  resumeFromWaiting(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_steps SET status = 'running', updated_at = ? WHERE id = ? AND status = 'waiting'`,
      )
      .run(new Date().toISOString(), id)
    return result.changes > 0
  }

  countByStatus(runId: string): Record<ExecutionStepStatus, number> {
    const rows = this.raw
      .prepare(
        `SELECT status, COUNT(*) as count FROM execution_steps WHERE run_id = ? GROUP BY status`,
      )
      .all(runId) as Array<{ status: string; count: number }>
    const result = {
      planned: 0,
      running: 0,
      committed: 0,
      waiting: 0,
      failed: 0,
      cancelled: 0,
      uncertain: 0,
    } as Record<ExecutionStepStatus, number>
    for (const row of rows) {
      result[row.status as ExecutionStepStatus] = row.count
    }
    return result
  }
}
