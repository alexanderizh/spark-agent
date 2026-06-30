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

export type WorkflowAtomicNodeExecutionRequest = {
  nodeId: string
  kind: WorkflowNodeKind
  title: string
  objective: string
  inputs: Record<string, unknown>
  config: Record<string, unknown>
}

export type WorkflowAtomicNodeExecutionReply =
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

export type WorkflowAtomicNodeExecutionRecord = {
  nodeId: string
  kind: WorkflowNodeKind
  state: 'completed' | 'failed' | 'canceled'
  outputKey: string
  content: string
  error?: { code?: string; message: string }
}

export type WorkflowAgentPlanResult = {
  status: 'completed' | 'failed' | 'canceled'
  state: WorkflowState
  executions: WorkflowAgentExecutionRecord[]
  atomicExecutions: WorkflowAtomicNodeExecutionRecord[]
  failedNode?: {
    nodeId: string
    agentId: string
    attempt: number
    error: { code?: string; message: string }
  }
}

export type WorkflowRunSnapshotStatus = 'working' | 'completed' | 'failed' | 'canceled'

export type WorkflowRunSnapshot = {
  status: WorkflowRunSnapshotStatus
  state: WorkflowState
  executions: WorkflowAgentExecutionRecord[]
  atomicExecutions: WorkflowAtomicNodeExecutionRecord[]
  completedNodeIds: string[]
  failedNode?: WorkflowAgentPlanResult['failedNode']
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
      value === null ||
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
    const workerId = getWorkflowNodeWorkerId(node)
    if (workerId != null) ids.add(workerId)
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
    if (upstream != null && !completedNodeIds.has(upstream.id)) return false
  }
  return true
}

function collectWorkflowInactiveNodeIds(
  graph: NormalizedWorkflowGraph,
  state: WorkflowState,
  pendingNodeIds: ReadonlySet<string>,
): Set<string> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const incomingByNodeId = new Map<string, NormalizedWorkflowEdge[]>()
  for (const edge of graph.edges) {
    incomingByNodeId.set(edge.to, [...(incomingByNodeId.get(edge.to) ?? []), edge])
  }

  const inactiveNodeIds = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const nodeId of pendingNodeIds) {
      if (inactiveNodeIds.has(nodeId)) continue
      const incoming = incomingByNodeId.get(nodeId) ?? []
      if (incoming.length === 0) continue
      const inactive = incoming.some((edge) => {
        if (!evaluateWorkflowEdgeCondition(edge.condition, state)) return true
        const upstream = byId.get(edge.from)
        return upstream != null && inactiveNodeIds.has(upstream.id)
      })
      if (!inactive) continue
      inactiveNodeIds.add(nodeId)
      changed = true
    }
  }

  return inactiveNodeIds
}

function buildWorkflowFailedNode(
  graph: NormalizedWorkflowGraph,
  nodeId: string,
  error: { code?: string; message: string },
): NonNullable<WorkflowAgentPlanResult['failedNode']> {
  const node = graph.nodes.find((item) => item.id === nodeId)
  const agentId = getWorkflowNodeWorkerId(node ?? {
    id: nodeId,
    kind: 'agent',
    title: nodeId,
    config: {},
  }) ?? node?.kind ?? 'workflow'
  return {
    nodeId,
    agentId,
    attempt: 0,
    error,
  }
}

export async function executeWorkflowAgentPlan(input: {
  graph: NormalizedWorkflowGraph
  objective: string
  initialState?: WorkflowState
  dispatch: (
    request: WorkflowAgentDispatchRequest,
    options?: WorkflowAgentDispatchOptions,
  ) => Promise<WorkflowAgentDispatchReply>
  executeAtomicNode?: (request: WorkflowAtomicNodeExecutionRequest) => Promise<WorkflowAtomicNodeExecutionReply>
  /** 续跑：预置为已完成的节点 id，执行器跳过它们（断点续跑）。 */
  initialCompletedNodeIds?: Iterable<string>
  /** 进度快照回调：每个节点完成后 + 终态时触发，调用方据此持久化（审计/续跑）。 */
  onSnapshot?: (snapshot: WorkflowRunSnapshot) => void | Promise<void>
}): Promise<WorkflowAgentPlanResult> {
  const state: WorkflowState = { ...input.initialState }
  const executions: WorkflowAgentExecutionRecord[] = []
  const atomicExecutions: WorkflowAtomicNodeExecutionRecord[] = []
  const completedNodeIds = new Set<string>(input.initialCompletedNodeIds ?? [])
  const orderedNodes = orderWorkflowNodes(input.graph.nodes, input.graph.edges)
  const pendingNodes = new Map(
    orderedNodes
      .filter((node) => !isWorkflowDispatchableNode(node) || getWorkflowNodeWorkerId(node) != null)
      .filter((node) => {
        if (!isWorkflowDispatchableNode(node)) return true
        const workerId = getWorkflowNodeWorkerId(node)
        return workerId != null && workerId.length > 0
      })
      .filter((node) => !completedNodeIds.has(node.id))
      .map((node) => [node.id, node]),
  )

  const emitSnapshot = async (
    status: WorkflowRunSnapshotStatus,
    failedNode?: WorkflowAgentPlanResult['failedNode'],
  ): Promise<void> => {
    await input.onSnapshot?.({
      status,
      state,
      executions,
      atomicExecutions,
      completedNodeIds: [...completedNodeIds],
      ...(failedNode != null ? { failedNode } : {}),
    })
  }

  while (pendingNodes.size > 0) {
    const readyNodes = orderedNodes.filter((node) =>
      pendingNodes.has(node.id) && isWorkflowNodeReady(node.id, input.graph, state, completedNodeIds),
    )
    if (readyNodes.length === 0) {
      const inactiveNodeIds = collectWorkflowInactiveNodeIds(input.graph, state, new Set(pendingNodes.keys()))
      if (inactiveNodeIds.size > 0) {
        for (const nodeId of inactiveNodeIds) pendingNodes.delete(nodeId)
        continue
      }
      const [firstPendingNodeId] = pendingNodes.keys()
      const unresolvedNodeIds = [...pendingNodes.keys()]
      const failedNode = buildWorkflowFailedNode(input.graph, firstPendingNodeId ?? 'workflow', {
        code: 'workflow_deadlock',
        message: `Workflow blocked with unresolved nodes: ${unresolvedNodeIds.join(', ')}`,
      })
      await emitSnapshot('failed', failedNode)
      return {
        status: 'failed',
        state,
        executions,
        atomicExecutions,
        failedNode,
      }
    }

    const readyAtomicNodes = readyNodes.filter((node) => !isWorkflowDispatchableNode(node))
    if (readyAtomicNodes.length > 0) {
      for (const node of readyAtomicNodes) {
        const result = await executeWorkflowAtomicNode({
          graph: input.graph,
          node,
          objective: input.objective,
          state,
          ...(input.executeAtomicNode != null ? { executeAtomicNode: input.executeAtomicNode } : {}),
        })
        atomicExecutions.push(result.record)
        pendingNodes.delete(result.nodeId)
        if (result.status === 'completed') {
          if (result.outputKey.length > 0) state[result.outputKey] = result.content
          completedNodeIds.add(result.nodeId)
          await emitSnapshot('working')
          continue
        }
        await emitSnapshot(result.status, result.failedNode)
        return {
          status: result.status,
          state,
          executions,
          atomicExecutions,
          failedNode: result.failedNode,
        }
      }
      continue
    }

    const stateSnapshot = { ...state }
    const readyWorkerNodes = readyNodes.filter((node) => isWorkflowDispatchableNode(node))
    const waveResults = await Promise.all(readyWorkerNodes.map((node) =>
      executeWorkflowAgentNode({
        graph: input.graph,
        node,
        objective: input.objective,
        state: stateSnapshot,
        dispatch: input.dispatch,
        parallel: readyNodes.length > 1,
      }),
    ))

    let failedResult: Extract<WorkflowAgentNodeResult, { status: 'failed' | 'canceled' }> | undefined
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

    await emitSnapshot('working')

    if (failedResult != null) {
      await emitSnapshot(failedResult.status, failedResult.failedNode)
      return {
        status: failedResult.status,
        state,
        executions,
        atomicExecutions,
        failedNode: failedResult.failedNode,
      }
    }
  }

  await emitSnapshot('completed')
  return { status: 'completed', state, executions, atomicExecutions }
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

type WorkflowAtomicNodeResult =
  | {
      status: 'completed'
      nodeId: string
      outputKey: string
      content: string
      record: WorkflowAtomicNodeExecutionRecord
    }
  | {
      status: 'failed' | 'canceled'
      nodeId: string
      outputKey: string
      content: string
      record: WorkflowAtomicNodeExecutionRecord
      failedNode: NonNullable<WorkflowAgentPlanResult['failedNode']>
    }

async function executeWorkflowAtomicNode(input: {
  graph: NormalizedWorkflowGraph
  node: NormalizedWorkflowNode
  objective: string
  state: WorkflowState
  executeAtomicNode?: (request: WorkflowAtomicNodeExecutionRequest) => Promise<WorkflowAtomicNodeExecutionReply>
}): Promise<WorkflowAtomicNodeResult> {
  const outputKey = typeof input.node.config.outputKey === 'string' ? input.node.config.outputKey.trim() : ''
  const request: WorkflowAtomicNodeExecutionRequest = {
    nodeId: input.node.id,
    kind: input.node.kind,
    title: input.node.title,
    objective: input.objective,
    inputs: buildWorkflowNodeInputs(input.node.id, input.graph, input.state),
    config: input.node.config,
  }
  const reply = input.executeAtomicNode != null
    ? await input.executeAtomicNode(request)
    : { content: getDefaultAtomicNodeContent(input.node, input.objective) }
  const replyState = reply.state ?? 'completed'
  const error = replyState === 'completed'
    ? undefined
    : normalizeWorkflowReplyError(
        'error' in reply ? reply.error : undefined,
        `Workflow node ${input.node.id} did not complete successfully.`,
      )
  const record: WorkflowAtomicNodeExecutionRecord = {
    nodeId: input.node.id,
    kind: input.node.kind,
    state: replyState,
    outputKey,
    content: reply.content,
    ...(error != null ? { error } : {}),
  }
  if (replyState === 'completed') {
    return {
      status: 'completed',
      nodeId: input.node.id,
      outputKey,
      content: reply.content,
      record,
    }
  }
  return {
    status: replyState,
    nodeId: input.node.id,
    outputKey,
    content: reply.content,
    record,
    failedNode: {
      nodeId: input.node.id,
      agentId: input.node.kind,
      attempt: 1,
      error: error ?? { message: `Workflow node ${input.node.id} did not complete successfully.` },
    },
  }
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
  const agentId = getWorkflowNodeWorkerId(node) ?? ''
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

function getDefaultAtomicNodeContent(node: NormalizedWorkflowNode, objective: string): string {
  const value = node.config.value
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value != null) return JSON.stringify(value)
  const prompt = typeof node.config.prompt === 'string' ? node.config.prompt.trim() : ''
  if (prompt.length > 0) return prompt
  if (node.kind === 'input' && objective.trim().length > 0) return objective.trim()
  return node.title
}

export function getWorkflowNodeWorkerId(node: NormalizedWorkflowNode): string | undefined {
  if (node.kind !== 'agent' && node.kind !== 'subagent') return undefined
  const configured = typeof node.config.agentId === 'string' ? node.config.agentId.trim() : ''
  if (configured.length > 0) return configured
  if (node.kind === 'subagent') return `workflow-subagent:${node.id}`
  return undefined
}

function isWorkflowDispatchableNode(node: NormalizedWorkflowNode): boolean {
  return node.kind === 'agent' || node.kind === 'subagent'
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
