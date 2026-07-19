/**
 * 实体抽取（剧本 → 角色 / 场景 / 道具 / 特效，一对多）。
 *
 * 用于画布「文本节点右键 → 提取角色 / 提取场景」：让文本模型按**固定可解析格式**
 * 输出实体清单，再用这里的解析器还原为结构化实体，逐个落库 + 在画布生成专用节点。
 * 纯逻辑、无 DOM/IPC，便于单测。
 */

import { SCENE_NO_PEOPLE_PROMPT } from './canvasScenePrompt'

export type ExtractEntityKind = 'character' | 'scene' | 'prop' | 'effect'

export function extractEntityKindLabel(kind: ExtractEntityKind): string {
  return kind === 'character'
    ? '角色'
    : kind === 'scene'
      ? '场景'
      : kind === 'prop'
        ? '道具'
        : '特效'
}

export function resolveExtractEntityKindFromWorkflow(
  workflow: unknown,
): ExtractEntityKind | null {
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
    { key: 'gender', match: /^性别|gender$/i },
    { key: 'age', match: /^年龄|年龄段|年纪|age$/i },
    { key: 'height', match: /^身高|体型|身形|身材|体态|height|build|physique$/i },
    { key: 'skin', match: /^肤色|皮肤|肤质|skin|complexion$/i },
    { key: 'occupation', match: /^身份|职业|角色定位|occupation|role$/i },
    { key: 'appearance', match: /^外貌|外形|长相|相貌|体貌|appearance|look$/i },
    { key: 'face', match: /^五官|面貌|脸型|面庞|相貌特征|face|facial|features$/i },
    { key: 'eyes', match: /^眼睛|眼神|目色|瞳色|eyes|eye$/i },
    { key: 'hair', match: /^发型|发式|发色|头发|hair$/i },
    { key: 'costume', match: /^服饰|服装|穿着|衣着|costume|clothing|outfit$/i },
    { key: 'accessories', match: /^配饰|饰品|首饰|佩饰|accessory|accessories$/i },
    { key: 'signatureProp', match: /^标志道具|随身道具|道具|标志物|signatureProp|prop$/i },
    { key: 'marks', match: /^标志特征|特征|疤痕|纹身|胎记|辨识|marks|mark|tattoo|scar$/i },
    { key: 'temperament', match: /^气质|神态|气场|temperament|aura$/i },
    { key: 'personality', match: /^性格|个性|personality$/i },
    { key: 'voice', match: /^声线|声音|嗓音|voice$/i },
  ],
  scene: [
    { key: 'settingType', match: /^类型|内外景|场景类型|settingType|type$/i },
    { key: 'location', match: /^地点|位置|场所|location|place$/i },
    { key: 'era', match: /^年代|时代|时期|纪元|era|period$/i },
    { key: 'timeOfDay', match: /^时间|时段|时间段|timeOfDay|time$/i },
    { key: 'weather', match: /^天气|weather$/i },
    { key: 'lighting', match: /^光线|光影|照明|光源|lighting|light$/i },
    { key: 'colorTone', match: /^色调|色彩|色温|colorTone|palette$/i },
    { key: 'artDirection', match: /^美术|美术风格|风格|artDirection|art$/i },
    { key: 'styleRef', match: /^风格参考|质感|画风|风格锚点|styleRef|reference$/i },
    { key: 'spatialLayout', match: /^空间|空间层次|布局|纵深|景深|层次|spatialLayout|layout|depth$/i },
    { key: 'perspective', match: /^视角|机位|景别|取景|perspective|angle|framing$/i },
    { key: 'scale', match: /^体量|尺度|规模|大小|scale|size$/i },
    { key: 'keyElements', match: /^陈设|关键陈设|标志物|核心物件|道具|keyElements|elements|props$/i },
    { key: 'materials', match: /^材质|质感|材料|表面|materials|material|texture$/i },
    { key: 'mood', match: /^氛围|情绪|气氛|mood|atmosphere$/i },
  ],
  prop: [
    { key: 'category', match: /^类型|类别|category|type$/i },
    { key: 'owner', match: /^归属|持有者|使用者|owner|user$/i },
    { key: 'function', match: /^功能|用途|作用|function|purpose$/i },
    { key: 'material', match: /^材质|材料|material$/i },
    { key: 'shape', match: /^形状|轮廓|造型|shape|silhouette$/i },
    { key: 'color', match: /^颜色|色彩|color|palette$/i },
    { key: 'details', match: /^细节|纹理|磨损|机关|details|texture$/i },
    { key: 'style', match: /^风格|工艺|年代感|style|craft$/i },
    { key: 'scale', match: /^尺寸|比例|大小|scale|size$/i },
  ],
  effect: [
    { key: 'effectType', match: /^类型|特效类型|effectType|type$/i },
    { key: 'source', match: /^来源|触发|source|trigger$/i },
    { key: 'stage', match: /^阶段|起势|峰值|消散|生命周期|stage|phase$/i },
    { key: 'motion', match: /^运动|动态|轨迹|motion|movement$/i },
    { key: 'color', match: /^颜色|色彩|color|palette$/i },
    { key: 'texture', match: /^质感|粒子|纹理|texture|particles$/i },
    { key: 'lighting', match: /^光照|发光|lighting|glow$/i },
    { key: 'interaction', match: /^交互|影响|interaction|impact$/i },
    { key: 'mood', match: /^氛围|情绪|mood|atmosphere$/i },
  ],
}

const FIELD_LABELS: Record<string, string> = {
  age: '年龄',
  gender: '性别',
  height: '身高体型',
  skin: '肤色',
  occupation: '身份',
  appearance: '外貌',
  face: '面庞五官',
  eyes: '眼睛',
  hair: '发型',
  costume: '服饰',
  accessories: '配饰',
  signatureProp: '标志道具',
  marks: '标志特征',
  temperament: '气质神态',
  personality: '性格',
  voice: '声线',
  settingType: '类型',
  location: '地点',
  era: '年代',
  timeOfDay: '时间',
  weather: '天气',
  lighting: '光线',
  colorTone: '色调',
  artDirection: '美术',
  styleRef: '风格参考',
  spatialLayout: '空间层次',
  perspective: '视角景别',
  keyElements: '关键陈设',
  materials: '材质',
  mood: '氛围',
  category: '类型',
  owner: '归属',
  function: '功能',
  material: '材质',
  shape: '形状',
  color: '颜色',
  details: '细节',
  style: '风格工艺',
  scale: '体量尺寸',
  effectType: '特效类型',
  source: '来源',
  stage: '阶段',
  motion: '动态',
  texture: '质感',
  interaction: '交互',
}

const ENTITY_LABEL: Record<ExtractEntityKind, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  effect: '特效',
}

/** 各实体类型的"应覆盖维度"清单——逼模型从粗浅概括升级为可制作的精细设定 */
const DETAIL_GUIDE_BY_KIND: Record<ExtractEntityKind, string> = {
  character:
    '- 角色须覆盖：性别、年龄、身高与体型、肤色、脸型与五官特色（眉/眼/鼻/唇）、眼睛颜色与神态、发型发色、身份职业、服饰（款式/颜色/材质/新旧）、配饰、标志道具、标志特征（疤痕/纹身/胎记等辨识点）、气质神态、性格、声线。\n- prompt 必须产出"专业角色定妆设计图（character model sheet / turnaround reference）"：纯白底、干净排版；顶部第一行写角色名；顶部区域放面部特征拆解特写（眼/鼻/唇/佩戴饰物的耳部）与头部三视图（正/侧/背）；中部区域放全身三视图（正/侧/背）；底部或侧边放服装细节图与鞋的细节图；高清、柔和摄影棚光效、无影棚角色定妆照质感，统一光照与色彩锚点确保多视图一致性。',
  scene: `- 场景须覆盖：内外景、地点、年代、时间与天气、光源与光影、色调、美术风格与质感、空间层次（前景/中景/背景及纵深）、视角与景别建议、体量尺度、关键陈设与标志物、主要材质、氛围情绪。\n- ${SCENE_NO_PEOPLE_PROMPT} 场景实体的 description、prompt、attributes 均只描述环境本身，不记录人物活动、站位、动作或人物特征；每个场景的 prompt 都必须原样包含“【不要存在人物】”。\n- prompt 必须产出"专业场景设计参考图（scene model sheet / environment turnaround）"：纯白底或中性背景、干净排版；顶部第一行写场景名；主画面至少包含 4 个视角的子图，按场景类型从以下视图中选取必要组合——整体建立镜头（wide establishing shot）、俯瞰图（top-down / overhead）、正面平视（eye-level front）、侧面侧拍（side angle）、远景（long shot）、近景/中景（medium / close-up）、关键陈设或标志物特写（detail insert）、窗内看向窗外（interior-to-exterior view）、窗外看向窗内（exterior-to-interior view）、360° 环视或前-后-左-右四向展开（360 turnaround / four-side views）；各子图间用统一的光源方向、色温、色调与材质锚点，确保场景在镜头切换、机位变化及后续使用中保持视觉一致；附 1-2 张关键道具/材质放大细节。高清、电影级美术指导质感，单点透视与空气透视正确，景别之间比例与纵深连贯。`,
  prop:
    '- 道具须覆盖：类别、归属者、功能用途、材质、造型轮廓、颜色、细节（纹理/磨损/机关/编号）、工艺风格与年代感、尺寸比例。',
  effect:
    '- 特效须覆盖：特效类型、触发来源、生命周期阶段（起势/峰值/消散）、运动轨迹、颜色、质感（粒子/烟雾/能量膜）、发光与照明、与角色/环境的交互影响、氛围情绪。',
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
              name: '林岚',
              description:
                '约二十四五岁的清瘦青年，身高约178cm，肩窄背直，常年奔波留下小麦色略粗糙的肤色。鹅蛋脸、剑眉深目，琥珀色眼瞳眼神锐利而克制，鼻梁挺直、薄唇微抿；左颧骨有一道约三厘米的旧刀疤，是辨识度最高的标志。深褐短发偏分、发尾微乱。常穿洗得发白的靛蓝色立领短打，外搭半旧皮质护腕，腰间系深色布带。随身一枚刻有编号的氧化铜钥匙，用红绳系在腰侧。气质沉静内敛，性格沉默而坚韧，是推动故事的主要行动者。',
              prompt:
                'professional character design model sheet, turnaround reference, pure white background, clean studio layout, character name "林岚" printed at the top, top section with close-up facial detail callouts of eyes, nose, lips and pearl-earring ear alongside a head turnaround showing front, side and back views, middle section with full-body turnaround in front, side and back views, bottom section with costume detail callouts and shoe detail callouts, slim resilient young man around 24, 178cm lean build, tanned slightly rough skin, oval face with sharp brows and deep-set amber eyes, straight nose and thin pressed lips, distinctive three-centimeter old scar on left cheekbone, dark brown side-parted short hair, faded indigo mandarin-collar tunic with worn leather wrist guard and dark waist sash, oxidized brass key on red cord at hip, quiet and composed temperament, high definition, soft diffused studio lighting, shadowless character costume photo, consistent lighting and color anchors across all views',
              attributes: {
                gender: '男',
                age: '青年（约24岁）',
                height: '约178cm，清瘦、肩窄背直',
                skin: '小麦色，略粗糙',
                occupation: '主角 / 行动者',
                appearance: '清瘦挺拔，常年奔波的风尘感',
                face: '鹅蛋脸，剑眉深目，鼻梁挺直，薄唇微抿',
                eyes: '琥珀色，眼神锐利克制',
                hair: '深褐短发偏分，发尾微乱',
                costume: '洗白的靛蓝立领短打，半旧皮护腕，深色腰带',
                accessories: '皮质护腕、腰间布带',
                signatureProp: '刻编号的氧化铜钥匙（红绳系于腰侧）',
                marks: '左颧骨约3cm旧刀疤',
                temperament: '沉静内敛',
                personality: '沉默、坚韧',
              },
            },
          ],
        }
      : kind === 'scene'
        ? {
            kind: 'scene',
            entities: [
              {
                name: '旧车站候车室',
                description:
                  '上世纪八十年代废弃火车站的内景，夜戏。空间纵深清晰：前景是翻倒的木质长椅与散落报纸，中景是斑驳剥落的水磨石立柱与售票窗口，背景是高大拱形窗透入的冷蓝月光与生锈的站台指示牌。层高约六米，空间空旷而压抑。主光来自忽明忽暗的吊顶白炽灯，辅以窗外冷色漏光，地面有积水反射形成明暗交错。材质上墙面起皮、铁件锈蚀、地砖油腻发暗。整体暖黄人工光与冷蓝自然光对冲，色调低饱和偏青绿，氛围压抑、悬疑，带颗粒胶片质感。',
                prompt:
                  '【不要存在人物】pure environment only, no people, characters, crowds, silhouettes, body parts or human reflections, professional scene design model sheet, environment turnaround reference, neutral white background, clean studio layout, scene name "旧车站候车室" printed at the top, multi-view panel with at least four views: wide establishing shot of the abandoned 1980s railway station waiting room interior at night, overhead top-down floor plan view, eye-level front perspective and side angle perspective showing six-meter ceiling height and deep spatial depth, plus a 360 turnaround row showing front back left and right sides, an interior-to-exterior view through the tall arched window toward the cold moonlit platform and an exterior-to-interior view through the ticket window, close-up detail inserts of peeling terrazzo columns rusted platform signs and wet reflective floor tiles, consistent key light from flickering incandescent ceiling lamps with cold blue window spill, unified desaturated teal palette warm-cold contrast, film grain, oppressive suspenseful mood, cinematic production design, single-point and atmospheric perspective correct, consistent lighting color and material anchors across all views to keep the location visually identical across shots and camera moves',
                attributes: {
                  settingType: '内景',
                  location: '废弃火车站候车室',
                  era: '上世纪80年代',
                  timeOfDay: '夜',
                  lighting: '忽明忽暗的吊顶白炽灯为主光，窗外冷色漏光为辅，积水反射',
                  colorTone: '低饱和偏青绿，暖冷对冲',
                  styleRef: '颗粒胶片质感，怀旧写实',
                  spatialLayout: '前景翻倒长椅/报纸，中景剥落立柱与售票窗，背景拱窗月光与站台牌',
                  perspective: '低机位广角建立镜头，兼顾细节插入',
                  scale: '层高约6米，空旷压抑',
                  keyElements: '拱形高窗、水磨石立柱、售票窗口、生锈指示牌',
                  materials: '墙面起皮、铁件锈蚀、地砖油腻发暗',
                  mood: '压抑、悬疑',
                },
              },
            ],
          }
        : kind === 'prop'
          ? {
              kind: 'prop',
              entities: [
                {
                  name: '铜钥匙',
                  description:
                    '角色随身携带的旧铜钥匙，细长齿形、磨损边缘、暗红绳结和刻痕编号，是推动剧情的关键道具。',
                  prompt:
                    'aged brass key prop design sheet, elongated teeth, worn edges, dark red cord knot, engraved number, macro detail, front side back views, neutral background, cinematic prop reference',
                  attributes: {
                    category: '关键随身道具',
                    owner: '林岚',
                    function: '开启旧车站储物柜 / 剧情线索',
                    material: '氧化旧铜、红绳',
                    shape: '细长齿形，柄部圆环',
                    color: '暗金氧化色，绳结暗红',
                    details: '磨损边缘、刻痕编号、绿锈斑',
                    style: '复古工业，怀旧做旧',
                    scale: '手掌大小（约8cm）',
                  },
                },
              ],
            }
          : {
              kind: 'effect',
              entities: [
                {
                  name: '蓝白电弧护盾',
                  description:
                    '角色抬手触发的半透明能量护盾，蓝白电弧沿弧面游走，边缘有粒子碎屑与空气扭曲，照亮脸部和近处道具。',
                  prompt:
                    'blue white electric arc energy shield VFX design, translucent curved force field, crawling lightning, particle sparks, air distortion, interactive glow on face and nearby props, cinematic VFX reference sheet',
                  attributes: {
                    effectType: '能量护盾',
                    source: '角色抬手触发',
                    stage: '起势聚能→峰值稳定弧面→消散粒子飘散',
                    motion: '电弧沿弧面游走并向外扩散',
                    color: '蓝白高光、紫色边缘',
                    texture: '半透明能量膜、粒子碎屑、空气扭曲',
                    lighting: '自发光，向四周投射冷蓝辉光',
                    interaction: '照亮脸部和近处道具',
                    mood: '紧张、科技感',
                  },
                },
              ],
            }

  const detailGuide = DETAIL_GUIDE_BY_KIND[kind]

  return [
    `【任务】你是资深影视美术/设定师。通读下面的剧本，抽取其中出现的全部${label}，为每个${label}产出"可直接用于精良影视制作"的精细化设定，输出稳定 JSON。`,
    '【硬性格式要求】只输出一个 JSON 对象，不要 Markdown，不要代码块，不要额外解释。',
    `JSON 顶层结构必须为：{"kind":"${kind}","entities":[...]}`,
    `每个 entities[] 项必须包含 name、description、prompt、attributes。attributes 只使用这些 key：${attributeKeys.join(', ')}。`,
    '【精细化要求】务必摆脱粗浅概括，做到具体、可视、可复用：',
    detailGuide,
    'description 写成 4-6 句的专业设定稿，逐项覆盖上述维度，给出可观察的细节（颜色、材质、比例、光影、空间关系、辨识特征等），剧本未明示的合理细节可基于人物/情境补全，但不得与剧情冲突；',
    'prompt 写"可直接喂给 AI 生图/生视频模型"的视觉提示词（中英不限，推荐英文），包含主体描述、关键视觉细节、镜头/视角/景别、光影与色调、一致性锚点、电影美术与画质关键词；',
    'attributes 每个字段给一句具体短语而非单词，确实无信息的字段才省略，不要编造与剧情矛盾的内容。',
    `同一${label}只出现一次，按剧情重要性排序。`,
    '',
    '【精细化示例（请对齐这一详尽程度，而非更简略）】',
    JSON.stringify(example, null, 2),
    '',
    styleBible && styleBible.trim() ? `【可参考的全片视觉总设定（须贯彻一致性）】\n${styleBible.trim()}\n` : '',
    '【剧本】',
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

function collectBalancedJsonCandidates(text: string): string[] {
  const candidates: string[] = []
  let start = -1
  let stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (start < 0) {
      if (char === '{' || char === '[') {
        start = index
        stack = [char === '{' ? '}' : ']']
      }
      continue
    }
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']')
      continue
    }
    if (char !== stack.at(-1)) continue
    stack.pop()
    if (stack.length === 0) {
      candidates.push(text.slice(start, index + 1))
      start = -1
    }
  }
  return candidates
}

function tryParseJsonValues(text: string): unknown[] {
  const trimmed = text.trim()
  const candidates = [trimmed]
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) candidates.push(match[1].trim())
  }
  candidates.push(...collectBalancedJsonCandidates(trimmed))
  const parsedValues: unknown[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    try {
      parsedValues.push(JSON.parse(candidate))
    } catch {
      // try next candidate
    }
  }
  return parsedValues
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJsonEntities(kind: ExtractEntityKind, text: string): ParsedEntity[] {
  const collectionKeys: Record<ExtractEntityKind, string[]> = {
    character: ['entities', 'characters', '角色'],
    scene: ['entities', 'scenes', '场景'],
    prop: ['entities', 'props', '道具'],
    effect: ['entities', 'effects', '特效'],
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
      : collectionKeys[kind]
          .map((key) => root[key] ?? nestedData?.[key])
          .find((value): value is unknown[] => Array.isArray(value)) ?? []
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
