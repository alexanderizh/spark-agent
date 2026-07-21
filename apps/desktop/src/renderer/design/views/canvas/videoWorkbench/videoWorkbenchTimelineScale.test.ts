import { describe, expect, it } from 'vitest'
import {
  buildTimelineTicks,
  timelineClientXToSecond,
  timelineClipWidth,
} from './videoWorkbenchTimelineScale'

describe('video workbench timeline scale', () => {
  it('keeps clip widths strictly proportional to duration', () => {
    expect(timelineClipWidth(2, 40)).toBe(80)
    expect(timelineClipWidth(8, 40)).toBe(320)
  })

  it('maps the shared playhead coordinate into timeline seconds', () => {
    expect(timelineClientXToSecond(260, 100, 40, 10)).toBe(4)
    expect(timelineClientXToSecond(900, 100, 40, 10)).toBe(10)
  })

  it('adapts ruler density to zoom while retaining major ticks', () => {
    const zoomedOut = buildTimelineTicks(60, 10)
    const zoomedIn = buildTimelineTicks(60, 80)
    expect(zoomedIn.length).toBeGreaterThan(zoomedOut.length)
    expect(zoomedIn.some((tick) => tick.major)).toBe(true)
  })

  it('covers the full duration of long timelines without exceeding the tick budget', () => {
    const ticks = buildTimelineTicks(36_000, 160)
    expect(ticks.length).toBeLessThanOrEqual(1001)
    expect(ticks.at(-1)?.second).toBe(36_000)
  })
})
