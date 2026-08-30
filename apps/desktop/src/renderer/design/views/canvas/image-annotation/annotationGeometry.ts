import type { CanvasImageAnnotationPadding } from '../canvas.types'

export const EMPTY_ANNOTATION_PADDING: CanvasImageAnnotationPadding = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

export const DEFAULT_ANNOTATION_PADDING: CanvasImageAnnotationPadding = {
  top: 64,
  right: 64,
  bottom: 64,
  left: 64,
}

const MAX_PADDING = 4096

export function clampAnnotationPaddingValue(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_PADDING, Math.round(value)))
}

export function normalizeAnnotationPadding(
  padding: Partial<CanvasImageAnnotationPadding> | null | undefined,
): CanvasImageAnnotationPadding {
  return {
    top: clampAnnotationPaddingValue(padding?.top ?? 0),
    right: clampAnnotationPaddingValue(padding?.right ?? 0),
    bottom: clampAnnotationPaddingValue(padding?.bottom ?? 0),
    left: clampAnnotationPaddingValue(padding?.left ?? 0),
  }
}

export function annotationArtboardSize(
  contentWidth: number,
  contentHeight: number,
  padding: CanvasImageAnnotationPadding,
): { width: number; height: number } {
  const safePadding = normalizeAnnotationPadding(padding)
  return {
    width: Math.max(1, Math.round(contentWidth) + safePadding.left + safePadding.right),
    height: Math.max(1, Math.round(contentHeight) + safePadding.top + safePadding.bottom),
  }
}

export function annotationPaddingTranslation(
  previous: CanvasImageAnnotationPadding,
  next: CanvasImageAnnotationPadding,
): { x: number; y: number } {
  return {
    x: next.left - previous.left,
    y: next.top - previous.top,
  }
}

export function setLinkedAnnotationPadding(value: number): CanvasImageAnnotationPadding {
  const safeValue = clampAnnotationPaddingValue(value)
  return { top: safeValue, right: safeValue, bottom: safeValue, left: safeValue }
}
