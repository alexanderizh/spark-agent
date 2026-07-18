import type { Node } from '@xyflow/react'
import type { CanvasNode as SparkCanvasNode } from './canvas.types'
import type { CanvasFlowNodeData } from './CanvasNode'

function canvasNodeFingerprint(node: SparkCanvasNode): string {
  return [
    node.id,
    node.updatedAt,
    node.x,
    node.y,
    node.width,
    node.height,
    node.title ?? '',
    node.locked ? '1' : '0',
    node.hidden ? '1' : '0',
    node.zIndex,
    node.parentNodeId ?? '',
    node.taskId ?? '',
    node.assetId ?? '',
  ].join('|')
}

export function flowNodeContentEqual(
  prev: Node<CanvasFlowNodeData>,
  next: Node<CanvasFlowNodeData>,
): boolean {
  if (prev.id !== next.id) return false
  if (prev.selected !== next.selected) return false
  if (prev.draggable !== next.draggable) return false
  if (prev.zIndex !== next.zIndex) return false
  if (prev.parentId !== next.parentId) return false
  if (prev.position.x !== next.position.x || prev.position.y !== next.position.y) return false
  const prevWidth = typeof prev.width === 'number' ? prev.width : 0
  const nextWidth = typeof next.width === 'number' ? next.width : 0
  const prevHeight = typeof prev.height === 'number' ? prev.height : 0
  const nextHeight = typeof next.height === 'number' ? next.height : 0
  if (prevWidth !== nextWidth || prevHeight !== nextHeight) return false
  if (prev.data.actions !== next.data.actions) return false
  if (prev.data.lineage !== next.data.lineage) return false
  if (prev.data.operationRunsFingerprint !== next.data.operationRunsFingerprint) return false
  if (prev.data.isGeneratedOutput !== next.data.isGeneratedOutput) return false
  if (prev.data.baseRenderedHeight !== next.data.baseRenderedHeight) return false
  if (prev.data.inlineToolbar !== next.data.inlineToolbar) return false
  if (prev.data.inlinePanel !== next.data.inlinePanel) return false
  if (prev.data.inlinePanelExtraHeight !== next.data.inlinePanelExtraHeight) return false
  if (prev.data.inlineToolbarHeight !== next.data.inlineToolbarHeight) return false
  if (prev.data.inlinePanelExtraWidth !== next.data.inlinePanelExtraWidth) return false
  if (prev.data.canvasNode === next.data.canvasNode) return true
  return (
    canvasNodeFingerprint(prev.data.canvasNode) === canvasNodeFingerprint(next.data.canvasNode)
  )
}

export function mergeFlowNodes(
  prevNodes: Node<CanvasFlowNodeData>[],
  nextNodes: Node<CanvasFlowNodeData>[],
): Node<CanvasFlowNodeData>[] {
  const prevById = new Map(prevNodes.map((node) => [node.id, node]))
  let changed = prevNodes.length !== nextNodes.length
  const merged = nextNodes.map((next) => {
    const prev = prevById.get(next.id)
    if (!prev) {
      changed = true
      return next
    }
    if (flowNodeContentEqual(prev, next)) return prev
    changed = true
    const sameRenderedSize = prev.width === next.width && prev.height === next.height
    if (next.measured == null && prev.measured != null && sameRenderedSize) {
      // React Flow derives handleBounds from the measured user node. Dropping
      // this field during a content-only snapshot refresh resets handleBounds;
      // its marquee algorithm then treats the node as an initial render and
      // includes it without checking whether it intersects the selection box.
      return { ...next, measured: prev.measured }
    }
    return next
  })
  return changed ? merged : prevNodes
}

export function canvasFlowNodeDataEqual(
  prev: CanvasFlowNodeData,
  next: CanvasFlowNodeData,
): boolean {
  if (prev.actions !== next.actions) return false
  if (prev.lineage !== next.lineage) return false
  if (prev.operationRunsFingerprint !== next.operationRunsFingerprint) return false
  if (prev.isGeneratedOutput !== next.isGeneratedOutput) return false
  if (prev.baseRenderedHeight !== next.baseRenderedHeight) return false
  if (prev.inlineToolbar !== next.inlineToolbar) return false
  if (prev.inlinePanel !== next.inlinePanel) return false
  if (prev.inlinePanelExtraHeight !== next.inlinePanelExtraHeight) return false
  if (prev.inlineToolbarHeight !== next.inlineToolbarHeight) return false
  if (prev.inlinePanelExtraWidth !== next.inlinePanelExtraWidth) return false
  if (prev.canvasNode === next.canvasNode) return true
  return canvasNodeFingerprint(prev.canvasNode) === canvasNodeFingerprint(next.canvasNode)
}
