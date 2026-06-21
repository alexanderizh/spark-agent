/**
 * 实体抽取（剧本 → 角色 / 场景，一对多）。
 *
 * 用于画布「文本节点右键 → 提取角色 / 提取场景」：让文本模型按**固定可解析格式**
 * 输出实体清单，再用这里的解析器还原为结构化实体，逐个落库 + 在画布生成专用节点。
 * 纯逻辑、无 DOM/IPC，便于单测。
 */

export type ExtractEntityKind = 'character' | 'scene'

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
    { key: 'occupation', match: /^身份|职业|角色定位|occupation|role$/i },
    { key: 'appearance', match: /^外貌|外形|长相|相貌|体貌|appearance|look$/i },
    { key: 'hair', match: /^发型|发式|头发|hair$/i },
    { key: 'costume', match: /^服饰|服装|穿着|衣着|costume|clothing$/i },
    { key: 'signatureProp', match: /^标志道具|随身道具|道具|标志物|signatureProp|prop$/i },
    { key: 'personality', match: /^性格|气质|个性|personality$/i },
    { key: 'voice', match: /^声线|声音|嗓音|voice$/i },
  ],
  scene: [
    { key: 'settingType', match: /^类型|内外景|场景类型|settingType|type$/i },
    { key: 'location', match: /^地点|位置|场所|location|place$/i },
    { key: 'timeOfDay', match: /^时间|时段|时间段|timeOfDay|time$/i },
    { key: 'weather', match: /^天气|weather$/i },
    { key: 'lighting', match: /^光线|光影|照明|lighting|light$/i },
    { key: 'colorTone', match: /^色调|色彩|色温|colorTone|palette$/i },
    { key: 'artDirection', match: /^美术|美术风格|风格|artDirection|art$/i },
    { key: 'mood', match: /^氛围|情绪|气氛|mood|atmosphere$/i },
  ],
}

const FIELD_LABELS: Record<string, string> = {
  age: '年龄',
  gender: '性别',
  occupation: '身份',
  appearance: '外貌',
  hair: '发型',
  costume: '服饰',
  signatureProp: '标志道具',
  personality: '性格',
  voice: '声线',
  settingType: '类型',
  location: '地点',
  timeOfDay: '时间',
  weather: '天气',
  lighting: '光线',
  colorTone: '色调',
  artDirection: '美术',
  mood: '氛围',
}

const ENTITY_LABEL: Record<ExtractEntityKind, string> = {
  character: '角色',
  scene: '场景',
}

/** 构造抽取提示词：要求模型按可解析格式逐个输出实体 */
export function buildEntityExtractionPrompt(
  kind: ExtractEntityKind,
  scriptText: string,
  styleBible?: string,
): string {
  const label = ENTITY_LABEL[kind]
  const attributeKeys =
    kind === 'character'
      ? ['age', 'gender', 'occupation', 'appearance', 'hair', 'costume', 'signatureProp', 'personality', 'voice']
      : ['settingType', 'location', 'timeOfDay', 'weather', 'lighting', 'colorTone', 'artDirection', 'mood']
  const example =
    kind === 'character'
      ? {
          kind: 'character',
          entities: [
            {
              name: '林岚',
              description: '清瘦青年，左脸有旧疤，沉默坚韧，是故事的主要行动者。',
              prompt: 'slim young man, scar on left cheek, indigo short outfit, brass key, quiet and resilient, cinematic character design',
              attributes: {
                age: '青年',
                gender: '男',
                occupation: '主角 / 行动者',
                appearance: '清瘦，左脸有疤',
                costume: '靛蓝短打',
                signatureProp: '铜钥匙',
                personality: '沉默、坚韧',
              },
            },
          ],
        }
      : {
          kind: 'scene',
          entities: [
            {
              name: '旧车站候车室',
              description: '废弃车站的内景夜戏空间，顶灯忽明忽暗，压抑且悬疑。',
              prompt: 'abandoned railway station waiting room at night, flickering ceiling lights, oppressive suspense mood, cinematic production design',
              attributes: {
                settingType: '内景',
                location: '废弃车站',
                timeOfDay: '夜',
                lighting: '忽明忽暗的顶灯',
                mood: '压抑、悬疑',
              },
            },
          ],
        }

  return [
    `【任务】通读下面的剧本，抽取其中出现的全部${label}，输出稳定 JSON。`,
    '【硬性格式要求】只输出一个 JSON 对象，不要 Markdown，不要代码块，不要额外解释。',
    `JSON 顶层结构必须为：{"kind":"${kind}","entities":[...]}`,
    `每个 entities[] 项必须包含 name、description、prompt、attributes。attributes 只使用这些 key：${attributeKeys.join(', ')}。`,
    'description 写完整可读设定；prompt 写可直接用于后续 AI 生图/生视频的视觉提示词；无信息的字段不要编造，可省略。',
    `同一${label}只出现一次，按剧情重要性排序。`,
    '',
    '【示例】',
    JSON.stringify(example, null, 2),
    '',
    styleBible && styleBible.trim() ? `【可参考的全片视觉总设定】\n${styleBible.trim()}\n` : '',
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
  const match = line.match(/^\s*(?:\d+|[一二三四五六七八九十]+)[.、)：:]\s*([^：:，,\-—]{1,16})(?:[：:，,\-—]\s*(.*))?$/)
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

function tryParseJsonObject(text: string): unknown | null {
  const trimmed = text.trim()
  const candidates = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try next candidate
    }
  }
  return null
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJsonEntities(kind: ExtractEntityKind, text: string): ParsedEntity[] {
  const parsed = tryParseJsonObject(text)
  if (!parsed || typeof parsed !== 'object') return []
  const root = parsed as Record<string, unknown>
  const rawEntities = Array.isArray(root.entities) ? root.entities : []
  const result: ParsedEntity[] = []
  const seen = new Set<string>()
  for (const raw of rawEntities) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const name = stringField(item.name)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const fields: Record<string, string> = {}
    const attrs = item.attributes
    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
      for (const [rawKey, rawValue] of Object.entries(attrs as Record<string, unknown>)) {
        const value = stringField(rawValue)
        if (!value) continue
        fields[normalizeFieldKey(kind, rawKey)] = value
      }
    }
    const description = stringField(item.description) || buildEntityDescription(name, fields)
    const prompt = stringField(item.prompt)
    result.push({
      name,
      fields,
      description,
      ...(prompt ? { prompt } : {}),
      raw: item,
    })
  }
  return result
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
