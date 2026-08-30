import { describe, expect, it } from 'vitest'
import { readVideoWorkbenchProject } from './projectParser'
import { createDefaultVideoWorkbenchProject } from './projectTypes'

describe('video workbench V2 project parser and migration', () => {
  it('creates a versioned project for an empty payload', () => {
    const result = readVideoWorkbenchProject(undefined)
    expect(result.source).toBe('empty')
    expect(result.project).toEqual(createDefaultVideoWorkbenchProject())
  })

  it('migrates V1 clips in order and preserves legacy metadata', () => {
    const result = readVideoWorkbenchProject({
      sourceVideoAssetId: 'asset-1',
      resourcePanel: [
        {
          id: 'video',
          source: 'local',
          kind: 'video',
          title: 'Video',
          url: 'safe-file:///video.mp4',
          originPath: '/video.mp4',
          durationSec: 12,
          importedAt: 1,
        },
        {
          id: 'image',
          source: 'canvas',
          kind: 'image',
          title: 'Image',
          url: 'safe-file:///image.png',
          originPath: '/image.png',
          importedAt: 2,
        },
      ],
      track: [
        { id: 'image-clip', resourceId: 'image', order: 1, staticDuration: 3 },
        { id: 'video-clip', resourceId: 'video', order: 0, range: { startSec: 2, endSec: 7 } },
      ],
      manualMarks: [1, 4],
      activeTab: 'frames',
      autoCollectUpstream: false,
    })

    expect(result.source).toBe('v1')
    expect(result.project?.schemaVersion).toBe(2)
    expect(result.project?.sourceVideoAssetId).toBe('asset-1')
    expect(result.project?.manualMarks).toEqual([1, 4])
    expect(result.project?.ui.activeTab).toBe('frames')
    expect(result.project?.autoCollectUpstream).toBe(false)
    expect(result.project?.tracks[0]?.clips).toEqual([
      expect.objectContaining({
        id: 'video-clip',
        timelineStartSec: 0,
        sourceInSec: 2,
        sourceOutSec: 7,
        durationSec: 5,
      }),
      expect.objectContaining({
        id: 'image-clip',
        timelineStartSec: 5,
        durationSec: 3,
      }),
    ])
  })

  it('preserves dangling clip references so they can be relinked', () => {
    const result = readVideoWorkbenchProject({
      resourcePanel: [],
      track: [{ id: 'dangling', resourceId: 'missing', order: 0 }],
    })
    expect(result.project?.tracks[0]?.clips[0]).toEqual(
      expect.objectContaining({ id: 'dangling', resourceId: 'missing', durationSec: 0 }),
    )
    expect(result.issues).toContain('track clip dangling references missing resource missing')
  })

  it('migrates a V1 video with zero duration to a visible placeholder until metadata loads', () => {
    const result = readVideoWorkbenchProject({
      resourcePanel: [
        {
          id: 'video',
          source: 'canvas',
          kind: 'video',
          title: 'Video',
          url: 'safe-file:///video.mp4',
          originPath: '/video.mp4',
          durationSec: 0,
          importedAt: 1,
        },
      ],
      track: [{ id: 'clip', resourceId: 'video', order: 0 }],
    })

    expect(result.project?.tracks[0]?.clips[0]).toEqual(
      expect.objectContaining({ sourceOutSec: 8, durationSec: 8 }),
    )
  })

  it('round-trips a valid V2 project including audio and clip settings', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [
      {
        id: 'audio',
        source: 'local',
        kind: 'audio',
        title: 'Music',
        url: 'safe-file:///music.wav',
        originPath: '/music.wav',
        durationSec: 30,
        importedAt: 10,
      },
    ]
    project.tracks = [
      {
        id: 'track:audio',
        kind: 'audio',
        name: '背景音乐',
        order: 0,
        locked: false,
        muted: false,
        solo: false,
        visible: true,
        collapsed: false,
        clips: [
          {
            id: 'clip:audio',
            resourceId: 'audio',
            timelineStartSec: 2,
            sourceInSec: 5,
            sourceOutSec: 15,
            durationSec: 5,
            speed: 2,
            enabled: true,
            audio: { gainDb: -12, muted: false, balance: 0, preservePitch: true },
          },
        ],
      },
    ]

    const result = readVideoWorkbenchProject(project)
    expect(result).toEqual({ source: 'v2', project, issues: [] })
  })

  it('filters malformed nested entries but keeps valid project data', () => {
    const project = createDefaultVideoWorkbenchProject() as unknown as Record<string, unknown>
    project.resources = [
      {
        id: 'good',
        source: 'local',
        kind: 'audio',
        title: 'Good',
        url: 'u',
        originPath: '/a.wav',
        importedAt: 0,
      },
      { id: 'bad', kind: 'binary' },
    ]
    const tracks = project.tracks as Array<Record<string, unknown>>
    tracks[0]!.clips = [
      {
        id: 'good-clip',
        timelineStartSec: 0,
        sourceInSec: 0,
        sourceOutSec: 1,
        durationSec: 1,
        speed: 1,
        enabled: true,
      },
      { id: 'bad-clip', speed: Number.NaN },
    ]

    const result = readVideoWorkbenchProject(project)
    expect(result.source).toBe('v2')
    expect(result.project?.resources.map((resource) => resource.id)).toEqual(['good'])
    expect(result.project?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['good-clip'])
    expect(result.issues).toEqual(
      expect.arrayContaining(['resources[1] is invalid', 'tracks[0].clips[1] is invalid']),
    )
  })

  it('reports dangling and incompatible V2 references without silently dropping clips', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [
      {
        id: 'audio',
        source: 'local',
        kind: 'audio',
        title: 'Audio',
        url: 'safe-file:///audio.wav',
        originPath: '/audio.wav',
        durationSec: 10,
        importedAt: 1,
      },
    ]
    project.tracks[0]!.clips = [
      {
        id: 'wrong-kind',
        resourceId: 'audio',
        timelineStartSec: 0,
        sourceInSec: 0,
        sourceOutSec: 5,
        durationSec: 5,
        speed: 1,
        enabled: true,
      },
      {
        id: 'missing',
        resourceId: 'missing-resource',
        timelineStartSec: 5,
        sourceInSec: 0,
        sourceOutSec: 5,
        durationSec: 5,
        speed: 1,
        enabled: true,
      },
    ]

    const result = readVideoWorkbenchProject(project)
    expect(result.project?.tracks[0]?.clips.map((clip) => clip.id)).toEqual([
      'wrong-kind',
      'missing',
    ])
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'tracks[0].clips[0] is incompatible with video track',
        'tracks[0].clips[1] references missing resource missing-resource',
      ]),
    )
  })

  it('refuses unknown future schema versions instead of overwriting them', () => {
    const result = readVideoWorkbenchProject({ schemaVersion: 3, tracks: [] })
    expect(result.source).toBe('unsupported')
    expect(result.project).toBeNull()
  })
})
