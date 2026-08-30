import type {
  VideoWorkbenchClip,
  VideoWorkbenchProjectV2,
  VideoWorkbenchResourceKindV2,
  VideoWorkbenchTrack,
  VideoWorkbenchTrackKind,
} from './projectTypes'
import {
  VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC,
  resolveVideoWorkbenchClipTiming,
} from './timelineMath'

export function canPlaceVideoWorkbenchResourceOnTrack(
  resourceKind: VideoWorkbenchResourceKindV2 | undefined,
  trackKind: VideoWorkbenchTrackKind,
  clip: Pick<VideoWorkbenchClip, 'resourceId' | 'text'>,
): boolean {
  if (trackKind === 'video' || trackKind === 'overlay') {
    return resourceKind === 'video' || resourceKind === 'image'
  }
  if (trackKind === 'audio') {
    return resourceKind === 'audio' || resourceKind === 'video'
  }
  return clip.resourceId == null && clip.text != null
}

export function videoWorkbenchTrackAllowsOverlap(kind: VideoWorkbenchTrackKind): boolean {
  return kind !== 'video'
}

export function findVideoWorkbenchClip(
  project: Pick<VideoWorkbenchProjectV2, 'tracks'>,
  clipId: string,
): { track: VideoWorkbenchTrack; clip: VideoWorkbenchClip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId)
    if (clip) return { track, clip }
  }
  return null
}

export function isVideoWorkbenchClipPlacementAvailable(
  track: VideoWorkbenchTrack,
  clip: VideoWorkbenchClip,
  ignoredClipIds: ReadonlySet<string> = new Set(),
): boolean {
  if (videoWorkbenchTrackAllowsOverlap(track.kind)) return true
  const timing = resolveVideoWorkbenchClipTiming(clip)
  return track.clips.every((candidate) => {
    if (ignoredClipIds.has(candidate.id)) return true
    const candidateTiming = resolveVideoWorkbenchClipTiming(candidate)
    return (
      timing.timelineEndSec <=
        candidateTiming.timelineStartSec + VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC ||
      timing.timelineStartSec >=
        candidateTiming.timelineEndSec - VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC
    )
  })
}

export function isMainVideoWorkbenchTrack(
  project: Pick<VideoWorkbenchProjectV2, 'tracks'>,
  trackId: string,
): boolean {
  const mainTrack = [...project.tracks]
    .filter((track) => track.kind === 'video')
    .sort((left, right) => left.order - right.order)[0]
  return mainTrack?.id === trackId
}

export function hasDuplicateVideoWorkbenchClipId(
  project: Pick<VideoWorkbenchProjectV2, 'tracks'>,
  clipId: string,
): boolean {
  return project.tracks.some((track) => track.clips.some((clip) => clip.id === clipId))
}
