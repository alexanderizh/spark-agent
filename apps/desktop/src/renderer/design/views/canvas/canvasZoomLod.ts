export type CanvasZoomLod = 'overview' | 'compact' | 'detail'

export function resolveCanvasZoomLod(zoom: number): CanvasZoomLod {
  if (!Number.isFinite(zoom) || zoom < 0.45) return 'overview'
  if (zoom < 0.8) return 'compact'
  return 'detail'
}
