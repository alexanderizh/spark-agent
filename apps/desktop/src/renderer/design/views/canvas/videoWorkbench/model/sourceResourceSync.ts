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

/** 从资源 id 解析关联的画布节点 id（canvas:<nodeId> / upstream:<nodeId>）。 */
export function upstreamNodeIdFromResource(resource: {
  id: string
  upstreamNodeId?: string | undefined
}): string | null {
  if (resource.upstreamNodeId) return resource.upstreamNodeId
  const match = /^(?:canvas|upstream):(.+)$/.exec(resource.id)
  return match?.[1] ?? null
}

/**
 * 按画布节点存活情况 reconcile 资源的 missing 标记：
 * 引用的节点已删除 → missing: true；节点恢复 → 清除标记。
 * 只在状态实际变化时返回新工程，否则原样返回同一引用（供调用方跳过 commit）。
 * 仅处理 canvas:/upstream: 来源；local: 资源与画布节点无关联，不动。
 */
export function reconcileVideoWorkbenchResourceMissing(
  project: VideoWorkbenchProjectV2,
  existingNodeIds: ReadonlySet<string>,
): VideoWorkbenchProjectV2 {
  let changed = false
  const resources = project.resources.map((resource) => {
    const nodeId = upstreamNodeIdFromResource(resource)
    if (!nodeId) return resource
    const exists = existingNodeIds.has(nodeId)
    if (exists === !resource.missing) return resource
    changed = true
    return exists ? { ...resource, missing: undefined } : { ...resource, missing: true }
  })
  return changed ? { ...project, resources } : project
}

/**
 * 资源 id → 上游画布任务状态（仅 running/failed 会进入结果，completed/pending 无需展示）。
 * 供时间线 clip 状态着色；无命中时返回空表。
 */
export function resolveVideoWorkbenchTaskStatusByResourceId(
  project: VideoWorkbenchProjectV2,
  taskStatusByNodeId: ReadonlyMap<string, string | undefined>,
): Map<string, 'running' | 'failed'> {
  const map = new Map<string, 'running' | 'failed'>()
  for (const resource of project.resources) {
    const nodeId = upstreamNodeIdFromResource(resource)
    if (!nodeId) continue
    const status = taskStatusByNodeId.get(nodeId)
    if (status === 'running' || status === 'failed') map.set(resource.id, status)
  }
  return map
}
