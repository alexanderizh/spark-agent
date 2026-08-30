import type {
  VideoWorkbenchClip,
  VideoWorkbenchProjectV2,
  VideoWorkbenchTrack,
} from './projectTypes'

export const VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC = 0.000_001
export const VIDEO_WORKBENCH_MIN_CLIP_DURATION_SEC = 0.1

export interface ResolvedVideoWorkbenchClipTiming {
  timelineStartSec: number
  timelineEndSec: number
  sourceStartSec: number
  sourceEndSec: number
  speed: number
}

export interface ActiveVideoWorkbenchClip {
  track: VideoWorkbenchTrack
  clip: VideoWorkbenchClip
  timing: ResolvedVideoWorkbenchClipTiming
}

export function resolveVideoWorkbenchClipTiming(
  clip: VideoWorkbenchClip,
): ResolvedVideoWorkbenchClipTiming {
  const timelineStartSec = finiteNonNegative(clip.timelineStartSec)
  const durationSec = finiteNonNegative(clip.durationSec)
  const sourceStartSec = finiteNonNegative(clip.sourceInSec)
  const sourceEndSec = Math.max(sourceStartSec, finiteNonNegative(clip.sourceOutSec))
  return {
    timelineStartSec,
    timelineEndSec: timelineStartSec + durationSec,
    sourceStartSec,
    sourceEndSec,
    speed: finitePositive(clip.speed, 1),
  }
}

export function projectTimeToClipSourceTime(
  clip: VideoWorkbenchClip,
  projectTimeSec: number,
): number {
  const timing = resolveVideoWorkbenchClipTiming(clip)
  const clampedProjectTime = clamp(
    finiteNonNegative(projectTimeSec),
    timing.timelineStartSec,
    timing.timelineEndSec,
  )
  return clamp(
    timing.sourceStartSec + (clampedProjectTime - timing.timelineStartSec) * timing.speed,
    timing.sourceStartSec,
    timing.sourceEndSec,
  )
}

export function clipSourceTimeToProjectTime(
  clip: VideoWorkbenchClip,
  sourceTimeSec: number,
): number {
  const timing = resolveVideoWorkbenchClipTiming(clip)
  const clampedSourceTime = clamp(
    finiteNonNegative(sourceTimeSec),
    timing.sourceStartSec,
    timing.sourceEndSec,
  )
  return clamp(
    timing.timelineStartSec + (clampedSourceTime - timing.sourceStartSec) / timing.speed,
    timing.timelineStartSec,
    timing.timelineEndSec,
  )
}

export function isVideoWorkbenchClipActiveAtTime(
  clip: VideoWorkbenchClip,
  projectTimeSec: number,
): boolean {
  if (!clip.enabled || !Number.isFinite(projectTimeSec)) return false
  const timing = resolveVideoWorkbenchClipTiming(clip)
  return (
    timing.timelineEndSec - timing.timelineStartSec >= VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC &&
    projectTimeSec + VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC >= timing.timelineStartSec &&
    projectTimeSec < timing.timelineEndSec - VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC
  )
}

export function resolveActiveVideoWorkbenchClipsAtTime(
  project: VideoWorkbenchProjectV2,
  projectTimeSec: number,
): ActiveVideoWorkbenchClip[] {
  return [...project.tracks]
    .sort((left, right) => left.order - right.order)
    .flatMap((track) => {
      if (!track.visible && track.kind !== 'audio') return []
      return track.clips
        .filter((clip) => isVideoWorkbenchClipActiveAtTime(clip, projectTimeSec))
        .map((clip) => ({ track, clip, timing: resolveVideoWorkbenchClipTiming(clip) }))
    })
}

export function resolveAudibleVideoWorkbenchClipsAtTime(
  project: VideoWorkbenchProjectV2,
  projectTimeSec: number,
): ActiveVideoWorkbenchClip[] {
  const audioTracks = project.tracks.filter((track) => track.kind === 'audio')
  const hasSoloTrack = audioTracks.some((track) => track.solo && !track.muted)
  const resourcesById = new Map(project.resources.map((resource) => [resource.id, resource]))
  return project.tracks
    .filter(
      (track) =>
        track.kind !== 'text' &&
        track.kind !== 'subtitle' &&
        !track.muted &&
        (!hasSoloTrack || (track.kind === 'audio' && track.solo)),
    )
    .flatMap((track) =>
      track.clips
        .filter((clip) => {
          const resource = clip.resourceId ? resourcesById.get(clip.resourceId) : undefined
          const hasAudio =
            clip.audio != null ||
            resource?.kind === 'audio' ||
            (resource?.kind === 'video' && resource.hasAudio !== false)
          return (
            hasAudio && !clip.audio?.muted && isVideoWorkbenchClipActiveAtTime(clip, projectTimeSec)
          )
        })
        .map((clip) => ({ track, clip, timing: resolveVideoWorkbenchClipTiming(clip) })),
    )
}

export function resolveVideoWorkbenchProjectDuration(
  project: Pick<VideoWorkbenchProjectV2, 'tracks'>,
): number {
  return project.tracks.reduce(
    (projectEndSec, track) =>
      track.clips.reduce(
        (trackEndSec, clip) =>
          Math.max(trackEndSec, resolveVideoWorkbenchClipTiming(clip).timelineEndSec),
        projectEndSec,
      ),
    0,
  )
}

export function durationForVideoWorkbenchSourceRange(
  sourceInSec: number,
  sourceOutSec: number,
  speed: number,
): number {
  const safeSourceIn = finiteNonNegative(sourceInSec)
  const safeSourceOut = Math.max(safeSourceIn, finiteNonNegative(sourceOutSec))
  return (safeSourceOut - safeSourceIn) / finitePositive(speed, 1)
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
