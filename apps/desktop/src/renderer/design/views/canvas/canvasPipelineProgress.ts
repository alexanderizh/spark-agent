/**
 * 制作进度引擎（导演台 / Production Cockpit）。
 *
 * 纯逻辑：从画布快照算出「文稿 → 剧本 → 角色/场景/道具 → 分镜 → 关键帧 → 视频」
 * 各阶段的完成度，并推导「下一步建议」。驱动右侧「制作」面板，让整条流水线一目了然。
 */

import type { CanvasAsset, CanvasNode } from './canvas.types'
import { readAssetKind } from './canvasFilmAssets'
import type { ShotGroup } from './canvasFilmAssets'

export type PipelineStageKey =
  | 'manuscript'
  | 'screenplay'
  | 'resource'
  | 'shot'
  | 'keyframe'
  | 'video'

export type PipelineStageProgress = {
  key: PipelineStageKey
  label: string
  count: number
  /** 次要说明（如「总时长 42s」「角色3·场景2·道具1」） */
  detail?: string
  done: boolean
}

export type PipelineNextAction = {
  stageKey: PipelineStageKey
  /** 行动号召文案 */
  cta: string
  /** 一句话提示该步怎么做 */
  hint: string
}

export type PipelineProgress = {
  stages: PipelineStageProgress[]
  completedStages: number
  totalStages: number
  /** 0-100 */
  percent: number
  nextAction: PipelineNextAction | null
}

export type PipelineProgressInput = {
  assets: CanvasAsset[]
  nodes: CanvasNode[]
  metadata: Record<string, unknown> | undefined
}

function countByKind(assets: CanvasAsset[]) {
  const counts: Record<string, number> = {}
  for (const asset of assets) {
    const kind = readAssetKind(asset)
    if (kind) counts[kind] = (counts[kind] ?? 0) + 1
  }
  return counts
}

function readShotGroups(metadata: Record<string, unknown> | undefined): ShotGroup[] {
  const film = metadata?.['film'] as { shotGroups?: ShotGroup[] } | undefined
  return film?.shotGroups ?? []
}

function readChapterCount(metadata: Record<string, unknown> | undefined): number {
  const film = metadata?.['film'] as
    | { manuscript?: { chapters?: unknown[] } }
    | undefined
  return film?.manuscript?.chapters?.length ?? 0
}

/** 计算制作进度 */
export function computePipelineProgress(input: PipelineProgressInput): PipelineProgress {
  const kinds = countByKind(input.assets)
  const chapterCount = readChapterCount(input.metadata)
  const scriptCount = kinds['script'] ?? 0
  const characterCount = kinds['character'] ?? 0
  const sceneCount = kinds['scene'] ?? 0
  const propCount = kinds['prop'] ?? 0
  const resourceCount = characterCount + sceneCount + propCount

  const shotGroups = readShotGroups(input.metadata)
  let shotCount = 0
  let totalDurationSec = 0
  for (const group of shotGroups) {
    for (const segment of group.segments) {
      shotCount += 1
      if (typeof segment.durationSec === 'number') totalDurationSec += segment.durationSec
    }
  }

  const keyframeCount = input.nodes.filter(
    (node) => node.data?.pipelineRole === 'keyframe',
  ).length
  const videoCount = input.nodes.filter(
    (node) => node.type === 'video' && Boolean(node.data?.url),
  ).length

  const round1 = (n: number) => Math.round(n * 10) / 10

  const stages: PipelineStageProgress[] = [
    {
      key: 'manuscript',
      label: '文稿分章',
      count: chapterCount,
      ...(chapterCount > 0 ? { detail: `${chapterCount} 章` } : {}),
      done: chapterCount > 0,
    },
    {
      key: 'screenplay',
      label: '剧本',
      count: scriptCount,
      ...(scriptCount > 0 ? { detail: `${scriptCount} 个剧本` } : {}),
      done: scriptCount > 0,
    },
    {
      key: 'resource',
      label: '资源设计',
      count: resourceCount,
      ...(resourceCount > 0
        ? { detail: `角色${characterCount}·场景${sceneCount}·道具${propCount}` }
        : {}),
      done: resourceCount > 0,
    },
    {
      key: 'shot',
      label: '分镜',
      count: shotCount,
      ...(shotCount > 0
        ? { detail: totalDurationSec > 0 ? `${shotCount} 镜·${round1(totalDurationSec)}s` : `${shotCount} 镜` }
        : {}),
      done: shotCount > 0,
    },
    {
      key: 'keyframe',
      label: '关键帧',
      count: keyframeCount,
      ...(keyframeCount > 0 ? { detail: `${keyframeCount} 帧` } : {}),
      done: keyframeCount > 0,
    },
    {
      key: 'video',
      label: '视频',
      count: videoCount,
      ...(videoCount > 0 ? { detail: `${videoCount} 段` } : {}),
      done: videoCount > 0,
    },
  ]

  const completedStages = stages.filter((stage) => stage.done).length
  const percent = Math.round((completedStages / stages.length) * 100)

  return {
    stages,
    completedStages,
    totalStages: stages.length,
    percent,
    nextAction: deriveNextAction(stages),
  }
}

const NEXT_ACTION_COPY: Record<PipelineStageKey, { cta: string; hint: string }> = {
  manuscript: { cta: '导入文稿并分章', hint: '在影视资产中心「文稿」导入小说或长文稿，自动按章切分' },
  screenplay: { cta: '把章节转成剧本', hint: '在「章节」卡片点「转剧本」，或右键章节节点 →「转剧本」' },
  resource: { cta: '从剧本抽取资源', hint: '右键剧本节点 →「抽取资源」，生成角色/场景/道具' },
  shot: { cta: '生成分镜', hint: '在分镜面板「按剧本自动分镜」，或右键剧本 →「生成分镜」' },
  keyframe: { cta: '生成关键帧', hint: '分镜片段「生成关键帧」，或「设为关键帧」把画布图片绑定为首/尾帧' },
  video: { cta: '逐段生成视频', hint: '分镜片段「生成视频」，有关键帧时自动走首尾帧图生视频' },
}

function deriveNextAction(stages: PipelineStageProgress[]): PipelineNextAction | null {
  const firstUndone = stages.find((stage) => !stage.done)
  if (!firstUndone) return null
  const copy = NEXT_ACTION_COPY[firstUndone.key]
  return { stageKey: firstUndone.key, cta: copy.cta, hint: copy.hint }
}
