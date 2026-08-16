import type { CanvasEdge, CanvasNode } from './canvas.types'
import { inferCanvasConnectionType } from './canvasConnectionSemantics'

/**
 * 连线吸附辅助的纯逻辑层：
 * - 牵线端点靠近节点时挑选候选节点（感应半径为屏幕像素，与画布缩放无关）。
 * - 卡片级投放时按现有业务规则预检（自连接、隐藏节点、按推断类型的重复边）。
 * DOM 采集与事件接线见 useCanvasConnectionAssist.ts。
 */

/** 接近感应半径（屏幕像素）。 */
export const CANVAS_CONNECTION_ASSIST_RADIUS_PX = 32

/** 牵线时挂在候选节点外层 .react-flow__node 上的类名。 */
export const CANVAS_CONNECTION_CANDIDATE_CLASS = 'canvas-connection-candidate'
/** 牵线时挂在无效目标节点外层 .react-flow__node 上的类名。 */
export const CANVAS_CONNECTION_INVALID_CLASS = 'canvas-connection-invalid'

export interface ConnectionAssistPointer {
  x: number
  y: number
}

export interface ConnectionAssistNodeRect {
  id: string
  left: number
  top: number
  right: number
  bottom: number
  /** React Flow 提升层级后的 z-index，未设置时为 0。 */
  zIndex: number
  /** DOM 顺序，越靠后绘制越靠上。 */
  order: number
}

export interface ConnectionDragOrigin {
  nodeId: string
  handleType: 'source' | 'target'
}

export interface CardDropConnection {
  sourceNodeId: string
  targetNodeId: string
}

export interface ConnectionAssistRules {
  nodeById: Map<string, CanvasNode>
  edges: CanvasEdge[]
}

export function getConnectionClientPoint(
  event: MouseEvent | TouchEvent,
): ConnectionAssistPointer | null {
  if ('clientX' in event) return { x: event.clientX, y: event.clientY }
  const touch = event.changedTouches[0] ?? event.touches[0]
  return touch ? { x: touch.clientX, y: touch.clientY } : null
}

function distanceToRect(pointer: ConnectionAssistPointer, rect: ConnectionAssistNodeRect): number {
  const dx = Math.max(rect.left - pointer.x, 0, pointer.x - rect.right)
  const dy = Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom)
  return Math.hypot(dx, dy)
}

function isTopmost(a: ConnectionAssistNodeRect, b: ConnectionAssistNodeRect): boolean {
  if (a.zIndex !== b.zIndex) return a.zIndex > b.zIndex
  return a.order > b.order
}

/**
 * 选出牵线端点当前应反馈的候选节点：
 * 优先指针正落在卡片内的（视觉最上层优先），其次取感应半径内最近的。
 * 起点节点自身排除在外，避免拖起瞬间就出现反馈。
 */
export function pickConnectionCandidate(
  rects: ConnectionAssistNodeRect[],
  pointer: ConnectionAssistPointer,
  radiusPx: number,
  excludeNodeId?: string | null,
): ConnectionAssistNodeRect | null {
  const available = excludeNodeId ? rects.filter((rect) => rect.id !== excludeNodeId) : rects
  const containing = available.filter(
    (rect) =>
      pointer.x >= rect.left &&
      pointer.x <= rect.right &&
      pointer.y >= rect.top &&
      pointer.y <= rect.bottom,
  )
  if (containing.length > 0) {
    return containing.reduce((top, rect) => (isTopmost(rect, top) ? rect : top))
  }
  let nearest: ConnectionAssistNodeRect | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const rect of available) {
    const distance = distanceToRect(pointer, rect)
    if (distance > radiusPx) continue
    if (
      nearest &&
      (distance > nearestDistance || (distance === nearestDistance && !isTopmost(rect, nearest)))
    ) {
      continue
    }
    nearest = rect
    nearestDistance = distance
  }
  return nearest
}

/**
 * 卡片级投放的连接预检，镜像 canvas.api connectNodes 的业务规则
 * （自连接、隐藏节点、按推断类型的重复边）。返回 null 表示不允许创建，
 * 由调用方负责给出与有效目标不同的反馈且不创建连线。
 */
export function resolveCardDropConnection(params: {
  origin: ConnectionDragOrigin
  dropNodeId: string
  rules: ConnectionAssistRules
}): CardDropConnection | null {
  const { origin, dropNodeId, rules } = params
  if (dropNodeId === origin.nodeId) return null
  const originNode = rules.nodeById.get(origin.nodeId)
  const dropNode = rules.nodeById.get(dropNodeId)
  if (!originNode || !dropNode || originNode.hidden || dropNode.hidden) return null
  const source = origin.handleType === 'source' ? originNode : dropNode
  const target = origin.handleType === 'source' ? dropNode : originNode
  const edgeType = inferCanvasConnectionType(source, target)
  const duplicate = rules.edges.some(
    (edge) =>
      edge.sourceNodeId === source.id && edge.targetNodeId === target.id && edge.type === edgeType,
  )
  if (duplicate) return null
  return { sourceNodeId: source.id, targetNodeId: target.id }
}
