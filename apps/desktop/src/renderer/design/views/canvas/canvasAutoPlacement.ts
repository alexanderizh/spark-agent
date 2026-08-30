export type CanvasAutoPlacementPoint = {
  x: number
  y: number
}

export type CanvasAutoPlacementRect = {
  x: number
  y: number
  width: number
  height: number
}

export type CanvasAutoPlacementSize = {
  width: number
  height: number
}

export const AUTO_NODE_RIGHT_GAP = 96
export const AUTO_NODE_VERTICAL_GAP = 72
export const AUTO_NODE_META_BAR_CLEARANCE = 28

export function placeAutoNodeToRight(
  anchor: CanvasAutoPlacementRect,
  size?: CanvasAutoPlacementSize,
): CanvasAutoPlacementPoint {
  return {
    x: Math.round(anchor.x + anchor.width + AUTO_NODE_RIGHT_GAP),
    y: Math.round(
      size ? anchor.y + (anchor.height - size.height) / 2 : anchor.y + AUTO_NODE_META_BAR_CLEARANCE,
    ),
  }
}

export function stackAutoNodesToRight(
  anchor: CanvasAutoPlacementRect,
  sizes: readonly CanvasAutoPlacementSize[],
): CanvasAutoPlacementPoint[] {
  const x = Math.round(anchor.x + anchor.width + AUTO_NODE_RIGHT_GAP)
  const positions: CanvasAutoPlacementPoint[] = []
  const rowGap = AUTO_NODE_VERTICAL_GAP + AUTO_NODE_META_BAR_CLEARANCE
  const totalHeight =
    sizes.reduce((total, size) => total + size.height, 0) + Math.max(0, sizes.length - 1) * rowGap
  let cursorY = anchor.y + (anchor.height - totalHeight) / 2

  for (const size of sizes) {
    positions.push({
      x,
      y: Math.round(cursorY),
    })
    cursorY += size.height + rowGap
  }

  return positions
}

export function placeAutoGridNode(
  base: CanvasAutoPlacementPoint,
  size: CanvasAutoPlacementSize,
  index: number,
  perRow: number,
): CanvasAutoPlacementPoint {
  const column = index % perRow
  const row = Math.floor(index / perRow)
  return {
    x: Math.round(base.x + column * (size.width + AUTO_NODE_RIGHT_GAP)),
    y: Math.round(
      base.y + row * (size.height + AUTO_NODE_VERTICAL_GAP + AUTO_NODE_META_BAR_CLEARANCE),
    ),
  }
}
