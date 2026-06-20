/**
 * 角色设定图提示词模板库（设计 §10 引擎 / §S4 标杆环节）。
 *
 * 与 canvasFilmPrompts（镜头语言）、canvasFilmPerformancePrompts（表演）同构：
 * 「积木 + 命名模板」两层。每个面向（aspect）= 一套内置模板，自动把角色结构化
 * 字段 + 视觉总设定填进去，生成可继续编辑的角色图提示词。
 *
 * 一致性策略：先出「三视图正面」作为角色基准图（concept），其余面向走 image_to_image
 * 喂基准图，保证同一张脸 / 同一套设定。
 */

import type { FilmCharacter } from './canvasFilmTypes'
import type { FilmReferenceKind } from './canvasFilmTypes'

/** 角色图面向 */
export type CharacterSheetAspect =
  | 'turnaround' // 三视图
  | 'expression' // 表情
  | 'distance' // 远近（景别变体）
  | 'costume' // 服装
  | 'facial' // 五官特写
  | 'props' // 常用武器/道具

export type CharacterSheetTemplate = {
  aspect: CharacterSheetAspect
  /** 中文标签 */
  label: string
  /** 面向说明 */
  description: string
  /** 产物回挂为哪种 FilmReference kind */
  referenceKind: FilmReferenceKind
  /** 该面向的提示词积木（结构化英文短语） */
  fragments: string[]
  /**
   * 是否需要角色基准图作为输入（image_to_image 保一致性）。
   * 三视图本身是基准，为 false；其余面向为 true。
   */
  needsBaseImage: boolean
}

/** 内置角色设定图模板（每个面向 ≥1 默认模板） */
export const CHARACTER_SHEET_TEMPLATES: CharacterSheetTemplate[] = [
  {
    aspect: 'turnaround',
    label: '三视图',
    description: '正面 / 侧面 / 背面同一角色定妆，作为后续所有面向的基准图',
    referenceKind: 'concept',
    fragments: [
      'character turnaround model sheet',
      'front view, side view, back view',
      'T-pose, full body',
      'consistent character design',
      'neutral gray background',
      'even studio lighting',
      'no text, no watermark',
    ],
    needsBaseImage: false,
  },
  {
    aspect: 'expression',
    label: '表情',
    description: '一组面部表情，统一脸型与五官',
    referenceKind: 'expression',
    fragments: [
      'character expression sheet',
      'multiple facial expressions: neutral, smile, angry, sad, surprised, smirk',
      'same character, consistent face',
      'head and shoulders, grid layout',
      'neutral background',
    ],
    needsBaseImage: true,
  },
  {
    aspect: 'distance',
    label: '远近',
    description: '远景 / 全身 / 半身 / 近景 / 特写 景别变体',
    referenceKind: 'angle',
    fragments: [
      'shot scale variation sheet',
      'extreme long shot, full body shot, medium shot, close-up, extreme close-up',
      'same character, consistent design',
      'neutral background',
    ],
    needsBaseImage: true,
  },
  {
    aspect: 'costume',
    label: '服装',
    description: '多套服饰 / 换装，全身展示',
    referenceKind: 'costume',
    fragments: [
      'costume design sheet',
      'multiple outfits, full body',
      'same character, consistent face and body',
      'neutral background, front view',
    ],
    needsBaseImage: true,
  },
  {
    aspect: 'facial',
    label: '五官',
    description: '面部细节特写（眼 / 鼻 / 口 / 发际线）',
    referenceKind: 'reference',
    fragments: [
      'facial feature close-up study',
      'eyes detail, nose detail, mouth detail, hairline detail',
      'front view and three-quarter view',
      'beauty lighting, high detail',
      'same character, consistent face',
    ],
    needsBaseImage: true,
  },
  {
    aspect: 'props',
    label: '武器道具',
    description: '角色标志性武器 / 随身道具设定',
    referenceKind: 'reference',
    fragments: [
      'prop design sheet',
      'signature weapon and personal items',
      'multiple angles, isolated on neutral background',
      'consistent art style, high detail',
    ],
    needsBaseImage: true,
  },
]

export const CHARACTER_SHEET_ASPECT_ORDER: CharacterSheetAspect[] = CHARACTER_SHEET_TEMPLATES.map(
  (template) => template.aspect,
)

export function getCharacterSheetTemplate(
  aspect: CharacterSheetAspect,
): CharacterSheetTemplate | undefined {
  return CHARACTER_SHEET_TEMPLATES.find((template) => template.aspect === aspect)
}

/** 角色核心描述所需字段（FilmCharacter 子集，全部可选，便于解耦/测试） */
export type CharacterPromptFields = Partial<
  Pick<
    FilmCharacter,
    | 'name'
    | 'ageStage'
    | 'gender'
    | 'occupation'
    | 'appearance'
    | 'hairstyle'
    | 'costume'
    | 'signatureProps'
    | 'personalityKeywords'
    | 'lockedAttributes'
  >
>

/** 把角色结构化字段拼成「角色核心描述」 */
export function buildCharacterCoreDescription(character: CharacterPromptFields): string {
  const parts: string[] = []
  if (character.gender) parts.push(character.gender)
  if (character.ageStage) parts.push(character.ageStage)
  if (character.occupation) parts.push(character.occupation)
  if (character.appearance) parts.push(character.appearance)
  if (character.hairstyle) parts.push(character.hairstyle)
  if (character.costume) parts.push(character.costume)
  if (character.signatureProps && character.signatureProps.length > 0) {
    parts.push(character.signatureProps.join(', '))
  }
  if (character.personalityKeywords && character.personalityKeywords.length > 0) {
    parts.push(character.personalityKeywords.join(', '))
  }
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
}

/**
 * 组装角色图提示词：角色核心描述 + 面向模板积木 + 视觉总设定 + 一致性锁定项 + 额外补充。
 * 返回可继续编辑的最终 prompt。
 */
export function buildCharacterSheetPrompt(input: {
  aspect: CharacterSheetAspect
  character: CharacterPromptFields
  /** S0 视觉总设定（项目级风格） */
  styleBible?: string
  /** 用户额外补充 */
  extraPrompt?: string
}): string {
  const template = getCharacterSheetTemplate(input.aspect)
  if (!template) return input.extraPrompt?.trim() ?? ''

  const segments: string[] = []
  const core = buildCharacterCoreDescription(input.character)
  if (core) segments.push(core)
  segments.push(...template.fragments)
  if (input.styleBible && input.styleBible.trim()) segments.push(input.styleBible.trim())
  if (input.character.lockedAttributes && input.character.lockedAttributes.length > 0) {
    segments.push(`keep consistent: ${input.character.lockedAttributes.join(', ')}`)
  }
  if (input.extraPrompt && input.extraPrompt.trim()) segments.push(input.extraPrompt.trim())

  // 去重保持顺序
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const segment of segments) {
    const normalized = segment.trim()
    if (!normalized || seen.has(normalized.toLowerCase())) continue
    seen.add(normalized.toLowerCase())
    deduped.push(normalized)
  }
  return deduped.join(', ')
}
