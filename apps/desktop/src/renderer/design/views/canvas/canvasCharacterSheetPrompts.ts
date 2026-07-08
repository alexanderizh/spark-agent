/**
 * 角色设定图提示词模板库（设计 §10 引擎 / §S4 标杆环节）。
 *
 * 与 canvasFilmPrompts（镜头语言）、canvasFilmPerformancePrompts（表演）同构：
 * 「积木 + 命名模板」两层。每个面向（aspect）= 一套内置模板，自动把角色结构化
 * 字段 + 视觉总设定填进去，生成可继续编辑的角色图提示词。
 *
 * 一致性策略：先出「角色身份板（turnaround 综合卡）正面」作为角色基准图（concept），其余面向走 image_to_image
 * 喂基准图，保证同一张脸 / 同一套设定。
 */

import type { FilmCharacter } from './canvasFilmTypes'
import type { FilmReferenceKind } from './canvasFilmTypes'

/** 角色图面向 */
export type CharacterSheetAspect =
  | 'turnaround' // 角色身份板（三视图综合卡，含坐姿/仰视俯视等）
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
   * 角色身份板（turnaround）本身是基准，为 false；其余面向为 true。
   */
  needsBaseImage: boolean
}

/** 内置角色设定图模板（每个面向 ≥1 默认模板） */
export const CHARACTER_SHEET_TEMPLATES: CharacterSheetTemplate[] = [
  {
    aspect: 'turnaround',
    label: '角色卡 · 身份板',
    description:
      '完整角色身份板：三视图 + 面部特写 + 带标注表情条 + 配饰/道具板 + 坐姿 + 仰视/俯视视角 + 角色名与描述，作为后续所有面向的基准图',
    referenceKind: 'concept',
    fragments: [
      'large comprehensive character design sheet / character reference card, ultra high resolution, professional concept art',
      'character turnaround model sheet',
      'full body turnaround: front view, side view, three-quarter view and back view, consistent proportions and costume',
      'one large detailed facial close-up portrait panel (eyes, nose, mouth, skin and hair detail)',
      'expression panel with 5-6 facial expressions (neutral, smile, angry, sad, surprised, determined), each in its own small framed box with a short caption label',
      'accessories and worn items panel (jewelry, glasses, belt, gear) shown separately with small text labels',
      'signature props and personal items panel with scale reference and labels',
      'costume breakdown with fabric layers, seams, footwear and material callouts',
      'hands and key detail close-ups',
      'sitting pose reference panel (seated on a chair / ground / cushion), shown full body from the side and front with consistent costume and proportions',
      'camera angle reference panel: low-angle shot (hero angle looking up) and high-angle shot (looking down) of the same character, each clearly labeled with its angle, consistent design and costume',
      'character name rendered as a clean bold title, plus a short one-line role description caption in small neat typography',
      'organized labeled-panel layout grouped by section, like a studio model sheet',
      'neutral light-gray studio background, even soft lighting',
      'no watermark',
    ],
    needsBaseImage: false,
  },
  {
    aspect: 'expression',
    label: '表情',
    description: '一组带标注的面部表情，统一脸型与五官',
    referenceKind: 'expression',
    fragments: [
      'character expression sheet',
      'multiple facial expressions: neutral, gentle smile, laughing, angry, sad, surprised, smirk, determined',
      'each expression in its own framed cell with a short label caption',
      'same character, consistent face shape and features',
      'head and shoulders, clean grid layout',
      'consistent lighting',
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
      'extreme long shot, full body shot, medium shot, close-up, extreme close-up of the same character',
      'each shot labeled with its scale, arranged left to right from wide to tight',
      'same character, consistent design and costume',
      'consistent cinematic lighting, neutral background',
    ],
    needsBaseImage: true,
  },
  {
    aspect: 'costume',
    label: '服装',
    description: '多套服饰 / 换装，全身展示并标注',
    referenceKind: 'costume',
    fragments: [
      'costume design sheet',
      'multiple full-body outfits for the same character (everyday, formal, action), each with a short label',
      'fabric, color and accessory callouts for each outfit',
      'same character, consistent face and body proportions',
      'neutral background, front view full body',
    ],
    needsBaseImage: true,
  },
  {
    aspect: 'facial',
    label: '五官',
    description: '面部细节特写（脸型 / 眼 / 鼻 / 口 / 眉 / 发际线）',
    referenceKind: 'reference',
    fragments: [
      'facial feature close-up study sheet',
      'face shape, eyes detail, eyebrows, nose detail, mouth detail, ears and hairline detail',
      'front view, three-quarter view and profile of the face',
      'skin texture and distinguishing marks preserved',
      'beauty lighting, ultra high detail',
      'same character, consistent face',
    ],
    needsBaseImage: true,
  },
  {
    aspect: 'props',
    label: '武器道具',
    description: '角色标志性武器 / 随身道具 / 配饰设定',
    referenceKind: 'reference',
    fragments: [
      'prop and accessory design sheet',
      'signature weapon, personal items and worn accessories',
      'multiple angles per item with scale reference and short labels',
      'material, wear and mechanism detail close-ups',
      'isolated on neutral background, consistent art style, high detail',
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
    | 'height'
    | 'skinTone'
    | 'appearance'
    | 'facialFeatures'
    | 'eyeColor'
    | 'hairstyle'
    | 'costume'
    | 'accessories'
    | 'signatureProps'
    | 'distinguishingMarks'
    | 'temperament'
    | 'personalityKeywords'
    | 'lockedAttributes'
  >
>

/**
 * 把角色结构化字段拼成「角色核心描述」。
 * 维度顺序：体貌（性别/年龄/身高/肤色/外貌/五官/眼睛/发型）→ 穿戴（服饰/配饰/道具）→ 辨识/气质。
 * 字段缺省时不输出，保证「字段越全 → 描述越精细」。
 */
export function buildCharacterCoreDescription(character: CharacterPromptFields): string {
  const parts: string[] = []
  if (character.gender) parts.push(character.gender)
  if (character.ageStage) parts.push(character.ageStage)
  if (character.occupation) parts.push(character.occupation)
  if (character.height) parts.push(character.height)
  if (character.skinTone) parts.push(character.skinTone)
  if (character.appearance) parts.push(character.appearance)
  if (character.facialFeatures) parts.push(character.facialFeatures)
  if (character.eyeColor) parts.push(character.eyeColor)
  if (character.hairstyle) parts.push(character.hairstyle)
  if (character.costume) parts.push(character.costume)
  if (character.accessories && character.accessories.length > 0) {
    parts.push(character.accessories.join(', '))
  }
  if (character.signatureProps && character.signatureProps.length > 0) {
    parts.push(character.signatureProps.join(', '))
  }
  if (character.distinguishingMarks) parts.push(character.distinguishingMarks)
  if (character.temperament) parts.push(character.temperament)
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
  // 角色名锚点：给模型可直接渲染为卡片标题的真实文本；角色身份板额外带角色定位说明
  const name = input.character.name?.trim()
  if (name) {
    if (input.aspect === 'turnaround') {
      const caption = [input.character.occupation, input.character.temperament]
        .map((value) => value?.trim())
        .filter(Boolean)
        .join(' · ')
      segments.push(
        caption
          ? `render the character name as a title reading "${name}", with a small role caption reading "${caption}"`
          : `render the character name as a title reading "${name}"`,
      )
    } else {
      segments.push(`character named "${name}"`)
    }
  }
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
