/**
 * 视频裁剪框的几何计算。
 *
 * 预览区使用 0~1 的归一化坐标，导出前再按视频原始像素尺寸换算，
 * 这样视频在工作台里缩放、留黑边或窗口尺寸变化都不会影响最终裁剪区域。
 */

export interface VideoCropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface VideoCropPixels {
  x: number
  y: number
  w: number
  h: number
}

export type VideoCropHandle = 'nw' | 'ne' | 'sw' | 'se'

export const DEFAULT_VIDEO_CROP_RECT: VideoCropRect = {
  x: 0.1,
  y: 0.1,
  width: 0.8,
  height: 0.8,
}

const MIN_CROP_RATIO = 0.03

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/** 规范化矩形，保证它始终完整落在视频画面内。 */
export function normalizeVideoCropRect(
  rect: VideoCropRect,
  minSize = MIN_CROP_RATIO,
): VideoCropRect {
  const safeMin = clamp(Number.isFinite(minSize) ? minSize : MIN_CROP_RATIO, 0.001, 0.5)
  const width = clamp(Number.isFinite(rect.width) ? rect.width : safeMin, safeMin, 1)
  const height = clamp(Number.isFinite(rect.height) ? rect.height : safeMin, safeMin, 1)
  const x = clamp(Number.isFinite(rect.x) ? rect.x : 0, 0, 1 - width)
  const y = clamp(Number.isFinite(rect.y) ? rect.y : 0, 0, 1 - height)
  return {
    x: roundRatio(x),
    y: roundRatio(y),
    width: roundRatio(width),
    height: roundRatio(height),
  }
}

/** 根据拖拽起点和终点生成一个裁剪框。 */
export function cropRectFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
): VideoCropRect {
  return normalizeVideoCropRect({
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  })
}

/** 移动裁剪框，同时保持它的尺寸。 */
export function moveVideoCropRect(
  rect: VideoCropRect,
  delta: { x: number; y: number },
): VideoCropRect {
  const normalized = normalizeVideoCropRect(rect)
  return normalizeVideoCropRect({
    ...normalized,
    x: normalized.x + delta.x,
    y: normalized.y + delta.y,
  })
}

/** 从四个角之一调整裁剪框尺寸。 */
export function resizeVideoCropRect(
  rect: VideoCropRect,
  handle: VideoCropHandle,
  delta: { x: number; y: number },
): VideoCropRect {
  const normalized = normalizeVideoCropRect(rect)
  const minSize = MIN_CROP_RATIO
  let left = normalized.x
  let top = normalized.y
  let right = normalized.x + normalized.width
  let bottom = normalized.y + normalized.height

  if (handle.includes('w')) left = clamp(left + delta.x, 0, right - minSize)
  if (handle.includes('e')) right = clamp(right + delta.x, left + minSize, 1)
  if (handle.includes('n')) top = clamp(top + delta.y, 0, bottom - minSize)
  if (handle.includes('s')) bottom = clamp(bottom + delta.y, top + minSize, 1)

  return normalizeVideoCropRect({ x: left, y: top, width: right - left, height: bottom - top })
}

function evenAtMost(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2)
}

/** 判断像素裁剪矩形是否完整落在源视频内。 */
export function isVideoCropPixelsWithinBounds(
  crop: VideoCropPixels,
  videoWidth: number,
  videoHeight: number,
): boolean {
  return (
    Number.isFinite(videoWidth) &&
    Number.isFinite(videoHeight) &&
    videoWidth >= 2 &&
    videoHeight >= 2 &&
    Number.isFinite(crop.x) &&
    Number.isFinite(crop.y) &&
    Number.isFinite(crop.w) &&
    Number.isFinite(crop.h) &&
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.w >= 2 &&
    crop.h >= 2 &&
    crop.x + crop.w <= videoWidth &&
    crop.y + crop.h <= videoHeight
  )
}

/** 把归一化裁剪框换算为 FFmpeg crop filter 使用的像素参数。 */
export function videoCropRectToPixels(
  rect: VideoCropRect,
  videoWidth: number,
  videoHeight: number,
): VideoCropPixels {
  const width = Math.max(2, Math.floor(videoWidth))
  const height = Math.max(2, Math.floor(videoHeight))
  const normalized = normalizeVideoCropRect(rect, Math.min(2 / width, 2 / height))
  const maxX = Math.max(0, width - 2)
  const maxY = Math.max(0, height - 2)
  const x = Math.min(maxX, Math.max(0, Math.round(normalized.x * width)))
  const y = Math.min(maxY, Math.max(0, Math.round(normalized.y * height)))
  const w = Math.min(width - x, Math.max(2, Math.round(normalized.width * width)))
  const h = Math.min(height - y, Math.max(2, Math.round(normalized.height * height)))

  const pixels = {
    x: Math.min(x, width - w),
    y: Math.min(y, height - h),
    w: evenAtMost(w),
    h: evenAtMost(h),
  }
  return pixels
}
