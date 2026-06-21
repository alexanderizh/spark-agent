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
  /** 画面 / 动作描述 */
  description?: string
  /** 对白 */
  dialogue?: string
  /** 旁白 */
  narration?: string
  /** 角色名（原始文本，调用方可再匹配为 assetId） */
  characterNames?: string[]
  /** 镜头语言合并文本（景别+角度+运镜，或「镜头」列原文） */
  shotPrompt?: string
}

/** 表头关键字 → 逻辑列名 */
type ColumnKey =
  | 'index'
  | 'duration'
  | 'shotSize'
  | 'angle'
  | 'movement'
  | 'shot'
  | 'description'
  | 'dialogue'
  | 'narration'
  | 'characters'

const HEADER_MATCHERS: Array<{ key: ColumnKey; test: (h: string) => boolean }> = [
  { key: 'index', test: (h) => /镜号|分镜号|序号|^#$|^no\.?$/i.test(h) },
  { key: 'duration', test: (h) => /时长|时间|秒|duration|time/i.test(h) },
  { key: 'shotSize', test: (h) => /景别|景\b|shot\s*size|scale/i.test(h) },
  { key: 'angle', test: (h) => /角度|机位|angle/i.test(h) },
  { key: 'movement', test: (h) => /运镜|镜头运动|运动|movement|camera\s*move/i.test(h) },
  { key: 'shot', test: (h) => /镜头语言|镜头$|^镜头|camera$|lens|焦段/i.test(h) },
  { key: 'description', test: (h) => /画面|动作|描述|内容|场景描述|description|action/i.test(h) },
  { key: 'dialogue', test: (h) => /对白|台词|dialogue|line/i.test(h) },
  { key: 'narration', test: (h) => /旁白|narration|voice\s*over|vo/i.test(h) },
  { key: 'characters', test: (h) => /角色|人物|出场|character|cast/i.test(h) },
]

/** 把一行 Markdown 表格切成单元格（去掉首尾竖线与空白） */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((cell) => cell.trim())
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
    .split(/[,，、\/\s]+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && name !== '—' && name !== '-')
}

function cleanCell(cell: string | undefined): string {
  const value = (cell ?? '').trim()
  return value === '—' || value === '-' ? '' : value
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

function numberField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') return parseDuration(value)
  return undefined
}

function parseJsonShotRows(text: string): ParsedShotRow[] {
  const parsed = tryParseJsonObject(text)
  if (!parsed || typeof parsed !== 'object') return []
  const root = parsed as Record<string, unknown>
  const rawShots = Array.isArray(root.shots) ? root.shots : Array.isArray(parsed) ? parsed : []
  const rows: ParsedShotRow[] = []
  for (const raw of rawShots) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const index =
      typeof item.index === 'number'
        ? Math.floor(item.index)
        : stringField(item.index).match(/\d+/)
          ? Number.parseInt(stringField(item.index).match(/\d+/)![0]!, 10)
          : undefined
    const durationSec = numberField(item.durationSec ?? item.duration ?? item['时长'])
    const description = stringField(item.description ?? item.action ?? item['画面/动作'])
    const dialogue = stringField(item.dialogue ?? item['对白'])
    const narration = stringField(item.narration ?? item['旁白'])
    const shotSize = stringField(item.shotSize ?? item['景别'])
    const angle = stringField(item.angle ?? item['角度'])
    const movement = stringField(item.movement ?? item['运镜'])
    const shotPrompt = stringField(item.shotPrompt ?? item.shot ?? item['镜头语言'])
    const rawCharacters = item.characters ?? item.characterNames ?? item['角色']
    const characterNames = Array.isArray(rawCharacters)
      ? rawCharacters.map(stringField).filter(Boolean)
      : stringField(rawCharacters)
        ? parseCharacterNames(stringField(rawCharacters))
        : []
    if (!description && !dialogue && !narration && durationSec === undefined) continue
    const fallbackIndex = rows.length + 1
    rows.push({
      ...(index !== undefined ? { index } : {}),
      title: stringField(item.title) || `镜${index ?? fallbackIndex}`,
      ...(durationSec !== undefined ? { durationSec } : {}),
      ...(shotSize ? { shotSize } : {}),
      ...(angle ? { angle } : {}),
      ...(movement ? { movement } : {}),
      ...(description ? { description } : {}),
      ...(dialogue ? { dialogue } : {}),
      ...(narration ? { narration } : {}),
      ...(characterNames.length > 0 ? { characterNames } : {}),
      ...(shotPrompt ? { shotPrompt } : {}),
    })
  }
  return rows
}

/**
 * 解析 Markdown 分镜表为结构化行。
 * 优先解析标准 JSON shots；找不到 JSON/表格时返回 []。
 * 无法识别表头则按「镜号|时长|景别|运镜|画面|对白|角色」默认列序兜底。
 */
export function parseShotTable(markdown: string): ParsedShotRow[] {
  const jsonRows = parseJsonShotRows(markdown)
  if (jsonRows.length > 0) return jsonRows

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
    const shotCol = at(cells, 'shot')
    const charactersCell = at(cells, 'characters')
    const indexCell = at(cells, 'index')
    const indexMatch = indexCell.match(/\d+/)
    const index = indexMatch ? Number.parseInt(indexMatch[0]!, 10) : undefined

    // 整行无实质内容（画面/对白/时长都空）→ 跳过（如残留的合计行）
    if (!description && !dialogue && !narration && durationSec === undefined) continue

    const shotPromptParts = [shotSize, angle, movement].filter(Boolean)
    const shotPrompt = shotCol || (shotPromptParts.length > 0 ? shotPromptParts.join('，') : '')
    const characterNames = charactersCell ? parseCharacterNames(charactersCell) : []
    const fallbackIndex = rows.length + 1
    const title = `镜${index ?? fallbackIndex}`

    rows.push({
      ...(index !== undefined ? { index } : {}),
      title,
      ...(durationSec !== undefined ? { durationSec } : {}),
      ...(shotSize ? { shotSize } : {}),
      ...(angle ? { angle } : {}),
      ...(movement ? { movement } : {}),
      ...(description ? { description } : {}),
      ...(dialogue ? { dialogue } : {}),
      ...(narration ? { narration } : {}),
      ...(characterNames.length > 0 ? { characterNames } : {}),
      ...(shotPrompt ? { shotPrompt } : {}),
    })
  }
  return rows
}
