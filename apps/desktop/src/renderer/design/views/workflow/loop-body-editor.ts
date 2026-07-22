import type {
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeKind,
  WorkflowOrientation,
} from '@spark/protocol'

export type WorkflowEditorScope =
  | { kind: 'root' }
  | {
      kind: 'loop-body'
      loopNodeId: string
      loopTitle: string
      rootGraph: WorkflowGraph
    }

export type LoopBodySummary = {
  nodeCount: number
  edgeCount: number
  conditionalEdgeCount: number
  orientation: WorkflowOrientation
}

export type LoopBodyValidationError = {
  code:
    | 'empty_body'
    | 'nested_loop'
    | 'duplicate_node_id'
    | 'node_id_collision'
    | 'dangling_edge'
    | 'invalid_condition'
    | 'cycle'
  message: string
  nodeId?: string
  edgeId?: string
}

export function isWorkflowGraph(value: unknown): value is WorkflowGraph {
  if (value == null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.nodes) && Array.isArray(record.edges)
}

export function defaultLoopBodyGraph(): WorkflowGraph {
  return {
    nodes: [
      {
        id: 'loop-draft',
        kind: 'review',
        title: '迭代产出',
        x: 80,
        y: 120,
        config: {
          prompt: '基于上游输入和上一轮结果，产出本轮改进版本。',
          outputKey: 'draft',
        },
      },
      {
        id: 'loop-check',
        kind: 'review',
        title: '退出判断',
        x: 360,
        y: 120,
        config: {
          prompt: "评估本轮结果是否达标。严格只输出 'pass' 或 'retry'。",
          outputKey: 'verdict',
        },
      },
    ],
    edges: [{ id: 'loop-draft-check', from: 'loop-draft', to: 'loop-check' }],
  }
}

export function openLoopBodyGraph(
  rootGraph: WorkflowGraph,
  loopNodeId: string,
  fallback: WorkflowGraph,
): { graph: WorkflowGraph; loopTitle: string } {
  const loopNode = rootGraph.nodes.find((node) => node.id === loopNodeId && node.kind === 'loop')
  if (loopNode == null) throw new Error(`Loop node ${loopNodeId} not found.`)
  const body = isWorkflowGraph(loopNode.config.body) ? loopNode.config.body : fallback
  return { graph: structuredClone(body), loopTitle: loopNode.title }
}

export function commitLoopBodyGraph(
  rootGraph: WorkflowGraph,
  loopNodeId: string,
  body: WorkflowGraph,
): WorkflowGraph {
  const target = rootGraph.nodes.find((node) => node.id === loopNodeId && node.kind === 'loop')
  if (target == null) throw new Error(`Loop node ${loopNodeId} not found.`)
  return {
    ...rootGraph,
    nodes: rootGraph.nodes.map((node) =>
      node.id === loopNodeId
        ? { ...node, config: { ...node.config, body: structuredClone(body) } }
        : node,
    ),
  }
}

export function summarizeLoopBodyGraph(graph: WorkflowGraph): LoopBodySummary {
  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    conditionalEdgeCount: graph.edges.filter((edge) => edge.condition != null).length,
    orientation: graph.orientation ?? 'horizontal',
  }
}

export function collectWorkflowNodeIds(graph: WorkflowGraph): Set<string> {
  return new Set(graph.nodes.map((node) => node.id))
}

export function createScopedWorkflowNodeId(
  loopNodeId: string,
  kind: WorkflowNodeKind,
  existingIds: ReadonlySet<string>,
  nextSuffix: () => string,
): string {
  while (true) {
    const id = `${loopNodeId}__${kind}-${nextSuffix()}`
    if (!existingIds.has(id)) return id
  }
}

function duplicateNodeIds(nodes: WorkflowNode[]): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const node of nodes) {
    if (seen.has(node.id)) duplicates.add(node.id)
    seen.add(node.id)
  }
  return duplicates
}

function graphHasCycle(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
  }
  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id)
  let visited = 0
  while (queue.length > 0) {
    const current = queue.shift()!
    visited += 1
    for (const target of outgoing.get(current) ?? []) {
      const next = (incoming.get(target) ?? 0) - 1
      incoming.set(target, next)
      if (next === 0) queue.push(target)
    }
  }
  return visited !== nodes.length
}

export function validateLoopBodyGraph(
  graph: WorkflowGraph,
  rootGraph: WorkflowGraph,
  loopNodeId: string,
): LoopBodyValidationError[] {
  const errors: LoopBodyValidationError[] = []
  if (graph.nodes.length === 0) {
    errors.push({ code: 'empty_body', message: '循环体至少需要一个节点。' })
  }

  const rootNodeIds = collectWorkflowNodeIds(rootGraph)
  const duplicateIds = duplicateNodeIds(graph.nodes)
  const reportedDuplicates = new Set<string>()
  for (const node of graph.nodes) {
    if (rootNodeIds.has(node.id)) {
      errors.push({
        code: 'node_id_collision',
        message: `循环体节点 ${node.id} 与父工作流节点 ID 冲突。`,
        nodeId: node.id,
      })
    }
    if (duplicateIds.has(node.id) && !reportedDuplicates.has(node.id)) {
      reportedDuplicates.add(node.id)
      errors.push({
        code: 'duplicate_node_id',
        message: `循环体包含重复节点 ID：${node.id}。`,
        nodeId: node.id,
      })
    }
    if (node.kind === 'loop') {
      errors.push({
        code: 'nested_loop',
        message: `循环体内不支持嵌套循环节点：${node.title || node.id}。`,
        nodeId: node.id,
      })
    }
  }

  const bodyNodeIds = collectWorkflowNodeIds(graph)
  for (const edge of graph.edges) {
    if (!bodyNodeIds.has(edge.from) || !bodyNodeIds.has(edge.to)) {
      errors.push({
        code: 'dangling_edge',
        message: `连线 ${edge.id} 引用了不存在的循环体节点。`,
        edgeId: edge.id,
      })
    }
    if (edge.condition != null && edge.condition.key.trim().length === 0) {
      errors.push({
        code: 'invalid_condition',
        message: `条件连线 ${edge.id} 的状态键不能为空。`,
        edgeId: edge.id,
      })
    }
  }

  if (graph.nodes.length > 0 && graphHasCycle(graph.nodes, graph.edges)) {
    errors.push({
      code: 'cycle',
      message: `循环节点 ${loopNodeId} 的内部子图必须保持无环。`,
    })
  }
  return errors
}
