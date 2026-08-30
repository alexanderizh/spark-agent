import type { Node } from '@xyflow/react'
import type { CanvasFlowNodeData } from './CanvasNode'

export type CanvasAlignmentGuide = {
  id: string
  orientation: 'vertical' | 'horizontal'
  position: number
  start: number
  end: number
  kind: 'edge' | 'center'
}

type Bounds = {
  id: string
  left: number
  centerX: number
  right: number
  top: number
  centerY: number
  bottom: number
}

const GUIDE_PADDING = 72

export function computeCanvasAlignmentGuides(
  allNodes: Node<CanvasFlowNodeData>[],
  draggedNodes: Node<CanvasFlowNodeData>[],
  threshold = 6,
): CanvasAlignmentGuide[] {
  if (draggedNodes.length === 0 || allNodes.length <= draggedNodes.length) return []
  const draggedIds = new Set(draggedNodes.map((node) => node.id))
  const dragged = boundsFromNodes(draggedNodes)
  if (!dragged) return []

  const others = allNodes
    .filter((node) => !draggedIds.has(node.id))
    .map(nodeBounds)
  const candidates: CanvasAlignmentGuide[] = []

  for (const other of others) {
    candidates.push(
      ...verticalCandidates(dragged, other, threshold),
      ...horizontalCandidates(dragged, other, threshold),
    )
  }

  return dedupeGuides(candidates)
    .sort((left, right) => guidePriority(left) - guidePriority(right))
    .slice(0, 6)
}

function verticalCandidates(
  dragged: Bounds,
  target: Bounds,
  threshold: number,
): CanvasAlignmentGuide[] {
  return [
    guideIfNear('vertical', 'edge', 'left', dragged.left, target.left, dragged, target, threshold),
    guideIfNear('vertical', 'center', 'center-x', dragged.centerX, target.centerX, dragged, target, threshold),
    guideIfNear('vertical', 'edge', 'right', dragged.right, target.right, dragged, target, threshold),
  ].filter((guide): guide is CanvasAlignmentGuide => Boolean(guide))
}

function horizontalCandidates(
  dragged: Bounds,
  target: Bounds,
  threshold: number,
): CanvasAlignmentGuide[] {
  return [
    guideIfNear('horizontal', 'edge', 'top', dragged.top, target.top, dragged, target, threshold),
    guideIfNear('horizontal', 'center', 'center-y', dragged.centerY, target.centerY, dragged, target, threshold),
    guideIfNear('horizontal', 'edge', 'bottom', dragged.bottom, target.bottom, dragged, target, threshold),
  ].filter((guide): guide is CanvasAlignmentGuide => Boolean(guide))
}

function guideIfNear(
  orientation: CanvasAlignmentGuide['orientation'],
  kind: CanvasAlignmentGuide['kind'],
  label: string,
  draggedPosition: number,
  targetPosition: number,
  dragged: Bounds,
  target: Bounds,
  threshold: number,
): CanvasAlignmentGuide | null {
  if (Math.abs(draggedPosition - targetPosition) > threshold) return null
  if (orientation === 'vertical') {
    return {
      id: `${orientation}:${kind}:${label}:${Math.round(targetPosition)}:${target.id}`,
      orientation,
      kind,
      position: targetPosition,
      start: Math.min(dragged.top, target.top) - GUIDE_PADDING,
      end: Math.max(dragged.bottom, target.bottom) + GUIDE_PADDING,
    }
  }
  return {
    id: `${orientation}:${kind}:${label}:${Math.round(targetPosition)}:${target.id}`,
    orientation,
    kind,
    position: targetPosition,
    start: Math.min(dragged.left, target.left) - GUIDE_PADDING,
    end: Math.max(dragged.right, target.right) + GUIDE_PADDING,
  }
}

function dedupeGuides(guides: CanvasAlignmentGuide[]): CanvasAlignmentGuide[] {
  const byKey = new Map<string, CanvasAlignmentGuide>()
  for (const guide of guides) {
    const key = `${guide.orientation}:${guide.kind}:${Math.round(guide.position)}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, guide)
      continue
    }
    byKey.set(key, {
      ...existing,
      start: Math.min(existing.start, guide.start),
      end: Math.max(existing.end, guide.end),
    })
  }
  return [...byKey.values()]
}

function guidePriority(guide: CanvasAlignmentGuide): number {
  return guide.kind === 'center' ? 0 : 1
}

function boundsFromNodes(nodes: Node<CanvasFlowNodeData>[]): Bounds | null {
  if (nodes.length === 0) return null
  const bounds = nodes.map(nodeBounds)
  const left = Math.min(...bounds.map((item) => item.left))
  const right = Math.max(...bounds.map((item) => item.right))
  const top = Math.min(...bounds.map((item) => item.top))
  const bottom = Math.max(...bounds.map((item) => item.bottom))
  return {
    id: bounds.map((item) => item.id).join('+'),
    left,
    right,
    top,
    bottom,
    centerX: left + (right - left) / 2,
    centerY: top + (bottom - top) / 2,
  }
}

function nodeBounds(node: Node<CanvasFlowNodeData>): Bounds {
  const width = measuredWidth(node)
  const height = measuredHeight(node)
  const left = node.position.x
  const top = node.position.y
  return {
    id: node.id,
    left,
    top,
    right: left + width,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  }
}

function measuredWidth(node: Node<CanvasFlowNodeData>): number {
  return typeof node.measured?.width === 'number'
    ? node.measured.width
    : typeof node.width === 'number'
      ? node.width
      : node.data.canvasNode.width
}

function measuredHeight(node: Node<CanvasFlowNodeData>): number {
  return typeof node.measured?.height === 'number'
    ? node.measured.height
    : typeof node.height === 'number'
      ? node.height
      : node.data.canvasNode.height
}
