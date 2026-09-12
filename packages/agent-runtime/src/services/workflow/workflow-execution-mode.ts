import type { AgentAdapterKind } from '../session/engine-kinds.js'
import { resolveEngineKind } from '../session/engine-kinds.js'
import type { WorkflowExecutionMode } from '../workflow-system-prompt.js'

export interface WorkflowExecutionModeCapabilities {
  agentAdapter: AgentAdapterKind
  hasWorkflowGraph: boolean
  managedExecutorAvailable: boolean
  isMentionTurn: boolean
}

/**
 * Preserve the current runtime execution-mode matrix behind one named boundary.
 * This function is intentionally capability-only: it does not inspect bindings,
 * mutate runtime state, or broaden workflow_run availability.
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
  return resolveEngineKind(capabilities.agentAdapter) === 'claude-sdk'
    ? 'workflow_run'
    : 'codex_guided'
}
