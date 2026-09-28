/**
 * @module execution-recovery-plan.repository
 *
 * execution_recovery_plans 仓储 — 版本化恢复计划。
 *
 * 相同 Run、checkpoint 与环境 fingerprint 只允许存在一个有效计划
 * （proposed/approved/executing），保证启动扫描和重复点击幂等（方案 §6.6）。
 */

import { BaseRepository } from '../base.repository.js'
import type { SparkDatabase } from '../../database.js'
import type {
  ExecutionRecoveryPlanRow,
  RecoveryDecision,
  RecoveryPlanStatus,
  RecoveryPlanV1,
} from '@spark/protocol'

export class ExecutionRecoveryPlanRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'execution_recovery_plans')
  }

  /**
   * 幂等 upsert：同 (runId, checkpointId, environmentFingerprint) 已有有效计划
   * （非 superseded/completed）时直接返回既有计划，不重复创建。
   */
  upsertActive(plan: RecoveryPlanV1): { created: boolean; row: ExecutionRecoveryPlanRow } {
    const now = new Date().toISOString()
    const existing = this.raw
      .prepare(
        `
        SELECT * FROM execution_recovery_plans
        WHERE run_id = ?
          AND checkpoint_id IS ?
          AND environment_fingerprint = ?
          AND status IN ('proposed', 'approved', 'executing')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      )
      .get(plan.runId, plan.checkpointId ?? null, plan.environmentFingerprint) as
      | ExecutionRecoveryPlanRow
      | undefined
    if (existing != null) return { created: false, row: existing }
    this.raw
      .prepare(
        `
      INSERT INTO execution_recovery_plans (
        id, run_id, checkpoint_id, environment_fingerprint, decision, plan_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        plan.planId,
        plan.runId,
        plan.checkpointId ?? null,
        plan.environmentFingerprint,
        plan.decision,
        JSON.stringify(plan),
        'proposed',
        plan.createdAt,
        now,
      )
    const row = this.raw
      .prepare(`SELECT * FROM execution_recovery_plans WHERE id = ?`)
      .get(plan.planId) as ExecutionRecoveryPlanRow | undefined
    if (row == null) throw new Error(`execution_recovery_plan insert failed: ${plan.planId}`)
    return { created: true, row }
  }

  get(id: string): ExecutionRecoveryPlanRow | null {
    return this.findById<ExecutionRecoveryPlanRow>(id)
  }

  getLatestForRun(runId: string): ExecutionRecoveryPlanRow | null {
    const row = this.raw
      .prepare(
        `SELECT * FROM execution_recovery_plans WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(runId) as ExecutionRecoveryPlanRow | undefined
    return row ?? null
  }

  parsePlan(row: ExecutionRecoveryPlanRow | null): RecoveryPlanV1 | null {
    if (row == null) return null
    try {
      const plan = JSON.parse(row.plan_json) as RecoveryPlanV1
      return plan.schemaVersion === 1 ? plan : null
    } catch {
      return null
    }
  }

  updateStatus(id: string, status: RecoveryPlanStatus): boolean {
    const result = this.raw
      .prepare(`UPDATE execution_recovery_plans SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, new Date().toISOString(), id)
    return result.changes > 0
  }

  /** 该 Run 是否存在 executing 状态的在途计划（恢复 Turn 已派发、尚未收口）。 */
  hasExecutingPlan(runId: string): boolean {
    const row = this.raw
      .prepare(
        `SELECT 1 FROM execution_recovery_plans WHERE run_id = ? AND status = 'executing' LIMIT 1`,
      )
      .get(runId)
    return row != null
  }

  /**
   * 收口该 Run 的全部有效计划（proposed/approved/executing → completed 或
   * superseded）。恢复 Turn 终态或用户取消/放弃时调用，防止计划永悬。
   */
  settleActiveForRun(runId: string, status: 'completed' | 'superseded'): number {
    const result = this.raw
      .prepare(
        `
        UPDATE execution_recovery_plans
        SET status = ?, updated_at = ?
        WHERE run_id = ? AND status IN ('proposed', 'approved', 'executing')
      `,
      )
      .run(status, new Date().toISOString(), runId)
    return result.changes
  }

  /** 新计划生效时把旧的有效计划标记为 superseded。 */
  supersedeActiveForRun(runId: string, exceptPlanId: string | null): number {
    const result = this.raw
      .prepare(
        `
        UPDATE execution_recovery_plans
        SET status = 'superseded', updated_at = ?
        WHERE run_id = ? AND status IN ('proposed', 'approved') AND id != ?
      `,
      )
      .run(new Date().toISOString(), runId, exceptPlanId ?? '')
    return result.changes
  }

  listRecent(limit = 50): Array<ExecutionRecoveryPlanRow & { decision: RecoveryDecision }> {
    return this.raw
      .prepare(`SELECT * FROM execution_recovery_plans ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Array<ExecutionRecoveryPlanRow & { decision: RecoveryDecision }>
  }
}
