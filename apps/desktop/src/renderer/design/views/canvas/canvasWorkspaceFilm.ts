import { readAssetKind, readReferences, type ShotGroup, type ShotSegment } from './canvasFilmAssets'
import { readStylePresets } from './canvasPipeline'
import type { CharacterPromptFields } from './canvasCharacterSheetPrompts'
import type { CanvasAsset } from './canvas.types'
import { SCENE_NO_PEOPLE_PROMPT } from './canvasScenePrompt'

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
  const title = asset.title?.trim() || '未命名剧本'
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
  let currentGroupName = `${title} - 自动分镜`

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
      description: `从剧本「${title}」自动抽取。代表台词/动作：${line.slice(0, 80)}`,
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
      description: `从剧本「${title}」自动抽取的道具。出现语境：${line.slice(0, 80)}`,
    })
  }

  for (const line of lines.slice(0, 160)) {
    // 显式道具标注：「道具：X、Y」/「【道具】X」（仅在明确标注时抽取，避免误判）
    const propLine = line.match(/^[【[]?\s*道具\s*[】\]]?\s*[:：]\s*(.+)$/)
    if (propLine && propLine[1]) {
      for (const part of propLine[1].split(/[、,，;；/]/)) pushProp(part, line)
      continue
    }
    const episodeLike = /^(第.{1,8}集|EP\s*\d+|Episode\s*\d+)/i.test(line)
    if (episodeLike && line.length <= 48) {
      currentGroupName = line.replace(/^#+\s*/, '').trim()
      continue
    }

    const sceneLike =
      /^(第.{1,8}[场幕集]|场景|内景|外景|INT\.|EXT\.)/i.test(line) ||
      /(?:室内|室外|街|房间|宫殿|教室|办公室|森林|海边|夜|日|黄昏|清晨)/.test(line)
    if (sceneLike && line.length <= 48) {
      currentSceneName = line.replace(/^场景[:：]?\s*/, '')
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
        title: `镜${segments.length + 1} - ${summary.slice(0, 18)}`,
        description: dialogueText ? `${characterNames[0] ?? '角色'}说：${dialogueText}` : line,
        ...(dialogueText ? { dialogue: dialogueText } : {}),
        characterNames,
        ...(currentSceneName ? { sceneName: currentSceneName } : {}),
        shotPrompt: '电影感构图，主体清晰，动作自然，镜头连贯。',
      })
    }
  }

  if (sceneMap.size === 0) {
    pushScene(
      `${title} - 默认场景`,
      '根据剧本文本自动生成的默认场景，请后续补充地点、光线和美术风格。',
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
              title: '镜1 - 剧情开场',
              description: text.slice(0, 160) || '请补充分镜画面描述。',
              characterNames: [],
              shotPrompt: '电影感开场镜头，建立场景氛围。',
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
      ? '角色定妆/设定'
      : kind === 'scene'
        ? '场景概念'
        : kind === 'prop'
          ? '道具设定'
          : kind === 'effect'
            ? '特效视觉设定'
            : '视觉参考'
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
      ? `${SCENE_NO_PEOPLE_PROMPT} 输出一张大画幅「场景概念设计板」：以低机位广角建立镜头呈现完整空间，明确前景/中景/背景的纵深层次与遮挡关系；标注主光源位置、光影走向、整体色调与色温；体现关键陈设、标志物与材质质感（墙面/地面/家具的材料及新旧磨损）；再补充 2-3 个细节插图（入口出口、标志物特写、材质特写）并配简短文字标签；保证空间布局可被后续镜头复用的一致性。`
      : kind === 'prop'
        ? '输出一张「道具设定板」：正面/侧面/背面与 3/4 视角并列，附手持或参照物比例；材质、工艺与磨损特写；功能结构拆解与可动部件；颜色、纹理、编号或机关等细节标注；附 1-2 个使用场景小图；强调可被后续分镜复用的一致性锚点。'
        : kind === 'effect'
          ? '输出一张「特效视觉设定板」：分起势/峰值/消散三阶段排列展示；标注运动轨迹与扩散方向；刻画粒子/烟雾/能量膜/光晕的质感细节；体现自发光及其对角色与环境的照明交互；提供近景细节与中景应用示例；统一色彩与氛围。'
          : '输出一张清晰「设定板」：主体居中并给出多视角，补充近景/中景与关键细节插图并配简短标签，便于作为后续分镜与视频生成的一致性参考。'

  const base = [
    `为影视项目生成一张「${asset.title ?? '未命名'}」的${subject}参考图。`,
    attrText ? `视觉要点：${attrText}` : '',
    setting ? `设定摘要：${setting}` : '',
    stylePrompt ? `风格要求：${stylePrompt}` : '',
    styleBible && styleBible.trim() ? `统一视觉基调：${styleBible.trim()}` : '',
    `画面要求：电影级质感，层次丰富、光影考究、细节精致、构图专业；${detailDirective}`,
    '负面要求：避免畸变、糊面、错误解剖、杂乱水印与无意义文字。',
  ].filter(Boolean)
  return base.join('\n')
}

/** 分镜节点展示文本（§S6 节点化） */
export function buildShotNodeText(group: ShotGroup, segment: ShotSegment): string {
  return [
    `【${group.name}】镜${segment.index}`,
    segment.durationSec != null ? `时长：${segment.durationSec}s` : '',
    segment.description ? `画面/动作：${segment.description}` : '',
    segment.actionBeats ? `动作节拍：${segment.actionBeats}` : '',
    segment.dialogue ? `对白：${segment.dialogue}` : '',
    segment.narration ? `旁白/OS：${segment.narration}` : '',
    segment.soundEffects ? `音效：${segment.soundEffects}` : '',
    segment.firstFrame ? `首帧：${segment.firstFrame}` : '',
    segment.lastFrame ? `尾帧：${segment.lastFrame}` : '',
    segment.transition ? `转场：${segment.transition}` : '',
    segment.continuity ? `连续性：${segment.continuity}` : '',
    segment.shotPrompt ? `镜头：${segment.shotPrompt}` : '',
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
      return `${asset.title ?? '角色'}：${asset.contentText ?? ''}${refText ? `；参考：${refText}` : ''}`
    })
    .join('\n')
  const sceneRefs = scene
    ? readReferences(scene.metadata)
        .map((ref) => ref.description)
        .filter(Boolean)
        .join('；')
    : ''
  return [
    `请生成一段影视分镜视频。`,
    `分组：${group.name}`,
    `镜号：#${segment.index} ${segment.title}`,
    segment.durationSec != null ? `时长：${segment.durationSec} 秒` : '',
    segment.description ? `画面/动作：${segment.description}` : '',
    [
      segment.shotSize,
      segment.angle,
      segment.movement,
      segment.focalLength,
      segment.aperture,
    ].filter(Boolean).length > 0
      ? `镜头语言：${[
          segment.shotSize,
          segment.angle,
          segment.movement,
          segment.focalLength,
          segment.aperture,
        ]
          .filter(Boolean)
          .join('；')}`
      : '',
    segment.sceneLayout ? `场景布局：${segment.sceneLayout}` : '',
    segment.composition ? `构图：${segment.composition}` : '',
    segment.blocking ? `人物占位与距离：${segment.blocking}` : '',
    segment.characterReferences ? `角色参考：${segment.characterReferences}` : '',
    segment.microExpression ? `表演：${segment.microExpression}` : '',
    segment.costume ? `造型：${segment.costume}` : '',
    segment.lighting ? `灯光：${segment.lighting}` : '',
    segment.colorTone ? `色调：${segment.colorTone}` : '',
    segment.iso ? `感光度/颗粒：${segment.iso}` : '',
    segment.actionBeats ? `动作节拍：${segment.actionBeats}` : '',
    segment.dialogue ? `对白：${segment.dialogue}` : '',
    segment.narration ? `旁白/OS：${segment.narration}` : '',
    segment.soundEffects ? `音效：${segment.soundEffects}` : '',
    segment.transition ? `入/出转场：${segment.transition}` : '',
    segment.firstFrame ? `首帧：${segment.firstFrame}` : '',
    segment.lastFrame ? `尾帧：${segment.lastFrame}` : '',
    segment.continuity ? `连续性锁定：${segment.continuity}` : '',
    scene
      ? `场景：${scene.title ?? ''} ${scene.contentText ?? ''}${sceneRefs ? `；参考：${sceneRefs}` : ''}`
      : '',
    characterText ? `角色设定：\n${characterText}` : '',
    segment.shotPrompt ? `完整视频 Prompt：${segment.shotPrompt}` : '',
    segment.negativePrompt ? `该镜反向约束：${segment.negativePrompt}` : '',
    styleFragments.length > 0 ? `片段风格预设：${styleFragments.join('；')}` : '',
    styleBible && styleBible.trim() ? `视觉总设定：${styleBible.trim()}` : '',
    '生成要求：严格按 0.5s 节拍执行，保持角色身份、肢体结构、场景几何、道具手位和光影稳定；运动符合重力与惯性，无闪烁、跳变、漂移、字幕或水印。',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildChapterToScreenplayInstruction(chapterText: string): string {
  return [
    '请把下面的小说/长文稿章节改写为影视剧本（场次剧本）。',
    '要求：按场次切分，每场标注【场号 内/外景 地点 时间】；正文用「动作描述 + 角色对白 + 旁白」格式；',
    '保留关键情节与人物关系；对白口语化、可表演；输出可直接用于后续角色/场景/分镜拆解，不要解释过程。',
    `章节原文：\n${chapterText.slice(0, 8000)}`,
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
      return `${asset.title ?? '角色'}：${asset.contentText ?? ''}${refText ? `；参考：${refText}` : ''}`
    })
    .join('\n')
  const sceneRefs = scene
    ? readReferences(scene.metadata)
        .map((ref) => ref.description)
        .filter(Boolean)
        .join('；')
    : ''
  return [
    `请生成一张影视分镜${frame === 'first' ? '首帧' : '尾帧'}关键帧图。`,
    `分组：${group.name}`,
    `镜号：#${segment.index} ${segment.title}`,
    segment.durationSec != null ? `镜头时长：${segment.durationSec} 秒` : '',
    segment.description ? `画面/动作：${segment.description}` : '',
    frame === 'first' && segment.firstFrame ? `首帧精确描述：${segment.firstFrame}` : '',
    frame === 'last' && segment.lastFrame ? `尾帧精确描述：${segment.lastFrame}` : '',
    frame === 'first'
      ? '取镜头 0.0s 的确定画面，不要提前执行后续动作。'
      : '取镜头结束瞬间的确定画面，保留下一镜所需的动作与视线接点。',
    segment.composition ? `构图：${segment.composition}` : '',
    segment.blocking ? `人物占位与距离：${segment.blocking}` : '',
    segment.characterReferences ? `角色参考：${segment.characterReferences}` : '',
    segment.lighting ? `灯光：${segment.lighting}` : '',
    segment.colorTone ? `色调：${segment.colorTone}` : '',
    segment.continuity ? `连续性锁定：${segment.continuity}` : '',
    scene
      ? `场景：${scene.title ?? ''} ${scene.contentText ?? ''}${sceneRefs ? `；参考：${sceneRefs}` : ''}`
      : '',
    characterText ? `角色设定：\n${characterText}` : '',
    segment.shotPrompt ? `镜头语言：${segment.shotPrompt}` : '',
    segment.negativePrompt ? `反向约束：${segment.negativePrompt}` : '',
    styleFragments.length > 0 ? `片段风格预设：${styleFragments.join('；')}` : '',
    styleBible ? `视觉总设定：${styleBible}` : '',
    '生成要求：电影级光影，角色与场景一致，单帧静态画面，避免字幕、水印和畸变。',
  ]
    .filter(Boolean)
    .join('\n\n')
}
