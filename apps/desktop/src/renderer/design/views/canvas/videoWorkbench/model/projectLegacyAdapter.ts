import type { TrackClip, VideoWorkbenchData, WorkbenchResource } from '../videoWorkbench.types'
import type {
  VideoWorkbenchClip,
  VideoWorkbenchProjectV2,
  VideoWorkbenchResourceV2,
  VideoWorkbenchTrack,
} from './projectTypes'
import { resolveVideoWorkbenchClipTiming } from './timelineMath'

/**
 * Phase 1 keeps the existing preview/keyframe/process panels alive while V2 becomes the only
 * persisted project. This adapter is deliberately one-way for multi-track-only fields: legacy
 * updates may change shared metadata/resources and the main video track, but never flatten or
 * discard overlay/audio tracks unless the caller explicitly changes the legacy main-track view.
 */
export function videoWorkbenchProjectToLegacyData(
  project: VideoWorkbenchProjectV2,
): VideoWorkbenchData {
  return {
    sourceVideoAssetId: project.sourceVideoAssetId,
    probeInfo: project.probeInfo,
    keyframes: project.keyframes,
    extractConfig: project.extractConfig,
    outputs: project.outputs,
    manualMarks: project.manualMarks,
    activeTab: project.ui.activeTab,
    resourcePanel: project.resources,
    track: videoWorkbenchProjectMainTrackToLegacy(project),
    autoCollectUpstream: project.autoCollectUpstream,
  }
}

export function updateVideoWorkbenchProjectFromLegacy(
  project: VideoWorkbenchProjectV2,
  updater: (legacy: VideoWorkbenchData) => VideoWorkbenchData,
): VideoWorkbenchProjectV2 {
  const currentLegacy = videoWorkbenchProjectToLegacyData(project)
  const nextLegacy = updater(currentLegacy)
  if (nextLegacy === currentLegacy) return project

  const nextResources =
    nextLegacy.resourcePanel === currentLegacy.resourcePanel
      ? project.resources
      : mergeLegacyResources(project.resources, nextLegacy.resourcePanel)
  const nextTracks =
    nextLegacy.track === currentLegacy.track
      ? project.tracks
      : replaceMainTrackFromLegacy(project, nextLegacy.track, nextResources)

  return {
    ...project,
    ...(nextLegacy.sourceVideoAssetId !== undefined
      ? { sourceVideoAssetId: nextLegacy.sourceVideoAssetId }
      : { sourceVideoAssetId: undefined }),
    ...(nextLegacy.probeInfo !== undefined
      ? { probeInfo: nextLegacy.probeInfo }
      : { probeInfo: undefined }),
    keyframes: nextLegacy.keyframes,
    extractConfig: nextLegacy.extractConfig,
    outputs: nextLegacy.outputs,
    manualMarks: nextLegacy.manualMarks,
    resources: nextResources,
    tracks: nextTracks,
    autoCollectUpstream: nextLegacy.autoCollectUpstream,
    ui:
      nextLegacy.activeTab === project.ui.activeTab
        ? project.ui
        : { ...project.ui, activeTab: nextLegacy.activeTab },
  }
}

export function videoWorkbenchProjectMainTrackToLegacy(
  project: Pick<VideoWorkbenchProjectV2, 'resources' | 'tracks'>,
): TrackClip[] {
  const resourcesById = new Map(project.resources.map((resource) => [resource.id, resource]))
  const mainTrack = findMainVideoTrack(project.tracks)
  if (!mainTrack) return []
  return [...mainTrack.clips]
    .sort(
      (left, right) =>
        left.timelineStartSec - right.timelineStartSec || left.id.localeCompare(right.id),
    )
    .flatMap((clip, order): TrackClip[] => {
      if (!clip.resourceId) return []
      const resource = resourcesById.get(clip.resourceId)
      const base: TrackClip = { id: clip.id, resourceId: clip.resourceId, order }
      if (resource?.kind === 'image') {
        return [{ ...base, staticDuration: clip.durationSec }]
      }
      return [
        {
          ...base,
          range: { startSec: clip.sourceInSec, endSec: clip.sourceOutSec },
        },
      ]
    })
}

export function videoWorkbenchClipToLegacyTrackClip(
  clip: VideoWorkbenchClip,
  resource: VideoWorkbenchResourceV2 | undefined,
): TrackClip | null {
  if (!clip.resourceId || resource?.kind === 'audio') return null
  const base: TrackClip = { id: clip.id, resourceId: clip.resourceId, order: 0 }
  return resource?.kind === 'image'
    ? { ...base, staticDuration: clip.durationSec }
    : { ...base, range: { startSec: clip.sourceInSec, endSec: clip.sourceOutSec } }
}

export function isLegacyVideoWorkbenchExportCompatible(project: VideoWorkbenchProjectV2): boolean {
  const populatedTracks = project.tracks.filter((track) => track.clips.length > 0)
  if (!populatedTracks.every((track) => track.kind === 'video') || populatedTracks.length > 1) {
    return false
  }
  const track = populatedTracks[0]
  if (!track) return true
  const resourcesById = new Map(project.resources.map((resource) => [resource.id, resource]))
  let cursorSec = 0
  for (const clip of [...track.clips].sort(
    (left, right) => left.timelineStartSec - right.timelineStartSec,
  )) {
    const timing = resolveVideoWorkbenchClipTiming(clip)
    const resource = clip.resourceId ? resourcesById.get(clip.resourceId) : undefined
    const hasUnsupportedEdit =
      resource?.kind !== 'video' ||
      clip.speed !== 1 ||
      clip.transform != null ||
      clip.audio != null ||
      clip.fadeInSec != null ||
      clip.fadeOutSec != null ||
      clip.text != null ||
      Math.abs(timing.timelineStartSec - cursorSec) > 0.000_001
    if (hasUnsupportedEdit) return false
    cursorSec = timing.timelineEndSec
  }
  return true
}

function mergeLegacyResources(
  current: VideoWorkbenchResourceV2[],
  legacy: WorkbenchResource[],
): VideoWorkbenchResourceV2[] {
  const currentById = new Map(current.map((resource) => [resource.id, resource]))
  return legacy.map((resource) => ({ ...currentById.get(resource.id), ...resource }))
}

function replaceMainTrackFromLegacy(
  project: VideoWorkbenchProjectV2,
  legacyTrack: TrackClip[],
  resources: VideoWorkbenchResourceV2[],
): VideoWorkbenchTrack[] {
  const mainTrack = findMainVideoTrack(project.tracks)
  if (!mainTrack) return project.tracks
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]))
  let cursorSec = 0
  const clips = [...legacyTrack]
    .sort((left, right) => left.order - right.order)
    .map((clip): VideoWorkbenchClip => {
      const resource = resourcesById.get(clip.resourceId)
      const sourceInSec = clip.range?.startSec ?? 0
      const fallbackDuration =
        resource?.kind === 'image'
          ? (clip.staticDuration ?? project.project.defaultImageDurationSec)
          : Math.max(0.1, resource?.durationSec ?? project.project.defaultImageDurationSec)
      const sourceOutSec = clip.range?.endSec ?? sourceInSec + fallbackDuration
      const durationSec =
        resource?.kind === 'image'
          ? (clip.staticDuration ?? fallbackDuration)
          : Math.max(0.1, sourceOutSec - sourceInSec)
      const migrated: VideoWorkbenchClip = {
        id: clip.id,
        resourceId: clip.resourceId,
        timelineStartSec: cursorSec,
        sourceInSec,
        sourceOutSec,
        durationSec,
        speed: 1,
        enabled: true,
      }
      cursorSec += durationSec
      return migrated
    })
  return project.tracks.map((track) => (track.id === mainTrack.id ? { ...track, clips } : track))
}

function findMainVideoTrack(tracks: VideoWorkbenchTrack[]): VideoWorkbenchTrack | undefined {
  return [...tracks]
    .filter((track) => track.kind === 'video')
    .sort((left, right) => left.order - right.order)[0]
}
