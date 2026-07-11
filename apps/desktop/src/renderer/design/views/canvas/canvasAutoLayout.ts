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

export type CanvasAutoLayoutLink = {
  sourceId: string
  targetId: string
}

type LayoutRect = {
  left: number
  top: number
  right: number
  bottom: number
}

type LayoutTree = {
  node: CanvasAutoLayoutNode
  depth: number
  children: LayoutTree[]
}

type TreeBlock = {
  width: number
  height: number
  positions: CanvasAutoLayoutPosition[]
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
    links?: readonly CanvasAutoLayoutLink[]
    obstacles?: readonly CanvasAutoLayoutNode[]
  },
): CanvasAutoLayoutPosition[] {
  if (nodes.length === 0) return []

  const gap = canvasAutoLayoutGap(options.spacing)
  const ordered = [...nodes].sort((left, right) => compareNodes(left, right, options.mode))
  const anchorLeft = Math.min(...ordered.map((node) => node.x))
  const anchorTop = Math.min(...ordered.map((node) => node.y - (node.headerHeight ?? 0)))
  const links = normalizeLayoutLinks(ordered, options.links ?? [])
  const positions =
    links.length > 0
      ? buildHierarchicalPositions(ordered, links, options.mode, gap, anchorLeft, anchorTop)
      : buildPositions(ordered, options.mode, gap, anchorLeft, anchorTop)
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

function normalizeLayoutLinks(
  nodes: readonly CanvasAutoLayoutNode[],
  links: readonly CanvasAutoLayoutLink[],
): CanvasAutoLayoutLink[] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const seen = new Set<string>()
  const normalized: CanvasAutoLayoutLink[] = []
  for (const link of links) {
    if (link.sourceId === link.targetId) continue
    if (!nodeIds.has(link.sourceId) || !nodeIds.has(link.targetId)) continue
    const key = `${link.sourceId}->${link.targetId}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(link)
  }
  return normalized
}

function buildHierarchicalPositions(
  nodes: readonly CanvasAutoLayoutNode[],
  links: readonly CanvasAutoLayoutLink[],
  mode: CanvasAutoLayoutMode,
  gap: number,
  anchorLeft: number,
  anchorTop: number,
): CanvasAutoLayoutPosition[] {
  const roots = buildLayoutForest(nodes, links, mode)
  if (roots.length === 0) return buildPositions(nodes, mode, gap, anchorLeft, anchorTop)

  if (mode === 'horizontal') {
    return arrangeHorizontalForest(roots, gap, anchorLeft, anchorTop)
  }

  const blocks = roots.map((root) => arrangeVerticalTree(root, gap, 0, 0))
  if (mode === 'grid') return arrangeTreeBlocksInGrid(blocks, gap, anchorLeft, anchorTop)

  let cursorTop = anchorTop
  const positions: CanvasAutoLayoutPosition[] = []
  for (const block of blocks) {
    positions.push(...translatePositions(block.positions, anchorLeft, cursorTop))
    cursorTop += block.height + gap
  }
  return positions
}

function buildLayoutForest(
  nodes: readonly CanvasAutoLayoutNode[],
  links: readonly CanvasAutoLayoutLink[],
  mode: CanvasAutoLayoutMode,
): LayoutTree[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const order = new Map(nodes.map((node, index) => [node.id, index]))
  const childrenById = new Map<string, CanvasAutoLayoutNode[]>()
  const incomingIds = new Set<string>()

  for (const link of links) {
    const source = nodeById.get(link.sourceId)
    const target = nodeById.get(link.targetId)
    if (!source || !target) continue
    incomingIds.add(target.id)
    const children = childrenById.get(source.id) ?? []
    children.push(target)
    childrenById.set(source.id, children)
  }

  for (const children of childrenById.values()) {
    children.sort((left, right) => compareNodes(left, right, mode))
  }

  const roots = nodes.filter((node) => !incomingIds.has(node.id))
  const rootCandidates = roots.length > 0 ? roots : nodes
  const assigned = new Set<string>()
  const forest: LayoutTree[] = []

  const buildTree = (
    node: CanvasAutoLayoutNode,
    depth: number,
    visiting: Set<string>,
  ): LayoutTree | null => {
    if (assigned.has(node.id) || visiting.has(node.id)) return null
    assigned.add(node.id)
    const nextVisiting = new Set(visiting)
    nextVisiting.add(node.id)
    const children = (childrenById.get(node.id) ?? [])
      .map((child) => buildTree(child, depth + 1, nextVisiting))
      .filter((child): child is LayoutTree => Boolean(child))
    return { node, depth, children }
  }

  for (const root of rootCandidates) {
    const tree = buildTree(root, 0, new Set())
    if (tree) forest.push(tree)
  }

  for (const node of nodes) {
    const tree = buildTree(node, 0, new Set())
    if (tree) forest.push(tree)
  }

  return forest.sort((left, right) => {
    const leftOrder = order.get(left.node.id) ?? 0
    const rightOrder = order.get(right.node.id) ?? 0
    return leftOrder - rightOrder
  })
}

function arrangeVerticalTree(
  tree: LayoutTree,
  gap: number,
  offsetX: number,
  offsetY: number,
): TreeBlock {
  const columnWidths = collectDepthSizes(tree, 'width')
  const columnOffsets = cumulativeOffsets(columnWidths, gap, 0)
  return layoutVerticalTree(tree, columnOffsets, gap, offsetX, offsetY)
}

function layoutVerticalTree(
  tree: LayoutTree,
  columnOffsets: readonly number[],
  gap: number,
  offsetX: number,
  offsetY: number,
): TreeBlock {
  const childBlocks = tree.children.map((child) =>
    layoutVerticalTree(child, columnOffsets, gap, offsetX, 0),
  )
  const ownHeight = nodeOuterHeight(tree.node)
  const childrenHeight = sumBlockSizes(childBlocks, 'height', gap)
  const blockHeight = Math.max(ownHeight, childrenHeight)
  const nodeTop = offsetY + (blockHeight - ownHeight) / 2
  const nodeLeft = offsetX + (columnOffsets[tree.depth] ?? 0)
  const positions: CanvasAutoLayoutPosition[] = [
    {
      id: tree.node.id,
      x: Math.round(nodeLeft),
      y: Math.round(nodeTop + (tree.node.headerHeight ?? 0)),
    },
  ]

  let childTop = offsetY + (blockHeight - childrenHeight) / 2
  for (const childBlock of childBlocks) {
    positions.push(...translatePositions(childBlock.positions, 0, childTop))
    childTop += childBlock.height + gap
  }

  const rect = boundsForPositions([tree.node, ...flattenTreeNodes(tree.children)], positions)
  return {
    width: rect.right - rect.left,
    height: blockHeight,
    positions,
  }
}

function arrangeHorizontalForest(
  roots: readonly LayoutTree[],
  gap: number,
  anchorLeft: number,
  anchorTop: number,
): CanvasAutoLayoutPosition[] {
  let cursorLeft = anchorLeft
  const positions: CanvasAutoLayoutPosition[] = []
  for (const root of roots) {
    const block = arrangeHorizontalTree(root, gap, 0, anchorTop)
    positions.push(...translatePositions(block.positions, cursorLeft, 0))
    cursorLeft += block.width + gap
  }
  return positions
}

function arrangeHorizontalTree(
  tree: LayoutTree,
  gap: number,
  offsetX: number,
  offsetY: number,
): TreeBlock {
  const rowHeights = collectDepthSizes(tree, 'height')
  const rowOffsets = cumulativeOffsets(rowHeights, gap, 0)
  return layoutHorizontalTree(tree, rowOffsets, gap, offsetX, offsetY)
}

function layoutHorizontalTree(
  tree: LayoutTree,
  rowOffsets: readonly number[],
  gap: number,
  offsetX: number,
  offsetY: number,
): TreeBlock {
  const childBlocks = tree.children.map((child) =>
    layoutHorizontalTree(child, rowOffsets, gap, 0, offsetY),
  )
  const ownWidth = tree.node.width
  const childrenWidth = sumBlockSizes(childBlocks, 'width', gap)
  const blockWidth = Math.max(ownWidth, childrenWidth)
  const nodeLeft = offsetX + (blockWidth - ownWidth) / 2
  const nodeTop = offsetY + (rowOffsets[tree.depth] ?? 0)
  const positions: CanvasAutoLayoutPosition[] = [
    {
      id: tree.node.id,
      x: Math.round(nodeLeft),
      y: Math.round(nodeTop + (tree.node.headerHeight ?? 0)),
    },
  ]

  let childLeft = offsetX + (blockWidth - childrenWidth) / 2
  for (const childBlock of childBlocks) {
    positions.push(...translatePositions(childBlock.positions, childLeft, 0))
    childLeft += childBlock.width + gap
  }

  const rect = boundsForPositions([tree.node, ...flattenTreeNodes(tree.children)], positions)
  return {
    width: blockWidth,
    height: rect.bottom - rect.top,
    positions,
  }
}

function arrangeTreeBlocksInGrid(
  blocks: readonly TreeBlock[],
  gap: number,
  anchorLeft: number,
  anchorTop: number,
): CanvasAutoLayoutPosition[] {
  const columnCount = Math.max(1, Math.ceil(Math.sqrt(blocks.length)))
  const rowCount = Math.ceil(blocks.length / columnCount)
  const columnWidths = Array.from({ length: columnCount }, () => 0)
  const rowHeights = Array.from({ length: rowCount }, () => 0)

  blocks.forEach((block, index) => {
    const column = index % columnCount
    const row = Math.floor(index / columnCount)
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, block.width)
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, block.height)
  })

  const columnOffsets = cumulativeOffsets(columnWidths, gap, anchorLeft)
  const rowOffsets = cumulativeOffsets(rowHeights, gap, anchorTop)
  return blocks.flatMap((block, index) =>
    translatePositions(
      block.positions,
      columnOffsets[index % columnCount] ?? anchorLeft,
      rowOffsets[Math.floor(index / columnCount)] ?? anchorTop,
    ),
  )
}

function collectDepthSizes(tree: LayoutTree, axis: 'height' | 'width'): number[] {
  const sizes: number[] = []
  const visit = (item: LayoutTree) => {
    const size = axis === 'height' ? nodeOuterHeight(item.node) : item.node.width
    sizes[item.depth] = Math.max(sizes[item.depth] ?? 0, size)
    item.children.forEach(visit)
  }
  visit(tree)
  return sizes
}

function nodeOuterHeight(node: CanvasAutoLayoutNode): number {
  return node.height + (node.headerHeight ?? 0)
}

function sumBlockSizes(
  blocks: readonly TreeBlock[],
  axis: 'height' | 'width',
  gap: number,
): number {
  if (blocks.length === 0) return 0
  return blocks.reduce((total, block) => total + block[axis], 0) + gap * (blocks.length - 1)
}

function flattenTreeNodes(trees: readonly LayoutTree[]): CanvasAutoLayoutNode[] {
  return trees.flatMap((tree) => [tree.node, ...flattenTreeNodes(tree.children)])
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
