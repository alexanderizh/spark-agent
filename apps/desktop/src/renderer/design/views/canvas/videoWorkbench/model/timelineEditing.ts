import type {
  VideoWorkbenchClip,
  VideoWorkbenchProjectV2,
  VideoWorkbenchResourceV2,
  VideoWorkbenchTrack,
  VideoWorkbenchTrackKind,
} from './projectTypes'
import { resolveVideoWorkbenchClipTiming } from './timelineMath'
import { canPlaceVideoWorkbenchResourceOnTrack } from './trackRules'

export const VIDEO_WORKBENCH_TIMELINE_MIN_PX_PER_SEC = 8
export const VIDEO_WORKBENCH_TIMELINE_MAX_PX_PER_SEC = 160

export function createVideoWorkbenchEntityId(prefix: 'clip' | 'track'): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}:${suffix}`
}

export function createVideoWorkbenchTrack(
  project: Pick<VideoWorkbenchProjectV2, 'tracks'>,
  kind: VideoWorkbenchTrackKind,
): VideoWorkbenchTrack {
  const sequence = project.tracks.filter((track) => track.kind === kind).length + 1
  return {
    id: createVideoWorkbenchEntityId('track'),
    kind,
    name: `${trackKindLabel(kind)} ${sequence}`,
    order: project.tracks.length,
    locked: false,
    muted: false,
    solo: false,
    visible: true,
    collapsed: false,
    clips: [],
  }
}

export function createVideoWorkbenchClipForResource(
  project: Pick<VideoWorkbenchProjectV2, 'project'>,
  resource: VideoWorkbenchResourceV2,
  timelineStartSec: number,
): VideoWorkbenchClip {
  const fallbackDuration = project.project.defaultImageDurationSec
  const sourceDurationSec =
    Number.isFinite(resource.durationSec) && Number(resource.durationSec) > 0
      ? Number(resource.durationSec)
      : fallbackDuration
  return {
    id: createVideoWorkbenchEntityId('clip'),
    resourceId: resource.id,
    timelineStartSec: Math.max(0, Number.isFinite(timelineStartSec) ? timelineStartSec : 0),
    sourceInSec: 0,
    sourceOutSec: resource.kind === 'image' ? fallbackDuration : sourceDurationSec,
    durationSec: resource.kind === 'image' ? fallbackDuration : sourceDurationSec,
    speed: 1,
    enabled: true,
    ...(resource.kind === 'audio'
      ? { audio: { gainDb: 0, muted: false, balance: 0, preservePitch: true } }
      : {}),
  }
}

export function findDefaultVideoWorkbenchTrackForResource(
  project: Pick<VideoWorkbenchProjectV2, 'tracks'>,
  resource: VideoWorkbenchResourceV2,
): VideoWorkbenchTrack | undefined {
  const preferredKinds: VideoWorkbenchTrackKind[] =
    resource.kind === 'audio' ? ['audio'] : ['video', 'overlay']
  return [...project.tracks]
    .sort((left, right) => left.order - right.order)
    .find(
      (track) =>
        !track.locked &&
        preferredKinds.includes(track.kind) &&
        canPlaceVideoWorkbenchResourceOnTrack(resource.kind, track.kind, {
          resourceId: resource.id,
        }),
    )
}

export function resolveVideoWorkbenchTrackAppendTime(track: VideoWorkbenchTrack): number {
  return track.clips.reduce(
    (endSec, clip) => Math.max(endSec, resolveVideoWorkbenchClipTiming(clip).timelineEndSec),
    0,
  )
}

export function timelineClientXToProjectTime(
  clientX: number,
  laneLeft: number,
  scrollLeft: number,
  pixelsPerSecond: number,
): number {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return 0
  return Math.max(0, (clientX - laneLeft + Math.max(0, scrollLeft)) / pixelsPerSecond)
}

export function trackKindLabel(kind: VideoWorkbenchTrackKind): string {
  switch (kind) {
    case 'video':
      return '主视频'
    case 'overlay':
      return '叠加'
    case 'audio':
      return '音频'
    case 'text':
      return '文本'
    case 'subtitle':
      return '字幕'
  }
}
