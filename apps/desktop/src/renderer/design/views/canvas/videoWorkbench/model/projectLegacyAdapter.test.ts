import { describe, expect, it } from 'vitest'
import {
  createDefaultVideoWorkbenchProject,
  createDefaultVideoWorkbenchTrack,
} from './projectTypes'
import {
  isLegacyVideoWorkbenchExportCompatible,
  updateVideoWorkbenchProjectFromLegacy,
  videoWorkbenchProjectToLegacyData,
} from './projectLegacyAdapter'

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
      durationSec: 30,
      importedAt: 2,
    },
  ]
  project.tracks[0]!.clips = [
    {
      id: 'clip:video',
      resourceId: 'video:1',
      timelineStartSec: 12,
      sourceInSec: 2,
      sourceOutSec: 8,
      durationSec: 6,
      speed: 1,
      enabled: true,
    },
  ]
  const audioTrack = createDefaultVideoWorkbenchTrack('audio', 'track:audio', 'Audio', 1)
  audioTrack.clips = [
    {
      id: 'clip:audio',
      resourceId: 'audio:1',
      timelineStartSec: 4,
      sourceInSec: 0,
      sourceOutSec: 10,
      durationSec: 10,
      speed: 1,
      enabled: true,
    },
  ]
  project.tracks.push(audioTrack)
  return project
}

describe('video workbench legacy adapter', () => {
  it('exposes audio resources but only the main visual track to legacy panels', () => {
    const legacy = videoWorkbenchProjectToLegacyData(createProject())
    expect(legacy.resourcePanel.map((resource) => resource.kind)).toEqual(['video', 'audio'])
    expect(legacy.track).toEqual([
      expect.objectContaining({
        id: 'clip:video',
        resourceId: 'video:1',
        range: { startSec: 2, endSec: 8 },
      }),
    ])
  })

  it('preserves absolute timing and non-legacy tracks when shared metadata changes', () => {
    const project = createProject()
    const next = updateVideoWorkbenchProjectFromLegacy(project, (legacy) => ({
      ...legacy,
      manualMarks: [3],
    }))
    expect(next.manualMarks).toEqual([3])
    expect(next.tracks[0]!.clips[0]!.timelineStartSec).toBe(12)
    expect(next.tracks[1]).toBe(project.tracks[1])
  })

  it('rebuilds only the main track when a legacy-only operation explicitly changes it', () => {
    const project = createProject()
    const next = updateVideoWorkbenchProjectFromLegacy(project, (legacy) => ({
      ...legacy,
      track: legacy.track.map((clip) => ({ ...clip, range: { startSec: 3, endSec: 5 } })),
    }))
    expect(next.tracks[0]!.clips[0]).toEqual(
      expect.objectContaining({ timelineStartSec: 0, sourceInSec: 3, sourceOutSec: 5 }),
    )
    expect(next.tracks[1]).toBe(project.tracks[1])
  })

  it('allows legacy concat only for contiguous, unmodified video-only projects', () => {
    const project = createProject()
    project.tracks = [project.tracks[0]!]
    project.tracks[0]!.clips[0]!.timelineStartSec = 0
    expect(isLegacyVideoWorkbenchExportCompatible(project)).toBe(true)

    project.tracks[0]!.clips[0]!.timelineStartSec = 2
    expect(isLegacyVideoWorkbenchExportCompatible(project)).toBe(false)

    project.tracks[0]!.clips[0]!.timelineStartSec = 0
    project.tracks[0]!.clips[0]!.speed = 2
    expect(isLegacyVideoWorkbenchExportCompatible(project)).toBe(false)
  })
})
