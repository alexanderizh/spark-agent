import type { CanvasNode } from './canvas.types'

export type CanvasVideoSourceDimensions = {
  width?: number | null
  height?: number | null
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function parseRatioValue(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  const ratioMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  const dimensionMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i)
  const match = ratioMatch ?? dimensionMatch
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? width / height : null
}

export function readCanvasVideoAspectRatio(
  modelParams?: Record<string, unknown> | null,
): number | null {
  if (!modelParams) return null
  for (const key of ['aspectRatio', 'aspect_ratio', 'ratio', 'size']) {
    const ratio = parseRatioValue(modelParams[key])
    if (ratio) return ratio
  }
  return null
}

export function resolveCanvasVideoAspectRatio(
  dimensions?: CanvasVideoSourceDimensions,
  modelParams?: Record<string, unknown> | null,
): number {
  const width = positiveNumber(dimensions?.width)
  const height = positiveNumber(dimensions?.height)
  return width && height ? width / height : (readCanvasVideoAspectRatio(modelParams) ?? 16 / 9)
}

/** 已加载视频始终以当前节点宽度为基准恢复真实比例，旧节点也能自动自愈。 */
export function resolveCanvasVideoNodePresentationSize(
  node: CanvasNode,
  sourceDimensions?: CanvasVideoSourceDimensions,
): { width: number; height: number } | null {
  if (node.type !== 'video' || !node.data.url?.trim()) return null
  const nodeWidth = positiveNumber(node.data.mediaWidth)
  const nodeHeight = positiveNumber(node.data.mediaHeight)
  const sourceWidth = positiveNumber(sourceDimensions?.width)
  const sourceHeight = positiveNumber(sourceDimensions?.height)
  const [width, height] =
    nodeWidth && nodeHeight ? [nodeWidth, nodeHeight] : [sourceWidth, sourceHeight]
  if (!width || !height) return { width: node.width, height: node.height }
  return {
    width: node.width,
    height: Math.max(1, Math.round((node.width * height) / width)),
  }
}
