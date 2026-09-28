/**
 * @module execution-continuity
 *
 * 执行连续性子系统出口 — ExecutionSupervisor / CheckpointWriter / EffectJournal /
 * RecoveryPlanner / RecoveryValidator / 策略目录 / 配置。
 */

export { ExecutionSupervisor } from './execution-supervisor.js'
export type { TurnRecoveryDelegate } from './execution-supervisor.js'
export { CheckpointWriter } from './checkpoint-writer.js'
export type {
  CheckpointCursorInput,
  RuntimeBindingInput,
  WriteCheckpointInput,
} from './checkpoint-writer.js'
export { EffectJournal, normalizeRequestHash } from './effect-journal.js'
export type { EffectPrepareInput, PreparedEffect } from './effect-journal.js'
export { RecoveryPlanner, RECOVERY_PLANNER_VERSION } from './recovery-planner.js'
export type { PlanRecoveryInput, PlanRecoveryResult } from './recovery-planner.js'
export { RecoveryValidator, computeEnvironmentFingerprint } from './recovery-validator.js'
export type {
  CheckpointValidationResult,
  EnvironmentComparison,
  EnvironmentFingerprintInput,
} from './recovery-validator.js'
export { inspectTurnSideEffects } from './turn-side-effect-inspector.js'
export type { SideEffectProof } from './turn-side-effect-inspector.js'
export { getToolRecoveryPolicy, mayHaveExternalSideEffect } from './tool-recovery-registry.js'
export {
  DEFAULT_EXECUTION_CONTINUITY_CONFIG,
  getExecutionContinuityConfig,
  setExecutionContinuityConfig,
} from './execution-continuity-config.js'
export { ADAPTER_DECLARATIONS, supportsNativeResumeFor } from './adapters/index.js'
