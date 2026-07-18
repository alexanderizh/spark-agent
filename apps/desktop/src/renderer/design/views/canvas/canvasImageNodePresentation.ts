import type { CanvasNode } from './canvas.types'

export type CanvasImageSourceDimensions = {
  width?: number | null
  height?: number | null
}

export function isFullBleedCanvasImageNode(node: CanvasNode): boolean {
  return node.type === 'image' && Boolean(node.data.url?.trim())
}

export function resolveCanvasImageNodePresentationSize(
  node: CanvasNode,
  sourceDimensions?: CanvasImageSourceDimensions,
): { width: number; height: number } | null {
  if (!isFullBleedCanvasImageNode(node)) return null

  const sourceWidth = sourceDimensions?.width
  const sourceHeight = sourceDimensions?.height
  if (!sourceWidth || !sourceHeight || sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: node.width, height: node.height }
  }

  return {
    width: node.width,
    height: Math.max(1, Math.round((node.width * sourceHeight) / sourceWidth)),
  }
}
