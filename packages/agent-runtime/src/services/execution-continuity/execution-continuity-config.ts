/**
 * @module execution-continuity-config
 *
 * 执行连续性子系统运行配置。
 *
 * 默认值供本机单 Worker 场景；可经 IPC（恢复中心设置）覆盖。
 * enabled=false 时整体退回旧终止语义（方案 §15 兼容回退）。
 */

import type { ExecutionContinuityConfig } from '@spark/protocol'

export const DEFAULT_EXECUTION_CONTINUITY_CONFIG: ExecutionContinuityConfig = {
  enabled: true,
  leaseDurationMs: 90_000,
  heartbeatIntervalMs: 20_000,
  drainTimeoutMs: 5_000,
  // media 恢复（query_then_resume 轮询）尚无执行方，不在默认自动恢复白名单；
  // turn 恢复走恢复 Turn 闭环。
  autoRecoveryKinds: ['turn'],
}

/** 进程内可变配置（Phase 1：内存态 + IPC 覆盖；持久化设置后续挂 Settings）。 */
let currentConfig: ExecutionContinuityConfig = { ...DEFAULT_EXECUTION_CONTINUITY_CONFIG }

export function getExecutionContinuityConfig(): ExecutionContinuityConfig {
  return { ...currentConfig }
}

export function setExecutionContinuityConfig(patch: Partial<ExecutionContinuityConfig>): ExecutionContinuityConfig {
  currentConfig = {
    ...currentConfig,
    ...patch,
    autoRecoveryKinds:
      patch.autoRecoveryKinds ?? currentConfig.autoRecoveryKinds,
  }
  return { ...currentConfig }
}
