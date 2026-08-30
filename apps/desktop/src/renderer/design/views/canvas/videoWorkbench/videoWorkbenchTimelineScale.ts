export type TimelineTick = { second: number; leftPx: number; major: boolean }

export function timelineClipWidth(durationSec: number, pixelsPerSecond: number): number {
  return Math.max(1, durationSec * pixelsPerSecond)
}

export function timelineClientXToSecond(
  clientX: number,
  contentLeft: number,
  pixelsPerSecond: number,
  totalDurationSec: number,
): number {
  if (pixelsPerSecond <= 0 || totalDurationSec <= 0) return 0
  return Math.max(0, Math.min(totalDurationSec, (clientX - contentLeft) / pixelsPerSecond))
}

export function buildTimelineTicks(
  totalDurationSec: number,
  pixelsPerSecond: number,
): TimelineTick[] {
  if (totalDurationSec <= 0 || pixelsPerSecond <= 0) return []
  const candidates = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
  const minStepForCount = totalDurationSec / 1000
  const minorStep =
    candidates.find((step) => step * pixelsPerSecond >= 10 && step >= minStepForCount) ??
    Math.max(300, minStepForCount)
  const majorEvery = Math.max(1, Math.ceil(72 / (minorStep * pixelsPerSecond)))
  const count = Math.ceil(totalDurationSec / minorStep)
  return Array.from({ length: count + 1 }, (_, index) => ({
    second: Math.min(totalDurationSec, index * minorStep),
    leftPx: Math.min(totalDurationSec, index * minorStep) * pixelsPerSecond,
    major: index % majorEvery === 0,
  }))
}
