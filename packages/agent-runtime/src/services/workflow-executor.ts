import type { WorkflowEdgeCondition, WorkflowGraph, WorkflowNodeKind } from '@spark/protocol'

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

export type WorkflowAgentDispatchOptions = {
  parallel?: boolean
}

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
  condition?: WorkflowEdgeCondition
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
    const condition = normalizeWorkflowEdgeCondition(record.condition)
    return [{
      id,
      from,
      to,
      ...(condition != null ? { condition } : {}),
    }]
  })

  return { nodes, edges }
}

function normalizeWorkflowEdgeCondition(condition: unknown): WorkflowEdgeCondition | undefined {
  if (condition == null || typeof condition !== 'object') return undefined
  const record = condition as Record<string, unknown>
  const op = typeof record.op === 'string' ? record.op : ''
  const key = typeof record.key === 'string' ? record.key.trim() : ''
  if (key.length === 0) return undefined
  if (op === 'exists' || op === 'truthy' || op === 'falsy') return { op, key }
  if (op === 'equals' || op === 'not_equals') {
    const value = record.value
    if (
      value == null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return { op, key, value }
    }
  }
  return undefined
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
    if (!evaluateWorkflowEdgeCondition(edge.condition, state)) continue
    const upstream = byId.get(edge.from)
    const outputKey = typeof upstream?.config.outputKey === 'string' ? upstream.config.outputKey.trim() : ''
    if (outputKey.length === 0 || !(outputKey in state)) continue
    inputs[outputKey] = state[outputKey]
  }
  return inputs
}

export function evaluateWorkflowEdgeCondition(
  condition: WorkflowEdgeCondition | undefined,
  state: WorkflowState,
): boolean {
  if (condition == null) return true
  if (condition.op === 'exists') return Object.prototype.hasOwnProperty.call(state, condition.key)
  if (condition.op === 'equals') return state[condition.key] === condition.value
  if (condition.op === 'not_equals') return state[condition.key] !== condition.value
  if (condition.op === 'truthy') return Boolean(state[condition.key])
  if (condition.op === 'falsy') return !Boolean(state[condition.key])
  return false
}

export function isWorkflowNodeReady(
  nodeId: string,
  graph: NormalizedWorkflowGraph,
  state: WorkflowState,
  completedNodeIds: ReadonlySet<string>,
): boolean {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  for (const edge of graph.edges) {
    if (edge.to !== nodeId) continue
    if (!evaluateWorkflowEdgeCondition(edge.condition, state)) return false
    const upstream = byId.get(edge.from)
    if (upstream?.kind === 'agent' && !completedNodeIds.has(upstream.id)) return false
  }
  return true
}

export async function executeWorkflowAgentPlan(input: {
  graph: NormalizedWorkflowGraph
  objective: string
  initialState?: WorkflowState
  dispatch: (
    request: WorkflowAgentDispatchRequest,
    options?: WorkflowAgentDispatchOptions,
  ) => Promise<WorkflowAgentDispatchReply>
}): Promise<WorkflowAgentPlanResult> {
  const state: WorkflowState = { ...input.initialState }
  const executions: WorkflowAgentExecutionRecord[] = []
  const completedNodeIds = new Set<string>()
  const orderedNodes = orderWorkflowNodes(input.graph.nodes, input.graph.edges)
  const pendingNodes = new Map(
    orderedNodes
      .filter((node) => node.kind === 'agent')
      .filter((node) => {
        const agentId = typeof node.config.agentId === 'string' ? node.config.agentId.trim() : ''
        return agentId.length > 0
      })
      .map((node) => [node.id, node]),
  )

  while (pendingNodes.size > 0) {
    const readyNodes = orderedNodes.filter((node) =>
      pendingNodes.has(node.id) && isWorkflowNodeReady(node.id, input.graph, state, completedNodeIds),
    )
    if (readyNodes.length === 0) break

    const stateSnapshot = { ...state }
    const waveResults = await Promise.all(readyNodes.map((node) =>
      executeWorkflowAgentNode({
        graph: input.graph,
        node,
        objective: input.objective,
        state: stateSnapshot,
        dispatch: input.dispatch,
        parallel: readyNodes.length > 1,
      }),
    ))

    let failedResult: WorkflowAgentNodeResult | undefined
    for (const result of waveResults) {
      executions.push(...result.executions)
      pendingNodes.delete(result.nodeId)
      if (result.status === 'completed') {
        if (result.outputKey.length > 0) state[result.outputKey] = result.content
        completedNodeIds.add(result.nodeId)
      } else if (failedResult == null) {
        failedResult = result
      }
    }

    if (failedResult != null) {
      return {
        status: failedResult.status,
        state,
        executions,
        failedNode: failedResult.failedNode,
      }
    }
  }

  return { status: 'completed', state, executions }
}

type WorkflowAgentNodeResult =
  | {
      status: 'completed'
      nodeId: string
      agentId: string
      outputKey: string
      content: string
      executions: WorkflowAgentExecutionRecord[]
    }
  | {
      status: 'failed' | 'canceled'
      nodeId: string
      agentId: string
      outputKey: string
      content: string
      executions: WorkflowAgentExecutionRecord[]
      failedNode: NonNullable<WorkflowAgentPlanResult['failedNode']>
    }

async function executeWorkflowAgentNode(input: {
  graph: NormalizedWorkflowGraph
  node: NormalizedWorkflowNode
  objective: string
  state: WorkflowState
  dispatch: (
    request: WorkflowAgentDispatchRequest,
    options?: WorkflowAgentDispatchOptions,
  ) => Promise<WorkflowAgentDispatchReply>
  parallel: boolean
}): Promise<WorkflowAgentNodeResult> {
  const node = input.node
  const agentId = typeof node.config.agentId === 'string' ? node.config.agentId.trim() : ''
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
    inputs: buildWorkflowNodeInputs(node.id, input.graph, input.state),
  }
  const executions: WorkflowAgentExecutionRecord[] = []
  const outputKey = typeof node.config.outputKey === 'string' ? node.config.outputKey.trim() : ''
  const maxAttempts = 1 + getWorkflowNodeRetryCount(node)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const reply = await input.dispatch(request, { parallel: input.parallel })
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
      return {
        status: 'completed',
        nodeId: node.id,
        agentId,
        outputKey,
        content: reply.content,
        executions,
      }
    }
    if (attempt === maxAttempts) {
      return {
        status: replyState,
        nodeId: node.id,
        agentId,
        outputKey,
        content: reply.content,
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

  throw new Error(`Workflow node ${node.id} exhausted without a terminal result.`)
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
