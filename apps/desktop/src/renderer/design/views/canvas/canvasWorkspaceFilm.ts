import { readAssetKind, readReferences, type ShotGroup, type ShotSegment } from './canvasFilmAssets'
import { readStylePresets } from './canvasPipeline'
import type { CharacterPromptFields } from './canvasCharacterSheetPrompts'
import type { CanvasAsset } from './canvas.types'
import { SCENE_NO_PEOPLE_PROMPT } from './canvasScenePrompt'
import { clipTextHeadTail } from '@spark/shared'
import { translate } from '../../i18n'

const CHAPTER_SOURCE_TOKEN_BUDGET = 4_000

export type ShotSegmentContext = {
  group: ShotGroup
  segment: ShotSegment
  characters: CanvasAsset[]
  scene?: CanvasAsset
}

export function resolveShotSegmentContext(
  group: ShotGroup,
  segment: ShotSegment,
  assets: readonly CanvasAsset[],
): ShotSegmentContext {
  const characters = (segment.characterAssetIds ?? [])
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is CanvasAsset => Boolean(asset))
  const scene = segment.sceneAssetId
    ? assets.find((asset) => asset.id === segment.sceneAssetId)
    : undefined
  return { group, segment, characters, ...(scene ? { scene } : {}) }
}

export type ScriptBreakdownDraft = {
  characters: Array<{ name: string; description: string }>
  scenes: Array<{ name: string; description: string }>
  props: Array<{ name: string; description: string }>
  segments: Array<{
    groupName?: string
    title: string
    description: string
    dialogue?: string
    characterNames: string[]
    sceneName?: string
    shotPrompt?: string
  }>
}

export function buildScriptBreakdownDraft(asset: CanvasAsset): ScriptBreakdownDraft {
  const title = asset.title?.trim() || translate('canvasWorkspaceFilm.t1')
  const text = asset.contentText?.trim() ?? ''
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const characterMap = new Map<string, { name: string; description: string }>()
  const sceneMap = new Map<string, { name: string; description: string }>()
  const propMap = new Map<string, { name: string; description: string }>()
  const segments: ScriptBreakdownDraft['segments'] = []
  let currentSceneName = ''
  let currentGroupName = translate('canvasWorkspaceFilm.tpl1Desc', { title: title })

  const pushScene = (name: string, description: string) => {
    const normalized = name
      .replace(/^#+\s*/, '')
      .trim()
      .slice(0, 40)
    if (!normalized || sceneMap.has(normalized)) return
    sceneMap.set(normalized, { name: normalized, description })
  }

  const pushCharacter = (name: string, line: string) => {
    const normalized = name
      .trim()
      .replace(/[（）()【】[\]\s]/g, '')
      .slice(0, 16)
    if (!normalized || normalized.length < 2 || characterMap.has(normalized)) return
    characterMap.set(normalized, {
      name: normalized,
      description: translate('canvasWorkspaceFilm.tpl2Desc', {
        title: title,
        line: line.slice(0, 80),
      }),
    })
  }

  const pushProp = (name: string, line: string) => {
    const normalized = name
      .trim()
      .replace(/[（）()【】[\]\s]/g, '')
      .slice(0, 16)
    if (!normalized || normalized.length < 2 || propMap.has(normalized)) return
    propMap.set(normalized, {
      name: normalized,
      description: translate('canvasWorkspaceFilm.tpl3Desc', {
        title: title,
        line: line.slice(0, 80),
      }),
    })
  }

  for (const line of lines.slice(0, 160)) {
    // 显式道具标注：「道具：X、Y」/「【道具】X」（仅在明确标注时抽取，避免误判）
    const propLine = line.match(/^[【[]?\s*道具\s*[】\]]?\s*[:：]\s*(.+)$/) // i18n-exempt-line: 道具行识别正则
    if (propLine && propLine[1]) {
      for (const part of propLine[1].split(/[、,，;；/]/)) pushProp(part, line)
      continue
    }
    const episodeLike = /^(第.{1,8}集|EP\s*\d+|Episode\s*\d+)/i.test(line) // i18n-exempt-line: 集数标题识别正则
    if (episodeLike && line.length <= 48) {
      currentGroupName = line.replace(/^#+\s*/, '').trim()
      continue
    }

    const sceneLike =
      /^(第.{1,8}[场幕集]|场景|内景|外景|INT\.|EXT\.)/i.test(line) || // i18n-exempt-line: 场次标题识别正则
      /(?:室内|室外|街|房间|宫殿|教室|办公室|森林|海边|夜|日|黄昏|清晨)/.test(line) // i18n-exempt-line: 场景关键词匹配正则
    if (sceneLike && line.length <= 48) {
      currentSceneName = line.replace(/^场景[:：]?\s*/, '') // i18n-exempt-line: 场景前缀剥离正则
      pushScene(currentSceneName, line)
      continue
    }

    const dialogue = line.match(/^([^：:]{2,16})[：:]\s*(.+)$/)
    const characterNames: string[] = []
    let dialogueText = ''
    if (dialogue) {
      const name = dialogue[1]?.trim() ?? ''
      dialogueText = dialogue[2]?.trim() ?? ''
      pushCharacter(name, dialogueText)
      characterNames.push(name.replace(/[（）()【】[\]\s]/g, '').slice(0, 16))
    }

    if (segments.length < 24 && (dialogueText || line.length >= 8)) {
      const summary = dialogueText || line
      segments.push({
        groupName: currentGroupName,
        title: translate('canvasWorkspaceFilm.tpl4Desc', {
          index: segments.length + 1,
          summary: summary.slice(0, 18),
        }),
        description: dialogueText
          ? translate('canvasWorkspaceFilm.tpl5Desc', {
              name: characterNames[0] ?? translate('canvasWorkspaceFilm.t2'),
              text: dialogueText,
            })
          : line,
        ...(dialogueText ? { dialogue: dialogueText } : {}),
        characterNames,
        ...(currentSceneName ? { sceneName: currentSceneName } : {}),
        shotPrompt: translate('canvasWorkspaceFilm.t3Desc'),
      })
    }
  }

  if (sceneMap.size === 0) {
    pushScene(
      translate('canvasWorkspaceFilm.tpl6Desc', { title: title }),
      translate('canvasWorkspaceFilm.t4Desc'),
    )
  }

  return {
    characters: [...characterMap.values()].slice(0, 16),
    scenes: [...sceneMap.values()].slice(0, 12),
    props: [...propMap.values()].slice(0, 16),
    segments:
      segments.length > 0
        ? segments
        : [
            {
              groupName: currentGroupName,
              title: translate('canvasWorkspaceFilm.t5'),
              description: text.slice(0, 160) || translate('canvasWorkspaceFilm.t6'),
              characterNames: [],
              shotPrompt: translate('canvasWorkspaceFilm.t7Desc'),
            },
          ],
  }
}

/** 影视资产种类 → 流水线节点角色（设计 §6），用于插入画布时打标 */
export function filmKindToPipelineRole(
  kind: ReturnType<typeof readAssetKind>,
): import('./canvas.types').CanvasPipelineRole | undefined {
  switch (kind) {
    case 'chapter':
      return 'chapter'
    case 'script':
      return 'screenplay'
    case 'character':
      return 'character'
    case 'scene':
      return 'scene'
    case 'prop':
      return 'prop'
    case 'effect':
      return 'effect'
    default:
      return undefined
  }
}

/** 把抽取得到的结构化属性拆成数组（中英顿号/逗号/分号分隔） */
function splitAttrList(value: string | undefined): string[] | undefined {
  if (!value || !value.trim()) return undefined
  const items = value
    .split(/[、,，;；]/)
    .map((part) => part.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

/**
 * 把角色资产（contentText + metadata.attributes）映射为角色图提示词字段（设计 §S4）。
 * 优先把抽取出的结构化属性（身高/肤色/五官/眼睛/配饰/标志特征/气质…）逐项映射到
 * CharacterPromptFields，让角色卡拿到精细字段；未识别属性与正文设定汇入 appearance 补充。
 */
export function assetToCharacterFields(asset: CanvasAsset): CharacterPromptFields {
  const attrs = (asset.metadata?.attributes as Record<string, string> | undefined) ?? {}
  const get = (key: string): string | undefined => {
    const value = attrs[key]
    return value && value.trim() ? value.trim() : undefined
  }
  const fields: CharacterPromptFields = {}
  if (asset.title) fields.name = asset.title
  const gender = get('gender')
  if (gender) fields.gender = gender
  const age = get('age')
  if (age) fields.ageStage = age
  const occupation = get('occupation')
  if (occupation) fields.occupation = occupation
  const height = get('height')
  if (height) fields.height = height
  const skin = get('skin')
  if (skin) fields.skinTone = skin
  const face = get('face')
  if (face) fields.facialFeatures = face
  const eyes = get('eyes')
  if (eyes) fields.eyeColor = eyes
  const hair = get('hair')
  if (hair) fields.hairstyle = hair
  const costume = get('costume')
  if (costume) fields.costume = costume
  const accessories = splitAttrList(get('accessories'))
  if (accessories) fields.accessories = accessories
  const signatureProps = splitAttrList(get('signatureProp'))
  if (signatureProps) fields.signatureProps = signatureProps
  const marks = get('marks')
  if (marks) fields.distinguishingMarks = marks
  const temperament = get('temperament')
  if (temperament) fields.temperament = temperament
  const personality = splitAttrList(get('personality'))
  if (personality) fields.personalityKeywords = personality

  // 已映射的结构化 key 之外的属性 + 正文设定，汇入 appearance 作为补充视觉要点
  const mappedKeys = new Set([
    'gender',
    'age',
    'occupation',
    'height',
    'skin',
    'face',
    'eyes',
    'hair',
    'costume',
    'accessories',
    'signatureProp',
    'marks',
    'temperament',
    'personality',
    'appearance',
  ])
  const appearanceParts = [
    get('appearance') ?? '',
    asset.contentText ?? '',
    ...Object.entries(attrs)
      .filter(([key, value]) => !mappedKeys.has(key) && value && value.trim())
      .map(([key, value]) => `${key}: ${value.trim()}`),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
  if (appearanceParts.length > 0) fields.appearance = appearanceParts.join(', ')
  return fields
}

/** 设定文本摘要上限：参考图 prompt 只需要视觉要点，整段原文既浪费 token 又稀释画面重点 */
const REFERENCE_SETTING_MAX = 240

/** 把可能很长的设定文本压成一句视觉摘要：去多余空白、取要点、截断 */
function condenseSettingText(text?: string | null): string {
  if (!text) return ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= REFERENCE_SETTING_MAX) return normalized
  // 优先在句末标点处截断，读起来更完整
  const head = normalized.slice(0, REFERENCE_SETTING_MAX)
  const lastStop = Math.max(head.lastIndexOf('。'), head.lastIndexOf('，'), head.lastIndexOf('；'))
  return (lastStop > REFERENCE_SETTING_MAX * 0.6 ? head.slice(0, lastStop + 1) : head) + '…'
}

export function buildFilmAssetReferencePrompt(asset: CanvasAsset, styleBible?: string): string {
  const kind = readAssetKind(asset)
  const subject =
    kind === 'character'
      ? translate('canvasWorkspaceFilm.t8')
      : kind === 'scene'
        ? translate('canvasWorkspaceFilm.t9')
        : kind === 'prop'
          ? translate('canvasWorkspaceFilm.t10')
          : kind === 'effect'
            ? translate('canvasWorkspaceFilm.t11')
            : translate('canvasWorkspaceFilm.t12')
  const attrs = asset.metadata?.attributes as Record<string, string> | undefined
  // 结构化属性优先（性别/年龄/外貌/材质…），它们才是出图最该锚定的视觉锚点
  const attrText = attrs
    ? Object.entries(attrs)
        .filter(([, value]) => value && value.trim())
        .map(([key, value]) => `${key}: ${value.trim()}`)
        .join('；')
    : ''
  const setting = condenseSettingText(asset.contentText)
  const stylePrompt = typeof asset.metadata?.prompt === 'string' ? asset.metadata.prompt.trim() : ''

  // 只喂结构化视觉要点 + 截断后的设定摘要，避免把整章/整段原文丢给模型
  const detailDirective =
    kind === 'scene'
      ? translate('canvasWorkspaceFilm.tpl7Instruction', { base: SCENE_NO_PEOPLE_PROMPT })
      : kind === 'prop'
        ? translate('canvasWorkspaceFilm.t13LongDesc')
        : kind === 'effect'
          ? translate('canvasWorkspaceFilm.t14LongDesc')
          : translate('canvasWorkspaceFilm.t15LongDesc')

  const base = [
    translate('canvasWorkspaceFilm.tpl8Desc', {
      title: asset.title ?? translate('canvasWorkspaceFilm.t16'),
      subject: subject,
    }),
    attrText ? translate('canvasWorkspaceFilm.tpl9Desc', { value: attrText }) : '',
    setting ? translate('canvasWorkspaceFilm.tpl10Desc', { value: setting }) : '',
    stylePrompt ? translate('canvasWorkspaceFilm.tpl11Desc', { value: stylePrompt }) : '',
    styleBible && styleBible.trim()
      ? translate('canvasWorkspaceFilm.tpl12Desc', { value: styleBible.trim() })
      : '',
    translate('canvasWorkspaceFilm.tpl13Instruction', { detail: detailDirective }),
    translate('canvasWorkspaceFilm.t17Desc'),
  ].filter(Boolean)
  return base.join('\n')
}

/** 分镜节点展示文本（§S6 节点化） */
export function buildShotNodeText(group: ShotGroup, segment: ShotSegment): string {
  return [
    translate('canvasWorkspaceFilm.tpl14Desc', { group: group.name, index: segment.index }),
    segment.durationSec != null
      ? translate('canvasWorkspaceFilm.tpl15Desc', { value: segment.durationSec })
      : '',
    segment.description
      ? translate('canvasWorkspaceFilm.tpl16Desc', { value: segment.description })
      : '',
    segment.actionBeats
      ? translate('canvasWorkspaceFilm.tpl17Desc', { value: segment.actionBeats })
      : '',
    segment.dialogue ? translate('canvasWorkspaceFilm.tpl18Desc', { value: segment.dialogue }) : '',
    segment.narration
      ? translate('canvasWorkspaceFilm.tpl19Desc', { value: segment.narration })
      : '',
    segment.soundEffects
      ? translate('canvasWorkspaceFilm.tpl20Desc', { value: segment.soundEffects })
      : '',
    segment.firstFrame
      ? translate('canvasWorkspaceFilm.tpl21Desc', { value: segment.firstFrame })
      : '',
    segment.lastFrame
      ? translate('canvasWorkspaceFilm.tpl22Desc', { value: segment.lastFrame })
      : '',
    segment.transition
      ? translate('canvasWorkspaceFilm.tpl23Desc', { value: segment.transition })
      : '',
    segment.continuity
      ? translate('canvasWorkspaceFilm.tpl24Desc', { value: segment.continuity })
      : '',
    segment.shotPrompt
      ? translate('canvasWorkspaceFilm.tpl25Desc', { value: segment.shotPrompt })
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function findSegmentStyleFragments(
  segment: ShotSegment,
  presets: ReturnType<typeof readStylePresets>,
): string[] {
  const ids = [segment.cameraDesignId, segment.frameDesignId, segment.actionDesignId].filter(
    (id): id is string => Boolean(id),
  )
  return ids
    .map((id) => presets.find((preset) => preset.id === id)?.promptFragment?.trim())
    .filter((fragment): fragment is string => Boolean(fragment))
}

export function buildShotSegmentVideoPrompt(
  input: {
    group: ShotGroup
    segment: ShotSegment
    characters: CanvasAsset[]
    scene?: CanvasAsset
  },
  styleBible?: string,
  styleFragments: string[] = [],
): string {
  const { group, segment, characters, scene } = input
  const characterText = characters
    .map((asset) => {
      const refs = readReferences(asset.metadata)
      const refText = refs
        .map((ref) => ref.description)
        .filter(Boolean)
        .join('；')
      return translate('canvasWorkspaceFilm.tpl26Desc', {
        name: asset.title ?? translate('canvasWorkspaceFilm.t2'),
        text: asset.contentText ?? '',
        rest: refText ? translate('canvasWorkspaceFilm.tpl27Desc', { value: refText }) : '',
      })
    })
    .join('\n')
  const sceneRefs = scene
    ? readReferences(scene.metadata)
        .map((ref) => ref.description)
        .filter(Boolean)
        .join('；')
    : ''
  return [
    translate('canvasWorkspaceFilm.tpl28Desc'),
    translate('canvasWorkspaceFilm.tpl29Desc', { value: group.name }),
    translate('canvasWorkspaceFilm.tpl30Desc', { index: segment.index, title: segment.title }),
    segment.durationSec != null
      ? translate('canvasWorkspaceFilm.tpl31Desc', { value: segment.durationSec })
      : '',
    segment.description
      ? translate('canvasWorkspaceFilm.tpl16Desc', { value: segment.description })
      : '',
    [
      segment.shotSize,
      segment.angle,
      segment.movement,
      segment.focalLength,
      segment.aperture,
    ].filter(Boolean).length > 0
      ? translate('canvasWorkspaceFilm.tpl32Desc', {
          value: [
            segment.shotSize,
            segment.angle,
            segment.movement,
            segment.focalLength,
            segment.aperture,
          ]
            .filter(Boolean)
            .join('；'),
        })
      : '',
    segment.sceneLayout
      ? translate('canvasWorkspaceFilm.tpl33Desc', { value: segment.sceneLayout })
      : '',
    segment.composition
      ? translate('canvasWorkspaceFilm.tpl34Desc', { value: segment.composition })
      : '',
    segment.blocking ? translate('canvasWorkspaceFilm.tpl35Desc', { value: segment.blocking }) : '',
    segment.characterReferences
      ? translate('canvasWorkspaceFilm.tpl36Desc', { value: segment.characterReferences })
      : '',
    segment.microExpression
      ? translate('canvasWorkspaceFilm.tpl37Desc', { value: segment.microExpression })
      : '',
    segment.costume ? translate('canvasWorkspaceFilm.tpl38Desc', { value: segment.costume }) : '',
    segment.lighting ? translate('canvasWorkspaceFilm.tpl39Desc', { value: segment.lighting }) : '',
    segment.colorTone
      ? translate('canvasWorkspaceFilm.tpl40Desc', { value: segment.colorTone })
      : '',
    segment.iso ? translate('canvasWorkspaceFilm.tpl41Desc', { value: segment.iso }) : '',
    segment.actionBeats
      ? translate('canvasWorkspaceFilm.tpl17Desc', { value: segment.actionBeats })
      : '',
    segment.dialogue ? translate('canvasWorkspaceFilm.tpl18Desc', { value: segment.dialogue }) : '',
    segment.narration
      ? translate('canvasWorkspaceFilm.tpl19Desc', { value: segment.narration })
      : '',
    segment.soundEffects
      ? translate('canvasWorkspaceFilm.tpl20Desc', { value: segment.soundEffects })
      : '',
    segment.transition
      ? translate('canvasWorkspaceFilm.tpl42Desc', { value: segment.transition })
      : '',
    segment.firstFrame
      ? translate('canvasWorkspaceFilm.tpl21Desc', { value: segment.firstFrame })
      : '',
    segment.lastFrame
      ? translate('canvasWorkspaceFilm.tpl22Desc', { value: segment.lastFrame })
      : '',
    segment.continuity
      ? translate('canvasWorkspaceFilm.tpl43Desc', { value: segment.continuity })
      : '',
    scene
      ? translate('canvasWorkspaceFilm.tpl44Desc', {
          title: scene.title ?? '',
          text: scene.contentText ?? '',
          rest: sceneRefs ? translate('canvasWorkspaceFilm.tpl27Desc', { value: sceneRefs }) : '',
        })
      : '',
    characterText ? translate('canvasWorkspaceFilm.tpl45Desc', { text: characterText }) : '',
    segment.shotPrompt
      ? translate('canvasWorkspaceFilm.tpl46Desc', { value: segment.shotPrompt })
      : '',
    segment.negativePrompt
      ? translate('canvasWorkspaceFilm.tpl47Desc', { value: segment.negativePrompt })
      : '',
    styleFragments.length > 0
      ? translate('canvasWorkspaceFilm.tpl48Desc', { value: styleFragments.join('；') })
      : '',
    styleBible && styleBible.trim()
      ? translate('canvasWorkspaceFilm.tpl49Desc', { value: styleBible.trim() })
      : '',
    translate('canvasWorkspaceFilm.t18LongDesc'),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildChapterToScreenplayInstruction(chapterText: string): string {
  return [
    translate('canvasWorkspaceFilm.t19Desc'),
    translate('canvasWorkspaceFilm.t20LongDesc'),
    translate('canvasWorkspaceFilm.t21Desc'),
    translate('canvasWorkspaceFilm.t22LongDesc'),
    translate('canvasWorkspaceFilm.tpl50Desc', {
      text: clipTextHeadTail(chapterText, CHAPTER_SOURCE_TOKEN_BUDGET),
    }),
  ].join('\n\n')
}

export function buildShotSegmentKeyframePrompt(
  input: {
    group: ShotGroup
    segment: ShotSegment
    characters: CanvasAsset[]
    scene?: CanvasAsset
  },
  frame: 'first' | 'last',
  styleBible: string,
  styleFragments: string[] = [],
): string {
  const { group, segment, characters, scene } = input
  const characterText = characters
    .map((asset) => {
      const refs = readReferences(asset.metadata)
      const refText = refs
        .map((ref) => ref.description)
        .filter(Boolean)
        .join('；')
      return translate('canvasWorkspaceFilm.tpl26Desc', {
        name: asset.title ?? translate('canvasWorkspaceFilm.t2'),
        text: asset.contentText ?? '',
        rest: refText ? translate('canvasWorkspaceFilm.tpl27Desc', { value: refText }) : '',
      })
    })
    .join('\n')
  const sceneRefs = scene
    ? readReferences(scene.metadata)
        .map((ref) => ref.description)
        .filter(Boolean)
        .join('；')
    : ''
  return [
    translate('canvasWorkspaceFilm.tpl51Desc', {
      frame:
        frame === 'first'
          ? translate('canvasWorkspaceFilm.t23')
          : translate('canvasWorkspaceFilm.t24'),
    }),
    translate('canvasWorkspaceFilm.tpl29Desc', { value: group.name }),
    translate('canvasWorkspaceFilm.tpl30Desc', { index: segment.index, title: segment.title }),
    segment.durationSec != null
      ? translate('canvasWorkspaceFilm.tpl52Desc', { value: segment.durationSec })
      : '',
    segment.description
      ? translate('canvasWorkspaceFilm.tpl16Desc', { value: segment.description })
      : '',
    frame === 'first' && segment.firstFrame
      ? translate('canvasWorkspaceFilm.tpl53Desc', { value: segment.firstFrame })
      : '',
    frame === 'last' && segment.lastFrame
      ? translate('canvasWorkspaceFilm.tpl54Desc', { value: segment.lastFrame })
      : '',
    frame === 'first'
      ? translate('canvasWorkspaceFilm.t25Desc')
      : translate('canvasWorkspaceFilm.t26Desc'),
    segment.composition
      ? translate('canvasWorkspaceFilm.tpl34Desc', { value: segment.composition })
      : '',
    segment.blocking ? translate('canvasWorkspaceFilm.tpl35Desc', { value: segment.blocking }) : '',
    segment.characterReferences
      ? translate('canvasWorkspaceFilm.tpl36Desc', { value: segment.characterReferences })
      : '',
    segment.lighting ? translate('canvasWorkspaceFilm.tpl39Desc', { value: segment.lighting }) : '',
    segment.colorTone
      ? translate('canvasWorkspaceFilm.tpl40Desc', { value: segment.colorTone })
      : '',
    segment.continuity
      ? translate('canvasWorkspaceFilm.tpl43Desc', { value: segment.continuity })
      : '',
    scene
      ? translate('canvasWorkspaceFilm.tpl44Desc', {
          title: scene.title ?? '',
          text: scene.contentText ?? '',
          rest: sceneRefs ? translate('canvasWorkspaceFilm.tpl27Desc', { value: sceneRefs }) : '',
        })
      : '',
    characterText ? translate('canvasWorkspaceFilm.tpl45Desc', { text: characterText }) : '',
    segment.shotPrompt
      ? translate('canvasWorkspaceFilm.tpl32Desc', { value: segment.shotPrompt })
      : '',
    segment.negativePrompt
      ? translate('canvasWorkspaceFilm.tpl55Desc', { value: segment.negativePrompt })
      : '',
    styleFragments.length > 0
      ? translate('canvasWorkspaceFilm.tpl48Desc', { value: styleFragments.join('；') })
      : '',
    styleBible ? translate('canvasWorkspaceFilm.tpl49Desc', { value: styleBible }) : '',
    translate('canvasWorkspaceFilm.t27Desc'),
  ]
    .filter(Boolean)
    .join('\n\n')
}
