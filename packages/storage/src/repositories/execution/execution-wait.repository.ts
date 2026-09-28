/**
 * @module execution-wait.repository
 *
 * execution_waits 仓储 — 持久 HITL 等待（问题/权限/计划审批/外部回调）。
 *
 * 关键不变量（方案 §6.5）：
 *   open → answered/denied/expired/cancelled
 *   回答使用唯一请求 ID CAS；重复提交只返回原结果，不重复唤醒
 *   UNIQUE(run_id, step_id, type) 保证重放不重复弹卡
 */

import { BaseRepository } from '../base.repository.js'
import type { SparkDatabase } from '../../database.js'
import type { ExecutionWaitRecord, ExecutionWaitStatus, ExecutionWaitType } from '@spark/protocol'

interface ExecutionWaitRow {
  id: string
  run_id: string
  step_id: string | null
  type: string
  status: string
  request_json: string | null
  answer_json: string | null
  deadline_at: string | null
  answered_at: string | null
  created_at: string
  updated_at: string
}

function rowToRecord(row: ExecutionWaitRow): ExecutionWaitRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    type: row.type as ExecutionWaitType,
    status: row.status as ExecutionWaitStatus,
    requestJson: row.request_json == null ? null : safeParse(row.request_json),
    answerJson: row.answer_json == null ? null : safeParse(row.answer_json),
    deadlineAt: row.deadline_at,
    answeredAt: row.answered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

export interface ExecutionWaitCreateParams {
  id: string
  runId: string
  stepId?: string | null
  type: ExecutionWaitType
  requestJson: unknown
  deadlineAt?: string | null
}

export class ExecutionWaitRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'execution_waits')
  }

  /**
   * 幂等创建：同 (runId, stepId, type) 已有 open 等待时返回既有记录
   * （重放不重复弹卡）；前一个已关闭时新开一行，保留审计历史。
   */
  ensureOpen(params: ExecutionWaitCreateParams): ExecutionWaitRecord {
    const selectOpen = this.raw.prepare(
      `SELECT * FROM execution_waits WHERE run_id = ? AND step_id IS ? AND type = ? AND status = 'open'`,
    )
    const existing = selectOpen.get(params.runId, params.stepId ?? null, params.type) as
      | ExecutionWaitRow
      | undefined
    if (existing != null) return rowToRecord(existing)
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `
      INSERT OR IGNORE INTO execution_waits (
        id, run_id, step_id, type, status, request_json, answer_json, deadline_at, answered_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'open', ?, NULL, ?, NULL, ?, ?)
    `,
      )
      .run(
        params.id,
        params.runId,
        params.stepId ?? null,
        params.type,
        JSON.stringify(params.requestJson ?? {}),
        params.deadlineAt ?? null,
        now,
        now,
      )
    const row = selectOpen.get(params.runId, params.stepId ?? null, params.type) as
      | ExecutionWaitRow
      | undefined
    if (row == null) throw new Error(`execution_wait insert failed: ${params.id}`)
    return rowToRecord(row)
  }

  get(id: string): ExecutionWaitRecord | null {
    const row = this.findById<ExecutionWaitRow>(id)
    return row == null ? null : rowToRecord(row)
  }

  listByRun(runId: string): ExecutionWaitRecord[] {
    const rows = this.raw
      .prepare(`SELECT * FROM execution_waits WHERE run_id = ? ORDER BY created_at ASC`)
      .all(runId) as ExecutionWaitRow[]
    return rows.map(rowToRecord)
  }

  listOpen(runId?: string): ExecutionWaitRecord[] {
    const rows =
      runId == null
        ? (this.raw
            .prepare(`SELECT * FROM execution_waits WHERE status = 'open' ORDER BY created_at ASC`)
            .all() as ExecutionWaitRow[])
        : (this.raw
            .prepare(
              `SELECT * FROM execution_waits WHERE run_id = ? AND status = 'open' ORDER BY created_at ASC`,
            )
            .all(runId) as ExecutionWaitRow[])
    return rows.map(rowToRecord)
  }

  /**
   * CAS 回答：只有 open 状态可被回答；重复提交（已 answered/denied）返回
   * 原记录而不改状态，由调用方读取 answerJson 复用原结果，不重复唤醒。
   */
  answer(
    id: string,
    outcome: 'answered' | 'denied',
    answerJson: unknown,
  ): { changed: boolean; record: ExecutionWaitRecord | null } {
    const now = new Date().toISOString()
    const result = this.raw
      .prepare(
        `
        UPDATE execution_waits
        SET status = ?, answer_json = ?, answered_at = ?, updated_at = ?
        WHERE id = ? AND status = 'open'
      `,
      )
      .run(outcome, JSON.stringify(answerJson ?? {}), now, now, id)
    const record = this.get(id)
    return { changed: result.changes > 0, record }
  }

  markExpired(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_waits SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'open'`,
      )
      .run(new Date().toISOString(), id)
    return result.changes > 0
  }

  markCancelled(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_waits SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'open'`,
      )
      .run(new Date().toISOString(), id)
    return result.changes > 0
  }

  /** Run 终态收口：遗留 open Wait 全部取消（方案 §6.6）。 */
  cancelOpenByRun(runId: string): number {
    const result = this.raw
      .prepare(
        `UPDATE execution_waits SET status = 'cancelled', updated_at = ? WHERE run_id = ? AND status = 'open'`,
      )
      .run(new Date().toISOString(), runId)
    return result.changes
  }

  /** 到期扫描：deadline 已过的 open Wait 转 expired。 */
  expireOverdue(nowIso = new Date().toISOString()): number {
    const result = this.raw
      .prepare(
        `UPDATE execution_waits SET status = 'expired', updated_at = ? WHERE status = 'open' AND deadline_at IS NOT NULL AND deadline_at < ?`,
      )
      .run(nowIso, nowIso)
    return result.changes
  }
}
