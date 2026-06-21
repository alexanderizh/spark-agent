/**
 * 分镜图（宫格关键帧）提示词组装（用户诉求：分镜表出来后，按分镜指导在一张图上
 * 以宫格形式展示「许多」关键帧画面）。
 *
 * 纯逻辑：把一个分镜分组的片段拼成「一张多格分镜图」的 text_to_image 提示词，
 * 每格 = 一镜的关键帧画面 + 镜头语言 + 角色/场景 + 时长/对白提示，整体继承视觉总设定。
 * 强调宫格规整、逐格编号、跨格角色/风格一致。无 DOM/IPC，便于单测。
 */

import type { ShotGroup, ShotSegment } from './canvasFilmAssets'

/** 单图最多纳入的宫格数（再多单图会糊；超出建议分多张分镜图） */
export const DEFAULT_MAX_PANELS = 16

/** 按镜数推荐宫格列数：尽量接近正方形，单行不超过 5 列 */
export function recommendGridColumns(count: number): number {
  if (count <= 1) return 1
  if (count <= 4) return 2
  if (count <= 9) return 3
  if (count <= 16) return 4
  return 5
}

/** 行数 = ceil(镜数 / 列数) */
export function gridRows(count: number, columns: number): number {
  if (count <= 0 || columns <= 0) return 0
  return Math.ceil(count / columns)
}

/** 单格描述：镜号 + 关键帧画面 + 镜头 + 角色/场景 + 时长/对白 */
function buildPanelLine(
  segment: ShotSegment,
  panelIndex: number,
  nameById?: (id: string) => string | undefined,
): string {
  const parts: string[] = []
  const visual = (segment.description || segment.title || '').trim()
  parts.push(`Panel ${panelIndex} [key frame]`)
  if (visual) parts.push(visual)
  if (segment.shotPrompt && segment.shotPrompt.trim()) parts.push(`shot: ${segment.shotPrompt.trim()}`)

  if (nameById) {
    const cast = (segment.characterAssetIds ?? [])
      .map((id) => nameById(id))
      .filter((name): name is string => Boolean(name && name.trim()))
    if (cast.length > 0) parts.push(`cast: ${cast.join(', ')}`)
    const scene = segment.sceneAssetId ? nameById(segment.sceneAssetId) : undefined
    if (scene && scene.trim()) parts.push(`scene: ${scene.trim()}`)
  }

  if (typeof segment.durationSec === 'number' && segment.durationSec > 0) {
    parts.push(`${segment.durationSec}s`)
  }
  if (segment.dialogue && segment.dialogue.trim()) parts.push(`dialogue: ${segment.dialogue.trim()}`)
  return parts.join(' — ')
}

/**
 * 组装分镜图提示词。返回可继续编辑的最终 prompt。
 * @param input.maxPanels 限制纳入的镜数（防止格子过多导致单图不清晰），默认 16。
 * @param input.nameById  可选：把角色/场景 assetId 解析为名字，写进每格（提升一致性）。
 */
export function buildStoryboardGridPrompt(input: {
  group: Pick<ShotGroup, 'name' | 'segments'>
  styleBible?: string
  columns?: number
  maxPanels?: number
  nameById?: (id: string) => string | undefined
}): string {
  const maxPanels = input.maxPanels && input.maxPanels > 0 ? input.maxPanels : DEFAULT_MAX_PANELS
  const segments = input.group.segments.slice(0, maxPanels)
  const count = segments.length
  if (count === 0) return ''

  const columns = input.columns && input.columns > 0 ? input.columns : recommendGridColumns(count)
  const rows = gridRows(count, columns)

  const header = [
    `film storyboard sheet containing ${count} key-frame panels`,
    `arranged in a regular ${columns}-column by ${rows}-row grid`,
    'every panel the same size with thin gutters, ordered left-to-right then top-to-bottom',
    'each panel clearly bordered and numbered in the top-left corner',
    'each panel is a distinct key frame of its shot',
    'hand-drawn film storyboard style, consistent character designs and setting across all panels',
    'black and white line art with light grayscale shading, clear readable composition',
    'no speech bubbles, no captions, no watermark',
  ].join(', ')

  const panels = segments
    .map((segment, index) => buildPanelLine(segment, index + 1, input.nameById))
    .join('\n')

  const segs = [header, '', panels]
  if (input.styleBible && input.styleBible.trim()) {
    segs.push('', `overall visual style: ${input.styleBible.trim()}`)
  }
  return segs.join('\n').trim()
}
