/**
 * @module session-forced-workflow-runner
 *
 * 会话输入框工作流托管（session_workflow_bindings mode='override'）的运行时强制接管。
 *
 * 语义：override 绑定 = 用户显式要求「按工作流跑」，不再依赖宿主 LLM 自主决定是否
 * 调用 workflow_run。满足条件时，运行时在宿主 turn 起跑前直接以用户消息为 objective
 * 驱动 workflow_run 工具 handler——与模型调用完全同一条执行链（Run 建档/按代次续跑、
 * 进度事件广播、快照落库、执行连续性、M4 结果治理入参全部复用），终态后由宿主做
 * 一次面向用户的收尾综合回复（结果经 buildForcedWorkflowTakeoverResultPrompt 注入
 * 系统提示词尾部权威段）。
 *
 * 失败回退：接管启动失败（handler 抛出）或图执行到失败/取消终态时，不阻断本轮——
 * 本轮保留 workflow_run 工具与引导提示词，回退为由 agent 自主决策完成目标。
 */
import { createLogger } from '@spark/shared'
import type { TeamToolDefinition } from '../team-mcp-http-bridge.js'

const log = createLogger('session-forced-workflow-runner')

/** workflow_run 工具 schema 的 objective 上限；超长用户消息截断到该长度。 */
const FORCED_TAKEOVER_OBJECTIVE_MAX_CHARS = 8000

/** 注入宿主系统提示词的运行结果摘要上限（Final state 可能很大，超限截断并提示）。 */
export const FORCED_TAKEOVER_SUMMARY_MAX_CHARS = 6000

export interface ForcedWorkflowTakeoverCompleted {
  kind: 'completed'
  /** workflow_run 工具返回的终态摘要文本（含 Final state 或 per-key summary）。 */
  summaryText: string
}

export interface ForcedWorkflowTakeoverFailed {
  /** 失败阶段：'invoke'（handler 抛出/启动失败）或 'run'（图执行到失败/取消终态）。 */
  kind: 'failed'
  stage: 'invoke' | 'run'
  reason: string
  /** run 终态失败时的节点 id（structuredContent.failedNode.nodeId，如有）。 */
  failedNodeId?: string
  /**
   * 运行进度摘要（已完成节点 + 失败节点 + 终态），供回退提示词如实向用户汇报。
   * invoke 失败（图没跑起来）时缺省——无进度可汇报。
   */
  progressSummary?: string
}

export type ForcedWorkflowTakeoverOutcome =
  | ForcedWorkflowTakeoverCompleted
  | ForcedWorkflowTakeoverFailed

/** 可变结果容器：createTeamMcpServer 内执行接管并回写，startTurn 侧读取做收尾注入。 */
export interface ForcedWorkflowTakeoverHolder {
  outcome?: ForcedWorkflowTakeoverOutcome
}

/**
 * 强制接管条件：非 mention 回合 + 图可执行（沿用 managedExecutorAvailable 判定）+
 * 生效绑定来源为 session-override（输入框选择）+ 该绑定下没有不可续跑的终态 run。
 *
 * 终态守卫（实测修复）：override 绑定的语义是「首条消息必跑」，不是「每条消息都重跑
 * 一遍整图」。completed/canceled 之后用户再发消息（追问总结、继续对话）不得自动重跑
 * ——改为注入最近运行状态（buildWorkflowRecentRunPrompt）由宿主基于结果对话，用户
 * 明确要求重跑时宿主自行调用 workflow_run。failed 不算终态（coordinator 按代次续跑
 * 重试，与 findLatestResumable 语义一致）。agent 身上挂载（legacy-agent）与
 * inherit 绑定保持「宿主自主判断是否调用」的既有语义，不强制。
 */
export function shouldForceWorkflowTakeover(input: {
  isMentionTurn: boolean
  workflowCanUseManagedExecutor: boolean
  /** 生效绑定来源（effectiveWorkflowContext.source）；仅 session-override 强制。 */
  bindingSource?: string
  /** 当前绑定下最近一条 completed/canceled run 是否存在（findLatestTerminal*）。 */
  hasTerminalRun?: boolean
}): boolean {
  return (
    !input.isMentionTurn &&
    input.workflowCanUseManagedExecutor &&
    input.bindingSource === 'session-override' &&
    input.hasTerminalRun !== true
  )
}

/** workflow_run 工具 structuredContent 的最小读取面（成功/失败两形态的字段子集）。 */
interface WorkflowRunToolStructuredResult {
  status?: unknown
  failedNode?: { nodeId?: unknown; error?: { message?: unknown } | null } | null
  completedNodeIds?: unknown
  stateSummary?: unknown
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 以用户消息为 objective 直接驱动 workflow_run 工具 handler 跑到终态。
 * 判定成功依据 structuredContent.status === 'completed'（envelope 化的大 state
 * 形态也带该字段）；structuredContent 缺失时按内联文本前缀兜底。
 */
export async function runForcedWorkflowTakeover(input: {
  tool: TeamToolDefinition
  objective: string
  sessionId: string
  turnId: string
}): Promise<ForcedWorkflowTakeoverOutcome> {
  const objective =
    input.objective.length > FORCED_TAKEOVER_OBJECTIVE_MAX_CHARS
      ? input.objective.slice(0, FORCED_TAKEOVER_OBJECTIVE_MAX_CHARS)
      : input.objective
  try {
    const reply = await input.tool.handler({ objective })
    const structured = (reply.structuredContent ?? {}) as WorkflowRunToolStructuredResult
    const text = readString(reply.content[0]?.text)
    if (readString(structured.status) === 'completed' || text.startsWith('Workflow completed')) {
      return { kind: 'completed', summaryText: text }
    }
    const failedNode = structured.failedNode
    const reason =
      text.trim().length > 0
        ? text
        : readString(failedNode?.error?.message) || 'workflow run did not complete'
    log.warn('forced workflow takeover: run failed', {
      sessionId: input.sessionId,
      turnId: input.turnId,
      reason,
    })
    return {
      kind: 'failed',
      stage: 'run',
      reason,
      ...(failedNode?.nodeId != null ? { failedNodeId: readString(failedNode.nodeId) } : {}),
      progressSummary: buildTakeoverProgressSummary(structured),
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log.warn('forced workflow takeover: invoke failed', {
      sessionId: input.sessionId,
      turnId: input.turnId,
      reason,
    })
    return { kind: 'failed', stage: 'invoke', reason }
  }
}

/** 从 workflow_run structuredContent 提取可读进度摘要（节点完成/失败 + 状态键）。 */
function buildTakeoverProgressSummary(structured: WorkflowRunToolStructuredResult): string {
  const lines: string[] = []
  const completed = Array.isArray(structured.completedNodeIds)
    ? structured.completedNodeIds.filter((id): id is string => typeof id === 'string')
    : []
  if (completed.length > 0) {
    lines.push(`Completed nodes (${completed.length}): ${completed.join(', ')}`)
  } else {
    lines.push('No nodes completed before the failure.')
  }
  const failedNodeId = readString(structured.failedNode?.nodeId)
  const failedMessage = readString(structured.failedNode?.error?.message)
  if (failedNodeId.length > 0) {
    lines.push(
      `Failed at node ${failedNodeId}${failedMessage.length > 0 ? ` — ${failedMessage}` : ''}`,
    )
  }
  const stateSummary = Array.isArray(structured.stateSummary)
    ? structured.stateSummary.filter((line): line is string => typeof line === 'string')
    : []
  if (stateSummary.length > 0) {
    lines.push('State keys:', ...stateSummary.map((line) => `  - ${line}`))
  }
  return lines.join('\n')
}

function truncateSummary(text: string): string {
  if (text.length <= FORCED_TAKEOVER_SUMMARY_MAX_CHARS) return text
  return `${text.slice(0, FORCED_TAKEOVER_SUMMARY_MAX_CHARS)}\n[Workflow result summary truncated at ${FORCED_TAKEOVER_SUMMARY_MAX_CHARS} chars; the full state is persisted in workflow_runs and the run history panel.]`
}

/**
 * 接管结果注入宿主系统提示词的尾部权威段（排在 [Current Workflow Binding —
 * Authoritative] 之后，覆盖其与 workflow_run 引导词的执行指令）：
 * - completed：宿主只做收尾综合，本轮不再暴露 workflow_run 工具；
 * - failed：如实汇报运行进度与失败原因并给出修复建议；run 失败（非启动失败）时
 *   默认不自动重跑（用户刚经历了失败的长任务，未经确认重跑会重复消耗），用户明确
 *   要求重跑或示意重试时再调用 workflow_run；invoke 失败（图没跑起来）时保留自主决策。
 */
export function buildForcedWorkflowTakeoverResultPrompt(
  outcome: ForcedWorkflowTakeoverOutcome,
): string {
  if (outcome.kind === 'completed') {
    return [
      '[Forced Workflow Run — Authoritative]',
      'The session workflow binding for this turn was executed by the runtime BEFORE this reply; the workflow_run tool is not exposed this turn. This section supersedes any earlier instruction to call workflow_run.',
      'Workflow result summary:',
      truncateSummary(outcome.summaryText),
      'Now synthesize the final user-facing answer from the workflow results above. Stay faithful to the node outputs and do not restate the workflow steps unless asked. If the results are insufficient to answer, complete the remaining work yourself with your own tools and say so.',
    ].join('\n')
  }
  const where =
    outcome.stage === 'invoke'
      ? 'failed to start'
      : `failed${outcome.failedNodeId != null ? ` at node ${outcome.failedNodeId}` : ''}`
  const sections = [
    '[Forced Workflow Run — Fallback]',
    `The runtime attempted to execute the bound workflow before this turn but it ${where}: ${truncateSummary(outcome.reason)}`,
  ]
  if (outcome.progressSummary != null && outcome.progressSummary.length > 0) {
    sections.push('Workflow progress before failure:', outcome.progressSummary)
  }
  if (outcome.stage === 'invoke') {
    sections.push(
      'The workflow never started, so decide autonomously how to complete the user objective: you may call workflow_run yourself (the tool remains available this turn), execute the workflow phases yourself, or answer directly.',
    )
  } else {
    sections.push(
      'This section supersedes any earlier instruction to call workflow_run. First report honestly to the user: what the workflow completed, where and why it failed, and a concrete fix suggestion. Do NOT automatically re-run the workflow this turn — the run above already consumed real work; only call workflow_run when the user explicitly asks to retry or clearly wants the workflow re-executed.',
    )
  }
  return sections.join('\n')
}

/** buildWorkflowRecentRunPrompt 读取的 run 行子集（WorkflowRunRow 的最小读取面）。 */
export interface WorkflowRecentRunLike {
  status: string
  ended_at: string | null
  completed_node_ids_json: string
  failed_node_json: string | null
}

function parseNodeIdList(raw: string): string[] {
  try {
    const ids = JSON.parse(raw) as unknown
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function readFailedNodeMessage(raw: string | null): string {
  if (raw == null) return ''
  try {
    const failed = JSON.parse(raw) as { error?: { message?: unknown } }
    return typeof failed.error?.message === 'string' ? failed.error.message : ''
  } catch {
    return ''
  }
}

/**
 * 终态守卫生效时（completed/canceled run 已存在、本轮不强制接管）注入的最近运行状态段。
 * 让宿主知道绑定的工作流已经跑过、结果如何——用户追问总结/进度时如实汇报，
 * 而不是当作「还没跑过」重新叙述。用户明确要求重跑时宿主自行调用 workflow_run。
 */
export function buildWorkflowRecentRunPrompt(input: {
  run: WorkflowRecentRunLike
  workflowName: string
}): string {
  const { run } = input
  const completed = parseNodeIdList(run.completed_node_ids_json)
  const failedMessage = readFailedNodeMessage(run.failed_node_json)
  const lines = [
    '[Bound Workflow — Recent Run State]',
    `The bound workflow "${input.workflowName}" already has a ${run.status} run (ended ${run.ended_at ?? 'unknown time'}). This turn does NOT auto-execute the workflow again.`,
    completed.length > 0
      ? `Completed nodes (${completed.length}): ${completed.join(', ')}`
      : 'No nodes were completed in that run.',
  ]
  // 终态守卫的数据源（findLatestTerminal）只返回 completed/canceled；canceled 的两种
  // 来源——用户手动终止、审批节点被拒绝（run 标 canceled，failed_node 带 denied
  // 信息）——都可能在 failed_node_json 里留下原因，有就如实展示给宿主转述。
  if (failedMessage.length > 0) {
    lines.push(`Failure: ${failedMessage}`)
  }
  if (run.status === 'canceled') {
    lines.push('The run was canceled — either stopped by the user or rejected at an approval node.')
  }
  lines.push(
    'Answer the user based on this state and the conversation: report progress or results when asked, and only call workflow_run if the user explicitly asks to re-run the workflow.',
  )
  return lines.join('\n')
}
