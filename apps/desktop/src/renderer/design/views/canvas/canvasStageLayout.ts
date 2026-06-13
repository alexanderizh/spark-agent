import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react'
import type { CanvasFlowNodeData } from './CanvasNode'
import type { CanvasNode as SparkCanvasNode } from './canvas.types'

function fromFlowNodes(
  base: SparkCanvasNode[],
  flowNodes: Node<CanvasFlowNodeData>[],
): SparkCanvasNode[] {
  const flowById = new Map(flowNodes.map((node) => [node.id, node]))
  return base.map((node) => {
    const flow = flowById.get(node.id)
    if (!flow) return node
    return {
      ...node,
      x: flow.position.x,
      y: flow.position.y,
      width: typeof flow.width === 'number' ? flow.width : node.width,
      height: typeof flow.height === 'number' ? flow.height : node.height,
    }
  })
}

function hasPersistedLayoutChanged(
  previousNodes: SparkCanvasNode[],
  nextNodes: SparkCanvasNode[],
): boolean {
  if (previousNodes.length !== nextNodes.length) return true
  return previousNodes.some((node, index) => {
    const next = nextNodes[index]
    return (
      !next ||
      node.id !== next.id ||
      node.x !== next.x ||
      node.y !== next.y ||
      node.width !== next.width ||
      node.height !== next.height
    )
  })
}

export function persistCanvasNodeLayoutChanges(
  baseNodes: SparkCanvasNode[],
  flowNodes: Node<CanvasFlowNodeData>[],
  changes: NodeChange<Node<CanvasFlowNodeData>>[],
): SparkCanvasNode[] | null {
  const layoutChanges = changes.filter(
    (change) => change.type === 'position' && Boolean(change.position),
  )
  if (layoutChanges.length === 0) return null

  const nextFlowNodes = applyNodeChanges(layoutChanges, flowNodes)
  const nextNodes = fromFlowNodes(baseNodes, nextFlowNodes)
  return hasPersistedLayoutChanged(baseNodes, nextNodes) ? nextNodes : null
}
