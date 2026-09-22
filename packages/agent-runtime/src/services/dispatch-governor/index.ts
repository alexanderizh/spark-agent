/**
 * @module dispatch-governor
 *
 * 全局成员派发并发闸门（M0「物理闸门」）+ 工作流执行治理配置。
 *
 * 与既有 team-dispatch-governance.ts（SteeringGate 讨论域钩子）同名不同物，
 * 互不依赖。命名按影响分析 §1.2 末的冲突提示刻意区分。
 */

export { DispatchGovernor } from './dispatch-governor.js'
export type { DispatchGovernorAcquireArgs, DispatchGovernorOptions } from './dispatch-governor.js'
export type { DispatchGatePermit } from './dispatch-governor.js'

export {
  DEFAULT_DISPATCH_GOVERNANCE_CONFIG,
  DEFAULT_WORKFLOW_EXECUTION_GOVERNANCE,
  normalizeDispatchGovernanceConfig,
  normalizeWorkflowExecutionGovernance,
  TOTAL_AGENT_PROCESS_BUDGET_RANGE,
  WORKFLOW_GOVERNANCE_RANGES,
} from './governance-config.js'
export type { WorkflowExecutionGovernance } from './governance-config.js'

export { DispatchGateError } from './types.js'
export type {
  DispatchGatePool,
  DispatchGateRejectionKind,
  DispatchGovernanceConfig,
  DispatchGovernorDiagnostics,
  DispatchSource,
} from './types.js'
