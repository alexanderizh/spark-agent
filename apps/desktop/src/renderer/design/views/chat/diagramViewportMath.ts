export const DIAGRAM_MIN_ZOOM = 0.5
export const DIAGRAM_MAX_ZOOM = 3
export const DIAGRAM_ZOOM_STEP = 0.1

const roundZoom = (zoom: number): number => Math.round(zoom * 100) / 100

export function clampDiagramZoom(zoom: number): number {
  return roundZoom(Math.min(DIAGRAM_MAX_ZOOM, Math.max(DIAGRAM_MIN_ZOOM, zoom)))
}

export function stepDiagramZoom(currentZoom: number, direction: -1 | 1): number {
  return clampDiagramZoom(currentZoom + direction * DIAGRAM_ZOOM_STEP)
}

export function getDiagramWheelZoom(currentZoom: number, deltaY: number): number {
  if (deltaY === 0) return clampDiagramZoom(currentZoom)
  return stepDiagramZoom(currentZoom, deltaY < 0 ? 1 : -1)
}

export function getDiagramFitZoom({
  viewportWidth,
  viewportHeight,
  contentWidth,
  contentHeight,
  padding,
}: {
  viewportWidth: number
  viewportHeight: number
  contentWidth: number
  contentHeight: number
  padding: number
}): number {
  if (viewportWidth <= 0 || viewportHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) {
    return 1
  }
  const availableWidth = Math.max(1, viewportWidth - padding * 2)
  const availableHeight = Math.max(1, viewportHeight - padding * 2)
  return clampDiagramZoom(
    Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight),
  )
}

export function getZoomedScrollPosition({
  currentZoom,
  nextZoom,
  pointerX,
  pointerY,
  scrollLeft,
  scrollTop,
}: {
  currentZoom: number
  nextZoom: number
  pointerX: number
  pointerY: number
  scrollLeft: number
  scrollTop: number
}): { scrollLeft: number; scrollTop: number } {
  const safeCurrentZoom = currentZoom > 0 ? currentZoom : 1
  const contentX = (scrollLeft + pointerX) / safeCurrentZoom
  const contentY = (scrollTop + pointerY) / safeCurrentZoom
  return {
    scrollLeft: Math.max(0, contentX * nextZoom - pointerX),
    scrollTop: Math.max(0, contentY * nextZoom - pointerY),
  }
}

export function parseDiagramViewBox(
  viewBox: string | null,
): { width: number; height: number } | null {
  if (!viewBox) return null
  const values = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null
  const width = values[2]
  const height = values[3]
  if (width == null || height == null || width <= 0 || height <= 0) return null
  return { width, height }
}

export function getPaddedDiagramBounds(
  rect: { x1: number; y1: number; x2: number; y2: number },
  padding: number,
): { x: number; y: number; width: number; height: number } {
  const safePadding = Math.max(0, padding)
  return {
    x: rect.x1 - safePadding,
    y: rect.y1 - safePadding,
    width: Math.max(1, rect.x2 - rect.x1 + safePadding * 2),
    height: Math.max(1, rect.y2 - rect.y1 + safePadding * 2),
  }
}
