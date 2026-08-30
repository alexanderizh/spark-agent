export interface TimelineRange {
  startSec: number
  endSec: number
}

export type TimelineRangeEdge = 'start' | 'end'

/** 防止拖拽手柄交叉，也避免生成接近零时长的无效片段。 */
export const MIN_TIMELINE_RANGE_SEC = 0.1

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function normalizeTimelineRange(range: TimelineRange, duration: number): TimelineRange {
  if (!Number.isFinite(duration) || duration <= 0) return { startSec: 0, endSec: 0 }

  const minRange = Math.min(MIN_TIMELINE_RANGE_SEC, duration)
  const rawStart = Number.isFinite(range.startSec) ? range.startSec : 0
  const rawEnd = Number.isFinite(range.endSec) && range.endSec > 0 ? range.endSec : duration
  const startSec = clamp(rawStart, 0, Math.max(0, duration - minRange))
  const endSec = clamp(rawEnd, startSec + minRange, duration)

  return { startSec, endSec }
}

export function moveTimelineRangeEdge(
  range: TimelineRange,
  edge: TimelineRangeEdge,
  nextTime: number,
  duration: number,
): TimelineRange {
  const normalized = normalizeTimelineRange(range, duration)
  const minRange = Math.min(MIN_TIMELINE_RANGE_SEC, duration)
  if (!Number.isFinite(nextTime)) return normalized

  if (edge === 'start') {
    return {
      ...normalized,
      startSec: clamp(nextTime, 0, normalized.endSec - minRange),
    }
  }

  return {
    ...normalized,
    endSec: clamp(nextTime, normalized.startSec + minRange, duration),
  }
}

export function splitTimelineRange(
  range: TimelineRange,
  splitAtSec: number,
  duration: number,
): [TimelineRange, TimelineRange] | null {
  if (!Number.isFinite(splitAtSec)) return null
  const normalized = normalizeTimelineRange(range, duration)
  const minRange = Math.min(MIN_TIMELINE_RANGE_SEC, duration)
  if (splitAtSec < normalized.startSec + minRange || splitAtSec > normalized.endSec - minRange) {
    return null
  }

  return [
    { startSec: normalized.startSec, endSec: splitAtSec },
    { startSec: splitAtSec, endSec: normalized.endSec },
  ]
}
