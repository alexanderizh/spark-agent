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
 * 生效绑定来源为 session-override（输入框选择）。agent 身上挂载（legacy-agent）与
 * inherit 绑定保持「宿主自主判断是否调用」的既有语义，不强制。
 */
export function shouldForceWorkflowTakeover(input: {
  isMentionTurn: boolean
  workflowCanUseManagedExecutor: boolean
  /** 生效绑定来源（effectiveWorkflowContext.source）；仅 session-override 强制。 */
  bindingSource?: string
}): boolean {
  return (
    !input.isMentionTurn &&
    input.workflowCanUseManagedExecutor &&
    input.bindingSource === 'session-override'
  )
}

/** workflow_run 工具 structuredContent 的最小读取面（成功/失败两形态的字段子集）。 */
interface WorkflowRunToolStructuredResult {
  status?: unknown
  failedNode?: { nodeId?: unknown; error?: { message?: unknown } | null } | null
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

function truncateSummary(text: string): string {
  if (text.length <= FORCED_TAKEOVER_SUMMARY_MAX_CHARS) return text
  return `${text.slice(0, FORCED_TAKEOVER_SUMMARY_MAX_CHARS)}\n[Workflow result summary truncated at ${FORCED_TAKEOVER_SUMMARY_MAX_CHARS} chars; the full state is persisted in workflow_runs and the run history panel.]`
}

/**
 * 接管结果注入宿主系统提示词的尾部权威段（排在 [Current Workflow Binding —
 * Authoritative] 之后，覆盖其与 workflow_run 引导词的执行指令）：
 * - completed：宿主只做收尾综合，本轮不再暴露 workflow_run 工具；
 * - failed：回退说明 + 保留 agent 自主决策（工具仍在，可自行调用或直接作答）。
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
  return [
    '[Forced Workflow Run — Fallback]',
    `The runtime attempted to execute the bound workflow before this turn but it ${where}: ${outcome.reason}`,
    'Decide autonomously how to complete the user objective: you may call workflow_run yourself (the tool remains available this turn), execute the workflow phases yourself, or answer directly.',
  ].join('\n')
}
