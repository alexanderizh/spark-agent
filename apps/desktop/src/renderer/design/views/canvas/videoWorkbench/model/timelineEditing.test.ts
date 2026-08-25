import { describe, expect, it } from 'vitest'
import {
  createDefaultVideoWorkbenchProject,
  createDefaultVideoWorkbenchTrack,
} from './projectTypes'
import {
  createVideoWorkbenchClipForResource,
  findDefaultVideoWorkbenchTrackForResource,
  resolveVideoWorkbenchTrackAppendTime,
  timelineClientXToProjectTime,
} from './timelineEditing'

describe('video workbench timeline editing helpers', () => {
  it('creates audio clips with source duration and default gain settings', () => {
    const project = createDefaultVideoWorkbenchProject()
    const resource = {
      id: 'audio:1',
      source: 'local' as const,
      kind: 'audio' as const,
      title: 'Audio',
      url: 'safe-file:///audio.wav',
      originPath: '/audio.wav',
      durationSec: 12,
      importedAt: 1,
    }
    expect(createVideoWorkbenchClipForResource(project, resource, 3)).toEqual(
      expect.objectContaining({
        resourceId: 'audio:1',
        timelineStartSec: 3,
        sourceOutSec: 12,
        durationSec: 12,
        audio: { gainDb: 0, muted: false, balance: 0, preservePitch: true },
      }),
    )
  })

  it('treats a zero media duration as unknown and creates a visible placeholder clip', () => {
    const project = createDefaultVideoWorkbenchProject()
    const resource = {
      id: 'video:pending-metadata',
      source: 'canvas' as const,
      kind: 'video' as const,
      title: 'Pending video',
      url: 'safe-file:///pending.mp4',
      originPath: '/pending.mp4',
      durationSec: 0,
      importedAt: 1,
    }

    expect(createVideoWorkbenchClipForResource(project, resource, 0)).toEqual(
      expect.objectContaining({
        sourceOutSec: project.project.defaultImageDurationSec,
        durationSec: project.project.defaultImageDurationSec,
      }),
    )
  })

  it('selects compatible default tracks and computes absolute append/drop times', () => {
    const project = createDefaultVideoWorkbenchProject()
    const audioTrack = createDefaultVideoWorkbenchTrack('audio', 'track:audio', 'Audio', 1)
    audioTrack.clips = [
      {
        id: 'clip:1',
        resourceId: 'audio:1',
        timelineStartSec: 5,
        sourceInSec: 0,
        sourceOutSec: 4,
        durationSec: 4,
        speed: 1,
        enabled: true,
      },
    ]
    project.tracks.push(audioTrack)
    const audioResource = {
      id: 'audio:1',
      source: 'local' as const,
      kind: 'audio' as const,
      title: 'Audio',
      url: 'safe-file:///audio.wav',
      originPath: '/audio.wav',
      importedAt: 1,
    }
    expect(findDefaultVideoWorkbenchTrackForResource(project, audioResource)?.id).toBe(
      'track:audio',
    )
    audioTrack.locked = true
    expect(findDefaultVideoWorkbenchTrackForResource(project, audioResource)).toBeUndefined()
    expect(resolveVideoWorkbenchTrackAppendTime(audioTrack)).toBe(9)
    expect(timelineClientXToProjectTime(260, 100, 40, 20)).toBe(10)
  })
})
