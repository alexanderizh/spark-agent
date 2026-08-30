import { describe, expect, it } from 'vitest'
import {
  createDefaultVideoWorkbenchProject,
  createDefaultVideoWorkbenchTrack,
} from './projectTypes'
import {
  clipSourceTimeToProjectTime,
  isVideoWorkbenchClipActiveAtTime,
  projectTimeToClipSourceTime,
  resolveActiveVideoWorkbenchClipsAtTime,
  resolveAudibleVideoWorkbenchClipsAtTime,
  resolveVideoWorkbenchClipTiming,
  resolveVideoWorkbenchProjectDuration,
} from './timelineMath'

const clip = {
  id: 'clip:1',
  resourceId: 'video:1',
  timelineStartSec: 4,
  sourceInSec: 10,
  sourceOutSec: 20,
  durationSec: 5,
  speed: 2,
  enabled: true,
}

describe('video workbench shared timeline math', () => {
  it('maps project and source time through speed without changing the shared boundaries', () => {
    expect(resolveVideoWorkbenchClipTiming(clip)).toEqual({
      timelineStartSec: 4,
      timelineEndSec: 9,
      sourceStartSec: 10,
      sourceEndSec: 20,
      speed: 2,
    })
    expect(projectTimeToClipSourceTime(clip, 6.5)).toBe(15)
    expect(clipSourceTimeToProjectTime(clip, 15)).toBe(6.5)
    expect(projectTimeToClipSourceTime(clip, 99)).toBe(20)
  })

  it('uses inclusive starts and exclusive ends for active clip resolution', () => {
    expect(isVideoWorkbenchClipActiveAtTime(clip, 4)).toBe(true)
    expect(isVideoWorkbenchClipActiveAtTime(clip, 8.999)).toBe(true)
    expect(isVideoWorkbenchClipActiveAtTime(clip, 9)).toBe(false)
    expect(isVideoWorkbenchClipActiveAtTime({ ...clip, enabled: false }, 5)).toBe(false)
  })

  it('filters hidden visual tracks and applies mute/solo rules to audio tracks', () => {
    const project = createDefaultVideoWorkbenchProject()
    const hiddenVideo = createDefaultVideoWorkbenchTrack('overlay', 'overlay', 'Overlay', 1)
    hiddenVideo.visible = false
    hiddenVideo.clips = [{ ...clip, id: 'hidden', timelineStartSec: 0 }]
    const music = createDefaultVideoWorkbenchTrack('audio', 'music', 'Music', 2)
    music.clips = [
      {
        ...clip,
        id: 'music',
        timelineStartSec: 0,
        audio: { gainDb: 0, muted: false, balance: 0, preservePitch: true },
      },
    ]
    const voice = createDefaultVideoWorkbenchTrack('audio', 'voice', 'Voice', 3)
    voice.solo = true
    voice.clips = [
      {
        ...clip,
        id: 'voice',
        timelineStartSec: 0,
        audio: { gainDb: 0, muted: false, balance: 0, preservePitch: true },
      },
    ]
    project.tracks = [hiddenVideo, music, voice]

    expect(resolveActiveVideoWorkbenchClipsAtTime(project, 1).map(({ clip }) => clip.id)).toEqual([
      'music',
      'voice',
    ])
    expect(resolveAudibleVideoWorkbenchClipsAtTime(project, 1).map(({ clip }) => clip.id)).toEqual([
      'voice',
    ])
  })

  it('resolves project duration from the latest clip end across tracks', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.tracks[0]!.clips = [{ ...clip, timelineStartSec: 3, durationSec: 2 }]
    const overlay = createDefaultVideoWorkbenchTrack('overlay', 'overlay', 'Overlay', 1)
    overlay.clips = [{ ...clip, id: 'later', timelineStartSec: 10, durationSec: 4 }]
    project.tracks.push(overlay)
    expect(resolveVideoWorkbenchProjectDuration(project)).toBe(14)
  })
})
