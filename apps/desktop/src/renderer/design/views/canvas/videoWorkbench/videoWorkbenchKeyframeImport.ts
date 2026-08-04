import type { WorkbenchKeyframe } from './videoWorkbench.types'

const KEYFRAME_CANVAS_WIDTH = 320
const KEYFRAME_CANVAS_FALLBACK_HEIGHT = 180

export function selectKeyframesForImport(
  frames: WorkbenchKeyframe[],
  selectedIndexes: ReadonlySet<number>,
): WorkbenchKeyframe[] {
  return frames.filter((frame) => selectedIndexes.has(frame.index) && !frame.canvasNodeId)
}

export function selectKeyframesForRemoval(
  frames: WorkbenchKeyframe[],
  selectedIndexes: ReadonlySet<number>,
): WorkbenchKeyframe[] {
  return frames.filter((frame) => selectedIndexes.has(frame.index))
}

export function getKeyframeImportTitle(order: number): string {
  return `关键帧 ${String(order + 1).padStart(2, '0')}`
}

/** 固定缩略图宽度，同时按关键帧像素尺寸计算画布节点高度。 */
export function getKeyframeCanvasNodeSize(
  imageWidth: number,
  imageHeight: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return { width: KEYFRAME_CANVAS_WIDTH, height: KEYFRAME_CANVAS_FALLBACK_HEIGHT }
  }

  return {
    width: KEYFRAME_CANVAS_WIDTH,
    height: Math.max(1, Math.round((KEYFRAME_CANVAS_WIDTH * imageHeight) / imageWidth)),
  }
}

export function getKeyframeCanvasGridPosition(
  order: number,
  origin: { x: number; y: number },
  nodeSize: { width: number; height: number },
  columns = 4,
  gap = 24,
): { x: number; y: number } {
  const column = order % columns
  const row = Math.floor(order / columns)
  return {
    x: origin.x + column * (nodeSize.width + gap),
    y: origin.y + row * (nodeSize.height + gap),
  }
}
