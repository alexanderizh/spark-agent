/**
 * 分镜表解析（把「分镜 agent」产出的 Markdown 分镜表解析回结构化片段，批量落库）。
 *
 * 分镜 agent / 导演 agent 输出的是 Markdown 表格（列可乱序、可增列），形如：
 *   | 镜号 | 时长(秒) | 景别 | 运镜 | 画面/动作 | 对白 | 角色 |
 * 本模块按「表头关键字」识别列，容忍列顺序变化与额外列，解析为 ParsedShotRow[]，
 * 供面板把每行 createShotSegment 落库。纯逻辑、无 DOM/IPC，便于单测。
 */

/** 解析出的一行分镜（字段全部可选，便于容错） */
export type ParsedShotRow = {
  /** 镜号（解析失败时由调用方按顺序兜底） */
  index?: number
  /** 标题（默认「镜N」） */
  title: string
  /** 时长（秒） */
  durationSec?: number
  /** 景别 */
  shotSize?: string
  /** 角度 */
  angle?: string
  /** 运镜 */
  movement?: string
  /** 场景布局 / 场景描述 */
  sceneLayout?: string
  /** 构图、画面分割与视觉中心 */
  composition?: string
  /** 站位与场面调度 */
  blocking?: string
  /** 光照方案 */
  lighting?: string
  /** 镜头参数（焦距/光圈/ISO/景深等） */
  cameraParams?: string
  /** 镜头焦距 / 焦段 */
  focalLength?: string
  /** 光圈 / 景深 */
  aperture?: string
  /** 感光度 / 颗粒质感 */
  iso?: string
  /** 色调与色彩方案 */
  colorTone?: string
  /** 氛围与情绪基调 */
  mood?: string
  /** 表情、微表情与细小动作 */
  performance?: string
  /** 服装、造型与配饰 */
  costume?: string
  /** 场次 / 分组名 */
  groupName?: string
  /** 场景名 */
  sceneName?: string
  /** 画面 / 动作描述 */
  description?: string
  /** 对白 */
  dialogue?: string
  /** 旁白 */
  narration?: string
  /** 角色名（原始文本，调用方可再匹配为 assetId） */
  characterNames?: string[]
  /** 角色图 / 角色资产参考与本镜造型状态 */
  characterReferences?: string
  /** 0.5s 精度的动作节拍 */
  actionBeats?: string
  /** 环境声、拟音、音乐等声音设计 */
  soundEffects?: string
  /** 入镜 / 出镜剪辑与转场标识 */
  transition?: string
  /** 镜头 0.0s 首帧 */
  firstFrame?: string
  /** 镜头末尾帧 */
  lastFrame?: string
  /** 轴线、道具、光向等镜间连续性约束 */
  continuity?: string
  /** 镜头语言合并文本（景别+角度+运镜，或「镜头」列原文） */
  shotPrompt?: string
  /** 反向提示词 / 不应出现内容 */
  negativePrompt?: string
}

export function isShotScriptText(text: string | null | undefined): boolean {
  if (!text) return false
  return (
    /```json\b/.test(text) ||
    /"shots"\s*:/.test(text) ||
    /"groups"\s*:\s*\[/.test(text) ||
    /"segments"\s*:\s*\[/.test(text) ||
    /\|\s*镜号/.test(text)
  )
}

/** 表头关键字 → 逻辑列名 */
type ColumnKey =
  | 'index'
  | 'title'
  | 'duration'
  | 'shotSize'
  | 'angle'
  | 'movement'
  | 'sceneLayout'
  | 'composition'
  | 'blocking'
  | 'lighting'
  | 'cameraParams'
  | 'focalLength'
  | 'aperture'
  | 'iso'
  | 'colorTone'
  | 'mood'
  | 'performance'
  | 'costume'
  | 'groupName'
  | 'sceneName'
  | 'shot'
  | 'description'
  | 'dialogue'
  | 'narration'
  | 'characters'
  | 'characterReferences'
  | 'actionBeats'
  | 'soundEffects'
  | 'transition'
  | 'firstFrame'
  | 'lastFrame'
  | 'continuity'
  | 'negativePrompt'

const HEADER_MATCHERS: Array<{ key: ColumnKey; test: (h: string) => boolean }> = [
  { key: 'index', test: (h) => /镜号|分镜号|序号|^#$|^no\.?$/i.test(h) },
  { key: 'title', test: (h) => /^标题$|镜头标题|shot\s*title/i.test(h) },
  // 精确字段必须先于「时间」「动作」等宽泛匹配，否则精简表中的
  // 「时间轴 / 动作节拍」会分别被误识别成 duration / description。
  { key: 'actionBeats', test: (h) => /动作节拍|时间轴|节拍|action\s*beats?/i.test(h) },
  { key: 'duration', test: (h) => /时长|时间|秒|duration|time/i.test(h) },
  { key: 'shotSize', test: (h) => /景别|景\b|shot\s*size|scale/i.test(h) },
  { key: 'angle', test: (h) => /角度|机位|angle/i.test(h) },
  { key: 'movement', test: (h) => /运镜|镜头运动|运动|movement|camera\s*move/i.test(h) },
  {
    key: 'sceneLayout',
    test: (h) => /场景布局|场景描述|^场景$|空间|scene\s*layout|setting/i.test(h),
  },
  { key: 'composition', test: (h) => /构图|画面分割|九宫格|composition|framing/i.test(h) },
  { key: 'blocking', test: (h) => /站位|调度|走位|场面调度|blocking/i.test(h) },
  { key: 'lighting', test: (h) => /光照|布光|灯光|光影|lighting/i.test(h) },
  { key: 'cameraParams', test: (h) => /镜头参数|camera\s*params|lens\s*params/i.test(h) },
  { key: 'focalLength', test: (h) => /焦距|焦段|focal\s*length|^lens$/i.test(h) },
  { key: 'aperture', test: (h) => /光圈|景深|aperture|depth\s*of\s*field/i.test(h) },
  { key: 'iso', test: (h) => /^iso$|感光度|噪点|颗粒/i.test(h) },
  { key: 'colorTone', test: (h) => /色调|色彩|色温|color\s*tone|palette/i.test(h) },
  { key: 'mood', test: (h) => /氛围|情绪基调|mood|atmosphere/i.test(h) },
  { key: 'performance', test: (h) => /表情|微表情|动作细节|表演|performance|expression/i.test(h) },
  { key: 'costume', test: (h) => /服装|造型|服饰|配饰|costume|wardrobe/i.test(h) },
  { key: 'groupName', test: (h) => /分组|场次|group/i.test(h) },
  { key: 'sceneName', test: (h) => /场景名|地点|scene\s*name|location/i.test(h) },
  { key: 'shot', test: (h) => /生成提示词|正向提示词|镜头语言|镜头$|^镜头|camera$/i.test(h) },
  { key: 'description', test: (h) => /画面|动作|描述|内容|场景描述|description|action/i.test(h) },
  { key: 'dialogue', test: (h) => /对白|台词|dialogue|line/i.test(h) },
  { key: 'narration', test: (h) => /旁白|narration|voice\s*over|vo/i.test(h) },
  { key: 'characterReferences', test: (h) => /角色参考|角色图|资产参考|character\s*ref/i.test(h) },
  { key: 'characters', test: (h) => /角色|人物|出场|character|cast/i.test(h) },
  { key: 'soundEffects', test: (h) => /音效|声音|拟音|sfx|sound/i.test(h) },
  { key: 'transition', test: (h) => /转场|入镜|出镜|剪辑|transition|cut/i.test(h) },
  { key: 'firstFrame', test: (h) => /首帧|起始帧|first\s*frame/i.test(h) },
  { key: 'lastFrame', test: (h) => /尾帧|结束帧|last\s*frame/i.test(h) },
  { key: 'continuity', test: (h) => /连续性|衔接|轴线|continuity/i.test(h) },
  { key: 'negativePrompt', test: (h) => /反向|负面|不应出现|negative/i.test(h) },
]

/** 把一行 Markdown 表格切成单元格（去掉首尾竖线与空白） */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < s.length; index += 1) {
    const character = s.charAt(index)
    if (character === '\\' && s[index + 1] === '|') {
      cell += '|'
      index += 1
      continue
    }
    if (character === '|') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += character
  }
  cells.push(cell.trim())
  return cells
}

/** 是否为分隔行（如 |---|:--:|） */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')))
}

/** 从单元格解析时长秒数（容忍 "3s" / "3 秒" / "3.5"） */
function parseDuration(cell: string): number | undefined {
  const match = cell.match(/(\d+(?:\.\d+)?)/)
  if (!match) return undefined
  const value = Number.parseFloat(match[1]!)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** 拆分角色名（逗号 / 顿号 / 斜杠 / 空格分隔） */
function parseCharacterNames(cell: string): string[] {
  return cell
    .split(/[,，、/\s]+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && name !== '—' && name !== '-')
}

function cleanCell(cell: string | undefined): string {
  const value = (cell ?? '').trim().replace(/<br\s*\/?>/gi, '\n')
  return value === '—' || value === '-' ? '' : value
}

function tryParseJsonObject(text: string): unknown | null {
  const trimmed = text.trim()
  const candidates = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  // 没有闭合 ``` 时（agent 常见：代码块未闭合），按 ```json 之后到结尾兜底提取
  const openFenced = trimmed.match(/```(?:json)?\s*([\s\S]+)/i)
  if (openFenced?.[1] && openFenced[1] !== fenced?.[1]) {
    candidates.push(openFenced[1].trim())
  }
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace)
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      // Some adapters serialize the model's JSON one extra time. Accept that shape
      // without making the task detail depend on provider-specific escaping.
      if (typeof parsed === 'string') {
        try {
          return JSON.parse(parsed)
        } catch {
          return parsed
        }
      }
      return parsed
    } catch {
      // try next candidate
    }
  }
  return null
}

/**
 * 容错地从可能损坏/截断的 JSON 文本里逐个提取顶层 shot/segment 对象。
 *
 * 背景：agent 输出的 JSON 常因截断、字符串内未转义引号、代码块未闭合等原因导致
 * 整体 JSON.parse 失败。本函数用括号匹配扫描「shots/segments 数组」区域，
 * 逐个切出完整的 {...} 子对象并各自 JSON.parse（哪怕末尾对象损坏，前面完整的也能救回来）。
 * 正确处理字符串内的转义引号与括号，不依赖完整 JSON.parse。
 */
function recoverShotObjects(text: string): Record<string, unknown>[] {
  // 定位数组开始：找 "shots"/"segments" 后第一个 '['（用 exec 以拿到可靠的 index）
  const keyRe = /"(?:shots|segments)"\s*:\s*\[/
  let arrayStart = -1
  const keyMatch = keyRe.exec(text)
  if (keyMatch) arrayStart = text.lastIndexOf('[', keyMatch.index + keyMatch[0].length - 1)
  // groups[].segments[] 嵌套：定位第一个分组内 segments 数组
  if (arrayStart < 0) {
    const nestedRe = /"segments"\s*:\s*\[/g
    const first = nestedRe.exec(text)
    if (first) arrayStart = text.lastIndexOf('[', first.index + first[0].length - 1)
  }
  if (arrayStart < 0) return []

  const objects: Record<string, unknown>[] = []
  let i = arrayStart + 1
  while (i < text.length) {
    // 跳过空白与逗号
    const ch = text[i]
    if (ch === ']' || ch === undefined) break
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === ',') {
      i += 1
      continue
    }
    if (ch !== '{') {
      i += 1
      continue
    }
    // 从当前位置做括号匹配，切出一个完整对象
    let depth = 0
    let inString = false
    let escape = false
    let end = -1
    for (let j = i; j < text.length; j += 1) {
      const c = text[j]!
      if (inString) {
        if (escape) escape = false
        else if (c === '\\') escape = true
        else if (c === '"') inString = false
      } else {
        if (c === '"') inString = true
        else if (c === '{') depth += 1
        else if (c === '}') {
          depth -= 1
          if (depth === 0) {
            end = j
            break
          }
        }
      }
    }
    if (end < 0) break // 不完整，停止
    const slice = text.slice(i, end + 1)
    try {
      const obj = JSON.parse(slice) as unknown
      if (obj && typeof obj === 'object') objects.push(obj as Record<string, unknown>)
    } catch {
      // 该对象损坏则跳过，继续尝试下一个
    }
    i = end + 1
  }
  return objects
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') return parseDuration(value)
  return undefined
}

/**
 * 判断一行分镜是否有任何实质内容（mapShotItem 与 parseShotTable 共用同一判定）。
 * 整行所有字段都空（如残留合计行 / 占位空行）才视为无内容。
 * 不能只看 画面/对白/旁白/时长——很多分镜表的行只有 景别/运镜/镜头/场景 等列，
 * 只看这 4 个字段会把合法行误判为空，导致编辑态表格显示为空。
 */
function hasShotRowContent(row: ParsedShotRow): boolean {
  return (
    !!row.description ||
    !!row.dialogue ||
    !!row.narration ||
    row.durationSec !== undefined ||
    !!row.shotSize ||
    !!row.angle ||
    !!row.movement ||
    !!row.sceneLayout ||
    !!row.composition ||
    !!row.blocking ||
    !!row.lighting ||
    !!row.cameraParams ||
    !!row.focalLength ||
    !!row.aperture ||
    !!row.iso ||
    !!row.colorTone ||
    !!row.mood ||
    !!row.performance ||
    !!row.costume ||
    !!row.groupName ||
    !!row.sceneName ||
    !!row.characterReferences ||
    !!row.actionBeats ||
    !!row.soundEffects ||
    !!row.transition ||
    !!row.firstFrame ||
    !!row.lastFrame ||
    !!row.continuity ||
    !!row.shotPrompt ||
    !!row.negativePrompt ||
    (row.characterNames?.length ?? 0) > 0
  )
}

/** 把单个分镜项（shot / segment）对象映射为 ParsedShotRow。字段全部可选，便于容错。 */
function mapShotItem(item: Record<string, unknown>, fallbackIndex: number): ParsedShotRow | null {
  const index =
    typeof item.index === 'number'
      ? Math.floor(item.index)
      : stringField(item.index).match(/\d+/)
        ? Number.parseInt(stringField(item.index).match(/\d+/)![0]!, 10)
        : undefined
  const durationSec = numberField(item.durationSec ?? item.duration ?? item['时长'])
  const description = stringField(
    item.description ??
      item.action ??
      item['画面/动作'] ??
      item['画面'] ??
      item['内容'] ??
      item['描述'],
  )
  const dialogue = stringField(item.dialogue ?? item['对白'])
  const narration = stringField(item.narration ?? item['旁白'])
  const shotSize = stringField(item.shotSize ?? item['景别'])
  const angle = stringField(item.angle ?? item['角度'])
  const movement = stringField(item.movement ?? item['运镜'])
  const sceneLayout = stringField(
    item.sceneLayout ??
      item.sceneDescription ??
      item['场景布局'] ??
      item['场景描述'] ??
      item['场景'],
  )
  const composition = stringField(item.composition ?? item.framing ?? item['构图'])
  const blocking = stringField(
    item.blocking ?? item.staging ?? item['站位调度'] ?? item['场面调度'],
  )
  const lighting = stringField(item.lighting ?? item['光照'])
  const cameraParams = stringField(item.cameraParams ?? item['镜头参数'])
  const focalLength = stringField(item.focalLength ?? item.lens ?? item['焦距'] ?? item['焦段'])
  const aperture = stringField(item.aperture ?? item.depthOfField ?? item['光圈'] ?? item['景深'])
  const iso = stringField(item.iso ?? item['感光度'] ?? item['ISO'])
  const colorTone = stringField(item.colorTone ?? item.colorPalette ?? item['色调'] ?? item['色彩'])
  const mood = stringField(item.mood ?? item.atmosphere ?? item['氛围'] ?? item['情绪基调'])
  const performance = stringField(
    item.performance ??
      item.microExpression ??
      item.actionDetail ??
      item['微表情动作'] ??
      item['表演'],
  )
  const costume = stringField(item.costume ?? item.wardrobe ?? item['服装'] ?? item['造型'])
  const groupName = stringField(item.groupName ?? item['分组'] ?? item['场次'])
  const sceneName = stringField(item.sceneName ?? item.location ?? item['场景名'] ?? item['地点'])
  const shotPrompt = stringField(item.shotPrompt ?? item.shot ?? item['镜头语言'])
  const negativePrompt = stringField(item.negativePrompt ?? item.negative ?? item['反向提示词'])
  const characterReferences = stringField(
    item.characterReferences ?? item.characterRefs ?? item['角色参考'] ?? item['角色图'],
  )
  const actionBeats = stringField(item.actionBeats ?? item.timeline ?? item['动作节拍'])
  const soundEffects = stringField(item.soundEffects ?? item.sfx ?? item['音效'] ?? item['声音'])
  const transition = stringField(item.transition ?? item['转场'])
  const firstFrame = stringField(item.firstFrame ?? item['首帧'])
  const lastFrame = stringField(item.lastFrame ?? item['尾帧'])
  const continuity = stringField(item.continuity ?? item['连续性'] ?? item['衔接'])
  const rawCharacters = item.characters ?? item.characterNames ?? item['角色']
  const characterNames = Array.isArray(rawCharacters)
    ? rawCharacters.map(stringField).filter(Boolean)
    : stringField(rawCharacters)
      ? parseCharacterNames(stringField(rawCharacters))
      : []
  const row: ParsedShotRow = {
    title: stringField(item.title) || `镜${index ?? fallbackIndex}`,
    ...(index !== undefined ? { index } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(shotSize ? { shotSize } : {}),
    ...(angle ? { angle } : {}),
    ...(movement ? { movement } : {}),
    ...(sceneLayout ? { sceneLayout } : {}),
    ...(composition ? { composition } : {}),
    ...(blocking ? { blocking } : {}),
    ...(lighting ? { lighting } : {}),
    ...(cameraParams ? { cameraParams } : {}),
    ...(focalLength ? { focalLength } : {}),
    ...(aperture ? { aperture } : {}),
    ...(iso ? { iso } : {}),
    ...(colorTone ? { colorTone } : {}),
    ...(mood ? { mood } : {}),
    ...(performance ? { performance } : {}),
    ...(costume ? { costume } : {}),
    ...(groupName ? { groupName } : {}),
    ...(sceneName ? { sceneName } : {}),
    ...(description ? { description } : {}),
    ...(dialogue ? { dialogue } : {}),
    ...(narration ? { narration } : {}),
    ...(characterNames.length > 0 ? { characterNames } : {}),
    ...(characterReferences ? { characterReferences } : {}),
    ...(actionBeats ? { actionBeats } : {}),
    ...(soundEffects ? { soundEffects } : {}),
    ...(transition ? { transition } : {}),
    ...(firstFrame ? { firstFrame } : {}),
    ...(lastFrame ? { lastFrame } : {}),
    ...(continuity ? { continuity } : {}),
    ...(shotPrompt ? { shotPrompt } : {}),
    ...(negativePrompt ? { negativePrompt } : {}),
  }
  return hasShotRowContent(row) ? row : null
}

function parseJsonShotRows(text: string): ParsedShotRow[] {
  const parsed = tryParseJsonObject(text)
  if (!parsed || typeof parsed !== 'object') return []
  const root = (Array.isArray(parsed) ? { shots: parsed } : parsed) as Record<string, unknown>

  // 收集所有可能的分镜项来源：
  //  - shots[]              （storyboard 预设约定输出）
  //  - groups[].segments[]  （agent 实际常见输出，如截图里的 result/groups/segments 结构）
  //  - segments[]           （直接平铺，无分组）
  const candidates: unknown[] = []
  if (Array.isArray(root.shots)) candidates.push(...root.shots)
  if (Array.isArray(root.segments)) candidates.push(...root.segments)
  if (Array.isArray(root.groups)) {
    for (const group of root.groups) {
      if (!group || typeof group !== 'object') continue
      const groupRecord = group as Record<string, unknown>
      const segments = groupRecord.segments
      const groupName = stringField(groupRecord.name ?? groupRecord.groupName)
      if (Array.isArray(segments)) {
        for (const segment of segments) {
          if (!segment || typeof segment !== 'object') continue
          const segmentRecord = segment as Record<string, unknown>
          candidates.push(
            groupName && !stringField(segmentRecord.groupName)
              ? { ...segmentRecord, groupName }
              : segmentRecord,
          )
        }
      }
    }
  }

  const rows: ParsedShotRow[] = []
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object') continue
    const row = mapShotItem(raw as Record<string, unknown>, rows.length + 1)
    if (row) rows.push(row)
  }
  return rows
}

/**
 * 解析 Markdown 分镜表为结构化行。
 * 优先解析标准 JSON shots；找不到 JSON/表格时返回 []。
 * 无法识别表头则按「镜号|时长|景别|运镜|画面|对白|角色」默认列序兜底。
 */
export type ParseShotTableOptions = {
  /**
   * 仅供人工导入/历史内容抢救。模型任务的语义校验必须关闭，避免把被 token
   * 截断的 JSON 前缀误判为完整分镜。
   */
  allowPartialJsonRecovery?: boolean
}

export function parseShotTable(
  markdown: string,
  options: ParseShotTableOptions = {},
): ParsedShotRow[] {
  const jsonRows = parseJsonShotRows(markdown)
  if (jsonRows.length > 0) return jsonRows

  // 容错兜底：JSON 整体 parse 失败（截断/未闭合/字符串内未转义引号）时，
  // 用括号匹配逐个救出完整的 shot/segment 对象。仅当文本明显像 JSON 分镜才尝试。
  if (
    options.allowPartialJsonRecovery !== false &&
    /"shots"\s*:|"segments"\s*:|"groups"\s*:/.test(markdown)
  ) {
    const recovered = recoverShotObjects(markdown)
    if (recovered.length >= 2) {
      const rows: ParsedShotRow[] = []
      for (const obj of recovered) {
        const row = mapShotItem(obj, rows.length + 1)
        if (row) rows.push(row)
      }
      if (rows.length > 0) return rows
    }
  }

  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const tableLines = lines.filter((line) => line.trim().startsWith('|'))
  if (tableLines.length === 0) return []

  // 第一行为表头
  const headerCells = splitRow(tableLines[0]!)
  const columnMap: Partial<Record<ColumnKey, number>> = {}
  let recognized = 0
  headerCells.forEach((header, idx) => {
    for (const matcher of HEADER_MATCHERS) {
      if (columnMap[matcher.key] === undefined && matcher.test(header)) {
        columnMap[matcher.key] = idx
        recognized += 1
        break
      }
    }
  })

  // 表头识别不足（<2 列）：按默认列序兜底，并把第一行当作数据行
  let dataLines = tableLines.slice(1)
  if (recognized < 2) {
    columnMap.index = 0
    columnMap.duration = 1
    columnMap.shotSize = 2
    columnMap.movement = 3
    columnMap.description = 4
    columnMap.dialogue = 5
    columnMap.characters = 6
    dataLines = tableLines // 没有可信表头，全部按数据行处理
  }

  const at = (cells: string[], key: ColumnKey): string =>
    columnMap[key] !== undefined ? cleanCell(cells[columnMap[key]!]) : ''

  const rows: ParsedShotRow[] = []
  for (const line of dataLines) {
    const cells = splitRow(line)
    if (isSeparatorRow(cells)) continue

    const description = at(cells, 'description')
    const dialogue = at(cells, 'dialogue')
    const narration = at(cells, 'narration')
    const durationCell = at(cells, 'duration')
    const durationSec = durationCell ? parseDuration(durationCell) : undefined
    const shotSize = at(cells, 'shotSize')
    const angle = at(cells, 'angle')
    const movement = at(cells, 'movement')
    const sceneLayout = at(cells, 'sceneLayout')
    const composition = at(cells, 'composition')
    const blocking = at(cells, 'blocking')
    const lighting = at(cells, 'lighting')
    const cameraParams = at(cells, 'cameraParams')
    const focalLength = at(cells, 'focalLength')
    const aperture = at(cells, 'aperture')
    const iso = at(cells, 'iso')
    const colorTone = at(cells, 'colorTone')
    const mood = at(cells, 'mood')
    const performance = at(cells, 'performance')
    const costume = at(cells, 'costume')
    const groupName = at(cells, 'groupName')
    const sceneName = at(cells, 'sceneName')
    const shotCol = at(cells, 'shot')
    const negativePrompt = at(cells, 'negativePrompt')
    const characterReferences = at(cells, 'characterReferences')
    const actionBeats = at(cells, 'actionBeats')
    const soundEffects = at(cells, 'soundEffects')
    const transition = at(cells, 'transition')
    const firstFrame = at(cells, 'firstFrame')
    const lastFrame = at(cells, 'lastFrame')
    const continuity = at(cells, 'continuity')
    const charactersCell = at(cells, 'characters')
    const indexCell = at(cells, 'index')
    const title = at(cells, 'title')
    const indexMatch = indexCell.match(/\d+/)
    const index = indexMatch ? Number.parseInt(indexMatch[0]!, 10) : undefined

    const shotPromptParts = [shotSize, angle, movement].filter(Boolean)
    const shotPrompt = shotCol || (shotPromptParts.length > 0 ? shotPromptParts.join('，') : '')
    const characterNames = charactersCell ? parseCharacterNames(charactersCell) : []
    const fallbackIndex = rows.length + 1

    const row: ParsedShotRow = {
      title: title || `镜${index ?? fallbackIndex}`,
      ...(index !== undefined ? { index } : {}),
      ...(durationSec !== undefined ? { durationSec } : {}),
      ...(shotSize ? { shotSize } : {}),
      ...(angle ? { angle } : {}),
      ...(movement ? { movement } : {}),
      ...(sceneLayout ? { sceneLayout } : {}),
      ...(composition ? { composition } : {}),
      ...(blocking ? { blocking } : {}),
      ...(lighting ? { lighting } : {}),
      ...(cameraParams ? { cameraParams } : {}),
      ...(focalLength ? { focalLength } : {}),
      ...(aperture ? { aperture } : {}),
      ...(iso ? { iso } : {}),
      ...(colorTone ? { colorTone } : {}),
      ...(mood ? { mood } : {}),
      ...(performance ? { performance } : {}),
      ...(costume ? { costume } : {}),
      ...(groupName ? { groupName } : {}),
      ...(sceneName ? { sceneName } : {}),
      ...(description ? { description } : {}),
      ...(dialogue ? { dialogue } : {}),
      ...(narration ? { narration } : {}),
      ...(characterNames.length > 0 ? { characterNames } : {}),
      ...(characterReferences ? { characterReferences } : {}),
      ...(actionBeats ? { actionBeats } : {}),
      ...(soundEffects ? { soundEffects } : {}),
      ...(transition ? { transition } : {}),
      ...(firstFrame ? { firstFrame } : {}),
      ...(lastFrame ? { lastFrame } : {}),
      ...(continuity ? { continuity } : {}),
      ...(shotPrompt ? { shotPrompt } : {}),
      ...(negativePrompt ? { negativePrompt } : {}),
    }
    // 整行无任何实质内容才跳过（如残留的合计行 / 占位空行）。判定逻辑与 mapShotItem 共用
    // hasShotRowContent，避免两处字段增删不同步。
    if (!hasShotRowContent(row)) continue
    rows.push(row)
  }
  return rows
}
