/**
 * 实体抽取（剧本 → 角色 / 场景 / 道具 / 特效，一对多）。
 *
 * 用于画布「文本节点右键 → 提取角色 / 提取场景」：让文本模型按**固定可解析格式**
 * 输出实体清单，再用这里的解析器还原为结构化实体，逐个落库 + 在画布生成专用节点。
 * 纯逻辑、无 DOM/IPC，便于单测。
 */

import { translate } from '../../i18n'
import { SCENE_NO_PEOPLE_PROMPT } from './canvasScenePrompt'
import { parseCanvasJsonCandidates } from './canvasJsonRepair'

export type ExtractEntityKind = 'character' | 'scene' | 'prop' | 'effect'

export function extractEntityKindLabel(kind: ExtractEntityKind): string {
  return kind === 'character'
    ? translate('canvasEntityExtract.t1')
    : kind === 'scene'
      ? translate('canvasEntityExtract.t2')
      : kind === 'prop'
        ? translate('canvasEntityExtract.t3')
        : translate('canvasEntityExtract.t4')
}

export function resolveExtractEntityKindFromWorkflow(workflow: unknown): ExtractEntityKind | null {
  switch (workflow) {
    case 'extract_character':
      return 'character'
    case 'extract_scene':
      return 'scene'
    case 'extract_prop':
      return 'prop'
    case 'extract_effect':
      return 'effect'
    default:
      return null
  }
}

/** 解析出的单个实体（字段已归一化为中文标准 key） */
export type ParsedEntity = {
  /** 名称（唯一键） */
  name: string
  /** 归一化字段：标准字段名 → 值（可直接作为资产 attributes） */
  fields: Record<string, string>
  /** 默认生成提示词（用于后续生图/生视频），为空时回退 description */
  prompt?: string
  /** 整段可读描述（兜底文本，用作资产 text / 生成 prompt） */
  description: string
  /** 原始结构化数据，供任务日志/详情排查 */
  raw?: unknown
}

/** 字段别名表：把模型可能用的不同字段名归一到标准 key */
const FIELD_ALIASES: Record<ExtractEntityKind, Array<{ key: string; match: RegExp }>> = {
  character: [
    { key: 'gender', match: /^性别|gender$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'age', match: /^年龄|年龄段|年纪|age$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'height', match: /^身高|体型|身形|身材|体态|height|build|physique$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'skin', match: /^肤色|皮肤|肤质|skin|complexion$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'occupation', match: /^身份|职业|角色定位|occupation|role$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'appearance', match: /^外貌|外形|长相|相貌|体貌|appearance|look$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'face', match: /^五官|面貌|脸型|面庞|相貌特征|face|facial|features$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'eyes', match: /^眼睛|眼神|目色|瞳色|eyes|eye$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'hair', match: /^发型|发式|发色|头发|hair$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'costume', match: /^服饰|服装|穿着|衣着|costume|clothing|outfit$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'accessories', match: /^配饰|饰品|首饰|佩饰|accessory|accessories$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'signatureProp', match: /^标志道具|随身道具|道具|标志物|signatureProp|prop$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'marks', match: /^标志特征|特征|疤痕|纹身|胎记|辨识|marks|mark|tattoo|scar$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'temperament', match: /^气质|神态|气场|temperament|aura$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'personality', match: /^性格|个性|personality$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'voice', match: /^声线|声音|嗓音|voice$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
  ],
  scene: [
    { key: 'settingType', match: /^类型|内外景|场景类型|settingType|type$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'location', match: /^地点|位置|场所|location|place$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'era', match: /^年代|时代|时期|纪元|era|period$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'timeOfDay', match: /^时间|时段|时间段|timeOfDay|time$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'weather', match: /^天气|weather$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'lighting', match: /^光线|光影|照明|光源|lighting|light$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'colorTone', match: /^色调|色彩|色温|colorTone|palette$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'artDirection', match: /^美术|美术风格|风格|artDirection|art$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'styleRef', match: /^风格参考|质感|画风|风格锚点|styleRef|reference$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    {
      key: 'spatialLayout',
      match: /^空间|空间层次|布局|纵深|景深|层次|spatialLayout|layout|depth$/i,
    }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'perspective', match: /^视角|机位|景别|取景|perspective|angle|framing$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'scale', match: /^体量|尺度|规模|大小|scale|size$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    {
      key: 'keyElements',
      match: /^陈设|关键陈设|标志物|核心物件|道具|keyElements|elements|props$/i,
    }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'materials', match: /^材质|质感|材料|表面|materials|material|texture$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'mood', match: /^氛围|情绪|气氛|mood|atmosphere$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
  ],
  prop: [
    { key: 'category', match: /^类型|类别|category|type$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'owner', match: /^归属|持有者|使用者|owner|user$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'function', match: /^功能|用途|作用|function|purpose$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'material', match: /^材质|材料|material$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'shape', match: /^形状|轮廓|造型|shape|silhouette$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'color', match: /^颜色|色彩|color|palette$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'details', match: /^细节|纹理|磨损|机关|details|texture$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'style', match: /^风格|工艺|年代感|style|craft$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'scale', match: /^尺寸|比例|大小|scale|size$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
  ],
  effect: [
    { key: 'effectType', match: /^类型|特效类型|effectType|type$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'source', match: /^来源|触发|source|trigger$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'stage', match: /^阶段|起势|峰值|消散|生命周期|stage|phase$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'motion', match: /^运动|动态|轨迹|motion|movement$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'color', match: /^颜色|色彩|color|palette$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'texture', match: /^质感|粒子|纹理|texture|particles$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'lighting', match: /^光照|发光|lighting|glow$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'interaction', match: /^交互|影响|interaction|impact$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
    { key: 'mood', match: /^氛围|情绪|mood|atmosphere$/i }, // i18n-exempt-line: 中文字段别名匹配正则（数据匹配用，非 UI 文案）
  ],
}

const FIELD_LABELS: Record<string, string> = {
  age: translate('canvasEntityExtract.t5'),
  gender: translate('canvasEntityExtract.t6'),
  height: translate('canvasEntityExtract.t7'),
  skin: translate('canvasEntityExtract.t8'),
  occupation: translate('canvasEntityExtract.t9'),
  appearance: translate('canvasEntityExtract.t10'),
  face: translate('canvasEntityExtract.t11'),
  eyes: translate('canvasEntityExtract.t12'),
  hair: translate('canvasEntityExtract.t13'),
  costume: translate('canvasEntityExtract.t14'),
  accessories: translate('canvasEntityExtract.t15'),
  signatureProp: translate('canvasEntityExtract.t16'),
  marks: translate('canvasEntityExtract.t17'),
  temperament: translate('canvasEntityExtract.t18'),
  personality: translate('canvasEntityExtract.t19'),
  voice: translate('canvasEntityExtract.t20'),
  settingType: translate('canvasEntityExtract.t21'),
  location: translate('canvasEntityExtract.t22'),
  era: translate('canvasEntityExtract.t23'),
  timeOfDay: translate('canvasEntityExtract.t24'),
  weather: translate('canvasEntityExtract.t25'),
  lighting: translate('canvasEntityExtract.t26'),
  colorTone: translate('canvasEntityExtract.t27'),
  artDirection: translate('canvasEntityExtract.t28'),
  styleRef: translate('canvasEntityExtract.t29'),
  spatialLayout: translate('canvasEntityExtract.t30'),
  perspective: translate('canvasEntityExtract.t31'),
  keyElements: translate('canvasEntityExtract.t32'),
  materials: translate('canvasEntityExtract.t33'),
  mood: translate('canvasEntityExtract.t34'),
  category: translate('canvasEntityExtract.t21'),
  owner: translate('canvasEntityExtract.t35'),
  function: translate('canvasEntityExtract.t36'),
  material: translate('canvasEntityExtract.t33'),
  shape: translate('canvasEntityExtract.t37'),
  color: translate('canvasEntityExtract.t38'),
  details: translate('canvasEntityExtract.t39'),
  style: translate('canvasEntityExtract.t40'),
  scale: translate('canvasEntityExtract.t41'),
  effectType: translate('canvasEntityExtract.t42'),
  source: translate('canvasEntityExtract.t43'),
  stage: translate('canvasEntityExtract.t44'),
  motion: translate('canvasEntityExtract.t45'),
  texture: translate('canvasEntityExtract.t46'),
  interaction: translate('canvasEntityExtract.t47'),
}

const ENTITY_LABEL: Record<ExtractEntityKind, string> = {
  character: translate('canvasEntityExtract.t1'),
  scene: translate('canvasEntityExtract.t2'),
  prop: translate('canvasEntityExtract.t3'),
  effect: translate('canvasEntityExtract.t4'),
}

/** 各实体类型的"应覆盖维度"清单——逼模型从粗浅概括升级为可制作的精细设定 */
const DETAIL_GUIDE_BY_KIND: Record<ExtractEntityKind, string> = {
  character: translate('canvasEntityExtract.tpl1Instruction'),
  scene: `- 场景须覆盖：内外景、地点、年代、时间与天气、光源与光影、色调、美术风格与质感、空间层次（前景/中景/背景及纵深）、视角与景别建议、体量尺度、关键陈设与标志物、主要材质、氛围情绪。\n- ${SCENE_NO_PEOPLE_PROMPT} 场景实体的 description、prompt、attributes 均只描述环境本身，不记录人物活动、站位、动作或人物特征；每个场景的 prompt 都必须原样包含“【不要存在人物】”。\n- prompt 必须产出translate('canvasEntityExtract.t111LongDesc')：纯白底或中性背景、干净排版；顶部第一行写场景名；主画面至少包含 4 个视角的子图，按场景类型从以下视图中选取必要组合——整体建立镜头（wide establishing shot）、俯瞰图（top-down / overhead）、正面平视（eye-level front）、侧面侧拍（side angle）、远景（long shot）、近景/中景（medium / close-up）、关键陈设或标志物特写（detail insert）、窗内看向窗外（interior-to-exterior view）、窗外看向窗内（exterior-to-interior view）、360° 环视或前-后-左-右四向展开（360 turnaround / four-side views）；各子图间用统一的光源方向、色温、色调与材质锚点，确保场景在镜头切换、机位变化及后续使用中保持视觉一致；附 1-2 张关键道具/材质放大细节。高清、电影级美术指导质感，单点透视与空气透视正确，景别之间比例与纵深连贯。`,
  prop: translate('canvasEntityExtract.t48LongDesc'),
  effect: translate('canvasEntityExtract.t49Instruction'),
}

/** 构造抽取提示词：要求模型按可解析格式逐个输出实体 */
export function buildEntityExtractionPrompt(
  kind: ExtractEntityKind,
  scriptText: string,
  styleBible?: string,
): string {
  const label = ENTITY_LABEL[kind]
  const attributeKeysByKind: Record<ExtractEntityKind, string[]> = {
    character: [
      'gender',
      'age',
      'height',
      'skin',
      'occupation',
      'appearance',
      'face',
      'eyes',
      'hair',
      'costume',
      'accessories',
      'signatureProp',
      'marks',
      'temperament',
      'personality',
      'voice',
    ],
    scene: [
      'settingType',
      'location',
      'era',
      'timeOfDay',
      'weather',
      'lighting',
      'colorTone',
      'artDirection',
      'styleRef',
      'spatialLayout',
      'perspective',
      'scale',
      'keyElements',
      'materials',
      'mood',
    ],
    prop: [
      'category',
      'owner',
      'function',
      'material',
      'shape',
      'color',
      'details',
      'style',
      'scale',
    ],
    effect: [
      'effectType',
      'source',
      'stage',
      'motion',
      'color',
      'texture',
      'lighting',
      'interaction',
      'mood',
    ],
  }
  const attributeKeys = attributeKeysByKind[kind]
  const example =
    kind === 'character'
      ? {
          kind: 'character',
          entities: [
            {
              name: translate('canvasEntityExtract.t50'),
              description: translate('canvasEntityExtract.t51Instruction'),
              prompt:
                'professional character design model sheet, turnaround reference, pure white background, clean studio layout, character name "Lin Lan" printed at the top, top section with close-up facial detail callouts of eyes, nose, lips and pearl-earring ear alongside a head turnaround showing front, side and back views, middle section with full-body turnaround in front, side and back views, bottom section with costume detail callouts and shoe detail callouts, slim resilient young man around 24, 178cm lean build, tanned slightly rough skin, oval face with sharp brows and deep-set amber eyes, straight nose and thin pressed lips, distinctive three-centimeter old scar on left cheekbone, dark brown side-parted short hair, faded indigo mandarin-collar tunic with worn leather wrist guard and dark waist sash, oxidized brass key on red cord at hip, quiet and composed temperament, high definition, soft diffused studio lighting, shadowless character costume photo, consistent lighting and color anchors across all views',
              attributes: {
                gender: translate('canvasEntityExtract.t52'),
                age: translate('canvasEntityExtract.t53'),
                height: translate('canvasEntityExtract.t54Desc'),
                skin: translate('canvasEntityExtract.t55'),
                occupation: translate('canvasEntityExtract.t56'),
                appearance: translate('canvasEntityExtract.t57Desc'),
                face: translate('canvasEntityExtract.t58Desc'),
                eyes: translate('canvasEntityExtract.t59'),
                hair: translate('canvasEntityExtract.t60Instruction'),
                costume: translate('canvasEntityExtract.t61Desc'),
                accessories: translate('canvasEntityExtract.t62'),
                signatureProp: translate('canvasEntityExtract.t63Desc'),
                marks: translate('canvasEntityExtract.t64'),
                temperament: translate('canvasEntityExtract.t65'),
                personality: translate('canvasEntityExtract.t66'),
              },
            },
          ],
        }
      : kind === 'scene'
        ? {
            kind: 'scene',
            entities: [
              {
                name: translate('canvasEntityExtract.t67'),
                description: translate('canvasEntityExtract.t68Instruction'),
                prompt:
                  '【不要存在人物】pure environment only, no people, characters, crowds, silhouettes, body parts or human reflections, professional scene design model sheet, environment turnaround reference, neutral white background, clean studio layout, scene name "Abandoned Station Waiting Room" printed at the top, multi-view panel with at least four views: wide establishing shot of the abandoned 1980s railway station waiting room interior at night, overhead top-down floor plan view, eye-level front perspective and side angle perspective showing six-meter ceiling height and deep spatial depth, plus a 360 turnaround row showing front back left and right sides, an interior-to-exterior view through the tall arched window toward the cold moonlit platform and an exterior-to-interior view through the ticket window, close-up detail inserts of peeling terrazzo columns rusted platform signs and wet reflective floor tiles, consistent key light from flickering incandescent ceiling lamps with cold blue window spill, unified desaturated teal palette warm-cold contrast, film grain, oppressive suspenseful mood, cinematic production design, single-point and atmospheric perspective correct, consistent lighting color and material anchors across all views to keep the location visually identical across shots and camera moves',
                attributes: {
                  settingType: translate('canvasEntityExtract.t69'),
                  location: translate('canvasEntityExtract.t70'),
                  era: translate('canvasEntityExtract.t71'),
                  timeOfDay: translate('canvasEntityExtract.t72'),
                  lighting: translate('canvasEntityExtract.t73Desc'),
                  colorTone: translate('canvasEntityExtract.t74'),
                  styleRef: translate('canvasEntityExtract.t75'),
                  spatialLayout: translate('canvasEntityExtract.t76Instruction'),
                  perspective: translate('canvasEntityExtract.t77Desc'),
                  scale: translate('canvasEntityExtract.t78'),
                  keyElements: translate('canvasEntityExtract.t79Desc'),
                  materials: translate('canvasEntityExtract.t80Desc'),
                  mood: translate('canvasEntityExtract.t81'),
                },
              },
            ],
          }
        : kind === 'prop'
          ? {
              kind: 'prop',
              entities: [
                {
                  name: translate('canvasEntityExtract.t82'),
                  description: translate('canvasEntityExtract.t83LongDesc'),
                  prompt:
                    'aged brass key prop design sheet, elongated teeth, worn edges, dark red cord knot, engraved number, macro detail, front side back views, neutral background, cinematic prop reference',
                  attributes: {
                    category: translate('canvasEntityExtract.t84'),
                    owner: translate('canvasEntityExtract.t50'),
                    function: translate('canvasEntityExtract.t85Desc'),
                    material: translate('canvasEntityExtract.t86'),
                    shape: translate('canvasEntityExtract.t87'),
                    color: translate('canvasEntityExtract.t88'),
                    details: translate('canvasEntityExtract.t89Desc'),
                    style: translate('canvasEntityExtract.t90'),
                    scale: translate('canvasEntityExtract.t91'),
                  },
                },
              ],
            }
          : {
              kind: 'effect',
              entities: [
                {
                  name: translate('canvasEntityExtract.t92'),
                  description: translate('canvasEntityExtract.t93Instruction'),
                  prompt:
                    'blue white electric arc energy shield VFX design, translucent curved force field, crawling lightning, particle sparks, air distortion, interactive glow on face and nearby props, cinematic VFX reference sheet',
                  attributes: {
                    effectType: translate('canvasEntityExtract.t94'),
                    source: translate('canvasEntityExtract.t95'),
                    stage: translate('canvasEntityExtract.t96Desc'),
                    motion: translate('canvasEntityExtract.t97'),
                    color: translate('canvasEntityExtract.t98'),
                    texture: translate('canvasEntityExtract.t99Desc'),
                    lighting: translate('canvasEntityExtract.t100Desc'),
                    interaction: translate('canvasEntityExtract.t101'),
                    mood: translate('canvasEntityExtract.t102'),
                  },
                },
              ],
            }

  const detailGuide = DETAIL_GUIDE_BY_KIND[kind]

  return [
    `【任务】你是资深影视美术/设定师。通读下面的剧本，抽取其中出现的全部${label}，为每个${label}产出translate('canvasEntityExtract.t112')的精细化设定，输出稳定 JSON。`,
    translate('canvasEntityExtract.t103Instruction'),
    `JSON 顶层结构必须为：{"kind":"${kind}","entities":[...]}`,
    `每个 entities[] 项必须包含 name、description、prompt、attributes。attributes 只使用这些 key：${attributeKeys.join(', ')}。`,
    translate('canvasEntityExtract.t104Desc'),
    detailGuide,
    translate('canvasEntityExtract.t105Instruction'),
    translate('canvasEntityExtract.t106Instruction'),
    translate('canvasEntityExtract.t107LongDesc'),
    `同一${label}只出现一次，按剧情重要性排序。`,
    '',
    translate('canvasEntityExtract.t108Desc'),
    JSON.stringify(example, null, 2),
    '',
    styleBible && styleBible.trim()
      ? `【可参考的全片视觉总设定（须贯彻一致性）】\n${styleBible.trim()}\n`
      : '',
    translate('canvasEntityExtract.t109'),
    scriptText.trim(),
  ]
    .filter(Boolean)
    .join('\n')
}

/** 取「字段：值」；返回 null 表示该行不是字段行 */
function parseFieldLine(line: string): { rawKey: string; value: string } | null {
  const match = line.match(/^[\s\-*•]*([^：:]{1,12})[：:]\s*(.*)$/)
  if (!match) return null
  return { rawKey: match[1]!.trim(), value: (match[2] ?? '').trim() }
}

/**
 * 兜底：识别「编号 / 项目符号 + 名称」作为实体起点（模型不守「名称：」格式时常见）。
 * 例：`1. 林岚`、`1、林岚：清瘦少年`、`- 陈默 - 神秘访客`。
 * 返回 { name, rest }，rest 为名称后的补充描述（可空）；不匹配返回 null。
 */
function parseNumberedNameLine(line: string): { name: string; rest: string } | null {
  const match = line.match(
    /^\s*(?:\d+|[一二三四五六七八九十]+)[.、)：:]\s*([^：:，,\-—]{1,16})(?:[：:，,\-—]\s*(.*))?$/,
  )
  if (!match) return null
  const name = match[1]!.trim()
  if (!name) return null
  return { name, rest: (match[2] ?? '').trim() }
}

/** 归一化字段名到标准 key；无匹配返回原 key */
function normalizeFieldKey(kind: ExtractEntityKind, rawKey: string): string {
  for (const alias of FIELD_ALIASES[kind]) {
    if (alias.match.test(rawKey)) return alias.key
  }
  return rawKey
}

/** 把归一化字段拼成可读描述 */
export function buildEntityDescription(name: string, fields: Record<string, string>): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => `${FIELD_LABELS[key] ?? key}：${value.trim()}`)
  return parts.length > 0 ? `${name}（${parts.join('；')}）` : name
}

function tryParseJsonValues(text: string): unknown[] {
  return parseCanvasJsonCandidates(text)
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJsonEntities(kind: ExtractEntityKind, text: string): ParsedEntity[] {
  const collectionKeys: Record<ExtractEntityKind, string[]> = {
    character: ['entities', 'characters', translate('canvasEntityExtract.t1')],
    scene: ['entities', 'scenes', translate('canvasEntityExtract.t2')],
    prop: ['entities', 'props', translate('canvasEntityExtract.t3')],
    effect: ['entities', 'effects', translate('canvasEntityExtract.t4')],
  }
  for (const parsed of tryParseJsonValues(text)) {
    if (!parsed || typeof parsed !== 'object') continue
    const root = parsed as Record<string, unknown>
    const nestedData =
      root.data && typeof root.data === 'object' && !Array.isArray(root.data)
        ? (root.data as Record<string, unknown>)
        : null
    const rawEntities = Array.isArray(parsed)
      ? parsed
      : (collectionKeys[kind]
          .map((key) => root[key] ?? nestedData?.[key])
          .find((value): value is unknown[] => Array.isArray(value)) ?? [])
    const result: ParsedEntity[] = []
    const seen = new Set<string>()
    for (const raw of rawEntities) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const name =
        stringField(item.name) || stringField(item.名称) || stringField(item.characterName)
      if (!name) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      const fields: Record<string, string> = {}
      const attrs = item.attributes ?? item.属性 ?? item.fields
      if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
        for (const [rawKey, rawValue] of Object.entries(attrs as Record<string, unknown>)) {
          const value = stringField(rawValue)
          if (!value) continue
          fields[normalizeFieldKey(kind, rawKey)] = value
        }
      }
      const description =
        stringField(item.description) ||
        stringField(item.描述) ||
        buildEntityDescription(name, fields)
      const prompt = stringField(item.prompt) || stringField(item.提示词)
      result.push({
        name,
        fields,
        description,
        ...(prompt ? { prompt } : {}),
        raw: item,
      })
    }
    if (result.length > 0) return result
  }
  return []
}

/**
 * 解析模型输出的实体清单。容错：
 * - 优先解析 JSON：{"entities":[{name, description, prompt, attributes}]}；
 * - 以「名称：X」或「名称:X」作为实体起点；
 * - 其后的「字段：值」行归一化进 fields；
 * - 无冒号的行追加到当前实体描述；
 * - 同名实体合并（后出现的字段补全先出现的，不覆盖已有非空值）。
 */
export function parseExtractedEntities(kind: ExtractEntityKind, text: string): ParsedEntity[] {
  const jsonEntities = parseJsonEntities(kind, text)
  if (jsonEntities.length > 0) return jsonEntities

  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const byName = new Map<string, ParsedEntity>()
  const order: string[] = []
  let current: ParsedEntity | null = null
  const extraLines = new Map<string, string[]>()

  const isNameLine = (parsed: { rawKey: string } | null): boolean =>
    parsed != null && /^名称|^名字|^名$/.test(parsed.rawKey)

  const startEntity = (name: string): ParsedEntity => {
    const key = name.toLowerCase()
    const existing = byName.get(key)
    if (existing) return existing
    const entity: ParsedEntity = { name, fields: {}, description: '' }
    byName.set(key, entity)
    order.push(key)
    extraLines.set(key, [])
    return entity
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const field = parseFieldLine(line)

    if (isNameLine(field) && field!.value.trim()) {
      current = startEntity(field!.value.trim())
      continue
    }

    // 兜底：「1. 林岚」「- 陈默 - 神秘访客」等编号/项目符号名称行作为实体起点
    const numbered = parseNumberedNameLine(line)
    if (numbered) {
      current = startEntity(numbered.name)
      if (numbered.rest) extraLines.get(current.name.toLowerCase())?.push(numbered.rest)
      continue
    }

    if (!current) continue

    if (field && field.value) {
      const stdKey = normalizeFieldKey(kind, field.rawKey)
      // 不覆盖已有非空值（合并语义）
      if (!current.fields[stdKey] || current.fields[stdKey]!.trim().length === 0) {
        current.fields[stdKey] = field.value
      }
    } else {
      // 非字段行：作为补充描述
      const key = current.name.toLowerCase()
      extraLines.get(key)?.push(line)
    }
  }

  return order.map((key) => {
    const entity = byName.get(key)!
    const extras = extraLines.get(key) ?? []
    const base = buildEntityDescription(entity.name, entity.fields)
    entity.description = extras.length > 0 ? `${base}\n${extras.join('\n')}` : base
    return entity
  })
}

export function parseExtractedCharacters(text: string): ParsedEntity[] {
  return parseExtractedEntities('character', text)
}

export function parseExtractedScenes(text: string): ParsedEntity[] {
  return parseExtractedEntities('scene', text)
}
