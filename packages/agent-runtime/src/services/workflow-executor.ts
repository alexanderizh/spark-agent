import type { WorkflowEdgeCondition, WorkflowGraph, WorkflowNodeKind } from '@spark/protocol'

export type WorkflowState = Record<string, unknown>

/** 用户在触发本轮 workflow_run 的消息上附带的附件（图片/文件/目录），原样透传给每个被派发节点。 */
export type WorkflowDispatchAttachment = { type: 'text' | 'file_ref' | 'image_ref'; value: string }

export type WorkflowAgentDispatchRequest = {
  nodeId: string
  agentId: string
  instruction: string
  inputs: Record<string, unknown>
  attachments?: WorkflowDispatchAttachment[]
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
  skippedNodeIds?: string[]
  config: Record<string, unknown>
}

export type WorkflowAtomicNodeExecutionReply =
  | { state?: 'completed'; content: string }
  | { state: 'failed' | 'canceled'; content: string; error?: { code?: string; message: string } }

export type WorkflowAgentDispatchOptions = {
  parallel?: boolean
}

export type WorkflowWorkerResolutionOptions = {
  fallbackAgentId?: string
  availableWorkerIds?: ReadonlySet<string>
}

export type WorkflowAgentExecutionRecord = WorkflowAgentDispatchRequest & {
  attempt: number
  state: 'completed' | 'failed' | 'canceled'
  content: string
  error?: { code?: string; message: string }
  /** 本条记录（单次 attempt / 分支）的执行起止时间，ISO 8601，供运行详情展示耗时。 */
  startedAt?: string
  endedAt?: string
}

export type WorkflowAtomicNodeExecutionRecord = {
  nodeId: string
  kind: WorkflowNodeKind
  state: 'completed' | 'failed' | 'canceled'
  outputKey: string
  content: string
  error?: { code?: string; message: string }
  /** 本条记录的执行起止时间，ISO 8601，供运行详情展示耗时。 */
  startedAt?: string
  endedAt?: string
}

export type WorkflowAgentPlanResult = {
  status: 'completed' | 'failed' | 'canceled'
  state: WorkflowState
  executions: WorkflowAgentExecutionRecord[]
  atomicExecutions: WorkflowAtomicNodeExecutionRecord[]
  skippedNodeIds: string[]
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
  /** 本次快照时刻因条件分支未命中或上游被跳过而明确跳过的节点。 */
  skippedNodeIds: string[]
  /** 本次快照时刻正在执行（已开始派发/执行、尚未完成）的节点，供 UI 渲染实时进度用。 */
  runningNodeIds: string[]
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
  'route',
  'agent',
  'subagent',
  'skill',
  'tool',
  'mcp',
  'approval',
  'verify',
  'review',
  'artifact',
  'loop',
])

const WORKFLOW_LOOP_DEFAULT_MAX_ITERATIONS = 5
const WORKFLOW_LOOP_HARD_CAP = 50
const WORKFLOW_LOOP_VAR_DEFAULT = '__loop_index'

export function normalizeWorkflowGraph(
  graph: WorkflowGraph | Record<string, unknown>,
): NormalizedWorkflowGraph {
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const nodes = rawNodes.flatMap((node): NormalizedWorkflowNode[] => {
    if (node == null || typeof node !== 'object') return []
    const record = node as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (id.length === 0) return []
    const rawKind = typeof record.kind === 'string' ? record.kind : 'agent'
    const kind = WORKFLOW_NODE_KINDS.has(rawKind as WorkflowNodeKind)
      ? (rawKind as WorkflowNodeKind)
      : 'agent'
    return [
      {
        id,
        kind,
        title:
          typeof record.title === 'string' && record.title.trim().length > 0 ? record.title : id,
        config:
          record.config != null && typeof record.config === 'object'
            ? (record.config as Record<string, unknown>)
            : {},
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
    const id =
      typeof record.id === 'string' && record.id.trim().length > 0
        ? record.id
        : `${from}->${to}:${index}`
    const condition = normalizeWorkflowEdgeCondition(record.condition)
    return [
      {
        id,
        from,
        to,
        ...(condition != null ? { condition } : {}),
      },
    ]
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

/** 图环检测结果：scope 定位子图（主图或某 loop 体），cycleNodes 为环上（或环下游）无法拓扑排序的节点。 */
export type WorkflowGraphCycleReport = {
  scope: string
  cycleNodes: { id: string; title: string }[]
}

/**
 * 编译期环检测：对主图与所有 loop 体子图做 Kahn 拓扑排序，返回存在环的子图报告。
 * 运行时 executor 遇到环只能以 workflow_deadlock 失败（英文裸 node id 报错），本函数
 * 供保存/试跑前的即时校验使用，报告携带节点标题便于用户定位。
 */
export function detectWorkflowGraphCycles(
  graph: NormalizedWorkflowGraph,
): WorkflowGraphCycleReport[] {
  const reports: WorkflowGraphCycleReport[] = []

  const visit = (target: NormalizedWorkflowGraph, scope: string): void => {
    // Kahn：逐步移除入度为 0 的节点；剩余节点即环上或环下游节点。
    const remaining = new Map(target.nodes.map((node) => [node.id, 0]))
    for (const edge of target.edges) {
      if (!remaining.has(edge.from) || !remaining.has(edge.to)) continue
      remaining.set(edge.to, (remaining.get(edge.to) ?? 0) + 1)
    }
    const queue = [...remaining.entries()].filter(([, degree]) => degree === 0).map(([id]) => id)
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      remaining.delete(nodeId)
      for (const edge of target.edges) {
        if (edge.from !== nodeId || !remaining.has(edge.to)) continue
        const next = (remaining.get(edge.to) ?? 0) - 1
        remaining.set(edge.to, next)
        if (next === 0) queue.push(edge.to)
      }
    }
    if (remaining.size > 0) {
      const byId = new Map(target.nodes.map((node) => [node.id, node]))
      reports.push({
        scope,
        cycleNodes: [...remaining.keys()].map((id) => ({
          id,
          title: byId.get(id)?.title ?? id,
        })),
      })
    }
    // 递归检查 loop 体子图：loop 体内部成环同样会在循环执行时死锁。
    for (const node of target.nodes) {
      const bodyGraph = getWorkflowLoopBodyGraph(node)
      if (bodyGraph != null) visit(bodyGraph, `${scope} › ${node.title} 循环体`)
    }
  }

  visit(graph, '主图')
  return reports
}

/** 把环检测报告格式化为面向用户的一条错误消息（带节点标题，不暴露裸 id 报错）。 */
export function formatWorkflowCycleError(reports: WorkflowGraphCycleReport[]): string {
  const parts = reports.map(
    (report) =>
      `${report.scope}存在环：${report.cycleNodes.map((node) => `「${node.title}」`).join('、')}`,
  )
  return `工作流不允许出现循环依赖（${parts.join('；')}）。请调整连线后再保存。`
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
  for (const node of getWorkflowNodesDeep(nodes)) {
    const workerId = getWorkflowNodeWorkerId(node)
    if (workerId != null) ids.add(workerId)
  }
  return ids
}

export function getWorkflowNodesDeep(nodes: NormalizedWorkflowNode[]): NormalizedWorkflowNode[] {
  const collected: NormalizedWorkflowNode[] = []
  for (const node of nodes) {
    collected.push(node)
    const bodyGraph = getWorkflowLoopBodyGraph(node)
    if (bodyGraph != null) collected.push(...getWorkflowNodesDeep(bodyGraph.nodes))
  }
  return collected
}

export function buildWorkflowNodeInputs(
  nodeId: string,
  graph: NormalizedWorkflowGraph,
  state: WorkflowState,
  skippedNodeIds: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const inputs: Record<string, unknown> = {}
  for (const edge of graph.edges) {
    if (edge.to !== nodeId) continue
    if (skippedNodeIds.has(edge.from)) continue
    if (!evaluateWorkflowEdgeCondition(edge.condition, state)) continue
    const upstream = byId.get(edge.from)
    const outputKey =
      typeof upstream?.config.outputKey === 'string' ? upstream.config.outputKey.trim() : ''
    if (outputKey.length === 0 || !(outputKey in state)) continue
    inputs[outputKey] = state[outputKey]
  }
  return inputs
}

// ─── {{key}} 模板插值 ───────────────────────────────────────────────────────

const WORKFLOW_TEMPLATE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g

/**
 * 工作流模板插值：把 `{{key}}` 替换为 context 里的同名值（字符串原样、其余 JSON 序列化）。
 * key 未命中或值为 undefined 时保持字面量原样返回——半成品配置不会静默变成空串。
 * context 通常为 `{ ...state, ...inputs }`（inputs 为活跃上游 outputKey 的子集，优先级更高）。
 */
export function interpolateWorkflowTemplate(
  value: string,
  context: Record<string, unknown>,
): string {
  if (!value.includes('{{')) return value
  return value.replace(WORKFLOW_TEMPLATE_PATTERN, (raw, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(context, key)) return raw
    const resolved = context[key]
    if (resolved === undefined) return raw
    return typeof resolved === 'string' ? resolved : JSON.stringify(resolved)
  })
}

function interpolateWorkflowTemplateDeep(
  value: unknown,
  context: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') return interpolateWorkflowTemplate(value, context)
  if (Array.isArray(value))
    return value.map((item) => interpolateWorkflowTemplateDeep(item, context))
  if (value != null && typeof value === 'object') {
    const interpolated: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(value)) {
      interpolated[entryKey] = interpolateWorkflowTemplateDeep(entryValue, context)
    }
    return interpolated
  }
  return value
}

function workflowNodeConfigHasTemplate(config: Record<string, unknown>): boolean {
  if (typeof config.prompt === 'string' && config.prompt.includes('{{')) return true
  const toolArgs = config.toolArgs
  if (toolArgs == null || typeof toolArgs !== 'object') return false
  return workflowValueHasTemplate(toolArgs)
}

function workflowValueHasTemplate(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('{{')
  if (Array.isArray(value)) return value.some((item) => workflowValueHasTemplate(item))
  if (value != null && typeof value === 'object') {
    return Object.values(value).some((item) => workflowValueHasTemplate(item))
  }
  return false
}

/**
 * 节点配置插值：只插值 `prompt` 与 `toolArgs`（含嵌套字符串叶子）——exportPath、routeOptions、
 * execution 等其余字段保持原样，避免导出路径和分支枚举被上游数据污染。
 * 配置里没有任何 `{{` 时返回同一引用，避免无谓的对象拷贝。
 */
export function interpolateWorkflowNodeConfig(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
): Record<string, unknown> {
  if (!workflowNodeConfigHasTemplate(config)) return config
  const interpolated: Record<string, unknown> = { ...config }
  if (typeof config.prompt === 'string') {
    interpolated.prompt = interpolateWorkflowTemplate(config.prompt, context)
  }
  if (config.toolArgs != null && typeof config.toolArgs === 'object') {
    interpolated.toolArgs = interpolateWorkflowTemplateDeep(config.toolArgs, context)
  }
  return interpolated
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
  if (condition.op === 'falsy') return !state[condition.key]
  return false
}

export function isWorkflowNodeReady(
  nodeId: string,
  graph: NormalizedWorkflowGraph,
  state: WorkflowState,
  completedNodeIds: ReadonlySet<string>,
  skippedNodeIds: ReadonlySet<string> = new Set(),
): boolean {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const incoming = graph.edges.filter((edge) => edge.to === nodeId)
  if (incoming.length === 0) return true
  let hasActiveIncoming = false
  for (const edge of incoming) {
    if (skippedNodeIds.has(edge.from)) continue
    const upstream = byId.get(edge.from)
    if (upstream != null && !completedNodeIds.has(upstream.id)) return false
    if (!evaluateWorkflowEdgeCondition(edge.condition, state)) continue
    hasActiveIncoming = true
  }
  return hasActiveIncoming
}

function isWorkflowEdgeInactive(
  edge: NormalizedWorkflowEdge,
  graphNodeById: ReadonlyMap<string, NormalizedWorkflowNode>,
  state: WorkflowState,
  completedNodeIds: ReadonlySet<string>,
  skippedNodeIds: ReadonlySet<string>,
): boolean {
  if (skippedNodeIds.has(edge.from)) return true
  const upstream = graphNodeById.get(edge.from)
  if (upstream != null && !completedNodeIds.has(upstream.id)) return false
  return !evaluateWorkflowEdgeCondition(edge.condition, state)
}

function collectWorkflowInactiveNodeIds(
  graph: NormalizedWorkflowGraph,
  state: WorkflowState,
  pendingNodeIds: ReadonlySet<string>,
  completedNodeIds: ReadonlySet<string>,
  skippedNodeIds: ReadonlySet<string>,
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
      const combinedSkipped = new Set([...skippedNodeIds, ...inactiveNodeIds])
      const inactive = incoming.every((edge) => {
        return isWorkflowEdgeInactive(edge, byId, state, completedNodeIds, combinedSkipped)
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
  const agentId =
    getWorkflowNodeWorkerId(
      node ?? {
        id: nodeId,
        kind: 'agent',
        title: nodeId,
        config: {},
      },
    ) ??
    node?.kind ??
    'workflow'
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
  /** 触发本轮 workflow_run 的用户消息自带的附件，原样转发给每个被派发的 agent/subagent 节点。 */
  attachments?: WorkflowDispatchAttachment[]
  /** agent 节点未绑定或绑定 worker 不可用时，回退派发给宿主 Agent。 */
  fallbackAgentId?: string
  /** 本次 workflow_run 实际注册进花名册、允许派发的 worker ids。 */
  availableWorkerIds?: ReadonlySet<string>
  initialState?: WorkflowState
  dispatch: (
    request: WorkflowAgentDispatchRequest,
    options?: WorkflowAgentDispatchOptions,
  ) => Promise<WorkflowAgentDispatchReply>
  executeAtomicNode?: (
    request: WorkflowAtomicNodeExecutionRequest,
  ) => Promise<WorkflowAtomicNodeExecutionReply>
  /** 续跑：预置为已完成的节点 id，执行器跳过它们（断点续跑）。 */
  initialCompletedNodeIds?: Iterable<string>
  /** 续跑：预置为已因条件未命中而跳过的节点 id。 */
  initialSkippedNodeIds?: Iterable<string>
  /** 进度快照回调：每个节点完成后 + 终态时触发，调用方据此持久化（审计/续跑）。 */
  onSnapshot?: (snapshot: WorkflowRunSnapshot) => void | Promise<void>
}): Promise<WorkflowAgentPlanResult> {
  const state: WorkflowState = { ...input.initialState }
  const executions: WorkflowAgentExecutionRecord[] = []
  const atomicExecutions: WorkflowAtomicNodeExecutionRecord[] = []
  const completedNodeIds = new Set<string>(input.initialCompletedNodeIds ?? [])
  const skippedNodeIds = new Set<string>(input.initialSkippedNodeIds ?? [])
  const orderedNodes = orderWorkflowNodes(input.graph.nodes, input.graph.edges)
  // 注意：dispatchable 节点（agent/subagent）即使 workerId 为空也保留进 pendingNodes，
  // 让 executeWorkflowAgentNode 显式失败（missing_agent_id）——避免用户画了 agent 节点却未
  // 绑 Agent 时被静默剔除，运行时悄无声息地"成功"。
  const pendingNodes = new Map(
    orderedNodes
      .filter((node) => !completedNodeIds.has(node.id))
      .filter((node) => !skippedNodeIds.has(node.id))
      .map((node) => [node.id, node]),
  )

  const runningNodeIds = new Set<string>()

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
      skippedNodeIds: [...skippedNodeIds],
      runningNodeIds: [...runningNodeIds],
      ...(failedNode != null ? { failedNode } : {}),
    })
  }

  // 节点级实时上报后，同波多个节点可能相继完成并触发快照；串行链保证 onSnapshot
  // 观察到的集合按完成顺序单调演进，避免乱序快照让持久化与前端进度状态回退。
  let snapshotChain: Promise<void> = Promise.resolve()
  const enqueueSnapshot = (
    status: WorkflowRunSnapshotStatus,
    failedNode?: WorkflowAgentPlanResult['failedNode'],
  ): Promise<void> => {
    snapshotChain = snapshotChain.then(() => emitSnapshot(status, failedNode))
    return snapshotChain
  }

  while (pendingNodes.size > 0) {
    const readyNodes = orderedNodes.filter(
      (node) =>
        pendingNodes.has(node.id) &&
        isWorkflowNodeReady(node.id, input.graph, state, completedNodeIds, skippedNodeIds),
    )
    if (readyNodes.length === 0) {
      const inactiveNodeIds = collectWorkflowInactiveNodeIds(
        input.graph,
        state,
        new Set(pendingNodes.keys()),
        completedNodeIds,
        skippedNodeIds,
      )
      if (inactiveNodeIds.size > 0) {
        for (const nodeId of inactiveNodeIds) {
          pendingNodes.delete(nodeId)
          skippedNodeIds.add(nodeId)
        }
        await enqueueSnapshot('working')
        continue
      }
      const [firstPendingNodeId] = pendingNodes.keys()
      const unresolvedNodeIds = [...pendingNodes.keys()]
      const failedNode = buildWorkflowFailedNode(input.graph, firstPendingNodeId ?? 'workflow', {
        code: 'workflow_deadlock',
        message: `Workflow blocked with unresolved nodes: ${unresolvedNodeIds.join(', ')}`,
      })
      await enqueueSnapshot('failed', failedNode)
      return {
        status: 'failed',
        state,
        executions,
        atomicExecutions,
        skippedNodeIds: [...skippedNodeIds],
        failedNode,
      }
    }

    const readyAtomicNodes = readyNodes.filter((node) => !isWorkflowDispatchableNode(node))
    if (readyAtomicNodes.length > 0) {
      for (const node of readyAtomicNodes) {
        runningNodeIds.add(node.id)
        await enqueueSnapshot('working')
        const result = await executeWorkflowAtomicNode({
          graph: input.graph,
          node,
          objective: input.objective,
          ...(input.attachments != null && input.attachments.length > 0
            ? { attachments: input.attachments }
            : {}),
          state,
          skippedNodeIds,
          dispatch: input.dispatch,
          ...(input.fallbackAgentId != null ? { fallbackAgentId: input.fallbackAgentId } : {}),
          ...(input.availableWorkerIds != null
            ? { availableWorkerIds: input.availableWorkerIds }
            : {}),
          ...(input.executeAtomicNode != null
            ? { executeAtomicNode: input.executeAtomicNode }
            : {}),
        })
        runningNodeIds.delete(node.id)
        atomicExecutions.push(result.record)
        pendingNodes.delete(result.nodeId)
        if (result.status === 'completed') {
          if (result.outputKey.length > 0) state[result.outputKey] = result.content
          completedNodeIds.add(result.nodeId)
          await enqueueSnapshot('working')
          continue
        }
        await enqueueSnapshot(result.status, result.failedNode)
        return {
          status: result.status,
          state,
          executions,
          atomicExecutions,
          skippedNodeIds: [...skippedNodeIds],
          failedNode: result.failedNode,
        }
      }
      continue
    }

    const stateSnapshot = { ...state }
    const readyWorkerNodes = readyNodes.filter((node) => isWorkflowDispatchableNode(node))
    for (const node of readyWorkerNodes) runningNodeIds.add(node.id)
    await enqueueSnapshot('working')
    // 节点级实时上报：单个节点完成即落 executions、更新集合并发快照，不再等整波结束——
    // 同波快慢节点并存时，快节点的完成状态立即可见。节点输入仍取波开始时的 state
    // 快照（stateSnapshot），state 写入按完成顺序串行（outputKey 互不冲突），语义不变。
    let failedResult:
      | Extract<WorkflowAgentNodeResult, { status: 'failed' | 'canceled' }>
      | undefined
    await Promise.all(
      readyWorkerNodes.map(async (node) => {
        const result = await executeWorkflowAgentNode({
          graph: input.graph,
          node,
          objective: input.objective,
          ...(input.attachments != null && input.attachments.length > 0
            ? { attachments: input.attachments }
            : {}),
          state: stateSnapshot,
          skippedNodeIds,
          dispatch: input.dispatch,
          parallel: readyNodes.length > 1,
          ...(input.fallbackAgentId != null ? { fallbackAgentId: input.fallbackAgentId } : {}),
          ...(input.availableWorkerIds != null
            ? { availableWorkerIds: input.availableWorkerIds }
            : {}),
        })
        runningNodeIds.delete(node.id)
        executions.push(...result.executions)
        pendingNodes.delete(result.nodeId)
        if (result.status === 'completed') {
          if (result.outputKey.length > 0) state[result.outputKey] = result.content
          completedNodeIds.add(result.nodeId)
        } else if (failedResult == null) {
          failedResult = result
        }
        await enqueueSnapshot('working')
      }),
    )

    if (failedResult != null) {
      await enqueueSnapshot(failedResult.status, failedResult.failedNode)
      return {
        status: failedResult.status,
        state,
        executions,
        atomicExecutions,
        skippedNodeIds: [...skippedNodeIds],
        failedNode: failedResult.failedNode,
      }
    }
  }

  await enqueueSnapshot('completed')
  return {
    status: 'completed',
    state,
    executions,
    atomicExecutions,
    skippedNodeIds: [...skippedNodeIds],
  }
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
  attachments?: WorkflowDispatchAttachment[]
  state: WorkflowState
  skippedNodeIds: ReadonlySet<string>
  dispatch: (
    request: WorkflowAgentDispatchRequest,
    options?: WorkflowAgentDispatchOptions,
  ) => Promise<WorkflowAgentDispatchReply>
  fallbackAgentId?: string
  availableWorkerIds?: ReadonlySet<string>
  executeAtomicNode?: (
    request: WorkflowAtomicNodeExecutionRequest,
  ) => Promise<WorkflowAtomicNodeExecutionReply>
}): Promise<WorkflowAtomicNodeResult> {
  const outputKey =
    typeof input.node.config.outputKey === 'string' ? input.node.config.outputKey.trim() : ''
  const request = buildWorkflowAtomicNodeExecutionRequest(input)
  // approval 节点的 "failed" 代表用户明确拒绝（或问询通道故障），重试等于无视用户决定去
  // 重新弹一次审批（或者在无人值守场景下重新自动放行）——两种都不对，所以不重试。
  // loop 内部可能包含完整 LLM 派发链路，失败后自动重跑整个循环成本不可控，v1 也固定不重试。
  // 其余原子节点（目前只有 verify 真正会失败）的 "failed" 是技术性故障（比如测试命令因为
  // 网络抖动跑挂），配了 retryCount 就按同样规则重试，跟 agent/subagent 节点保持一致。
  const maxAttempts =
    input.node.kind === 'approval' || input.node.kind === 'loop'
      ? 1
      : 1 + getWorkflowNodeRetryCount(input.node)
  let reply: WorkflowAtomicNodeExecutionReply = {
    content: getDefaultAtomicNodeContent(input.node, input.objective),
  }
  const startedAt = new Date().toISOString()
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    reply =
      input.node.kind === 'loop'
        ? await executeWorkflowLoopNode(input)
        : input.executeAtomicNode != null
          ? await input.executeAtomicNode(request)
          : { content: getDefaultAtomicNodeContent(input.node, input.objective) }
    if ((reply.state ?? 'completed') === 'completed' || attempt === maxAttempts) break
  }
  const endedAt = new Date().toISOString()
  const replyState = reply.state ?? 'completed'
  const error =
    replyState === 'completed'
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
    startedAt,
    endedAt,
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
      attempt: maxAttempts,
      error: error ?? { message: `Workflow node ${input.node.id} did not complete successfully.` },
    },
  }
}

function buildWorkflowAtomicNodeExecutionRequest(input: {
  graph: NormalizedWorkflowGraph
  node: NormalizedWorkflowNode
  objective: string
  state: WorkflowState
  skippedNodeIds: ReadonlySet<string>
}): WorkflowAtomicNodeExecutionRequest {
  const inputs = buildWorkflowNodeInputs(
    input.node.id,
    input.graph,
    input.state,
    input.skippedNodeIds,
  )
  return {
    nodeId: input.node.id,
    kind: input.node.kind,
    title: input.node.title,
    objective: input.objective,
    inputs,
    skippedNodeIds: [...input.skippedNodeIds],
    // prompt / toolArgs 里的 {{key}} 占位符在此统一替换为 state + 活跃上游输入。
    config: interpolateWorkflowNodeConfig(input.node.config, { ...input.state, ...inputs }),
  }
}

async function executeWorkflowLoopNode(input: {
  graph: NormalizedWorkflowGraph
  node: NormalizedWorkflowNode
  objective: string
  attachments?: WorkflowDispatchAttachment[]
  state: WorkflowState
  skippedNodeIds: ReadonlySet<string>
  dispatch: (
    request: WorkflowAgentDispatchRequest,
    options?: WorkflowAgentDispatchOptions,
  ) => Promise<WorkflowAgentDispatchReply>
  fallbackAgentId?: string
  availableWorkerIds?: ReadonlySet<string>
  executeAtomicNode?: (
    request: WorkflowAtomicNodeExecutionRequest,
  ) => Promise<WorkflowAtomicNodeExecutionReply>
}): Promise<WorkflowAtomicNodeExecutionReply> {
  const bodyGraph = getWorkflowLoopBodyGraph(input.node)
  if (bodyGraph == null || bodyGraph.nodes.length === 0) {
    return {
      state: 'failed',
      content: '',
      error: {
        code: 'workflow_loop_empty',
        message: `Loop node ${input.node.id} must define a non-empty config.body graph.`,
      },
    }
  }
  const validationError = validateWorkflowLoopBody(input.node, input.graph, bodyGraph)
  if (validationError != null) {
    return { state: 'failed', content: '', error: validationError }
  }

  const loopVar = getWorkflowLoopVar(input.node)
  const resultKey = getWorkflowLoopResultKey(input.node, bodyGraph)
  const maxIterations = getWorkflowLoopMaxIterations(input.node)
  const collectAll = input.node.config.collectAll === true
  const breakCondition = normalizeWorkflowEdgeCondition(input.node.config.breakCondition)
  const iterationContents: string[] = []
  let iterationState: WorkflowState = {
    ...buildWorkflowNodeInputs(input.node.id, input.graph, input.state, input.skippedNodeIds),
  }
  let lastContent = ''

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    iterationState = { ...iterationState, [loopVar]: iteration }
    const result = await executeWorkflowAgentPlan({
      graph: bodyGraph,
      objective: input.objective,
      ...(input.attachments != null && input.attachments.length > 0
        ? { attachments: input.attachments }
        : {}),
      ...(input.fallbackAgentId != null ? { fallbackAgentId: input.fallbackAgentId } : {}),
      ...(input.availableWorkerIds != null ? { availableWorkerIds: input.availableWorkerIds } : {}),
      initialState: iterationState,
      dispatch: input.dispatch,
      ...(input.executeAtomicNode != null ? { executeAtomicNode: input.executeAtomicNode } : {}),
    })
    if (result.status !== 'completed') {
      const failed = result.failedNode?.error
      return {
        state: result.status,
        content: lastContent,
        error: {
          ...(failed?.code != null ? { code: failed.code } : {}),
          message: `Loop node ${input.node.id} failed at iteration ${iteration + 1}: ${failed?.message ?? 'Unknown error'}`,
        },
      }
    }

    iterationState = result.state
    lastContent = workflowStateValueToContent(
      resultKey.length > 0 ? result.state[resultKey] : result.state,
    )
    iterationContents.push(`--- iteration ${iteration + 1} ---\n${lastContent}`)
    if (breakCondition != null && evaluateWorkflowEdgeCondition(breakCondition, result.state)) break
  }

  return {
    content: collectAll ? iterationContents.join('\n\n') : lastContent,
  }
}

function getWorkflowLoopBodyGraph(node: NormalizedWorkflowNode): NormalizedWorkflowGraph | null {
  if (node.kind !== 'loop') return null
  const body = node.config.body
  if (body == null || typeof body !== 'object') return null
  return normalizeWorkflowGraph(body as WorkflowGraph | Record<string, unknown>)
}

function validateWorkflowLoopBody(
  node: NormalizedWorkflowNode,
  parentGraph: NormalizedWorkflowGraph,
  bodyGraph: NormalizedWorkflowGraph,
): { code: string; message: string } | undefined {
  const parentNodeIds = new Set(parentGraph.nodes.map((item) => item.id))
  const bodyNodeIds = new Set<string>()
  for (const bodyNode of bodyGraph.nodes) {
    if (bodyNode.kind === 'loop') {
      return {
        code: 'workflow_loop_nested',
        message: `Loop node ${node.id} contains nested loop node ${bodyNode.id}, which is not supported in v1.`,
      }
    }
    if (parentNodeIds.has(bodyNode.id)) {
      return {
        code: 'workflow_loop_node_id_collision',
        message: `Loop node ${node.id} body node ${bodyNode.id} conflicts with an outer workflow node id.`,
      }
    }
    if (bodyNodeIds.has(bodyNode.id)) {
      return {
        code: 'workflow_loop_duplicate_node_id',
        message: `Loop node ${node.id} body contains duplicate node id ${bodyNode.id}.`,
      }
    }
    bodyNodeIds.add(bodyNode.id)
  }
  return undefined
}

function getWorkflowLoopMaxIterations(node: NormalizedWorkflowNode): number {
  const raw = node.config.maxIterations
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return WORKFLOW_LOOP_DEFAULT_MAX_ITERATIONS
  return Math.max(1, Math.min(WORKFLOW_LOOP_HARD_CAP, Math.floor(raw)))
}

function getWorkflowLoopVar(node: NormalizedWorkflowNode): string {
  const raw = typeof node.config.loopVar === 'string' ? node.config.loopVar.trim() : ''
  return raw.length > 0 ? raw : WORKFLOW_LOOP_VAR_DEFAULT
}

function getWorkflowLoopResultKey(
  node: NormalizedWorkflowNode,
  bodyGraph: NormalizedWorkflowGraph,
): string {
  const configured = typeof node.config.resultKey === 'string' ? node.config.resultKey.trim() : ''
  if (configured.length > 0) return configured
  return (
    [...orderWorkflowNodes(bodyGraph.nodes, bodyGraph.edges)]
      .reverse()
      .map((item) =>
        typeof item.config.outputKey === 'string' ? item.config.outputKey.trim() : '',
      )
      .find((key) => key.length > 0) ?? ''
  )
}

function workflowStateValueToContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

async function executeWorkflowAgentNode(input: {
  graph: NormalizedWorkflowGraph
  node: NormalizedWorkflowNode
  objective: string
  attachments?: WorkflowDispatchAttachment[]
  state: WorkflowState
  skippedNodeIds: ReadonlySet<string>
  dispatch: (
    request: WorkflowAgentDispatchRequest,
    options?: WorkflowAgentDispatchOptions,
  ) => Promise<WorkflowAgentDispatchReply>
  parallel: boolean
  fallbackAgentId?: string
  availableWorkerIds?: ReadonlySet<string>
}): Promise<WorkflowAgentNodeResult> {
  const node = input.node
  const agentId =
    getWorkflowNodeEffectiveWorkerId(node, {
      ...(input.fallbackAgentId != null ? { fallbackAgentId: input.fallbackAgentId } : {}),
      ...(input.availableWorkerIds != null ? { availableWorkerIds: input.availableWorkerIds } : {}),
    }) ?? ''
  const outputKey = typeof node.config.outputKey === 'string' ? node.config.outputKey.trim() : ''
  const executions: WorkflowAgentExecutionRecord[] = []

  // 没有提供宿主 fallback 的低层调用仍保持显式失败，避免纯执行器被误用时静默跳过节点。
  // SessionService 的 workflow_run 路径会传入 fallbackAgentId，将空绑定/失效绑定派给宿主。
  if (agentId === '') {
    const missingError: { code: string; message: string } = {
      code: 'missing_agent_id',
      message: `agent 节点「${node.title}」未绑定 Agent（config.agentId 为空），无法派发。`,
    }
    const missingAt = new Date().toISOString()
    const missingExecution: WorkflowAgentExecutionRecord = {
      nodeId: node.id,
      agentId,
      instruction: '',
      inputs: {},
      attempt: 1,
      state: 'failed',
      content: '',
      error: missingError,
      startedAt: missingAt,
      endedAt: missingAt,
    }
    executions.push(missingExecution)
    return {
      status: 'failed',
      nodeId: node.id,
      agentId,
      outputKey,
      content: '',
      executions,
      failedNode: {
        nodeId: node.id,
        agentId,
        attempt: 1,
        error: missingError,
      },
    }
  }

  const inputs = buildWorkflowNodeInputs(node.id, input.graph, input.state, input.skippedNodeIds)
  const promptRaw = typeof node.config.prompt === 'string' ? node.config.prompt : ''
  // prompt 里的 {{key}} 占位符替换为 state + 活跃上游输入后再生效指令。
  const prompt = interpolateWorkflowTemplate(promptRaw, { ...input.state, ...inputs })
  const instructionBase = prompt.trim().length > 0 ? prompt : node.title
  const instruction =
    input.objective.trim().length > 0
      ? `${instructionBase}\n\n[Workflow objective]\n${input.objective}`
      : instructionBase
  const request: WorkflowAgentDispatchRequest = {
    nodeId: node.id,
    agentId,
    instruction,
    inputs,
    ...(input.attachments != null && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
  }
  // 任务 1：subagent.parallelism 真实 fan-out。仅 subagent 节点读取，agent 节点忽略（恒为 1）。
  // fan-out 是「同一 workerId 在单次 attempt 内并发 N 路独立 dispatch」，不是 N 个 worker。
  const parallelism = node.kind === 'subagent' ? getWorkflowNodeParallelism(node) : 1
  const maxAttempts = 1 + getWorkflowNodeRetryCount(node)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptStartedAt = new Date().toISOString()
    const branches =
      parallelism > 1
        ? await Promise.all(
            Array.from({ length: parallelism }, () => input.dispatch(request, { parallel: true })),
          )
        : [await input.dispatch(request, { parallel: input.parallel })]
    const attemptEndedAt = new Date().toISOString()
    const branchRecords = branches.map((reply) => {
      const replyState = reply.state ?? 'completed'
      const error =
        replyState === 'completed'
          ? undefined
          : normalizeWorkflowReplyError(
              'error' in reply ? reply.error : undefined,
              `Workflow node ${node.id} did not complete successfully.`,
            )
      return { reply, replyState, error }
    })
    for (const { reply, replyState, error } of branchRecords) {
      executions.push({
        ...request,
        attempt,
        state: replyState,
        content: reply.content,
        ...(error != null ? { error } : {}),
        startedAt: attemptStartedAt,
        endedAt: attemptEndedAt,
      })
    }
    const firstFailed = branchRecords.find((record) => record.replyState !== 'completed')
    if (firstFailed == null) {
      // 全部分支成功：聚合 content。
      const aggregated =
        parallelism > 1
          ? branchRecords
              .map((record, index) => `--- branch ${index + 1} ---\n${record.reply.content}`)
              .join('\n\n')
          : branchRecords[0]!.reply.content
      return {
        status: 'completed',
        nodeId: node.id,
        agentId,
        outputKey,
        content: aggregated,
        executions,
      }
    }
    // 任一分支失败 → 本次 attempt 视为失败；若还有重试次数，下一 attempt 再次 fan-out。
    if (attempt === maxAttempts) {
      return {
        status: firstFailed.replyState,
        nodeId: node.id,
        agentId,
        outputKey,
        content: firstFailed.reply.content,
        executions,
        failedNode: {
          nodeId: node.id,
          agentId,
          attempt,
          error: firstFailed.error ?? {
            message: `Workflow node ${node.id} did not complete successfully.`,
          },
        },
      }
    }
  }

  throw new Error(`Workflow node ${node.id} exhausted without a terminal result.`)
}

function getWorkflowNodeParallelism(node: NormalizedWorkflowNode): number {
  const raw = node.config.parallelism
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 1) return 1
  return Math.floor(raw)
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

export function getWorkflowNodeEffectiveWorkerId(
  node: NormalizedWorkflowNode,
  options: WorkflowWorkerResolutionOptions = {},
): string | undefined {
  const configured = getWorkflowNodeWorkerId(node)
  if (node.kind !== 'agent') return configured
  if (
    configured != null &&
    (options.availableWorkerIds == null || options.availableWorkerIds.has(configured))
  ) {
    return configured
  }
  const fallback = typeof options.fallbackAgentId === 'string' ? options.fallbackAgentId.trim() : ''
  if (fallback.length > 0) return fallback
  return configured
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
  const message =
    typeof error?.message === 'string' && error.message.trim().length > 0
      ? error.message
      : fallbackMessage
  const code =
    typeof error?.code === 'string' && error.code.trim().length > 0 ? error.code : undefined
  return {
    ...(code != null ? { code } : {}),
    message,
  }
}
