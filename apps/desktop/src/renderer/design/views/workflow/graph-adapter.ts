import type { Edge, Node } from '@xyflow/react'
import type {
  WorkflowEdge,
  WorkflowEdgeCondition,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeKind,
  WorkflowOrientation,
} from '@spark/protocol'

export type SparkNodeData = {
  kind: WorkflowNodeKind
  title: string
  config: WorkflowNode['config']
  /** 节点所属编排方向，用于决定 handle 朝向（横向 = 左右、纵向 = 上下）。 */
  orientation: WorkflowOrientation
}

export type SparkFlowNode = Node<SparkNodeData, 'spark'>

/** 边条件放在 ReactFlow edge.data 里往返携带，避免保存时被 reactFlowToGraph 抹掉。 */
export type SparkEdgeData = {
  condition?: WorkflowEdgeCondition
}

const EDGE_CONDITION_OP_LABEL: Record<WorkflowEdgeCondition['op'], string> = {
  exists: '存在',
  truthy: '为真',
  falsy: '为假',
  equals: '=',
  not_equals: '≠',
}

/** 条件的画布展示文案，如 `plan_ok = true`、`report 存在`。 */
export function formatEdgeConditionLabel(condition: WorkflowEdgeCondition): string {
  if (condition.op === 'equals' || condition.op === 'not_equals') {
    return `${condition.key} ${EDGE_CONDITION_OP_LABEL[condition.op]} ${JSON.stringify(condition.value)}`
  }
  return `${condition.key} ${EDGE_CONDITION_OP_LABEL[condition.op]}`
}

/**
 * 条件变化时同步边的展示属性：带条件的边去掉流动动画、加标签与专属类名，
 * 让「有分支判断」在画布上一眼可辨。集中在这里保证 加载/编辑 两条路径样式一致。
 * 注意返回值不含 label/className 键时代表"无条件"——调用方更新已有边时要先剥掉旧键
 * （exactOptionalPropertyTypes 下不能用显式 undefined 覆盖）。
 */
export function buildEdgeConditionProps(
  condition: WorkflowEdgeCondition | undefined,
): { data: SparkEdgeData; animated: boolean; label?: string; className?: string } {
  if (condition == null) {
    return { data: {}, animated: true }
  }
  return {
    data: { condition },
    label: formatEdgeConditionLabel(condition),
    animated: false,
    className: 'wf-edge-conditional',
  }
}

export function graphToReactFlow(graph: WorkflowGraph): { nodes: SparkFlowNode[]; edges: Edge[] } {
  const orientation: WorkflowOrientation = graph.orientation ?? 'horizontal'
  const nodes: SparkFlowNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: 'spark',
    position: { x: node.x ?? 120, y: node.y ?? 120 },
    data: { kind: node.kind, title: node.title, config: node.config, orientation },
  }))
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: 'smoothstep',
    ...buildEdgeConditionProps(edge.condition),
  }))
  return { nodes, edges }
}

export function reactFlowToGraph(
  nodes: SparkFlowNode[],
  edges: Edge[],
  orientation?: WorkflowOrientation,
): WorkflowGraph {
  const protoNodes: WorkflowNode[] = nodes.map((node) => ({
    id: node.id,
    kind: node.data.kind,
    title: node.data.title,
    x: Math.round(node.position.x),
    y: Math.round(node.position.y),
    config: node.data.config,
  }))
  const protoEdges: WorkflowEdge[] = edges.map((edge) => {
    const condition = (edge.data as SparkEdgeData | undefined)?.condition
    return {
      id: edge.id,
      from: edge.source,
      to: edge.target,
      // 仅在有条件时携带字段，保持存储与导出的 graph JSON 整洁。
      ...(condition != null ? { condition } : {}),
    }
  })
  return {
    nodes: protoNodes,
    edges: protoEdges,
    // 仅纵向时携带字段：横向是默认值，省略以保持旧 JSON 整洁、且让旧工作流自然兼容。
    ...(orientation === 'vertical' ? { orientation } : {}),
  }
}
