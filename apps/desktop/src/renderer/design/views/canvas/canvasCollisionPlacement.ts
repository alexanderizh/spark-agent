import {
  findCollisionFreeCanvasPlacement,
  type CanvasPlacementPoint,
  type CanvasPlacementRect,
} from './canvasPlacementEngine'
import type { CanvasNode } from './canvas.types'

export const CANVAS_BATCH_ITEM_GAP = 64
export const CANVAS_BATCH_MAX_COLUMNS = 3

type CanvasPlacementSize = { width: number; height: number }

function topLevelObstacleRects(
  nodes: readonly CanvasNode[],
  boardId: string,
): CanvasPlacementRect[] {
  return nodes
    .filter(
      (node) =>
        node.boardId === boardId &&
        !node.hidden &&
        !node.parentNodeId &&
        node.width > 0 &&
        node.height > 0,
    )
    .map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height }))
}

/**
 * 统一解析手动、菜单、资产、任务等入口的新节点落点。
 * 调用方传入用户期望位置；仅当该位置与现有顶层节点/组框冲突时才向外搜索。
 */
export function resolveCollisionFreeNodePosition(input: {
  preferred: CanvasPlacementPoint
  size: CanvasPlacementSize
  nodes: readonly CanvasNode[]
  boardId: string
  extraObstacles?: readonly CanvasPlacementRect[]
}): CanvasPlacementPoint {
  const placed = findCollisionFreeCanvasPlacement({
    preferred: input.preferred,
    items: [{ x: 0, y: 0, ...input.size }],
    obstacles: [
      ...topLevelObstacleRects(input.nodes, input.boardId),
      ...(input.extraObstacles ?? []),
    ],
  })
  return placed?.origin ?? input.preferred
}

/**
 * 多产物先在局部坐标中做等间距网格，再把整个批次作为一个矩形寻找空位。
 * 这样成员不会被单独搜索打乱，后续创建 group 时能保持稳定、整齐的视觉顺序。
 */
export function resolveCollisionFreeBatchPositions(input: {
  preferred: CanvasPlacementPoint
  sizes: readonly CanvasPlacementSize[]
  nodes: readonly CanvasNode[]
  boardId: string
  maxColumns?: number
}): CanvasPlacementPoint[] {
  if (input.sizes.length === 0) return []
  const columns = Math.max(
    1,
    Math.min(input.maxColumns ?? CANVAS_BATCH_MAX_COLUMNS, input.sizes.length),
  )
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      0,
      ...input.sizes.filter((_, index) => index % columns === column).map((size) => size.width),
    ),
  )
  const rowCount = Math.ceil(input.sizes.length / columns)
  const rowHeights = Array.from({ length: rowCount }, (_, row) =>
    Math.max(
      0,
      ...input.sizes.slice(row * columns, (row + 1) * columns).map((size) => size.height),
    ),
  )
  const columnX = columnWidths.map((_, column) =>
    columnWidths
      .slice(0, column)
      .reduce((total, width) => total + width + CANVAS_BATCH_ITEM_GAP, 0),
  )
  const rowY = rowHeights.map((_, row) =>
    rowHeights.slice(0, row).reduce((total, height) => total + height + CANVAS_BATCH_ITEM_GAP, 0),
  )
  const localItems = input.sizes.map((size, index) => ({
    x: columnX[index % columns] ?? 0,
    y: rowY[Math.floor(index / columns)] ?? 0,
    width: size.width,
    height: size.height,
  }))
  const placed = findCollisionFreeCanvasPlacement({
    preferred: input.preferred,
    items: localItems,
    obstacles: topLevelObstacleRects(input.nodes, input.boardId),
  })
  return (placed?.items ?? localItems).map(({ x, y }) => ({ x, y }))
}
