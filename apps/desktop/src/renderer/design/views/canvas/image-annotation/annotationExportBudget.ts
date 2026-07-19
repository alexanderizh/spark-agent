export const ANNOTATION_EXPORT_WARN_PIXELS = 32 * 1024 * 1024
export const ANNOTATION_EXPORT_MAX_PIXELS = 64 * 1024 * 1024

export type AnnotationExportBudget = {
  pixels: number
  level: 'safe' | 'warning' | 'downscale'
  recommendedMultiplier: number
  outputWidth: number
  outputHeight: number
}

export function calculateAnnotationExportBudget(
  width: number,
  height: number,
): AnnotationExportBudget {
  const safeWidth = Math.max(1, Math.round(width))
  const safeHeight = Math.max(1, Math.round(height))
  const pixels = safeWidth * safeHeight
  const recommendedMultiplier =
    pixels > ANNOTATION_EXPORT_MAX_PIXELS
      ? Math.max(0.1, Math.min(1, Math.sqrt(ANNOTATION_EXPORT_MAX_PIXELS / pixels)))
      : 1
  return {
    pixels,
    level:
      pixels > ANNOTATION_EXPORT_MAX_PIXELS
        ? 'downscale'
        : pixels > ANNOTATION_EXPORT_WARN_PIXELS
          ? 'warning'
          : 'safe',
    recommendedMultiplier,
    outputWidth: Math.max(1, Math.round(safeWidth * recommendedMultiplier)),
    outputHeight: Math.max(1, Math.round(safeHeight * recommendedMultiplier)),
  }
}

export function formatAnnotationPixelCount(pixels: number): string {
  if (pixels >= 1_000_000) return `${(pixels / 1_000_000).toFixed(1)} MP`
  if (pixels >= 1_000) return `${Math.round(pixels / 1_000)} KP`
  return `${pixels} px`
}
