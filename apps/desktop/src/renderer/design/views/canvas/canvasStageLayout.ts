import type { Node, NodeChange } from '@xyflow/react'
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
    const inlineExtraHeight = flow.data.inlinePanelExtraHeight ?? 0
    const inlineToolbarHeight = flow.data.inlineToolbarHeight ?? 0
    const inlineExtraWidth = flow.data.inlinePanelExtraWidth ?? 0
    const cardChromeExtraHeight = flow.data.cardChromeExtraHeight ?? 0
    const measuredWidth =
      typeof flow.measured?.width === 'number'
        ? flow.measured.width
        : typeof flow.width === 'number'
          ? flow.width
          : node.width
    const measuredHeight =
      typeof flow.measured?.height === 'number'
        ? flow.measured.height
        : typeof flow.height === 'number'
          ? flow.height
          : node.height
    return {
      ...node,
      x: flow.position.x,
      y: flow.position.y,
      width:
        inlineExtraWidth > 0 && Math.abs(measuredWidth - (node.width + inlineExtraWidth)) <= 1
          ? node.width
          : measuredWidth,
      height:
        inlineExtraHeight > 0 || inlineToolbarHeight > 0
          ? node.height
          : Math.max(1, measuredHeight - cardChromeExtraHeight),
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
    (change) =>
      (change.type === 'position' && Boolean(change.position) && change.dragging === false) ||
      (change.type === 'dimensions' && Boolean(change.dimensions) && change.resizing === false),
  )
  if (layoutChanges.length === 0) return null

  const nextNodes = fromFlowNodes(baseNodes, flowNodes)
  return hasPersistedLayoutChanged(baseNodes, nextNodes) ? nextNodes : null
}
