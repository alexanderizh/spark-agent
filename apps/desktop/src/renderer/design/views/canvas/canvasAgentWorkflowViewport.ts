export type CanvasAgentLiveViewport = {
  x: number
  y: number
  zoom: number
  width: number
  height: number
}

export type CanvasAgentWorkflowRect = {
  x: number
  y: number
  width: number
  height: number
}

export type CanvasAgentWorkflowPlacement = {
  originX: number
  originY: number
  placement: 'viewport' | 'canvas_outside'
}

type CanvasBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

const VIEWPORT_MARGIN = 48
const OBSTACLE_GAP = 24
const CANDIDATE_STEP = 64

export function resolveCanvasViewportBounds(
  viewport: CanvasAgentLiveViewport,
): CanvasBounds | null {
  if (
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Number.isFinite(viewport.zoom) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.zoom <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null
  }
  return {
    left: -viewport.x / viewport.zoom,
    top: -viewport.y / viewport.zoom,
    right: (viewport.width - viewport.x) / viewport.zoom,
    bottom: (viewport.height - viewport.y) / viewport.zoom,
  }
}

function boundsForRects(rects: readonly CanvasAgentWorkflowRect[]): CanvasBounds | null {
  if (rects.length === 0) return null
  return {
    left: Math.min(...rects.map((rect) => rect.x)),
    top: Math.min(...rects.map((rect) => rect.y)),
    right: Math.max(...rects.map((rect) => rect.x + rect.width)),
    bottom: Math.max(...rects.map((rect) => rect.y + rect.height)),
  }
}

function overlapsWithGap(left: CanvasAgentWorkflowRect, right: CanvasAgentWorkflowRect): boolean {
  return !(
    left.x + left.width + OBSTACLE_GAP <= right.x ||
    right.x + right.width + OBSTACLE_GAP <= left.x ||
    left.y + left.height + OBSTACLE_GAP <= right.y ||
    right.y + right.height + OBSTACLE_GAP <= left.y
  )
}

function candidateAxis(min: number, max: number, preferred: number): number[] {
  if (max < min) return []
  const values = new Set<number>([Math.round(min), Math.round(max), Math.round(preferred)])
  for (let value = min; value <= max; value += CANDIDATE_STEP) values.add(Math.round(value))
  return [...values].filter((value) => value >= min && value <= max)
}

export function chooseCanvasWorkflowPlacement(input: {
  viewport: CanvasAgentLiveViewport | null | undefined
  workflowNodes: readonly CanvasAgentWorkflowRect[]
  obstacles: readonly CanvasAgentWorkflowRect[]
  fallbackOrigin: { x: number; y: number }
}): CanvasAgentWorkflowPlacement {
  const viewportBounds = input.viewport ? resolveCanvasViewportBounds(input.viewport) : null
  const workflowBounds = boundsForRects(input.workflowNodes)
  const fallback = {
    originX: input.fallbackOrigin.x,
    originY: input.fallbackOrigin.y,
    placement: 'canvas_outside' as const,
  }
  if (!viewportBounds || !workflowBounds) return fallback

  const minOriginX = viewportBounds.left + VIEWPORT_MARGIN - workflowBounds.left
  const maxOriginX = viewportBounds.right - VIEWPORT_MARGIN - workflowBounds.right
  const minOriginY = viewportBounds.top + VIEWPORT_MARGIN - workflowBounds.top
  const maxOriginY = viewportBounds.bottom - VIEWPORT_MARGIN - workflowBounds.bottom
  if (maxOriginX < minOriginX || maxOriginY < minOriginY) return fallback

  const preferredOriginX =
    (viewportBounds.left + viewportBounds.right - workflowBounds.left - workflowBounds.right) / 2
  const preferredOriginY =
    (viewportBounds.top + viewportBounds.bottom - workflowBounds.top - workflowBounds.bottom) / 2
  const candidates = candidateAxis(minOriginX, maxOriginX, preferredOriginX).flatMap((x) =>
    candidateAxis(minOriginY, maxOriginY, preferredOriginY).map((y) => ({ x, y })),
  )
  candidates.sort(
    (left, right) =>
      Math.hypot(left.x - preferredOriginX, left.y - preferredOriginY) -
        Math.hypot(right.x - preferredOriginX, right.y - preferredOriginY) ||
      left.y - right.y ||
      left.x - right.x,
  )

  for (const candidate of candidates) {
    const translated = input.workflowNodes.map((node) => ({
      ...node,
      x: node.x + candidate.x,
      y: node.y + candidate.y,
    }))
    if (
      translated.every((node) =>
        input.obstacles.every((obstacle) => !overlapsWithGap(node, obstacle)),
      )
    ) {
      return { originX: candidate.x, originY: candidate.y, placement: 'viewport' }
    }
  }
  return fallback
}

export function areCanvasNodesFullyVisible(
  nodes: readonly CanvasAgentWorkflowRect[],
  viewport: CanvasAgentLiveViewport | null | undefined,
): boolean {
  if (nodes.length === 0 || !viewport) return false
  const bounds = resolveCanvasViewportBounds(viewport)
  if (!bounds) return false
  return nodes.every(
    (node) =>
      node.x >= bounds.left + OBSTACLE_GAP &&
      node.y >= bounds.top + OBSTACLE_GAP &&
      node.x + node.width <= bounds.right - OBSTACLE_GAP &&
      node.y + node.height <= bounds.bottom - OBSTACLE_GAP,
  )
}
