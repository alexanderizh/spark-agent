/**
 * 分镜拆分（设计 §S6 / §S8：单段视频模型时长上限，需把一镜拆成多段逐段制作）。
 *
 * 纯逻辑：把一个分镜片段按「时长上限」或「指定段数 / 指定切点」拆成多段，
 * 每段继承父镜的角色/场景/道具/风格预设引用与镜头提示词，重算 in/out/时长。
 * 无 DOM/IPC，便于单测。
 */

import type { ShotSegment } from './canvasFilmAssets'
import { DEFAULT_MAX_CLIP_SEC } from './canvasAgentPromptPresets'

/** 拆分产物：可直接喂给 createShotSegment 的字段子集（不含 id / index，由调用方分配） */
export type ShotSplitPart = {
  title: string
  description?: string
  dialogue?: string
  narration?: string
  durationSec: number
  inSec: number
  outSec: number
  characterAssetIds?: string[]
  sceneAssetId?: string
  propAssetIds?: string[]
  shotPrompt?: string
  cameraDesignId?: string
  actionDesignId?: string
  frameDesignId?: string
}

/** 取片段时长：优先 durationSec，其次 out-in，最后兜底 0 */
export function resolveSegmentDuration(segment: Pick<ShotSegment, 'durationSec' | 'inSec' | 'outSec'>): number {
  if (typeof segment.durationSec === 'number' && segment.durationSec > 0) return segment.durationSec
  if (
    typeof segment.inSec === 'number' &&
    typeof segment.outSec === 'number' &&
    segment.outSec > segment.inSec
  ) {
    return segment.outSec - segment.inSec
  }
  return 0
}

/** 四舍五入到 0.5 秒，避免浮点毛刺 */
function roundHalf(value: number): number {
  return Math.round(value * 2) / 2
}

/**
 * 把一个分镜片段拆成多段。
 *
 * 段数决定优先级：
 *   1. `parts` 显式指定段数；
 *   2. 否则按 `maxClipSec` 时长上限计算 `ceil(duration / maxClipSec)`。
 *
 * 拆分后每段均分父镜时长，in/out 从父镜 inSec（缺省 0）累计推进。
 * 对白默认保留在第一段（视觉继续，但台词不重复）；其余字段全部继承。
 */
export function planSegmentSplit(
  segment: ShotSegment,
  options: { maxClipSec?: number; parts?: number } = {},
): ShotSplitPart[] {
  const duration = resolveSegmentDuration(segment)
  const maxClip = options.maxClipSec && options.maxClipSec > 0 ? options.maxClipSec : DEFAULT_MAX_CLIP_SEC

  let parts: number
  if (options.parts && options.parts > 0) {
    parts = Math.floor(options.parts)
  } else if (duration > 0) {
    parts = Math.max(1, Math.ceil(duration / maxClip))
  } else {
    parts = 1
  }

  // 不需要拆（单段且未强制多段）：返回单段归一化结果
  if (parts <= 1) {
    return [toSinglePart(segment, duration)]
  }

  const baseIn = typeof segment.inSec === 'number' ? segment.inSec : 0
  // 总时长未知时，用 maxClip * parts 兜底，保证每段有合理时长
  const effectiveDuration = duration > 0 ? duration : maxClip * parts
  const chunk = roundHalf(effectiveDuration / parts)

  const result: ShotSplitPart[] = []
  let cursor = baseIn
  for (let i = 0; i < parts; i += 1) {
    // 最后一段吸收四舍五入余量，保证 out 与父镜对齐
    const isLast = i === parts - 1
    const segOut = isLast ? roundHalf(baseIn + effectiveDuration) : roundHalf(cursor + chunk)
    const segDuration = roundHalf(segOut - cursor)
    result.push({
      title: `${segment.title} (${i + 1}/${parts})`,
      ...(segment.description ? { description: segment.description } : {}),
      // 对白只放第一段，避免逐段重复念白
      ...(i === 0 && segment.dialogue ? { dialogue: segment.dialogue } : {}),
      ...(i === 0 && segment.narration ? { narration: segment.narration } : {}),
      durationSec: segDuration > 0 ? segDuration : chunk,
      inSec: roundHalf(cursor),
      outSec: segOut,
      ...inheritRefs(segment),
    })
    cursor = segOut
  }
  return result
}

/**
 * 在指定时间点（相对父镜起点的秒数）把一个分镜片段切成两段。
 * `atSec` 会被夹到 (0, duration) 开区间内；越界时退化为均分两段。
 */
export function splitSegmentAt(segment: ShotSegment, atSec: number): ShotSplitPart[] {
  const duration = resolveSegmentDuration(segment)
  const baseIn = typeof segment.inSec === 'number' ? segment.inSec : 0
  const effectiveDuration = duration > 0 ? duration : DEFAULT_MAX_CLIP_SEC * 2
  let cut = roundHalf(atSec)
  if (!(cut > 0) || cut >= effectiveDuration) cut = roundHalf(effectiveDuration / 2)

  const midOut = roundHalf(baseIn + cut)
  const endOut = roundHalf(baseIn + effectiveDuration)
  return [
    {
      title: `${segment.title} (1/2)`,
      ...(segment.description ? { description: segment.description } : {}),
      ...(segment.dialogue ? { dialogue: segment.dialogue } : {}),
      ...(segment.narration ? { narration: segment.narration } : {}),
      durationSec: roundHalf(midOut - baseIn),
      inSec: roundHalf(baseIn),
      outSec: midOut,
      ...inheritRefs(segment),
    },
    {
      title: `${segment.title} (2/2)`,
      ...(segment.description ? { description: segment.description } : {}),
      durationSec: roundHalf(endOut - midOut),
      inSec: midOut,
      outSec: endOut,
      ...inheritRefs(segment),
    },
  ]
}

function toSinglePart(segment: ShotSegment, duration: number): ShotSplitPart {
  const baseIn = typeof segment.inSec === 'number' ? segment.inSec : 0
  const effectiveDuration = duration > 0 ? duration : DEFAULT_MAX_CLIP_SEC
  return {
    title: segment.title,
    ...(segment.description ? { description: segment.description } : {}),
    ...(segment.dialogue ? { dialogue: segment.dialogue } : {}),
    ...(segment.narration ? { narration: segment.narration } : {}),
    durationSec: roundHalf(effectiveDuration),
    inSec: roundHalf(baseIn),
    outSec: roundHalf(baseIn + effectiveDuration),
    ...inheritRefs(segment),
  }
}

/** 继承父镜的资源引用与风格预设 id（拆分后各段共享同一套设定，保证连贯） */
function inheritRefs(
  segment: ShotSegment,
): Pick<
  ShotSplitPart,
  | 'characterAssetIds'
  | 'sceneAssetId'
  | 'propAssetIds'
  | 'shotPrompt'
  | 'cameraDesignId'
  | 'actionDesignId'
  | 'frameDesignId'
> {
  return {
    ...(segment.characterAssetIds && segment.characterAssetIds.length > 0
      ? { characterAssetIds: [...segment.characterAssetIds] }
      : {}),
    ...(segment.sceneAssetId ? { sceneAssetId: segment.sceneAssetId } : {}),
    ...(segment.propAssetIds && segment.propAssetIds.length > 0
      ? { propAssetIds: [...segment.propAssetIds] }
      : {}),
    ...(segment.shotPrompt ? { shotPrompt: segment.shotPrompt } : {}),
    ...(segment.cameraDesignId ? { cameraDesignId: segment.cameraDesignId } : {}),
    ...(segment.actionDesignId ? { actionDesignId: segment.actionDesignId } : {}),
    ...(segment.frameDesignId ? { frameDesignId: segment.frameDesignId } : {}),
  }
}
