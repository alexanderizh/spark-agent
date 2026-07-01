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

export type StoryboardVisualStyle = 'line_art' | 'color_painted'

export type StoryboardPromptInputNode = {
  id: string
  type: string
  title?: string | null
  data?: {
    text?: string
    prompt?: string
    message?: string
    url?: string
  }
}

function storyboardStylePrompt(style: StoryboardVisualStyle): string {
  if (style === 'color_painted') {
    return 'color painted storyboard draft, cinematic lighting, coherent palette, clean production art, readable panel annotations'
  }
  return 'black and white line-art storyboard draft, confident pencil/ink lines, light grayscale shading, readable panel annotations'
}

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
  if (segment.shotPrompt && segment.shotPrompt.trim())
    parts.push(`shot: ${segment.shotPrompt.trim()}`)

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
  if (segment.dialogue && segment.dialogue.trim())
    parts.push(`dialogue: ${segment.dialogue.trim()}`)
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
  visualStyle?: StoryboardVisualStyle
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
    storyboardStylePrompt(input.visualStyle ?? 'line_art'),
    'use concise dialogue and action labels only where needed, no long text blocks, no watermark',
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

function compactText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function nodePromptText(node: StoryboardPromptInputNode): string {
  return (
    compactText(node.data?.prompt) ||
    compactText(node.data?.text) ||
    compactText(node.data?.message) ||
    compactText(node.title)
  )
}

/**
 * 为「故事板节点」组装输入映射上下文：
 * - 图片节点按 inputFiles 顺序写成「参考图 1/2/3」
 * - 每张图片绑定该节点自己的 title/prompt/text，避免多角色卡错配
 * - 文本/Prompt 节点另列为场景与分镜说明
 */
export function buildStoryboardNodePrompt(input: {
  prompt: string
  inputNodes: StoryboardPromptInputNode[]
}): string {
  const sections: string[] = []
  const basePrompt = input.prompt.trim()
  if (basePrompt) sections.push(basePrompt)

  const imageNodes = input.inputNodes.filter(
    (node) => node.type === 'image' && compactText(node.data?.url),
  )
  if (imageNodes.length > 0) {
    sections.push(
      [
        '故事板输入映射（必须严格按顺序使用，不要错配）：',
        ...imageNodes.map((node, index) => {
          const label = compactText(node.title) || `参考图 ${index + 1}`
          const nodePrompt = nodePromptText(node)
          return `- 参考图 ${index + 1} ↔ ${label}${nodePrompt ? `：${nodePrompt}` : ''}`
        }),
        '规则：当提示词中出现第 1 个角色/第 1 张图/角色 A 等顺序描述时，对应参考图 1；第 2 个对应参考图 2；依次类推。',
      ].join('\n'),
    )
  }

  const textContext = input.inputNodes
    .filter((node) => node.type === 'text' || node.type === 'prompt')
    .map((node, index) => {
      const text = nodePromptText(node)
      if (!text) return ''
      const title = compactText(node.title)
      return `- 文本 ${index + 1}${title ? `（${title}）` : ''}：${text}`
    })
    .filter(Boolean)
    .join('\n')
  if (textContext) sections.push(`场景/分镜文字输入：\n${textContext}`)

  return sections.join('\n\n').trim()
}
