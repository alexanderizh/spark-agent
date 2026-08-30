/**
 * 画布多选节点对齐算法（纯函数）。
 *
 * 与 canvasAutoLayout.ts 同风格：输入节点（绝对坐标 + 尺寸）+ 模式，
 * 输出每个节点的目标 { id, x, y }。调用方（CanvasStage 的 imperative API
 * alignNodes）负责相对坐标↔绝对坐标转换、写回 flow 节点、持久化与 fitView。
 *
 * 坐标语义与 canvasAutoLayout 一致：节点 y 是 body 顶部（meta-bar 之下），
 * 可见包围盒上沿 = y - (headerHeight ?? 0)，下沿 = y + height。
 * 对齐到「可见包围盒」基准，保证 headerHeight 不同的节点视觉上严格对齐。
 */

export type CanvasAlignmentMode =
  // 水平方向（沿 X 轴对齐）
  | 'left'
  | 'center-horizontal'
  | 'right'
  // 垂直方向（沿 Y 轴对齐）
  | 'top'
  | 'center-vertical'
  | 'bottom'
  // 等距分布（保留首尾、中间均分，Figma 语义）
  | 'distribute-horizontal'
  | 'distribute-vertical'

export type CanvasAlignmentNode = {
  id: string
  x: number
  y: number
  width: number
  height: number
  headerHeight?: number
}

export type CanvasAlignmentPosition = {
  id: string
  x: number
  y: number
}

type VisibleRect = {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * 按指定模式对齐节点。节点数 < 2 返回空；distribute 在节点数 < 3 或首尾中心重合时返回空。
 * 输出坐标全部 Math.round（与 canvasAutoLayout.translatePositions 行为对齐）。
 */
export function alignCanvasNodes(
  nodes: readonly CanvasAlignmentNode[],
  options: { mode: CanvasAlignmentMode },
): CanvasAlignmentPosition[] {
  const mode = options.mode
  if (nodes.length < 2) return []
  if (
    (mode === 'distribute-horizontal' || mode === 'distribute-vertical') &&
    nodes.length < 3
  ) {
    return []
  }

  if (mode === 'distribute-horizontal') return distributeNodes(nodes, 'horizontal')
  if (mode === 'distribute-vertical') return distributeNodes(nodes, 'vertical')

  const bounds = visibleBounds(nodes)

  return nodes.map((node) => alignSingleNode(node, bounds, mode))
}

function alignSingleNode(
  node: CanvasAlignmentNode,
  bounds: VisibleRect,
  mode: Exclude<CanvasAlignmentMode, 'distribute-horizontal' | 'distribute-vertical'>,
): CanvasAlignmentPosition {
  const headerHeight = node.headerHeight ?? 0
  switch (mode) {
    case 'left':
      return { id: node.id, x: Math.round(bounds.left), y: node.y }
    case 'right':
      return { id: node.id, x: Math.round(bounds.right - node.width), y: node.y }
    case 'center-horizontal': {
      const center = (bounds.left + bounds.right) / 2
      return { id: node.id, x: Math.round(center - node.width / 2), y: node.y }
    }
    case 'top':
      // 对齐到可见顶（meta-bar 上沿），写回 body 顶 y 时加回自身 headerHeight
      return { id: node.id, x: node.x, y: Math.round(bounds.top + headerHeight) }
    case 'bottom':
      return { id: node.id, x: node.x, y: Math.round(bounds.bottom - node.height) }
    case 'center-vertical': {
      const center = (bounds.top + bounds.bottom) / 2
      // 可见中心 = y + (height - headerHeight) / 2；反解 y
      return {
        id: node.id,
        x: node.x,
        y: Math.round(center - (node.height - headerHeight) / 2),
      }
    }
  }
}

/**
 * 等距分布：按中心排序后，首尾保留、中间均分。
 * span = 0（首尾中心重合）时返回空，避免除零与无意义抖动。
 */
function distributeNodes(
  nodes: readonly CanvasAlignmentNode[],
  axis: 'horizontal' | 'vertical',
): CanvasAlignmentPosition[] {
  const ordered = [...nodes].sort((left, right) => {
    const leftCenter = horizontalCenter(left)
    const rightCenter = horizontalCenter(right)
    if (axis === 'horizontal') {
      return leftCenter - rightCenter || left.id.localeCompare(right.id)
    }
    return visibleCenterY(left) - visibleCenterY(right) || left.id.localeCompare(right.id)
  })

  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  if (!first || !last) return []

  const firstCenter = axis === 'horizontal' ? horizontalCenter(first) : visibleCenterY(first)
  const lastCenter = axis === 'horizontal' ? horizontalCenter(last) : visibleCenterY(last)
  const span = lastCenter - firstCenter
  if (span === 0) return []

  const step = span / (ordered.length - 1)
  return ordered.map((node, index) => {
    const center = firstCenter + index * step
    if (axis === 'horizontal') {
      return { id: node.id, x: Math.round(center - node.width / 2), y: node.y }
    }
    const headerHeight = node.headerHeight ?? 0
    return {
      id: node.id,
      x: node.x,
      y: Math.round(center - (node.height - headerHeight) / 2),
    }
  })
}

function horizontalCenter(node: CanvasAlignmentNode): number {
  return node.x + node.width / 2
}

function visibleCenterY(node: CanvasAlignmentNode): number {
  return node.y + (node.height - (node.headerHeight ?? 0)) / 2
}

function visibleBounds(nodes: readonly CanvasAlignmentNode[]): VisibleRect {
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    const headerHeight = node.headerHeight ?? 0
    if (node.x < left) left = node.x
    if (node.x + node.width > right) right = node.x + node.width
    if (node.y - headerHeight < top) top = node.y - headerHeight
    if (node.y + node.height > bottom) bottom = node.y + node.height
  }
  return { left, right, top, bottom }
}
