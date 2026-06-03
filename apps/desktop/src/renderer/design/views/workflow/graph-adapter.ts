import type { Edge, Node } from '@xyflow/react'
import type { WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeKind } from '@spark/protocol'

export type SparkNodeData = {
  kind: WorkflowNodeKind
  title: string
  config: WorkflowNode['config']
}

export type SparkFlowNode = Node<SparkNodeData, 'spark'>

export function graphToReactFlow(graph: WorkflowGraph): { nodes: SparkFlowNode[]; edges: Edge[] } {
  const nodes: SparkFlowNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: 'spark',
    position: { x: node.x ?? 120, y: node.y ?? 120 },
    data: { kind: node.kind, title: node.title, config: node.config },
  }))
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: 'smoothstep',
    animated: true,
  }))
  return { nodes, edges }
}

export function reactFlowToGraph(nodes: SparkFlowNode[], edges: Edge[]): WorkflowGraph {
  const protoNodes: WorkflowNode[] = nodes.map((node) => ({
    id: node.id,
    kind: node.data.kind,
    title: node.data.title,
    x: Math.round(node.position.x),
    y: Math.round(node.position.y),
    config: node.data.config,
  }))
  const protoEdges: WorkflowEdge[] = edges.map((edge) => ({
    id: edge.id,
    from: edge.source,
    to: edge.target,
  }))
  return { nodes: protoNodes, edges: protoEdges }
}
