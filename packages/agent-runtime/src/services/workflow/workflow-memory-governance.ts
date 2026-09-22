/**
 * @module workflow/workflow-memory-governance
 *
 * M4 内存治理（方案 §4.3-5 / §4.4 / §六 配置表「工作流」组）：
 * - 落库 state 值 / executions content 截断（头 60% + 尾 30% + truncated 标记）；
 * - 快照节流最小间隔阈值；
 * - workflow_run 结果进上下文的 inline state 摘要阈值。
 *
 * 配置来源为 settings category=performance 的 workflow 内存治理键（桌面装配层
 * 经 SessionService.setWorkflowMemoryGovernance 灌入）。刻意与 M0 的
 * WorkflowExecutionGovernance（dispatch-governor/governance-config.ts）分离为
 * 独立接口：既有调用方按完整对象字面量传 M0 governance，若在此扩必填字段会
 * 破坏其 typecheck；M4 阈值经独立可选参数逐点接入。
 *
 * 截断只作用于「落库快照副本」：executor 内存中的 state/executions 保持完整
 * （模板插值 / 条件判断 / loop 语义不变），仅 onSnapshot 观察到的快照被治理；
 * 续跑从 state_json 读回的是截断值（truncated 标记完整，阈值可调至 2MB 回退）。
 */

import type {
  WorkflowAgentExecutionRecord,
  WorkflowAtomicNodeExecutionRecord,
  WorkflowRunSnapshot,
  WorkflowState,
} from '../workflow-executor.js'

/** state 单值 / executions 单条 content 的落库字符上限（默认 200KB / 20KB，方案 §六）。 */
export interface WorkflowMemoryGovernance {
  stateValueMaxChars: number
  executionsContentMaxChars: number
  /** working 快照落库最小间隔（0 = 不节流，保持现状）。 */
  snapshotMinIntervalMs: number
  /** workflow_run 结果 inline state 的字符上限，超限改逐 key 摘要 + artifact 归档。 */
  resultInlineStateMaxChars: number
}

export const DEFAULT_WORKFLOW_MEMORY_GOVERNANCE: WorkflowMemoryGovernance = {
  stateValueMaxChars: 200_000,
  executionsContentMaxChars: 20_000,
  snapshotMinIntervalMs: 2_000,
  resultInlineStateMaxChars: 2_000,
}

/**
 * 边界（方案 §六 该组范围为「—」，按 §九 风险缓解「阈值可调至 2MB」定上限；
 * 下限防止配置误填产生无意义的逐字符截断）。
 */
export const WORKFLOW_MEMORY_GOVERNANCE_RANGES = {
  stateValueMaxChars: { min: 1_000, max: 2_000_000 },
  executionsContentMaxChars: { min: 1_000, max: 2_000_000 },
  snapshotMinIntervalMs: { min: 0, max: 60_000 },
  resultInlineStateMaxChars: { min: 200, max: 2_000_000 },
} as const

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/** 把任意输入（settings JSON 局部 / 完整对象）归一为合法配置；未知字段忽略，越界钳制。 */
export function normalizeWorkflowMemoryGovernance(raw: unknown): WorkflowMemoryGovernance {
  const source = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const defaults = DEFAULT_WORKFLOW_MEMORY_GOVERNANCE
  return {
    stateValueMaxChars: clampInt(
      source.stateValueMaxChars,
      WORKFLOW_MEMORY_GOVERNANCE_RANGES.stateValueMaxChars.min,
      WORKFLOW_MEMORY_GOVERNANCE_RANGES.stateValueMaxChars.max,
      defaults.stateValueMaxChars,
    ),
    executionsContentMaxChars: clampInt(
      source.executionsContentMaxChars,
      WORKFLOW_MEMORY_GOVERNANCE_RANGES.executionsContentMaxChars.min,
      WORKFLOW_MEMORY_GOVERNANCE_RANGES.executionsContentMaxChars.max,
      defaults.executionsContentMaxChars,
    ),
    snapshotMinIntervalMs: clampInt(
      source.snapshotMinIntervalMs,
      WORKFLOW_MEMORY_GOVERNANCE_RANGES.snapshotMinIntervalMs.min,
      WORKFLOW_MEMORY_GOVERNANCE_RANGES.snapshotMinIntervalMs.max,
      defaults.snapshotMinIntervalMs,
    ),
    resultInlineStateMaxChars: clampInt(
      source.resultInlineStateMaxChars,
      WORKFLOW_MEMORY_GOVERNANCE_RANGES.resultInlineStateMaxChars.min,
      WORKFLOW_MEMORY_GOVERNANCE_RANGES.resultInlineStateMaxChars.max,
      defaults.resultInlineStateMaxChars,
    ),
  }
}

// ─── 截断纯函数（头 60% + 尾 30%，方案 §4.3-5）────────────────────────────────

/** 头部保留比例（占 maxChars）。 */
export const WORKFLOW_TRUNCATION_HEAD_RATIO = 0.6
/** 尾部保留比例（占 maxChars）。 */
export const WORKFLOW_TRUNCATION_TAIL_RATIO = 0.3

/** state 值被截断后的落库形态：additive 标记对象，原始字符串可从 value 头尾拼回主干。 */
export interface WorkflowTruncatedStateValue {
  truncated: true
  originalChars: number
  value: string
}

export function isWorkflowTruncatedStateValue(
  value: unknown,
): value is WorkflowTruncatedStateValue {
  return (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).truncated === true &&
    typeof (value as Record<string, unknown>).originalChars === 'number' &&
    typeof (value as Record<string, unknown>).value === 'string'
  )
}

/** 头尾截断：保留 maxChars 的头 60% + 尾 30%，中间以省略标记衔接（标记长度另计）。 */
export function clipWorkflowTextHeadTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text
  const head = Math.floor(maxChars * WORKFLOW_TRUNCATION_HEAD_RATIO)
  const tail = Math.floor(maxChars * WORKFLOW_TRUNCATION_TAIL_RATIO)
  const omitted = text.length - head - tail
  const marker = `\n…[workflow truncated: ${omitted} of ${text.length} chars omitted]…\n`
  return `${text.slice(0, head)}${marker}${text.slice(text.length - tail)}`
}

/**
 * 截断单个 state 值：string 超限 → truncated 标记对象；对象/数组按序列化长度
 * 判定（罕见：input 节点结构化输出）。未超限返回原引用（逐字节不变）。
 * 已是截断形态的值（续跑读回）经序列化路径天然幂等，不会嵌套包裹。
 */
export function truncateWorkflowStateValue(value: unknown, maxChars: number): unknown {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return value
  if (typeof value === 'string') {
    if (value.length <= maxChars) return value
    return {
      truncated: true as const,
      originalChars: value.length,
      value: clipWorkflowTextHeadTail(value, maxChars),
    }
  }
  if (value == null || typeof value !== 'object') return value
  let serialized: string
  try {
    serialized = JSON.stringify(value) ?? ''
  } catch {
    // 循环引用等不可序列化值不属于正文膨胀治理目标，原样保留。
    return value
  }
  if (serialized.length <= maxChars) return value
  return {
    truncated: true as const,
    originalChars: serialized.length,
    value: clipWorkflowTextHeadTail(serialized, maxChars),
  }
}

/**
 * 截断执行记录 content（agent / atomic 通用）：超限时截断正文并在记录上补
 * `truncated: true`（additive 字段，未截断记录不携带该字段）。结构字段
 * （nodeId/agentId/attempt/state/error/startedAt/endedAt 等）完整保留。
 */
export function truncateWorkflowExecutionRecord<T extends { content: string }>(
  record: T,
  maxChars: number,
): T {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return record
  if (record.content.length <= maxChars) return record
  return {
    ...record,
    content: clipWorkflowTextHeadTail(record.content, maxChars),
    truncated: true,
  }
}

/**
 * 对落库快照应用 M4 内存治理：state 逐值截断 + executions/atomicExecutions
 * content 截断。任何截断都不发生时返回原快照引用（调用方「未超限逐字节不变」
 * 的现状语义）；发生截断时返回浅拷贝快照（status/节点集合等结构字段原样）。
 */
export function applyWorkflowSnapshotMemoryGovernance(
  snapshot: WorkflowRunSnapshot,
  governance: WorkflowMemoryGovernance | undefined,
): WorkflowRunSnapshot {
  if (governance == null) return snapshot

  let stateChanged = false
  const state: WorkflowState = {}
  for (const [key, value] of Object.entries(snapshot.state)) {
    const next = truncateWorkflowStateValue(value, governance.stateValueMaxChars)
    state[key] = next
    if (next !== value) stateChanged = true
  }

  let executionsChanged = false
  const executions: WorkflowAgentExecutionRecord[] = snapshot.executions.map((record) => {
    const next = truncateWorkflowExecutionRecord(record, governance.executionsContentMaxChars)
    if (next !== record) executionsChanged = true
    return next
  })

  let atomicExecutionsChanged = false
  const atomicExecutions: WorkflowAtomicNodeExecutionRecord[] = snapshot.atomicExecutions.map(
    (record) => {
      const next = truncateWorkflowExecutionRecord(record, governance.executionsContentMaxChars)
      if (next !== record) atomicExecutionsChanged = true
      return next
    },
  )

  if (!stateChanged && !executionsChanged && !atomicExecutionsChanged) return snapshot
  return { ...snapshot, state, executions, atomicExecutions }
}

// ─── workflow_run 结果 inline 摘要（方案 §4.4：逐 key 类型+长度+预览）──────────

/** inline state 摘要中每个值的预览字符数（方案 §4.4：200 字符预览）。 */
export const WORKFLOW_STATE_SUMMARY_PREVIEW_CHARS = 200

function workflowStateValueKind(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (isWorkflowTruncatedStateValue(value)) return 'string(truncated)'
  return typeof value
}

function workflowStateValueText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

/**
 * 逐 key 生成 state 摘要行：`key: 类型(长度) "前 200 字符预览"`。
 * 用于 workflow_run 结果 inline 部分超限时的替代输出；完整结果由调用方归档。
 */
export function summarizeWorkflowStateKeys(state: WorkflowState): string[] {
  return Object.entries(state).map(([key, value]) => {
    const text = workflowStateValueText(value)
    const preview =
      text.length > WORKFLOW_STATE_SUMMARY_PREVIEW_CHARS
        ? `${text.slice(0, WORKFLOW_STATE_SUMMARY_PREVIEW_CHARS)}…`
        : text
    return `${key}: ${workflowStateValueKind(value)}(${text.length} chars) "${preview}"`
  })
}
