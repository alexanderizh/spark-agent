/**
 * 视频步骤（P6）纯数据层：从 stepStudioState 收集已完成分段的视频产物，
 * 幂等组装为视频工作台 V2 多轨工程（物化 video_workbench 节点的 data.videoWorkbench）。
 *
 * 组装策略（设计 §5.3）：
 * - step 生成的 resource/clip 用固定 id 前缀标记（stepres_/stepclip_），
 *   重组装时只替换这些标记项，用户在工作台手动添加的轨道/片段原样保留。
 * - 新一轮 step clips 铺在主视频轨末尾（resolveVideoWorkbenchTrackAppendTime），
 *   避免与保留的用户片段在时间线上重叠。
 */

import type { CanvasAsset, StepStudioState } from '../canvas.types'
import type {
  VideoWorkbenchClip,
  VideoWorkbenchProjectV2,
  VideoWorkbenchResourceV2,
  VideoWorkbenchTrack,
} from '../videoWorkbench/model/projectTypes'
import { createDefaultVideoWorkbenchProject } from '../videoWorkbench/model/projectTypes'
import { readVideoWorkbenchProject } from '../videoWorkbench/model/projectParser'
import {
  createVideoWorkbenchClipForResource,
  createVideoWorkbenchTrack,
  findDefaultVideoWorkbenchTrackForResource,
  resolveVideoWorkbenchTrackAppendTime,
} from '../videoWorkbench/model/timelineEditing'

export const STEP_RESOURCE_ID_PREFIX = 'stepres_'
export const STEP_CLIP_ID_PREFIX = 'stepclip_'

export interface StepAssemblySource {
  sequenceId: string
  sequenceTitle: string
  segmentId: string
  segmentOrder: number
  videoAsset: CanvasAsset
  /** clip 时长估算（秒；资产缺时长时用 undefined，clip 侧再落默认） */
  durationSec: number | undefined
}

/** 按序列/分段 order（用户语义顺序）收集已完成分段的最新视频产物 */
export function collectAssemblySources(
  state: StepStudioState,
  assetsById: Map<string, CanvasAsset>,
): StepAssemblySource[] {
  const sources: StepAssemblySource[] = []
  // order 是用户可调的顺序语义；数组物理顺序可能短暂漂移（移动操作中转态），排序防御
  const orderedSequences = [...state.sequences].sort((left, right) => left.order - right.order)
  for (const sequence of orderedSequences) {
    const orderedSegments = [...sequence.segments].sort((left, right) => left.order - right.order)
    for (const segment of orderedSegments) {
      // 只收完成的段：persisted status 由分镜步骤的任务终态同步维护
      if (segment.status !== 'done') continue
      let videoAsset: CanvasAsset | null = null
      for (let index = segment.outputVideoAssetIds.length - 1; index >= 0; index -= 1) {
        const id = segment.outputVideoAssetIds[index]
        if (!id) continue
        const asset = assetsById.get(id)
        if (asset && asset.type === 'video') {
          videoAsset = asset
          break
        }
      }
      if (!videoAsset) continue
      sources.push({
        sequenceId: sequence.id,
        sequenceTitle: sequence.title,
        segmentId: segment.id,
        segmentOrder: segment.order,
        videoAsset,
        durationSec:
          typeof videoAsset.durationMs === 'number' && videoAsset.durationMs > 0
            ? videoAsset.durationMs / 1000
            : undefined,
      })
    }
  }
  return sources
}

function assemblyResourceTitle(source: StepAssemblySource): string {
  return `${source.sequenceTitle} · 第 ${source.segmentOrder + 1} 段`
}

function buildAssemblyResource(source: StepAssemblySource): VideoWorkbenchResourceV2 {
  const asset = source.videoAsset
  return {
    id: `${STEP_RESOURCE_ID_PREFIX}${source.segmentId}`,
    source: 'canvas',
    kind: 'video',
    title: asset.title?.trim() || assemblyResourceTitle(source),
    url: typeof asset.url === 'string' && asset.url ? asset.url : (asset.storageKey ?? ''),
    originPath: typeof asset.storageKey === 'string' ? asset.storageKey : '',
    importedAt: Date.now(),
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    ...(typeof asset.thumbnailUrl === 'string' && asset.thumbnailUrl
      ? { thumbnailUrl: asset.thumbnailUrl }
      : {}),
    ...(source.durationSec != null ? { durationSec: source.durationSec } : {}),
  }
}

function isStepResource(resource: VideoWorkbenchResourceV2): boolean {
  return resource.id.startsWith(STEP_RESOURCE_ID_PREFIX)
}

function isStepClip(clip: VideoWorkbenchClip, stepResourceIds: Set<string>): boolean {
  return (
    clip.id.startsWith(STEP_CLIP_ID_PREFIX) ||
    (clip.resourceId != null && stepResourceIds.has(clip.resourceId))
  )
}

function segmentIdFromStepClipId(clipId: string): string | null {
  return clipId.startsWith(STEP_CLIP_ID_PREFIX) ? clipId.slice(STEP_CLIP_ID_PREFIX.length) : null
}

function segmentIdFromStepResourceId(resourceId: string): string | null {
  return resourceId.startsWith(STEP_RESOURCE_ID_PREFIX)
    ? resourceId.slice(STEP_RESOURCE_ID_PREFIX.length)
    : null
}

/** 产物内容是否一致（url 与本地路径均相同视为未变） */
function sameResourceContent(
  legacy: VideoWorkbenchResourceV2,
  next: VideoWorkbenchResourceV2,
): boolean {
  return legacy.url === next.url && legacy.originPath === next.originPath
}

/**
 * 产物已变时迁移「与内容无绑定」的风格性编辑（变速/启停/变换/音频/淡入淡出）。
 * 裁剪点（sourceIn/Out）与时间线位置不迁移：它们针对旧素材内容，新视频内容
 * 已变化，照搬会得到语义错误的片段；新 clip 以全时长铺主轨末尾重新起位。
 */
function migrateLegacyClipEdits(
  legacy: VideoWorkbenchClip,
  fresh: VideoWorkbenchClip,
): VideoWorkbenchClip {
  const speed = legacy.speed > 0 ? legacy.speed : fresh.speed
  const durationSec =
    speed === fresh.speed ? fresh.durationSec : fresh.durationSec * (fresh.speed / speed)
  return {
    ...fresh,
    speed,
    durationSec,
    enabled: legacy.enabled,
    ...(legacy.transform != null ? { transform: legacy.transform } : {}),
    ...(legacy.audio != null ? { audio: legacy.audio } : {}),
    ...(legacy.fadeInSec != null ? { fadeInSec: legacy.fadeInSec } : {}),
    ...(legacy.fadeOutSec != null ? { fadeOutSec: legacy.fadeOutSec } : {}),
  }
}

/**
 * 幂等组装：解析既有工程（v1/v2/损坏均容错），剥离旧 step 资源与片段，
 * 把当前 sources 顺序铺到主视频轨末尾。返回可直接写节点 data 的新工程。
 *
 * 重组装保留用户对 step clip 的手动编辑（二期）：
 * - 产物未变的分段：原 clip 原样保留（含裁剪点/时间线位置/所在轨道，
 *   用户在工作台的精剪成果不丢失）；
 * - 产物已变（重新生成）的分段：仅迁移风格性编辑，铺主轨末尾重新起位；
 * - 用户手动添加的轨道/片段/资源始终原样保留。
 */
export function applyAssemblyToProject(
  raw: unknown,
  sources: StepAssemblySource[],
): VideoWorkbenchProjectV2 {
  const parsed = readVideoWorkbenchProject(raw)
  const base = parsed.project ?? createDefaultVideoWorkbenchProject()

  // 1) 索引旧 step 资源与片段（segmentId → 产物/clip 及所在轨道），供编辑保留
  const oldStepResourceBySegmentId = new Map<string, VideoWorkbenchResourceV2>()
  for (const resource of base.resources) {
    const segmentId = segmentIdFromStepResourceId(resource.id)
    if (segmentId) oldStepResourceBySegmentId.set(segmentId, resource)
  }
  const oldStepClipBySegmentId = new Map<string, { clip: VideoWorkbenchClip; trackId: string }>()
  for (const track of base.tracks) {
    for (const clip of track.clips) {
      const segmentId = segmentIdFromStepClipId(clip.id)
      if (segmentId) oldStepClipBySegmentId.set(segmentId, { clip, trackId: track.id })
    }
  }

  // 2) 剥离上一轮 step 资源与片段（用户手动内容全保留）
  const oldStepResourceIds = new Set(
    base.resources.filter(isStepResource).map((resource) => resource.id),
  )
  const resources = base.resources.filter((resource) => !isStepResource(resource))
  const tracks = base.tracks.map((track) => ({
    ...track,
    clips: track.clips.filter((clip) => !isStepClip(clip, oldStepResourceIds)),
  }))

  // 3) 无 sources 时仅做清理（分镜步骤产物被删后同步回收）
  if (sources.length === 0) {
    return { ...base, resources, tracks }
  }

  // 4) 追加本轮资源
  const newResources = sources.map(buildAssemblyResource)
  const newResourceBySegmentId = new Map(
    newResources.map((resource, index) => [sources[index]!.segmentId, resource]),
  )
  const project: VideoWorkbenchProjectV2 = {
    ...base,
    resources: [...resources, ...newResources],
    tracks,
  }

  let mainTrack: VideoWorkbenchTrack | undefined = findDefaultVideoWorkbenchTrackForResource(
    project,
    newResources[0]!,
  )
  let nextTracks = project.tracks
  if (!mainTrack) {
    mainTrack = createVideoWorkbenchTrack(project, 'video')
    nextTracks = [...project.tracks, mainTrack]
  }

  // 5) 逐段落位：产物未变回原轨原位；产物已变/新增铺主轨末尾顺序追加
  const trackIdSet = new Set(nextTracks.map((track) => track.id))
  const clipAdditionsByTrackId = new Map<string, VideoWorkbenchClip[]>()
  const appendToTrack = (trackId: string, clip: VideoWorkbenchClip): void => {
    const bucket = clipAdditionsByTrackId.get(trackId)
    if (bucket) bucket.push(clip)
    else clipAdditionsByTrackId.set(trackId, [clip])
  }

  let timelineStartSec = resolveVideoWorkbenchTrackAppendTime(mainTrack)
  for (const source of sources) {
    const resource = newResourceBySegmentId.get(source.segmentId)
    if (!resource) continue
    const legacy = oldStepClipBySegmentId.get(source.segmentId)
    const legacyResource = oldStepResourceBySegmentId.get(source.segmentId)
    const unchanged =
      legacy != null &&
      legacyResource != null &&
      sameResourceContent(legacyResource, resource) &&
      trackIdSet.has(legacy.trackId)
    // stepclip_ 前缀 id 是重组装识别与替换的标记，任何落位路径都必须覆盖
    const stepClipId = `${STEP_CLIP_ID_PREFIX}${source.segmentId}`

    if (unchanged && legacy) {
      // 产物未变：原 clip 原样回原轨（裁剪/位置/属性全保留，仅刷新资源指向）
      appendToTrack(legacy.trackId, { ...legacy.clip, id: stepClipId, resourceId: resource.id })
      continue
    }

    const fresh = createVideoWorkbenchClipForResource(project, resource, timelineStartSec)
    timelineStartSec += fresh.durationSec
    appendToTrack(mainTrack!.id, {
      ...(legacy ? migrateLegacyClipEdits(legacy.clip, fresh) : fresh),
      id: stepClipId,
    })
  }

  return {
    ...project,
    tracks: nextTracks.map((track) => {
      const additions = clipAdditionsByTrackId.get(track.id)
      return additions ? { ...track, clips: [...track.clips, ...additions] } : track
    }),
  }
}

/** 轻量预览的总时长估算（秒；未知时长的段按 0 计，仅用于展示提示） */
export function estimateAssemblyDurationSec(sources: StepAssemblySource[]): number {
  return sources.reduce((total, source) => total + (source.durationSec ?? 0), 0)
}
