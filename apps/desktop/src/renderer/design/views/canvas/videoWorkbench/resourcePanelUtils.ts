/**
 * 资源面板 / 多段轨道的纯数据工具。
 *
 * 与 React/UI/IPC 完全解耦，方便单测与复用。
 * 涵盖：
 *  - 资源 id / clip id 生成
 *  - 上游节点首选产物挑选
 *  - 入边遍历
 *  - 轨道添加 / 重排 / 移除
 *  - 总时长与「资源是否已在轨道」判定
 */

import type { TrackClip, WorkbenchResource } from './videoWorkbench.types'

/** 默认图片静帧展示时长（秒） */
export const DEFAULT_IMAGE_STATIC_DURATION_SEC = 8

/** 短随机 id（资源面板内部使用） */
export function generateResourceId(): string {
  return `res_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

/** 短随机 id（轨道 clip 内部使用） */
export function generateClipId(): string {
  return `clip_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

/** 候选产物（来自上游节点或画布节点），用于首选产物挑选。 */
export interface UpstreamArtifact {
  /** 资源 id（modal 内生成） */
  id: string
  /** 媒体类型 */
  kind: 'video' | 'image'
  /** 浏览器可播放的 URL */
  url: string
  /** 磁盘绝对路径 */
  originPath: string
  /** 显示名 */
  title: string
  /** 缩略图 URL（可选） */
  thumbnailUrl?: string
  /** 视频时长（秒），仅视频 */
  durationSec?: number
  /** 宽 */
  width?: number
  /** 高 */
  height?: number
  /** 文件大小（字节） */
  fileSize?: number
}

/** 上游节点引用（用于按上级连线自动收集时给工作台一份"节点视角"的输入） */
export interface UpstreamNodeRef {
  /** 画布节点 id（用于回链） */
  nodeId: string
  /** 节点标题 */
  title: string
  /** 节点产出的候选产物（按顺序：先视频再图片） */
  artifacts: UpstreamArtifact[]
}

/**
 * 从上游节点的产物列表里挑选"首选产物"。
 *
 * 策略（设计稿 Q1 推荐）：取该节点首个视频产物；没有视频就取首个图片。
 * 传入空列表返回 null。
 */
export function pickPrimaryArtifact(artifacts: UpstreamArtifact[]): UpstreamArtifact | null {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null
  const firstVideo = artifacts.find((a) => a && a.kind === 'video')
  if (firstVideo) return firstVideo
  const firstImage = artifacts.find((a) => a && a.kind === 'image')
  if (firstImage) return firstImage
  return null
}

/** 把上游节点引用转成资源面板条目（取首选产物），附带来源节点元信息。 */
export function upstreamNodeToResource(
  node: UpstreamNodeRef,
  importedAt: number,
): WorkbenchResource | null {
  const primary = pickPrimaryArtifact(node.artifacts)
  if (!primary) return null
  // 记录选中产物在节点产物列表里的真实 index，便于后续按 index 重新选取。
  // pickPrimaryArtifact 返回的是第一个视频产物（若无视频则第一个图片），
  // 不能假设永远是 0。
  const primaryIndex = node.artifacts.indexOf(primary)
  const base: WorkbenchResource = {
    id: primary.id,
    source: 'upstream',
    kind: primary.kind,
    title: primary.title || node.title,
    url: primary.url,
    originPath: primary.originPath,
    upstreamNodeId: node.nodeId,
    upstreamArtifactIndex: primaryIndex >= 0 ? primaryIndex : 0,
    importedAt,
  }
  return {
    ...base,
    ...(primary.thumbnailUrl !== undefined ? { thumbnailUrl: primary.thumbnailUrl } : {}),
    ...(primary.durationSec !== undefined ? { durationSec: primary.durationSec } : {}),
    ...(primary.width !== undefined ? { width: primary.width } : {}),
    ...(primary.height !== undefined ? { height: primary.height } : {}),
    ...(primary.fileSize !== undefined ? { fileSize: primary.fileSize } : {}),
  }
}

/** 按顺序把一组上游节点转成资源条目，跳过无可用产物的节点。 */
export function collectUpstreamResources(
  nodes: UpstreamNodeRef[],
  importedAt: number = Date.now(),
): WorkbenchResource[] {
  if (!Array.isArray(nodes)) return []
  const out: WorkbenchResource[] = []
  for (const node of nodes) {
    const resource = upstreamNodeToResource(node, importedAt)
    if (resource) out.push(resource)
  }
  return out
}

/** 用 id 查资源；用于轨道渲染与"是否已加入轨道"判定。 */
export function indexResourcesById(resources: WorkbenchResource[]): Map<string, WorkbenchResource> {
  const map = new Map<string, WorkbenchResource>()
  for (const r of resources) {
    if (r && typeof r.id === 'string') map.set(r.id, r)
  }
  return map
}

/** 旧版独立源视频只在尚未迁入资源面板且轨道为空时自动加入一次。 */
export function shouldSeedSourceTrack(
  track: TrackClip[],
  resources: WorkbenchResource[],
  sourceResourceId: string,
): boolean {
  return track.length === 0 && !resources.some((resource) => resource.id === sourceResourceId)
}

/** 给定资源 id，返回是否已加入轨道（任一 TrackClip 引用即视为已加入）。 */
export function isResourceUsedInTrack(track: TrackClip[], resourceId: string): boolean {
  if (!Array.isArray(track) || !resourceId) return false
  return track.some((clip) => clip && clip.resourceId === resourceId)
}

/** 把新资源追加到轨道末尾，返回新轨道（不可变）。 */
export function appendResourceToTrack(
  track: TrackClip[],
  resource: WorkbenchResource,
  options?: { staticDurationSec?: number },
): TrackClip[] {
  if (!resource) return track.slice()
  const nextOrder = track.length === 0 ? 0 : Math.max(...track.map((c) => c.order)) + 1
  const base: TrackClip = {
    id: generateClipId(),
    resourceId: resource.id,
    order: nextOrder,
  }
  const staticDuration =
    resource.kind === 'image'
      ? (options?.staticDurationSec ?? DEFAULT_IMAGE_STATIC_DURATION_SEC)
      : undefined
  const clip: TrackClip = staticDuration !== undefined ? { ...base, staticDuration } : base
  return [...track, clip]
}

/**
 * 把资源加入轨道，并可指定插入锚点。
 *
 * `undefined` 表示追加到末尾，`null` 表示插入最前，其余字符串表示插到对应 clip 后面。
 * 已存在于轨道的资源保持原样，避免连续点击或同一批状态更新产生重复片段。
 */
export function insertResourceIntoTrack(
  track: TrackClip[],
  resource: WorkbenchResource,
  insertAfterClipId?: string | null,
): TrackClip[] {
  if (isResourceUsedInTrack(track, resource.id)) return track.slice()
  const appended = appendResourceToTrack(track, resource)
  if (insertAfterClipId === undefined) return appended
  const newClip = appended[appended.length - 1]
  if (!newClip) return appended
  if (insertAfterClipId === null) {
    return [newClip, ...appended.slice(0, -1)].map((clip, index) => ({
      ...clip,
      order: index,
    }))
  }
  return appended.some((clip) => clip.id === insertAfterClipId)
    ? reorderTrack(appended, newClip.id, insertAfterClipId)
    : appended
}

/**
 * 在轨道内把 fromId 移动到 toId 之后。
 * - 若 fromId === toId 或不在轨道内，原样返回。
 * - 重排后 order 字段会按新位置重写为 0..n-1。
 */
export function reorderTrack(track: TrackClip[], fromId: string, toId: string): TrackClip[] {
  if (!Array.isArray(track) || track.length === 0) return track.slice()
  if (fromId === toId) return track.slice()
  const fromIdx = track.findIndex((c) => c.id === fromId)
  const toIdx = track.findIndex((c) => c.id === toId)
  if (fromIdx < 0 || toIdx < 0) return track.slice()
  const next = track.slice()
  const [moved] = next.splice(fromIdx, 1)
  if (!moved) return track.slice()
  // 移除后 toIdx 可能在原位置前/后
  const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx
  const insertAt = adjustedTo + 1
  next.splice(insertAt, 0, moved)
  return next.map((clip, i) => ({ ...clip, order: i }))
}

/** 移除指定 clip，并重排 order。 */
export function removeTrackClip(track: TrackClip[], clipId: string): TrackClip[] {
  if (!Array.isArray(track) || track.length === 0) return track.slice()
  const next = track.filter((c) => c.id !== clipId)
  return next.map((clip, i) => ({ ...clip, order: i }))
}

/** 在片段内部按偏移秒数切成前后两段；边界位置不切分。 */
export function splitTrackClip(
  track: TrackClip[],
  resourcesById: Map<string, WorkbenchResource>,
  clipId: string,
  offsetSec: number,
): TrackClip[] {
  const sorted = track.slice().sort((a, b) => a.order - b.order)
  const index = sorted.findIndex((clip) => clip.id === clipId)
  const original = sorted[index]
  if (!original) return track.slice()
  const clip: TrackClip = { ...original }
  sorted[index] = clip
  const resource = resourcesById.get(clip.resourceId)
  const duration = clipDurationSec(clip, resource)
  if (offsetSec <= 0.1 || offsetSec >= duration - 0.1) return track.slice()

  const second: TrackClip = { ...clip, id: generateClipId() }
  if (resource?.kind === 'image') {
    clip.staticDuration = offsetSec
    second.staticDuration = duration - offsetSec
  } else {
    const startSec = clip.range?.startSec ?? 0
    const endSec = clip.range?.endSec ?? resource?.durationSec ?? duration
    const splitSec = startSec + offsetSec
    clip.range = { startSec, endSec: splitSec }
    second.range = { startSec: splitSec, endSec }
  }
  sorted.splice(index + 1, 0, second)
  return sorted.map((item, order) => ({ ...item, order }))
}

/**
 * 把 fromId 移动到 targetId 的指定侧（before / after）。
 *
 * 与 reorderTrack（语义：放到 toId 之后）相比，本函数支持 before/after 单步表达，
 * 避免组件层做"先 reorder 再 findIndex 再 reorder"两次重排。
 *
 * - fromId === targetId 或 fromId/targetId 不在轨道内 → 原样返回（id 不变）
 * - side === 'before'：放到 targetId 之前；targetId 已是首位时等价于 no-op
 * - side === 'after'：放到 targetId 之后（与 reorderTrack 等价）
 * - 重排后 order 字段会按新位置重写为 0..n-1
 */
export function moveClipRelativeTo(
  track: TrackClip[],
  fromId: string,
  targetId: string,
  side: 'before' | 'after',
): TrackClip[] {
  if (!Array.isArray(track) || track.length === 0) return track.slice()
  if (fromId === targetId) return track.slice()
  const fromIdx = track.findIndex((c) => c.id === fromId)
  const toIdx = track.findIndex((c) => c.id === targetId)
  if (fromIdx < 0 || toIdx < 0) return track.slice()
  const next = track.slice()
  const [moved] = next.splice(fromIdx, 1)
  if (!moved) return track.slice()
  // 移除后 toIdx 可能在原位置前/后
  const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx
  const insertAt =
    side === 'after' ? adjustedTo + 1 : side === 'before' ? adjustedTo : adjustedTo + 1
  next.splice(insertAt, 0, moved)
  return next.map((clip, i) => ({ ...clip, order: i }))
}

/** 清空轨道（保留数组引用稳定：返回新数组）。 */
export function clearTrack(): TrackClip[] {
  return []
}

/** 资源在轨道里占的展示时长（秒）。 */
export function clipDurationSec(
  clip: TrackClip | undefined,
  resource: WorkbenchResource | undefined,
): number {
  if (!clip) return 0
  if (clip.range && clip.range.endSec > clip.range.startSec) {
    return Math.max(0, clip.range.endSec - clip.range.startSec)
  }
  if (!resource) return 0
  if (resource.kind === 'image') {
    return Math.max(0, clip.staticDuration ?? DEFAULT_IMAGE_STATIC_DURATION_SEC)
  }
  return Math.max(0, resource.durationSec ?? 0)
}

/** 累加整条轨道总时长（秒）。 */
export function calculateTrackDuration(
  track: TrackClip[],
  resourcesById: Map<string, WorkbenchResource>,
): number {
  if (!Array.isArray(track) || track.length === 0) return 0
  let total = 0
  for (const clip of track) {
    total += clipDurationSec(clip, resourcesById.get(clip.resourceId))
  }
  return total
}

/** 合并去重：把新资源合入已有资源面板，按 id 去重，新条目覆盖旧条目。 */
export function mergeResources(
  existing: WorkbenchResource[],
  incoming: WorkbenchResource[],
): WorkbenchResource[] {
  const map = new Map<string, WorkbenchResource>()
  for (const r of existing) {
    if (r && typeof r.id === 'string') map.set(r.id, r)
  }
  for (const r of incoming) {
    if (r && typeof r.id === 'string') map.set(r.id, r)
  }
  return Array.from(map.values())
}

// ─── 连播（playlist-style playback）位置换算 ──────────────────────────
// 这些纯函数把"整条轨道的全局时间"与"(clip, clip 内偏移)"互相换算，
// 供 useVideoWorkbenchPlayback hook 和播放进度条共用，便于单测。

/** 把整条轨道的全局时间换算为 (clip, clip 内偏移)。超出末尾落在最后一个 clip。 */
export function resolveClipAtGlobalTime(
  track: TrackClip[],
  resourcesById: Map<string, WorkbenchResource>,
  globalSec: number,
): { clip: TrackClip; offsetSec: number } | null {
  if (!Array.isArray(track) || track.length === 0) return null
  const sorted = track.slice().sort((a, b) => a.order - b.order)
  let acc = 0
  for (let i = 0; i < sorted.length; i++) {
    const clip = sorted[i]
    if (!clip) continue
    const dur = clipDurationSec(clip, resourcesById.get(clip.resourceId))
    if (globalSec <= acc + dur || i === sorted.length - 1) {
      return { clip, offsetSec: Math.max(0, globalSec - acc) }
    }
    acc += dur
  }
  // 兜底（理论不可达：循环最后一轮必 return）
  const last = sorted[sorted.length - 1]
  return last ? { clip: last, offsetSec: 0 } : null
}

/** 给定 clipId，返回它在整条轨道里的起始全局时间（秒）。找不到返回 0。 */
export function clipStartSecInTrack(
  track: TrackClip[],
  resourcesById: Map<string, WorkbenchResource>,
  clipId: string | null | undefined,
): number {
  if (!clipId || !Array.isArray(track)) return 0
  const sorted = track.slice().sort((a, b) => a.order - b.order)
  let acc = 0
  for (const clip of sorted) {
    if (clip.id === clipId) return acc
    acc += clipDurationSec(clip, resourcesById.get(clip.resourceId))
  }
  return 0
}

/** clip 内偏移 → video 元素应该 seek 到的时间（含 range 裁剪起点）。 */
export function clipSeekTimeSec(clip: TrackClip, offsetSec: number): number {
  const start = clip.range?.startSec ?? 0
  return Math.max(0, start + Math.max(0, offsetSec))
}
