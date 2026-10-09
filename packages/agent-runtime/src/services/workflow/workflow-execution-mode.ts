import type { AgentAdapterKind } from '../session/engine-kinds.js'
import type { WorkflowExecutionMode } from '../workflow-system-prompt.js'

export interface WorkflowExecutionModeCapabilities {
  /**
   * 调用方的 adapter 口径。执行模式已引擎中立（三种执行器的 Host 工具面都挂载
   * workflow_run：claude-sdk 走 in-process SDK server，codex/spark 走 HTTP MCP 桥），
   * 该字段仅为调用方兼容保留，不再参与模式裁决。
   */
  agentAdapter: AgentAdapterKind
  hasWorkflowGraph: boolean
  managedExecutorAvailable: boolean
  isMentionTurn: boolean
}

/**
 * Runtime execution-mode boundary. Engine-neutral by contract: whenever the
 * graph is executable and this is not a mention turn, every engine returns
 * 'workflow_run'. This function is intentionally capability-only: it does not
 * inspect bindings or mutate runtime state.
 */
export function resolveWorkflowExecutionModeCapability(
  capabilities: WorkflowExecutionModeCapabilities,
): WorkflowExecutionMode {
  if (
    !capabilities.hasWorkflowGraph ||
    !capabilities.managedExecutorAvailable ||
    capabilities.isMentionTurn
  ) {
    return 'guided'
  }
  return 'workflow_run'
}
