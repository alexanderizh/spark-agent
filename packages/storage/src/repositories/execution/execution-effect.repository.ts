/**
 * @module execution-effect.repository
 *
 * execution_effects 仓储 — 工具副作用 write-ahead 执行信封（方案 §6.4/§8）。
 *
 * 关键不变量：
 *   prepared → dispatching → confirmed/failed/unknown；unknown → confirmed/failed/compensated
 *   dispatching 之后禁止无条件自动重放（必须先调和）。
 *   Worker 在越过副作用边界前必须先以当前 leaseEpoch 把 Effect 提交为 dispatching。
 */

import { BaseRepository } from '../base.repository.js'
import type { SparkDatabase } from '../../database.js'
import type {
  ExecutionEffectPhase,
  ExecutionEffectRecord,
  ToolReplayPolicy,
} from '@spark/protocol'

interface ExecutionEffectRow {
  id: string
  run_id: string
  step_id: string
  tool_name: string
  tool_version: string
  tool_call_id: string
  request_hash: string
  idempotency_key: string | null
  replay_policy: string
  phase: string
  external_receipt_ref: string | null
  result_ref: string | null
  created_at: string
  updated_at: string
}

function rowToRecord(row: ExecutionEffectRow): ExecutionEffectRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    toolName: row.tool_name,
    toolVersion: row.tool_version,
    toolCallId: row.tool_call_id,
    requestHash: row.request_hash,
    idempotencyKey: row.idempotency_key,
    replayPolicy: row.replay_policy as ToolReplayPolicy,
    phase: row.phase as ExecutionEffectPhase,
    externalReceiptRef: row.external_receipt_ref,
    resultRef: row.result_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface ExecutionEffectCreateParams {
  id: string
  runId: string
  stepId: string
  toolName: string
  toolVersion?: string | undefined
  toolCallId: string
  requestHash: string
  idempotencyKey?: string | null | undefined
  replayPolicy: ToolReplayPolicy
}

export class ExecutionEffectRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'execution_effects')
  }

  create(params: ExecutionEffectCreateParams): ExecutionEffectRecord {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `
      INSERT INTO execution_effects (
        id, run_id, step_id, tool_name, tool_version, tool_call_id, request_hash,
        idempotency_key, replay_policy, phase, external_receipt_ref, result_ref,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', NULL, NULL, ?, ?)
    `,
      )
      .run(
        params.id,
        params.runId,
        params.stepId,
        params.toolName,
        params.toolVersion ?? '',
        params.toolCallId,
        params.requestHash,
        params.idempotencyKey ?? null,
        params.replayPolicy,
        now,
        now,
      )
    return this.getOrFail(params.id)
  }

  get(id: string): ExecutionEffectRecord | null {
    const row = this.findById<ExecutionEffectRow>(id)
    return row == null ? null : rowToRecord(row)
  }

  private getOrFail(id: string): ExecutionEffectRecord {
    const record = this.get(id)
    if (record == null) throw new Error(`execution_effect not found after insert: ${id}`)
    return record
  }

  findByToolCallId(runId: string, toolCallId: string): ExecutionEffectRecord | null {
    const row = this.raw
      .prepare(`SELECT * FROM execution_effects WHERE run_id = ? AND tool_call_id = ?`)
      .get(runId, toolCallId) as ExecutionEffectRow | undefined
    return row == null ? null : rowToRecord(row)
  }

  listByRun(runId: string): ExecutionEffectRecord[] {
    const rows = this.raw
      .prepare(`SELECT * FROM execution_effects WHERE run_id = ? ORDER BY created_at ASC, id ASC`)
      .all(runId) as ExecutionEffectRow[]
    return rows.map(rowToRecord)
  }

  listByPhase(runId: string, phase: ExecutionEffectPhase): ExecutionEffectRecord[] {
    const rows = this.raw
      .prepare(`SELECT * FROM execution_effects WHERE run_id = ? AND phase = ?`)
      .all(runId, phase) as ExecutionEffectRow[]
    return rows.map(rowToRecord)
  }

  /**
   * prepared → dispatching（write-ahead sent-intent；越过副作用边界前的强制提交）。
   * 保守语义：dispatching 既可能尚未真正送达，也可能已完成但响应未提交；
   * 进程中断后一律调和为 unknown，不得恢复成"未发送"并自动重跑。
   */
  markDispatching(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_effects SET phase = 'dispatching', updated_at = ? WHERE id = ? AND phase = 'prepared'`,
      )
      .run(new Date().toISOString(), id)
    return result.changes > 0
  }

  /** dispatching/prepared → confirmed（成功响应与步骤 Checkpoint 同事务提交）。 */
  markConfirmed(id: string, resultRef: string | null, externalReceiptRef?: string | null): boolean {
    const result = this.raw
      .prepare(
        `
        UPDATE execution_effects
        SET phase = 'confirmed', result_ref = COALESCE(?, result_ref),
            external_receipt_ref = COALESCE(?, external_receipt_ref), updated_at = ?
        WHERE id = ? AND phase IN ('prepared', 'dispatching')
      `,
      )
      .run(resultRef, externalReceiptRef ?? null, new Date().toISOString(), id)
    return result.changes > 0
  }

  markFailed(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_effects SET phase = 'failed', updated_at = ? WHERE id = ? AND phase IN ('prepared', 'dispatching')`,
      )
      .run(new Date().toISOString(), id)
    return result.changes > 0
  }

  /** 调和为 unknown（中断后无法证明外部动作未发生时的保守终态）。 */
  markUnknown(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_effects SET phase = 'unknown', updated_at = ? WHERE id = ? AND phase IN ('prepared', 'dispatching')`,
      )
      .run(new Date().toISOString(), id)
    return result.changes > 0
  }

  /** unknown → confirmed/failed/compensated（人工确认或外部查询后的终态）。 */
  reconcileUnknown(id: string, phase: 'confirmed' | 'failed' | 'compensated'): boolean {
    const result = this.raw
      .prepare(
        `UPDATE execution_effects SET phase = ?, updated_at = ? WHERE id = ? AND phase = 'unknown'`,
      )
      .run(phase, new Date().toISOString(), id)
    return result.changes > 0
  }

  /** Run 终态收口：仍在 prepared/dispatching 的 Effect 先转 unknown（方案 §6.6）。 */
  reconcileInflightToUnknown(runId: string): number {
    const result = this.raw
      .prepare(
        `UPDATE execution_effects SET phase = 'unknown', updated_at = ? WHERE run_id = ? AND phase IN ('prepared', 'dispatching')`,
      )
      .run(new Date().toISOString(), runId)
    return result.changes
  }

  countByPhase(runId: string): Record<ExecutionEffectPhase, number> {
    const rows = this.raw
      .prepare(`SELECT phase, COUNT(*) as count FROM execution_effects WHERE run_id = ? GROUP BY phase`)
      .all(runId) as Array<{ phase: string; count: number }>
    const result = {
      prepared: 0,
      dispatching: 0,
      confirmed: 0,
      failed: 0,
      unknown: 0,
      compensated: 0,
    } as Record<ExecutionEffectPhase, number>
    for (const row of rows) {
      result[row.phase as ExecutionEffectPhase] = row.count
    }
    return result
  }
}
