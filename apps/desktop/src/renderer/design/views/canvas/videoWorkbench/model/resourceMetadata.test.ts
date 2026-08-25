import { describe, expect, it } from 'vitest'
import { createDefaultVideoWorkbenchProject } from './projectTypes'
import { backfillVideoWorkbenchProjectResourceMetadata } from './resourceMetadata'

describe('video workbench resource metadata backfill', () => {
  it('expands untouched audio placeholders when the real duration becomes available', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [
      {
        id: 'audio:1',
        source: 'local',
        kind: 'audio',
        title: 'Audio',
        url: 'safe-file:///audio.wav',
        originPath: '/audio.wav',
        importedAt: 1,
      },
    ]
    const audioTrack = {
      ...project.tracks[0]!,
      id: 'track:audio',
      kind: 'audio' as const,
      clips: [
        {
          id: 'clip:1',
          resourceId: 'audio:1',
          timelineStartSec: 3,
          sourceInSec: 0,
          sourceOutSec: 8,
          durationSec: 8,
          speed: 1,
          enabled: true,
        },
      ],
    }
    project.tracks.push(audioTrack)

    const next = backfillVideoWorkbenchProjectResourceMetadata(
      project,
      new Map([['audio:1', { durationSec: 42 }]]),
    )
    expect(next.resources[0]!.durationSec).toBe(42)
    expect(next.tracks[1]!.clips[0]).toEqual(
      expect.objectContaining({ timelineStartSec: 3, sourceOutSec: 42, durationSec: 42 }),
    )
  })

  it.each([0, 0.1, 8])(
    'repairs zero-duration resources and their untouched %s-second placeholder clips',
    (placeholderDurationSec) => {
      const project = createDefaultVideoWorkbenchProject()
      project.resources = [
        {
          id: 'video:zero',
          source: 'canvas',
          kind: 'video',
          title: 'Video',
          url: 'safe-file:///video.mp4',
          originPath: '/video.mp4',
          importedAt: 1,
          durationSec: 0,
        },
      ]
      project.tracks[0]!.clips = [
        {
          id: 'clip:zero',
          resourceId: 'video:zero',
          timelineStartSec: 0,
          sourceInSec: 0,
          sourceOutSec: placeholderDurationSec,
          durationSec: placeholderDurationSec,
          speed: 1,
          enabled: true,
        },
      ]

      const next = backfillVideoWorkbenchProjectResourceMetadata(
        project,
        new Map([['video:zero', { durationSec: 24 }]]),
      )

      expect(next.resources[0]!.durationSec).toBe(24)
      expect(next.tracks[0]!.clips[0]).toEqual(
        expect.objectContaining({ sourceOutSec: 24, durationSec: 24 }),
      )
    },
  )

  it('keeps consecutive main-track placeholders adjacent after both durations are discovered', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [
      {
        id: 'video:first',
        source: 'canvas',
        kind: 'video',
        title: 'First',
        url: 'safe-file:///first.mp4',
        originPath: '/first.mp4',
        importedAt: 1,
        durationSec: 0,
      },
      {
        id: 'video:second',
        source: 'canvas',
        kind: 'video',
        title: 'Second',
        url: 'safe-file:///second.mp4',
        originPath: '/second.mp4',
        importedAt: 2,
        durationSec: 0,
      },
    ]
    project.tracks[0]!.clips = [
      {
        id: 'clip:first',
        resourceId: 'video:first',
        timelineStartSec: 0,
        sourceInSec: 0,
        sourceOutSec: 8,
        durationSec: 8,
        speed: 1,
        enabled: true,
      },
      {
        id: 'clip:second',
        resourceId: 'video:second',
        timelineStartSec: 8,
        sourceInSec: 0,
        sourceOutSec: 8,
        durationSec: 8,
        speed: 1,
        enabled: true,
      },
    ]

    const next = backfillVideoWorkbenchProjectResourceMetadata(
      project,
      new Map([
        ['video:first', { durationSec: 24 }],
        ['video:second', { durationSec: 3 }],
      ]),
    )

    expect(next.tracks[0]!.clips).toEqual([
      expect.objectContaining({ id: 'clip:first', timelineStartSec: 0, durationSec: 24 }),
      expect.objectContaining({ id: 'clip:second', timelineStartSec: 24, durationSec: 3 }),
    ])
  })

  it('does not overwrite a clip that the user already trimmed', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [
      {
        id: 'video:1',
        source: 'local',
        kind: 'video',
        title: 'Video',
        url: 'safe-file:///video.mp4',
        originPath: '/video.mp4',
        importedAt: 1,
      },
    ]
    project.tracks[0]!.clips = [
      {
        id: 'clip:1',
        resourceId: 'video:1',
        timelineStartSec: 0,
        sourceInSec: 1,
        sourceOutSec: 6,
        durationSec: 5,
        speed: 1,
        enabled: true,
      },
    ]
    const next = backfillVideoWorkbenchProjectResourceMetadata(
      project,
      new Map([['video:1', { durationSec: 30 }]]),
    )
    expect(next.resources[0]!.durationSec).toBe(30)
    expect(next.tracks[0]!.clips[0]).toBe(project.tracks[0]!.clips[0])
  })
})
