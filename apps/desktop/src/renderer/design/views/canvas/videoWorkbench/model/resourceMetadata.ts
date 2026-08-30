import type { VideoWorkbenchClip, VideoWorkbenchProjectV2 } from './projectTypes'
import {
  VIDEO_WORKBENCH_MIN_CLIP_DURATION_SEC,
  VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC,
} from './timelineMath'

export interface VideoWorkbenchResourceMetadataPatch {
  durationSec?: number | undefined
  width?: number | undefined
  height?: number | undefined
}

/** Backfills resource metadata and expands untouched placeholder clips to the discovered duration. */
export function backfillVideoWorkbenchProjectResourceMetadata(
  project: VideoWorkbenchProjectV2,
  metadataById: ReadonlyMap<string, VideoWorkbenchResourceMetadataPatch>,
): VideoWorkbenchProjectV2 {
  let resourcesChanged = false
  const resources = project.resources.map((resource) => {
    const meta = metadataById.get(resource.id)
    if (!meta) return resource
    const durationSec = isPositiveDuration(resource.durationSec)
      ? resource.durationSec
      : isPositiveDuration(meta.durationSec)
        ? meta.durationSec
        : resource.durationSec
    const width = resource.width ?? meta.width
    const height = resource.height ?? meta.height
    if (
      durationSec === resource.durationSec &&
      width === resource.width &&
      height === resource.height
    ) {
      return resource
    }
    resourcesChanged = true
    return {
      ...resource,
      ...(durationSec !== undefined ? { durationSec } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    }
  })

  const resourcesById = new Map(project.resources.map((resource) => [resource.id, resource]))
  let tracksChanged = false
  const tracks = project.tracks.map((track) => {
    let clipsChanged = false
    const expandedClips = track.clips.map((clip) => {
      if (!clip.resourceId) return clip
      const meta = metadataById.get(clip.resourceId)
      const resource = resourcesById.get(clip.resourceId)
      const discoveredDurationSec = meta?.durationSec
      const fallbackDurationSec = project.project.defaultImageDurationSec
      const hasUntouchedPlaceholderDuration =
        Math.abs(clip.sourceOutSec - clip.durationSec) < VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC &&
        (clip.durationSec <=
          VIDEO_WORKBENCH_MIN_CLIP_DURATION_SEC + VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC ||
          Math.abs(clip.durationSec - fallbackDurationSec) < VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC)
      const isUntouchedFallback =
        resource?.kind !== 'image' &&
        !isPositiveDuration(resource?.durationSec) &&
        isPositiveDuration(discoveredDurationSec) &&
        clip.sourceInSec === 0 &&
        clip.speed === 1 &&
        hasUntouchedPlaceholderDuration
      if (!isUntouchedFallback) return clip
      clipsChanged = true
      return {
        ...clip,
        sourceOutSec: discoveredDurationSec,
        durationSec: discoveredDurationSec,
      }
    })
    if (!clipsChanged) return track
    tracksChanged = true
    return {
      ...track,
      clips:
        track.kind === 'video'
          ? alignExpandedVideoTrackClips(track.clips, expandedClips)
          : expandedClips,
    }
  })

  if (!resourcesChanged && !tracksChanged) return project
  return {
    ...project,
    ...(resourcesChanged ? { resources } : {}),
    ...(tracksChanged ? { tracks } : {}),
  }
}

function isPositiveDuration(value: number | undefined): value is number {
  return Number.isFinite(value) && Number(value) > 0
}

/** Preserve appended adjacency and prevent overlap when placeholder durations become real. */
function alignExpandedVideoTrackClips(
  originalClips: readonly VideoWorkbenchClip[],
  expandedClips: readonly VideoWorkbenchClip[],
): VideoWorkbenchClip[] {
  const expandedById = new Map(expandedClips.map((clip) => [clip.id, clip]))
  const alignedById = new Map<string, VideoWorkbenchClip>()
  let previousOriginalEndSec: number | null = null
  let previousAlignedEndSec: number | null = null

  for (const originalClip of [...originalClips].sort(
    (left, right) =>
      left.timelineStartSec - right.timelineStartSec || left.id.localeCompare(right.id),
  )) {
    const expandedClip = expandedById.get(originalClip.id) ?? originalClip
    let timelineStartSec = expandedClip.timelineStartSec
    if (previousOriginalEndSec != null && previousAlignedEndSec != null) {
      const wasAdjacent =
        Math.abs(originalClip.timelineStartSec - previousOriginalEndSec) <
        VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC
      if (wasAdjacent || timelineStartSec < previousAlignedEndSec) {
        timelineStartSec = previousAlignedEndSec
      }
    }
    const alignedClip =
      Math.abs(timelineStartSec - expandedClip.timelineStartSec) <
      VIDEO_WORKBENCH_TIMELINE_EPSILON_SEC
        ? expandedClip
        : { ...expandedClip, timelineStartSec }
    alignedById.set(alignedClip.id, alignedClip)
    previousOriginalEndSec = originalClip.timelineStartSec + originalClip.durationSec
    previousAlignedEndSec = timelineStartSec + alignedClip.durationSec
  }

  return originalClips.map((clip) => alignedById.get(clip.id) ?? clip)
}
