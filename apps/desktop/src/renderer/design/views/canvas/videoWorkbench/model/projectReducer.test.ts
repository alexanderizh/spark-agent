import { describe, expect, it } from 'vitest'
import {
  createDefaultVideoWorkbenchProject,
  createDefaultVideoWorkbenchTrack,
  type VideoWorkbenchClip,
} from './projectTypes'
import { reduceVideoWorkbenchProject } from './projectReducer'

function createProject() {
  const project = createDefaultVideoWorkbenchProject()
  project.resources = [
    {
      id: 'video:1',
      source: 'local',
      kind: 'video',
      title: 'Video',
      url: 'safe-file:///video.mp4',
      originPath: '/video.mp4',
      durationSec: 20,
      importedAt: 1,
    },
    {
      id: 'audio:1',
      source: 'local',
      kind: 'audio',
      title: 'Audio',
      url: 'safe-file:///audio.wav',
      originPath: '/audio.wav',
      durationSec: 20,
      importedAt: 2,
    },
  ]
  project.tracks[0]!.clips = [createClip('clip:1', 0, 10)]
  return project
}

function createClip(id: string, timelineStartSec: number, durationSec: number): VideoWorkbenchClip {
  return {
    id,
    resourceId: 'video:1',
    timelineStartSec,
    sourceInSec: 0,
    sourceOutSec: durationSec,
    durationSec,
    speed: 1,
    enabled: true,
  }
}

describe('video workbench project reducer', () => {
  it('rejects incompatible resources, locked tracks, and overlaps without mutating the project', () => {
    const project = createProject()
    const incompatible = reduceVideoWorkbenchProject(project, {
      type: 'clip/add',
      trackId: project.tracks[0]!.id,
      clip: { ...createClip('audio-clip', 10, 2), resourceId: 'audio:1' },
    })
    expect(incompatible).toEqual({ applied: false, project, reason: 'incompatible-track' })

    const overlap = reduceVideoWorkbenchProject(project, {
      type: 'clip/add',
      trackId: project.tracks[0]!.id,
      clip: createClip('overlap', 5, 2),
    })
    expect(overlap).toEqual({ applied: false, project, reason: 'overlap' })

    project.tracks[0]!.locked = true
    const locked = reduceVideoWorkbenchProject(project, {
      type: 'clip/remove',
      clipId: 'clip:1',
    })
    expect(locked).toEqual({ applied: false, project, reason: 'locked-track' })
  })

  it('moves clips across compatible tracks while preserving immutable input state', () => {
    const project = createProject()
    const overlay = createDefaultVideoWorkbenchTrack('overlay', 'track:overlay', 'Overlay', 1)
    project.tracks.push(overlay)
    const result = reduceVideoWorkbenchProject(project, {
      type: 'clip/move',
      clipId: 'clip:1',
      targetTrackId: overlay.id,
      timelineStartSec: 3,
    })
    expect(result.applied).toBe(true)
    expect(project.tracks[0]!.clips).toHaveLength(1)
    expect(result.project.tracks[0]!.clips).toHaveLength(0)
    expect(result.project.tracks[1]!.clips[0]).toEqual(
      expect.objectContaining({ id: 'clip:1', timelineStartSec: 3 }),
    )
  })

  it('trims, splits, and changes speed through the same shared source-time semantics', () => {
    const project = createProject()
    const trimmed = reduceVideoWorkbenchProject(project, {
      type: 'clip/trim',
      clipId: 'clip:1',
      edge: 'start',
      sourceTimeSec: 2,
    })
    expect(trimmed.applied).toBe(true)
    const trimmedClip = trimmed.project.tracks[0]!.clips[0]!
    expect(trimmedClip).toEqual(
      expect.objectContaining({ timelineStartSec: 2, sourceInSec: 2, durationSec: 8 }),
    )

    const extendedAgain = reduceVideoWorkbenchProject(trimmed.project, {
      type: 'clip/trim',
      clipId: 'clip:1',
      edge: 'start',
      sourceTimeSec: 0,
    })
    expect(extendedAgain.applied).toBe(true)
    expect(extendedAgain.project.tracks[0]!.clips[0]).toEqual(
      expect.objectContaining({ timelineStartSec: 0, sourceInSec: 0, durationSec: 10 }),
    )

    const extendedEnd = reduceVideoWorkbenchProject(project, {
      type: 'clip/trim',
      clipId: 'clip:1',
      edge: 'end',
      sourceTimeSec: 12,
    })
    expect(extendedEnd.applied).toBe(true)
    expect(extendedEnd.project.tracks[0]!.clips[0]).toEqual(
      expect.objectContaining({ sourceOutSec: 12, durationSec: 12 }),
    )

    const split = reduceVideoWorkbenchProject(trimmed.project, {
      type: 'clip/split',
      clipId: 'clip:1',
      splitAtSec: 5,
      rightClipId: 'clip:2',
    })
    expect(split.applied).toBe(true)
    expect(split.project.tracks[0]!.clips).toEqual([
      expect.objectContaining({ id: 'clip:1', sourceInSec: 2, sourceOutSec: 5, durationSec: 3 }),
      expect.objectContaining({
        id: 'clip:2',
        timelineStartSec: 5,
        sourceInSec: 5,
        durationSec: 5,
      }),
    ])

    const spedUp = reduceVideoWorkbenchProject(split.project, {
      type: 'clip/set-speed',
      clipId: 'clip:2',
      speed: 2,
    })
    expect(spedUp.applied).toBe(true)
    expect(spedUp.project.tracks[0]!.clips[1]).toEqual(
      expect.objectContaining({ id: 'clip:2', speed: 2, durationSec: 2.5 }),
    )
  })

  it('closes the main-track gap by default and preserves it when ripple is disabled', () => {
    const project = createProject()
    project.tracks[0]!.clips.push({
      ...createClip('clip:2', 10, 4),
      sourceInSec: 10,
      sourceOutSec: 14,
    })
    const magnetic = reduceVideoWorkbenchProject(project, {
      type: 'clip/remove',
      clipId: 'clip:1',
    })
    expect(magnetic.applied).toBe(true)
    expect(magnetic.project.tracks[0]!.clips[0]!.timelineStartSec).toBe(0)

    const nonRipple = reduceVideoWorkbenchProject(project, {
      type: 'clip/remove',
      clipId: 'clip:1',
      ripple: false,
    })
    expect(nonRipple.applied).toBe(true)
    expect(nonRipple.project.tracks[0]!.clips[0]!.timelineStartSec).toBe(10)
  })

  it('duplicates clips and protects the last main video track from deletion', () => {
    const project = createProject()
    const duplicated = reduceVideoWorkbenchProject(project, {
      type: 'clip/duplicate',
      clipId: 'clip:1',
      duplicateClipId: 'clip:copy',
      timelineStartSec: 10,
    })
    expect(duplicated.applied).toBe(true)
    expect(duplicated.project.tracks[0]!.clips[1]).toEqual(
      expect.objectContaining({ id: 'clip:copy', timelineStartSec: 10 }),
    )

    const protectedMain = reduceVideoWorkbenchProject(project, {
      type: 'track/remove',
      trackId: project.tracks[0]!.id,
    })
    expect(protectedMain).toEqual({ applied: false, project, reason: 'invalid-command' })

    const audioTrack = createDefaultVideoWorkbenchTrack('audio', 'track:audio', 'Audio', 1)
    const withAudio = { ...project, tracks: [...project.tracks, audioTrack] }
    const removedAudio = reduceVideoWorkbenchProject(withAudio, {
      type: 'track/remove',
      trackId: audioTrack.id,
    })
    expect(removedAudio.applied).toBe(true)
    expect(removedAudio.project.tracks).toHaveLength(1)
  })

  it('renames and atomically reorders tracks while respecting locked state', () => {
    const project = createProject()
    const overlayTrack = createDefaultVideoWorkbenchTrack('overlay', 'track:overlay', 'Overlay', 1)
    const audioTrack = createDefaultVideoWorkbenchTrack('audio', 'track:audio', 'Audio', 2)
    project.tracks.push(overlayTrack, audioTrack)

    const renamed = reduceVideoWorkbenchProject(project, {
      type: 'track/update',
      trackId: audioTrack.id,
      changes: { name: '  旁白  ' },
    })
    expect(renamed.applied).toBe(true)
    expect(renamed.project.tracks[2]!.name).toBe('旁白')

    const reordered = reduceVideoWorkbenchProject(renamed.project, {
      type: 'track/reorder',
      trackId: audioTrack.id,
      targetOrder: 0,
    })
    expect(reordered.applied).toBe(true)
    expect(reordered.project.tracks.map((track) => [track.id, track.order])).toEqual([
      ['track:audio', 0],
      ['track:main', 1],
      ['track:overlay', 2],
    ])

    reordered.project.tracks[0]!.locked = true
    const locked = reduceVideoWorkbenchProject(reordered.project, {
      type: 'track/reorder',
      trackId: audioTrack.id,
      targetOrder: 2,
    })
    expect(locked).toEqual({ applied: false, project: reordered.project, reason: 'locked-track' })

    const emptyName = reduceVideoWorkbenchProject(project, {
      type: 'track/update',
      trackId: overlayTrack.id,
      changes: { name: '   ' },
    })
    expect(emptyName).toEqual({ applied: false, project, reason: 'invalid-command' })
  })

  it('moves multiple clips as one atomic command and rejects partial application', () => {
    const project = createProject()
    project.tracks[0]!.clips = [createClip('clip:1', 0, 4), createClip('clip:2', 4, 4)]
    const overlayTrack = createDefaultVideoWorkbenchTrack('overlay', 'track:overlay', 'Overlay', 1)
    project.tracks.push(overlayTrack)

    const moved = reduceVideoWorkbenchProject(project, {
      type: 'clip/move-many',
      moves: [
        { clipId: 'clip:1', targetTrackId: overlayTrack.id, timelineStartSec: 2 },
        { clipId: 'clip:2', targetTrackId: overlayTrack.id, timelineStartSec: 6 },
      ],
    })
    expect(moved.applied).toBe(true)
    expect(project.tracks[0]!.clips).toHaveLength(2)
    expect(moved.project.tracks[0]!.clips).toHaveLength(0)
    expect(moved.project.tracks[1]!.clips.map((clip) => [clip.id, clip.timelineStartSec])).toEqual([
      ['clip:1', 2],
      ['clip:2', 6],
    ])

    const audioTrack = createDefaultVideoWorkbenchTrack('audio', 'track:audio', 'Audio', 2)
    audioTrack.clips = [
      {
        ...createClip('clip:audio', 0, 4),
        resourceId: 'audio:1',
        audio: { gainDb: 0, muted: false, balance: 0, preservePitch: true },
      },
    ]
    const mixedProject = { ...project, tracks: [...project.tracks, audioTrack] }
    const rejected = reduceVideoWorkbenchProject(mixedProject, {
      type: 'clip/move-many',
      moves: [
        { clipId: 'clip:1', targetTrackId: overlayTrack.id, timelineStartSec: 2 },
        { clipId: 'clip:audio', targetTrackId: project.tracks[0]!.id, timelineStartSec: 12 },
      ],
    })
    expect(rejected).toEqual({
      applied: false,
      project: mixedProject,
      reason: 'incompatible-track',
    })
  })

  it('duplicates and removes clip selections through one history-safe reducer result', () => {
    const project = createProject()
    project.tracks[0]!.clips = [
      createClip('clip:1', 0, 4),
      { ...createClip('clip:2', 4, 4), sourceInSec: 4, sourceOutSec: 8 },
      { ...createClip('clip:3', 8, 4), sourceInSec: 8, sourceOutSec: 12 },
    ]

    const duplicated = reduceVideoWorkbenchProject(project, {
      type: 'clip/duplicate-many',
      items: [
        { clipId: 'clip:1', duplicateClipId: 'clip:copy-1', timelineStartSec: 12 },
        { clipId: 'clip:2', duplicateClipId: 'clip:copy-2', timelineStartSec: 16 },
      ],
    })
    expect(duplicated.applied).toBe(true)
    expect(duplicated.project.tracks[0]!.clips.slice(-2).map((clip) => clip.id)).toEqual([
      'clip:copy-1',
      'clip:copy-2',
    ])

    const duplicateId = reduceVideoWorkbenchProject(project, {
      type: 'clip/duplicate-many',
      items: [
        { clipId: 'clip:1', duplicateClipId: 'clip:copy', timelineStartSec: 12 },
        { clipId: 'clip:2', duplicateClipId: 'clip:copy', timelineStartSec: 16 },
      ],
    })
    expect(duplicateId).toEqual({ applied: false, project, reason: 'duplicate-id' })

    const removed = reduceVideoWorkbenchProject(project, {
      type: 'clip/remove-many',
      clipIds: ['clip:1', 'clip:2'],
    })
    expect(removed.applied).toBe(true)
    expect(removed.project.tracks[0]!.clips).toEqual([
      expect.objectContaining({ id: 'clip:3', timelineStartSec: 0 }),
    ])
  })

  it('allows an image clip to be extended from its left edge without negative source time', () => {
    const project = createProject()
    project.resources.push({
      id: 'image:1',
      source: 'local',
      kind: 'image',
      title: 'Image',
      url: 'safe-file:///image.png',
      originPath: '/image.png',
      importedAt: 3,
    })
    project.tracks[0]!.clips = [
      {
        ...createClip('image-clip', 5, 8),
        resourceId: 'image:1',
        sourceOutSec: 8,
      },
    ]
    const result = reduceVideoWorkbenchProject(project, {
      type: 'clip/trim',
      clipId: 'image-clip',
      edge: 'start',
      sourceTimeSec: -2,
    })
    expect(result.applied).toBe(true)
    expect(result.project.tracks[0]!.clips[0]).toEqual(
      expect.objectContaining({
        timelineStartSec: 3,
        sourceInSec: 0,
        sourceOutSec: 10,
        durationSec: 10,
      }),
    )
  })
})
