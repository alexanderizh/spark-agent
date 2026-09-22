/**
 * @module dispatch-governor/governance-config
 *
 * 并发治理配置：默认值、normalize/钳制、工作流执行治理的默认值。
 *
 * 配置来源为 settings category=performance 的 governance / workflow 组
 * （每 category 单 data key JSON，渲染端 normalize 模式——见影响分析 §⑤）。
 * 本模块是 agent-runtime 侧的权威默认值与边界钳制，桌面装配层把
 * settings JSON 经 normalize 后灌给 governor / executor。
 */

import type { DispatchGovernanceConfig } from './types.js'

/** 主池默认预算 8：6 宿主会话上限下成员槽 ≥3，16GB 机器最坏 ≈3.2GB 子进程 RSS（方案 §六）。 */
export const DEFAULT_TOTAL_AGENT_PROCESS_BUDGET = 8
export const DEFAULT_HOST_INFLIGHT_CAP = 5
export const DEFAULT_MIN_MEMBER_SLOTS = 3
export const DEFAULT_MAX_MEMBER_DISPATCHES = 6
export const DEFAULT_NESTED_DISPATCH_SLOTS = 2
export const DEFAULT_DEADLOCK_ESCAPE_AFTER_MS = 15_000
export const DEFAULT_GATE_WAIT_TIMEOUT_MS = 120_000

export const TOTAL_AGENT_PROCESS_BUDGET_RANGE = { min: 4, max: 32 } as const
export const HOST_INFLIGHT_CAP_RANGE = { min: 3, max: 6 } as const
export const MIN_MEMBER_SLOTS_RANGE = { min: 1, max: 4 } as const
export const MAX_MEMBER_DISPATCHES_RANGE = { min: 1, max: 32 } as const
export const NESTED_DISPATCH_SLOTS_RANGE = { min: 1, max: 8 } as const

export const DEFAULT_DISPATCH_GOVERNANCE_CONFIG: DispatchGovernanceConfig = {
  enabled: true,
  totalAgentProcessBudget: DEFAULT_TOTAL_AGENT_PROCESS_BUDGET,
  hostInflightCap: DEFAULT_HOST_INFLIGHT_CAP,
  minMemberSlots: DEFAULT_MIN_MEMBER_SLOTS,
  maxMemberDispatches: DEFAULT_MAX_MEMBER_DISPATCHES,
  nestedDispatchSlots: DEFAULT_NESTED_DISPATCH_SLOTS,
  deadlockEscapeAfterMs: DEFAULT_DEADLOCK_ESCAPE_AFTER_MS,
  gateWaitTimeoutMs: DEFAULT_GATE_WAIT_TIMEOUT_MS,
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const truncated = Math.floor(value)
  return Math.min(max, Math.max(min, truncated))
}

function clampMs(value: unknown, min: number, max: number, fallback: number): number {
  return clampInt(value, min, max, fallback)
}

/**
 * 把任意输入（settings JSON 局部 / 完整对象）归一为合法配置。
 * 未知字段忽略；字段缺失回落默认值；越界钳制。始终返回完整对象。
 */
export function normalizeDispatchGovernanceConfig(raw: unknown): DispatchGovernanceConfig {
  const source = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const defaults = DEFAULT_DISPATCH_GOVERNANCE_CONFIG
  const budget = clampInt(
    source.totalAgentProcessBudget,
    TOTAL_AGENT_PROCESS_BUDGET_RANGE.min,
    TOTAL_AGENT_PROCESS_BUDGET_RANGE.max,
    defaults.totalAgentProcessBudget,
  )
  const minMemberSlots = clampInt(
    source.minMemberSlots,
    MIN_MEMBER_SLOTS_RANGE.min,
    Math.min(MIN_MEMBER_SLOTS_RANGE.max, budget),
    defaults.minMemberSlots,
  )
  return {
    enabled: source.enabled === false ? false : true,
    totalAgentProcessBudget: budget,
    hostInflightCap: clampInt(
      source.hostInflightCap,
      HOST_INFLIGHT_CAP_RANGE.min,
      HOST_INFLIGHT_CAP_RANGE.max,
      defaults.hostInflightCap,
    ),
    minMemberSlots,
    maxMemberDispatches: clampInt(
      source.maxMemberDispatches,
      MAX_MEMBER_DISPATCHES_RANGE.min,
      MAX_MEMBER_DISPATCHES_RANGE.max,
      defaults.maxMemberDispatches,
    ),
    nestedDispatchSlots: clampInt(
      source.nestedDispatchSlots,
      NESTED_DISPATCH_SLOTS_RANGE.min,
      NESTED_DISPATCH_SLOTS_RANGE.max,
      defaults.nestedDispatchSlots,
    ),
    deadlockEscapeAfterMs: clampMs(
      source.deadlockEscapeAfterMs,
      1_000,
      120_000,
      defaults.deadlockEscapeAfterMs,
    ),
    gateWaitTimeoutMs: clampMs(
      source.gateWaitTimeoutMs,
      1_000,
      600_000,
      defaults.gateWaitTimeoutMs,
    ),
  }
}

// ─── 工作流执行治理（executor additive options）───────────────────────────────

/**
 * 工作流执行治理参数（executeWorkflowAgentPlan input.governance）。
 * 不传（undefined）时 executor 行为与旧版逐字节一致。
 */
export interface WorkflowExecutionGovernance {
  /** 同波 ready 节点分块上限（波宽）。 */
  waveWidth: number
  /** subagent 节点 config.parallelism 静默钳制上限（扇出）。 */
  fanoutClamp: number
  /** 循环 × 体内最大派发波宽乘积上限，超限 loop 节点失败。 */
  loopFanoutProductCap: number
  /** 单 run（含 loop 迭代）派发总量上限，超限后续派发直接失败。 */
  maxDispatchesPerRun: number
}

export const DEFAULT_WORKFLOW_EXECUTION_GOVERNANCE: WorkflowExecutionGovernance = {
  waveWidth: 4,
  fanoutClamp: 4,
  loopFanoutProductCap: 32,
  maxDispatchesPerRun: 80,
}

/** 工作流治理参数边界（方案 §六）。 */
export const WORKFLOW_GOVERNANCE_RANGES = {
  waveWidth: { min: 1, max: 16 },
  fanoutClamp: { min: 1, max: 8 },
  loopFanoutProductCap: { min: 8, max: 400 },
  maxDispatchesPerRun: { min: 10, max: 500 },
} as const

export function normalizeWorkflowExecutionGovernance(raw: unknown): WorkflowExecutionGovernance {
  const source = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const defaults = DEFAULT_WORKFLOW_EXECUTION_GOVERNANCE
  return {
    waveWidth: clampInt(
      source.waveWidth,
      WORKFLOW_GOVERNANCE_RANGES.waveWidth.min,
      WORKFLOW_GOVERNANCE_RANGES.waveWidth.max,
      defaults.waveWidth,
    ),
    fanoutClamp: clampInt(
      source.fanoutClamp,
      WORKFLOW_GOVERNANCE_RANGES.fanoutClamp.min,
      WORKFLOW_GOVERNANCE_RANGES.fanoutClamp.max,
      defaults.fanoutClamp,
    ),
    loopFanoutProductCap: clampInt(
      source.loopFanoutProductCap,
      WORKFLOW_GOVERNANCE_RANGES.loopFanoutProductCap.min,
      WORKFLOW_GOVERNANCE_RANGES.loopFanoutProductCap.max,
      defaults.loopFanoutProductCap,
    ),
    maxDispatchesPerRun: clampInt(
      source.maxDispatchesPerRun,
      WORKFLOW_GOVERNANCE_RANGES.maxDispatchesPerRun.min,
      WORKFLOW_GOVERNANCE_RANGES.maxDispatchesPerRun.max,
      defaults.maxDispatchesPerRun,
    ),
  }
}
