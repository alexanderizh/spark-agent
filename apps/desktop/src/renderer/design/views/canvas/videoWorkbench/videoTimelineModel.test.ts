import { describe, expect, it } from 'vitest'
import {
  MIN_TIMELINE_RANGE_SEC,
  moveTimelineRangeEdge,
  normalizeTimelineRange,
  splitTimelineRange,
} from './videoTimelineModel'

describe('videoTimelineModel', () => {
  it('initializes an empty selection to the full source duration', () => {
    expect(normalizeTimelineRange({ startSec: 0, endSec: 0 }, 12)).toEqual({
      startSec: 0,
      endSec: 12,
    })
  })

  it('keeps trim handles inside the source and prevents them from crossing', () => {
    const range = { startSec: 2, endSec: 8 }
    expect(moveTimelineRangeEdge(range, 'start', 9, 10)).toEqual({
      startSec: 8 - MIN_TIMELINE_RANGE_SEC,
      endSec: 8,
    })
    expect(moveTimelineRangeEdge(range, 'end', -1, 10)).toEqual({
      startSec: 2,
      endSec: 2 + MIN_TIMELINE_RANGE_SEC,
    })
  })

  it('splits only when the playhead is safely inside the selected clip', () => {
    expect(splitTimelineRange({ startSec: 2, endSec: 8 }, 5, 10)).toEqual([
      { startSec: 2, endSec: 5 },
      { startSec: 5, endSec: 8 },
    ])
    expect(splitTimelineRange({ startSec: 2, endSec: 8 }, 2, 10)).toBeNull()
    expect(splitTimelineRange({ startSec: 2, endSec: 8 }, 8, 10)).toBeNull()
  })

  it('rejects non-finite pointer and playback values', () => {
    const range = { startSec: 2, endSec: 8 }
    expect(moveTimelineRangeEdge(range, 'start', Number.NaN, 10)).toEqual(range)
    expect(splitTimelineRange(range, Number.NaN, 10)).toBeNull()
  })
})
