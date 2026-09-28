/**
 * @module recovery-planner
 *
 * RecoveryPlanner — 加载最新有效 Checkpoint，校验环境，调和未知副作用，
 * 产生 auto_resume | needs_confirmation | cannot_resume 决策（方案 §5.1/§9）。
 *
 * Phase 1 关键约束（方案 §14）：
 *   只对「尚未开始执行」或 Adapter 能证明未派发任何副作用的 Run 自动继续；
 *   无法证明的进入 needs_attention，展示已知历史并由用户决定；
 *   原生会话可续接也不等于副作用可安全重放。
 */

import crypto from 'node:crypto'
import {
  ExecutionEffectRepository,
  ExecutionRecoveryPlanRepository,
  ExecutionRunRepository,
  ExecutionStepRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type {
  ExecutionRunRecord,
  RecoveryDecision,
  RecoveryLevel,
  RecoveryPlanV1,
  RecoveryStepDecision,
  RequestedRecoveryMode,
} from '@spark/protocol'
import { RecoveryValidator, type EnvironmentFingerprintInput } from './recovery-validator.js'
import type { SideEffectProof } from './turn-side-effect-inspector.js'

export const RECOVERY_PLANNER_VERSION = 'phase1.0'

export interface PlanRecoveryInput {
  run: ExecutionRunRecord
  current: EnvironmentFingerprintInput
  /** Phase 1 副作用证明（turn kind 由事件流检查器提供；其他 kind 可省略）。 */
  sideEffectProof?: SideEffectProof | undefined
  /** Adapter 声明：是否支持原生 resume（L2 基础）。 */
  supportsNativeResume: boolean
  /** 是否存在 continuity capsule（L1 fresh recovery 的材料）。 */
  hasContinuityCapsule: boolean
  requestedRecoveryMode: RequestedRecoveryMode
  /** 配置白名单：自动恢复仅对名单内 kind 生效。 */
  autoRecoveryEnabled: boolean
}

export interface PlanRecoveryResult {
  decision: RecoveryDecision
  plan: RecoveryPlanV1
  created: boolean
}

/** 无副作用证明时派生保守决策。 */
function classifySideEffectProof(proof: SideEffectProof | undefined): {
  provablySafe: boolean
  reason: string | null
} {
  if (proof == null) return { provablySafe: false, reason: 'no_side_effect_proof' }
  switch (proof.kind) {
    case 'no_tools_dispatched':
      return { provablySafe: true, reason: null }
    case 'query_tools_only':
      return { provablySafe: true, reason: null }
    case 'unknown':
      return {
        provablySafe: false,
        reason: `unverifiable_tools:${proof.riskyTools.slice(0, 5).join(',')}`,
      }
  }
}

export class RecoveryPlanner {
  private readonly validator: RecoveryValidator

  constructor(private readonly db: SparkDatabase) {
    this.validator = new RecoveryValidator(db)
  }

  /**
   * 生成（幂等）恢复计划并持久化；同 Run+checkpoint+环境只保留一个有效计划。
   */
  plan(input: PlanRecoveryInput): PlanRecoveryResult {
    const { run } = input
    const checkpoint = this.validator.validateLatestCheckpoint(run.id)
    const env = this.validator.compareEnvironment(run.id, input.current)
    const effectRepo = new ExecutionEffectRepository(this.db)
    const planRepo = new ExecutionRecoveryPlanRepository(this.db)

    const degradationReasons: string[] = []
    const stepDecisions: RecoveryStepDecision[] = []

    // ---- Effect 调和（Phase 2 起存在 EffectJournal 记录时） ----
    const effects = effectRepo.listByRun(run.id)
    let hasUnknownEffects = false
    for (const effect of effects) {
      switch (effect.phase) {
        case 'confirmed':
          stepDecisions.push({
            stepKey: effect.stepId,
            action: 'skip_already_committed',
            reason: 'effect_confirmed',
          })
          break
        case 'prepared':
          stepDecisions.push({
            stepKey: effect.stepId,
            action: effect.replayPolicy === 'safe' ? 'replay_safe' : 'require_user_confirmation',
            reason: `prepared_not_dispatched:${effect.replayPolicy}`,
          })
          break
        case 'dispatching':
        case 'unknown':
          hasUnknownEffects = true
          stepDecisions.push({
            stepKey: effect.stepId,
            action:
              effect.replayPolicy === 'query_then_resume'
                ? 'query_external_then_resume'
                : 'require_user_confirmation',
            reason: `sent_intent_unresolved:${effect.phase}:${effect.toolName}`,
          })
          break
        default:
          break
      }
    }

    // ---- 环境与材料校验 ----
    if (!checkpoint.valid) {
      degradationReasons.push(`checkpoint_${checkpoint.invalidCause ?? 'invalid'}`)
    }
    if (!env.matches) degradationReasons.push(...env.mismatches)

    // ---- 恢复等级（方案 §4.3）----
    const { provablySafe, reason: proofReason } = classifySideEffectProof(input.sideEffectProof)
    if (hasUnknownEffects) degradationReasons.push('effects_unknown')
    if (!provablySafe && proofReason != null) degradationReasons.push(proofReason)

    let achievedLevel: RecoveryLevel
    let recoveryMethod: RecoveryPlanV1['recoveryMethod']
    if (checkpoint.valid && checkpoint.envelope != null) {
      if (input.supportsNativeResume) {
        achievedLevel = 2
        recoveryMethod = 'native_resume'
      } else if (input.hasContinuityCapsule) {
        achievedLevel = 1
        recoveryMethod = 'continuity_capsule'
      } else {
        achievedLevel = 1
        recoveryMethod = 'fresh_context'
      }
    } else {
      achievedLevel = 1
      recoveryMethod = input.hasContinuityCapsule ? 'continuity_capsule' : 'fresh_context'
    }
    if (hasUnknownEffects || !provablySafe) {
      // 副作用不可证明 → 最高 L1，且决策必须人工确认。
      achievedLevel = Math.min(achievedLevel, 1) as RecoveryLevel
    }

    // ---- 决策 ----
    let decision: RecoveryDecision
    const neverAuto =
      input.requestedRecoveryMode === 'manual' || input.requestedRecoveryMode === 'none'
    const needsConfirmMode = input.requestedRecoveryMode === 'confirm'
    const noProgressPossible =
      checkpoint.valid &&
      checkpoint.envelope == null &&
      run.status === 'completed'
    if (noProgressPossible || (!checkpoint.valid && checkpoint.invalidCause === 'missing' && run.latestCheckpointId != null)) {
      decision = 'cannot_resume'
      recoveryMethod = 'none'
    } else if (
      !input.autoRecoveryEnabled ||
      neverAuto ||
      needsConfirmMode ||
      hasUnknownEffects ||
      !provablySafe
    ) {
      decision = 'needs_confirmation'
    } else {
      decision = 'auto_resume'
    }
    // 未派发任何东西且无 Checkpoint 的 accepted Run：直接重放（fresh）。
    // 仅在自动恢复策略允许且不存在 unknown Effect 时生效
    // （manual/confirm 模式、白名单关闭、副作用不可证明均不覆盖）。
    if (
      decision === 'needs_confirmation' &&
      checkpoint.invalidCause === 'missing' &&
      provablySafe &&
      !hasUnknownEffects &&
      input.requestedRecoveryMode === 'auto' &&
      input.autoRecoveryEnabled
    ) {
      decision = 'auto_resume'
      recoveryMethod = 'fresh_context'
      achievedLevel = 1
    }

    const plan: RecoveryPlanV1 = {
      schemaVersion: 1,
      planId: `erp_${crypto.randomUUID()}`,
      runId: run.id,
      checkpointId: checkpoint.envelope?.checkpointId ?? null,
      environmentFingerprint: env.fingerprint,
      decision,
      achievedLevel,
      degradationReasons,
      stepDecisions,
      recoveryMethod,
      plannerVersion: RECOVERY_PLANNER_VERSION,
      createdAt: new Date().toISOString(),
    }
    const { created, row } = planRepo.upsertActive(plan)
    if (created) {
      planRepo.supersedeActiveForRun(run.id, row.id)
      new ExecutionRunRepository(this.db).advanceRecoveryPlanRef(run.id, row.id)
      return { decision, plan, created: true }
    }
    // 幂等：同 run+checkpoint+env 已有有效计划时返回已持久化版本（planId/决策一致）。
    const stored = planRepo.parsePlan(row)
    if (stored != null) {
      return { decision: stored.decision, plan: stored, created: false }
    }
    return { decision, plan, created: false }
  }

  /** 读取既有计划详情（IPC 详情视图）。 */
  latestPlanForRun(runId: string): RecoveryPlanV1 | null {
    const planRepo = new ExecutionRecoveryPlanRepository(this.db)
    return planRepo.parsePlan(planRepo.getLatestForRun(runId))
  }

  /** 未提交步骤统计（恢复中心展示「将重试」分组）。 */
  stepSummary(runId: string): { committed: number; pending: number; uncertain: number } {
    const counts = new ExecutionStepRepository(this.db).countByStatus(runId)
    return {
      committed: counts.committed,
      pending: counts.planned + counts.running + counts.waiting,
      uncertain: counts.uncertain + counts.failed,
    }
  }
}
