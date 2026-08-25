import type { VideoWorkbenchProjectV2, VideoWorkbenchResourceV2 } from './projectTypes'
import { createVideoWorkbenchClipForResource } from './timelineEditing'

/**
 * Registers the independent source video without replacing an existing edited main track.
 * The source is seeded as a clip only when the main video track is still empty.
 */
export function syncVideoWorkbenchSourceResource(
  project: VideoWorkbenchProjectV2,
  sourceResource: VideoWorkbenchResourceV2,
): VideoWorkbenchProjectV2 {
  const resources = upsertResource(project.resources, sourceResource)
  const alreadyPlaced = project.tracks.some((track) =>
    track.clips.some((clip) => clip.resourceId === sourceResource.id),
  )
  if (alreadyPlaced) {
    return resources === project.resources ? project : { ...project, resources }
  }

  const mainTrack = [...project.tracks]
    .filter((track) => track.kind === 'video')
    .sort((left, right) => left.order - right.order)[0]
  if (!mainTrack || mainTrack.clips.length > 0) {
    return resources === project.resources ? project : { ...project, resources }
  }

  return {
    ...project,
    resources,
    tracks: project.tracks.map((track) =>
      track.id === mainTrack.id
        ? {
            ...track,
            clips: [createVideoWorkbenchClipForResource(project, sourceResource, 0)],
          }
        : track,
    ),
  }
}

function upsertResource(
  resources: VideoWorkbenchResourceV2[],
  incoming: VideoWorkbenchResourceV2,
): VideoWorkbenchResourceV2[] {
  const index = resources.findIndex((resource) => resource.id === incoming.id)
  if (index < 0) return [...resources, incoming]
  const current = resources[index]
  if (!current) return resources
  const next = { ...current, ...incoming }
  const unchanged = Object.keys(next).every(
    (key) =>
      current[key as keyof VideoWorkbenchResourceV2] ===
      next[key as keyof VideoWorkbenchResourceV2],
  )
  if (unchanged) return resources
  return resources.map((resource, resourceIndex) => (resourceIndex === index ? next : resource))
}
