import type { WorkflowItem } from '@spark/storage'
import {
  normalizeWorkflowGraph,
  orderWorkflowNodes,
  type NormalizedWorkflowEdge,
  type NormalizedWorkflowNode,
} from './workflow-executor.js'

export type WorkflowExecutionMode = 'guided' | 'workflow_run' | 'codex_guided'

export function buildWorkflowBindingAuthorityPrompt(workflow: WorkflowItem): string {
  if (normalizeWorkflowGraph(workflow.graph).nodes.length === 0) return ''
  return [
    '[Current Workflow Binding — Authoritative]',
    `The only active workflow binding for this turn is ${workflow.name} (${workflow.id}).`,
    'Only for workflow identity and execution steps, this binding overrides any different workflow name, default process, or step list found in other prompts, memory, or conversation history.',
    'All unrelated system, agent, project, session, and user instructions remain in force.',
    'When asked which workflow you use, report this workflow only. When executing, follow this workflow graph only.',
  ].join('\n')
}

export function buildWorkflowSystemPrompt(
  workflow: WorkflowItem,
  workflowExecutionMode: WorkflowExecutionMode = 'guided',
): string {
  const graph = normalizeWorkflowGraph(workflow.graph)
  if (graph.nodes.length === 0) return ''
  const nodes: NormalizedWorkflowNode[] = graph.nodes
  const edges: NormalizedWorkflowEdge[] = graph.edges
  const ordered = orderWorkflowNodes(nodes, edges)
  const lines = ordered.map((node, index) => {
    const config = node.config
    const detail = [
      `kind=${node.kind}`,
      config.role != null ? `role=${String(config.role)}` : '',
      config.modelId != null && String(config.modelId).trim()
        ? `model=${String(config.modelId)}`
        : '',
      Array.isArray(config.skillIds) && config.skillIds.length > 0
        ? `skills=${config.skillIds.join(', ')}`
        : '',
      Array.isArray(config.toolIds) && config.toolIds.length > 0
        ? `tools=${config.toolIds.join(', ')}`
        : '',
      Array.isArray(config.ruleIds) && config.ruleIds.length > 0
        ? `rules=${config.ruleIds.join(', ')}`
        : '',
      typeof config.outputKey === 'string' && config.outputKey.trim()
        ? `outputKey=${config.outputKey.trim()}`
        : '',
      typeof config.retryCount === 'number' ? `retry=${config.retryCount}` : '',
    ].filter(Boolean)
    const prompt =
      typeof config.prompt === 'string' && config.prompt.trim()
        ? `\n   prompt: ${config.prompt.trim()}`
        : ''
    return `${index + 1}. ${node.title} [${detail.join('; ')}]${prompt}`
  })
  const edgeLines = edges.map((edge) => {
    const from = nodes.find((node) => node.id === edge.from)?.title ?? edge.from
    const to = nodes.find((node) => node.id === edge.to)?.title ?? edge.to
    const condition =
      edge.condition == null ? 'always' : formatWorkflowConditionForPrompt(edge.condition)
    return `- ${from} -> ${to} [condition: ${condition}]`
  })

  return [
    '[Workflow Execution Plan]',
    `Workflow: ${workflow.name} (${workflow.id})`,
    workflow.description.trim() ? `Description: ${workflow.description.trim()}` : '',
    workflowExecutionMode === 'workflow_run'
      ? 'When workflow_run is available, call `mcp__spark_team__workflow_run` exactly once with the current user objective. The tool executes explicit agent nodes sequentially and carries outputKey state between nodes.'
      : workflowExecutionMode === 'codex_guided'
        ? 'This runtime does not expose `workflow_run`. Execute the active workflow phases yourself in topological order within this turn. Keep an internal checklist of active nodes, do not skip a node unless an incoming condition is false based on established state, and clearly report the blocking node if the workflow cannot be completed.'
        : 'Execute the task by following these workflow nodes in order. If a node declares a model, tool, skill, or permission preference, treat it as the preferred configuration for that phase. All enabled MCP servers remain globally available. When the SDK cannot literally switch model per node within one turn, preserve the node intent in your planning and execution notes.',
    lines.join('\n'),
    edgeLines.length > 0
      ? [
          '[Workflow Edges]',
          'Evaluate each condition against workflow state keys written by node outputKey values. A node with multiple incoming edges should wait for all active upstream branches, while branches made inactive by false conditions are skipped.',
          edgeLines.join('\n'),
        ].join('\n')
      : '',
  ]
    .filter((line) => line.trim().length > 0)
    .join('\n\n')
}

function formatWorkflowConditionForPrompt(
  condition: NormalizedWorkflowEdge['condition'],
): string {
  if (condition == null) return 'always'
  if (condition.op === 'equals' || condition.op === 'not_equals') {
    return `${condition.key} ${condition.op} ${JSON.stringify(condition.value)}`
  }
  return `${condition.key} ${condition.op}`
}
