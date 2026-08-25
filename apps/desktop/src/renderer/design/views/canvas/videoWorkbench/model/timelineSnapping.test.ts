import { describe, expect, it } from 'vitest'
import { createDefaultVideoWorkbenchProject } from './projectTypes'
import {
  collectVideoWorkbenchSnapCandidates,
  snapVideoWorkbenchClipMove,
  snapVideoWorkbenchTime,
} from './timelineSnapping'

describe('video workbench timeline snapping', () => {
  it('collects origin, playhead, markers, and clip boundaries while excluding moving clips', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.manualMarks = [2]
    project.tracks[0]!.clips = [
      {
        id: 'moving',
        timelineStartSec: 1,
        sourceInSec: 0,
        sourceOutSec: 3,
        durationSec: 3,
        speed: 1,
        enabled: true,
      },
      {
        id: 'anchor',
        timelineStartSec: 6,
        sourceInSec: 0,
        sourceOutSec: 2,
        durationSec: 2,
        speed: 1,
        enabled: true,
      },
    ]
    const candidates = collectVideoWorkbenchSnapCandidates(project, {
      playheadSec: 4,
      excludedClipIds: new Set(['moving']),
    })
    expect(candidates).toEqual(
      expect.arrayContaining([
        { timeSec: 0, kind: 'origin' },
        { timeSec: 2, kind: 'marker' },
        { timeSec: 4, kind: 'playhead' },
        { timeSec: 6, kind: 'clip-start', clipId: 'anchor' },
        { timeSec: 8, kind: 'clip-end', clipId: 'anchor' },
      ]),
    )
    expect(candidates.some((candidate) => candidate.clipId === 'moving')).toBe(false)
  })

  it('converts the pixel threshold to seconds at the current zoom', () => {
    const result = snapVideoWorkbenchTime(4.12, [{ timeSec: 4, kind: 'playhead' }], 50, 8)
    expect(result).toEqual({
      snapped: true,
      timeSec: 4,
      deltaSec: expect.closeTo(-0.12),
      candidate: { timeSec: 4, kind: 'playhead' },
    })
    expect(snapVideoWorkbenchTime(4.2, [{ timeSec: 4, kind: 'playhead' }], 50, 8).snapped).toBe(
      false,
    )
  })

  it('snaps the nearest clip edge and returns the adjusted clip start', () => {
    const result = snapVideoWorkbenchClipMove(
      5.9,
      2,
      [
        { timeSec: 6, kind: 'clip-end', clipId: 'left' },
        { timeSec: 8, kind: 'marker' },
      ],
      100,
      12,
    )
    expect(result.snapped).toBe(true)
    expect(result.timeSec).toBe(6)
    expect(result.alignedEdge).toBe('start')
  })
})
