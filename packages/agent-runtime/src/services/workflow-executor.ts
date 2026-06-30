import type { WorkflowGraph, WorkflowNodeKind } from '@spark/protocol'

export type WorkflowState = Record<string, unknown>

export type WorkflowAgentDispatchRequest = {
  nodeId: string
  agentId: string
  instruction: string
  inputs: Record<string, unknown>
}

export type WorkflowAgentDispatchReply =
  | { state?: 'completed'; content: string }
  | { state: 'failed' | 'canceled'; content: string; error?: { code?: string; message: string } }

export type WorkflowAgentExecutionRecord = WorkflowAgentDispatchRequest & {
  attempt: number
  state: 'completed' | 'failed' | 'canceled'
  content: string
  error?: { code?: string; message: string }
}

export type WorkflowAgentPlanResult = {
  status: 'completed' | 'failed' | 'canceled'
  state: WorkflowState
  executions: WorkflowAgentExecutionRecord[]
  failedNode?: {
    nodeId: string
    agentId: string
    attempt: number
    error: { code?: string; message: string }
  }
}

export type NormalizedWorkflowNode = {
  id: string
  kind: WorkflowNodeKind
  title: string
  config: Record<string, unknown>
}

export type NormalizedWorkflowEdge = {
  id: string
  from: string
  to: string
}

export type NormalizedWorkflowGraph = {
  nodes: NormalizedWorkflowNode[]
  edges: NormalizedWorkflowEdge[]
}

const WORKFLOW_NODE_KINDS = new Set<WorkflowNodeKind>([
  'input',
  'plan',
  'agent',
  'subagent',
  'skill',
  'tool',
  'mcp',
  'approval',
  'verify',
  'review',
  'artifact',
])

export function normalizeWorkflowGraph(graph: WorkflowGraph | Record<string, unknown>): NormalizedWorkflowGraph {
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const nodes = rawNodes.flatMap((node): NormalizedWorkflowNode[] => {
    if (node == null || typeof node !== 'object') return []
    const record = node as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (id.length === 0) return []
    const rawKind = typeof record.kind === 'string' ? record.kind : 'agent'
    const kind = WORKFLOW_NODE_KINDS.has(rawKind as WorkflowNodeKind) ? (rawKind as WorkflowNodeKind) : 'agent'
    return [
      {
        id,
        kind,
        title: typeof record.title === 'string' && record.title.trim().length > 0 ? record.title : id,
        config: record.config != null && typeof record.config === 'object' ? (record.config as Record<string, unknown>) : {},
      },
    ]
  })

  const nodeIds = new Set(nodes.map((node) => node.id))
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : []
  const edges = rawEdges.flatMap((edge, index): NormalizedWorkflowEdge[] => {
    if (edge == null || typeof edge !== 'object') return []
    const record = edge as Record<string, unknown>
    const from = typeof record.from === 'string' ? record.from.trim() : ''
    const to = typeof record.to === 'string' ? record.to.trim() : ''
    if (!nodeIds.has(from) || !nodeIds.has(to)) return []
    const id = typeof record.id === 'string' && record.id.trim().length > 0 ? record.id : `${from}->${to}:${index}`
    return [{ id, from, to }]
  })

  return { nodes, edges }
}

export function orderWorkflowNodes(
  nodes: NormalizedWorkflowNode[],
  edges: NormalizedWorkflowEdge[],
): NormalizedWorkflowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
  }

  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0)
  const ordered: NormalizedWorkflowNode[] = []
  while (queue.length > 0) {
    const node = queue.shift()!
    ordered.push(node)
    for (const to of outgoing.get(node.id) ?? []) {
      const next = (incoming.get(to) ?? 0) - 1
      incoming.set(to, next)
      if (next === 0) {
        const target = byId.get(to)
        if (target != null) queue.push(target)
      }
    }
  }

  return ordered.length === nodes.length ? ordered : nodes
}

export function getWorkflowAgentWorkerIds(nodes: NormalizedWorkflowNode[]): Set<string> {
  const ids = new Set<string>()
  for (const node of nodes) {
    if (node.kind !== 'agent') continue
    const agentId = typeof node.config.agentId === 'string' ? node.config.agentId.trim() : ''
    if (agentId.length > 0) ids.add(agentId)
  }
  return ids
}

export function buildWorkflowNodeInputs(
  nodeId: string,
  graph: NormalizedWorkflowGraph,
  state: WorkflowState,
): Record<string, unknown> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const inputs: Record<string, unknown> = {}
  for (const edge of graph.edges) {
    if (edge.to !== nodeId) continue
    const upstream = byId.get(edge.from)
    const outputKey = typeof upstream?.config.outputKey === 'string' ? upstream.config.outputKey.trim() : ''
    if (outputKey.length === 0 || !(outputKey in state)) continue
    inputs[outputKey] = state[outputKey]
  }
  return inputs
}

export async function executeWorkflowAgentPlan(input: {
  graph: NormalizedWorkflowGraph
  objective: string
  initialState?: WorkflowState
  dispatch: (request: WorkflowAgentDispatchRequest) => Promise<WorkflowAgentDispatchReply>
}): Promise<WorkflowAgentPlanResult> {
  const state: WorkflowState = { ...input.initialState }
  const executions: WorkflowAgentExecutionRecord[] = []

  for (const node of orderWorkflowNodes(input.graph.nodes, input.graph.edges)) {
    if (node.kind !== 'agent') continue
    const agentId = typeof node.config.agentId === 'string' ? node.config.agentId.trim() : ''
    if (agentId.length === 0) continue

    const prompt = typeof node.config.prompt === 'string' ? node.config.prompt : ''
    const instructionBase = prompt.trim().length > 0 ? prompt : node.title
    const instruction =
      input.objective.trim().length > 0
        ? `${instructionBase}\n\n[Workflow objective]\n${input.objective}`
        : instructionBase
    const request: WorkflowAgentDispatchRequest = {
      nodeId: node.id,
      agentId,
      instruction,
      inputs: buildWorkflowNodeInputs(node.id, input.graph, state),
    }
    const maxAttempts = 1 + getWorkflowNodeRetryCount(node)
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const reply = await input.dispatch(request)
      const replyState = reply.state ?? 'completed'
      const error = replyState === 'completed'
        ? undefined
        : normalizeWorkflowReplyError(
            'error' in reply ? reply.error : undefined,
            `Workflow node ${node.id} did not complete successfully.`,
          )
      executions.push({
        ...request,
        attempt,
        state: replyState,
        content: reply.content,
        ...(error != null ? { error } : {}),
      })
      if (replyState === 'completed') {
        const outputKey = typeof node.config.outputKey === 'string' ? node.config.outputKey.trim() : ''
        if (outputKey.length > 0) state[outputKey] = reply.content
        break
      }
      if (attempt === maxAttempts) {
        return {
          status: replyState,
          state,
          executions,
          failedNode: {
            nodeId: node.id,
            agentId,
            attempt,
            error: error ?? { message: `Workflow node ${node.id} did not complete successfully.` },
          },
        }
      }
    }
  }

  return { status: 'completed', state, executions }
}

function getWorkflowNodeRetryCount(node: NormalizedWorkflowNode): number {
  const raw = node.config.retryCount
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(3, Math.floor(raw)))
}

function normalizeWorkflowReplyError(
  error: { code?: string; message: string } | undefined,
  fallbackMessage: string,
): { code?: string; message: string } {
  const message = typeof error?.message === 'string' && error.message.trim().length > 0
    ? error.message
    : fallbackMessage
  const code = typeof error?.code === 'string' && error.code.trim().length > 0
    ? error.code
    : undefined
  return {
    ...(code != null ? { code } : {}),
    message,
  }
}
