export type CanvasAutoLayoutMode = 'horizontal' | 'vertical' | 'grid'

export type CanvasAutoLayoutSpacing = 'extra-large' | 'large' | 'medium' | 'small'

export type CanvasAutoLayoutNode = {
  id: string
  x: number
  y: number
  width: number
  height: number
  headerHeight?: number
}

export type CanvasAutoLayoutPosition = {
  id: string
  x: number
  y: number
}

type LayoutRect = {
  left: number
  top: number
  right: number
  bottom: number
}

const SPACING_PIXELS: Record<CanvasAutoLayoutSpacing, number> = {
  small: 32,
  medium: 64,
  large: 96,
  'extra-large': 144,
}

export function canvasAutoLayoutGap(spacing: CanvasAutoLayoutSpacing): number {
  return SPACING_PIXELS[spacing]
}

export function arrangeCanvasNodes(
  nodes: readonly CanvasAutoLayoutNode[],
  options: {
    mode: CanvasAutoLayoutMode
    spacing: CanvasAutoLayoutSpacing
    obstacles?: readonly CanvasAutoLayoutNode[]
  },
): CanvasAutoLayoutPosition[] {
  if (nodes.length === 0) return []

  const gap = canvasAutoLayoutGap(options.spacing)
  const ordered = [...nodes].sort((left, right) => compareNodes(left, right, options.mode))
  const anchorLeft = Math.min(...ordered.map((node) => node.x))
  const anchorTop = Math.min(...ordered.map((node) => node.y - (node.headerHeight ?? 0)))
  const positions = buildPositions(ordered, options.mode, gap, anchorLeft, anchorTop)
  const obstacleRects = (options.obstacles ?? []).map(nodeRect)

  if (obstacleRects.length === 0) return positions

  return moveLayoutPastObstacles(ordered, positions, obstacleRects, options.mode, gap)
}

function buildPositions(
  nodes: readonly CanvasAutoLayoutNode[],
  mode: CanvasAutoLayoutMode,
  gap: number,
  anchorLeft: number,
  anchorTop: number,
): CanvasAutoLayoutPosition[] {
  if (mode === 'horizontal') {
    let cursorX = anchorLeft
    return nodes.map((node) => {
      const position = {
        id: node.id,
        x: Math.round(cursorX),
        y: Math.round(anchorTop + (node.headerHeight ?? 0)),
      }
      cursorX += node.width + gap
      return position
    })
  }

  if (mode === 'vertical') {
    let cursorTop = anchorTop
    return nodes.map((node) => {
      const headerHeight = node.headerHeight ?? 0
      const position = {
        id: node.id,
        x: Math.round(anchorLeft),
        y: Math.round(cursorTop + headerHeight),
      }
      cursorTop += headerHeight + node.height + gap
      return position
    })
  }

  const columnCount = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
  const rowCount = Math.ceil(nodes.length / columnCount)
  const columnWidths = Array.from({ length: columnCount }, () => 0)
  const rowHeights = Array.from({ length: rowCount }, () => 0)

  nodes.forEach((node, index) => {
    const column = index % columnCount
    const row = Math.floor(index / columnCount)
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, node.width)
    rowHeights[row] = Math.max(
      rowHeights[row] ?? 0,
      node.height + (node.headerHeight ?? 0),
    )
  })

  const columnOffsets = cumulativeOffsets(columnWidths, gap, anchorLeft)
  const rowOffsets = cumulativeOffsets(rowHeights, gap, anchorTop)
  return nodes.map((node, index) => ({
    id: node.id,
    x: Math.round(columnOffsets[index % columnCount] ?? anchorLeft),
    y: Math.round(
      (rowOffsets[Math.floor(index / columnCount)] ?? anchorTop) + (node.headerHeight ?? 0),
    ),
  }))
}

function cumulativeOffsets(sizes: readonly number[], gap: number, start: number): number[] {
  const offsets: number[] = []
  let cursor = start
  for (const size of sizes) {
    offsets.push(cursor)
    cursor += size + gap
  }
  return offsets
}

function moveLayoutPastObstacles(
  nodes: readonly CanvasAutoLayoutNode[],
  positions: readonly CanvasAutoLayoutPosition[],
  obstacles: readonly LayoutRect[],
  mode: CanvasAutoLayoutMode,
  gap: number,
): CanvasAutoLayoutPosition[] {
  let translated = positions.map((position) => ({ ...position }))

  for (let pass = 0; pass < obstacles.length + 1; pass += 1) {
    const layoutRect = boundsForPositions(nodes, translated)
    const collisions = obstacles.filter((obstacle) => rectsOverlap(layoutRect, obstacle, gap))
    if (collisions.length === 0) return translated

    if (mode === 'horizontal') {
      const nextTop = Math.max(...collisions.map((obstacle) => obstacle.bottom + gap))
      translated = translatePositions(translated, 0, nextTop - layoutRect.top)
    } else {
      const nextLeft = Math.max(...collisions.map((obstacle) => obstacle.right + gap))
      translated = translatePositions(translated, nextLeft - layoutRect.left, 0)
    }
  }

  return translated
}

function translatePositions(
  positions: readonly CanvasAutoLayoutPosition[],
  deltaX: number,
  deltaY: number,
): CanvasAutoLayoutPosition[] {
  return positions.map((position) => ({
    ...position,
    x: Math.round(position.x + deltaX),
    y: Math.round(position.y + deltaY),
  }))
}

function boundsForPositions(
  nodes: readonly CanvasAutoLayoutNode[],
  positions: readonly CanvasAutoLayoutPosition[],
): LayoutRect {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const rects = positions.map((position) => {
    const node = nodeById.get(position.id)!
    const headerHeight = node.headerHeight ?? 0
    return {
      left: position.x,
      top: position.y - headerHeight,
      right: position.x + node.width,
      bottom: position.y + node.height,
    }
  })
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  }
}

function nodeRect(node: CanvasAutoLayoutNode): LayoutRect {
  return {
    left: node.x,
    top: node.y - (node.headerHeight ?? 0),
    right: node.x + node.width,
    bottom: node.y + node.height,
  }
}

function rectsOverlap(left: LayoutRect, right: LayoutRect, gap: number): boolean {
  return !(
    left.right + gap <= right.left ||
    left.left >= right.right + gap ||
    left.bottom + gap <= right.top ||
    left.top >= right.bottom + gap
  )
}

function compareNodes(
  left: CanvasAutoLayoutNode,
  right: CanvasAutoLayoutNode,
  mode: CanvasAutoLayoutMode,
): number {
  if (mode === 'horizontal') {
    return left.x - right.x || left.y - right.y || left.id.localeCompare(right.id)
  }
  return left.y - right.y || left.x - right.x || left.id.localeCompare(right.id)
}
