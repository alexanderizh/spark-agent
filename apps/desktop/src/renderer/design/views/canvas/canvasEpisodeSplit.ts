import { parseCanvasJsonCandidates } from './canvasJsonRepair'

/**
 * 「按剧情分集」任务的输出解析与落节点辅助。
 *
 * 模型被要求输出 {"episodes": [...]} 结构化 JSON；这里负责容错解析出
 * 每集元素，供任务完成回写时把每集物化为一个独立剧本节点。
 * JSON 解析失败时退回按「第X集」标题行切分纯文本，保证旧 prompt 或
 * 不守格式的模型输出仍能按集拆开，而不是丢给用户一整段文本。
 */

/** 与 modelParams.workflow 中的分集标识保持一致。 */
export const SPLIT_EPISODES_WORKFLOW = 'split_episodes'

export type ParsedSplitEpisode = {
  /** 集号，从 1 开始；模型缺失时按顺序补齐。 */
  episodeNo: number
  title: string
  openingHook: string
  mainConflict: string
  endingSuspense: string
  /** 本集完整场次剧本正文（未做场次标题规范化，由校验层负责）。 */
  script: string
}

/** 分集结果节点标题，如「第1集｜风起」。 */
export function splitEpisodeNodeTitle(episode: ParsedSplitEpisode): string {
  const title = episode.title.trim()
  return `第${episode.episodeNo}集${title ? `｜${title}` : ''}`
}

/** 把单集元素格式化为落节点使用的剧本文本（元信息头 + 场次正文）。 */
export function formatSplitEpisodeScreenplayText(episode: ParsedSplitEpisode): string {
  const headerLines = [
    `【${splitEpisodeNodeTitle(episode)}】`,
    episode.openingHook.trim() ? `开场钩子：${episode.openingHook.trim()}` : '',
    episode.mainConflict.trim() ? `主要冲突：${episode.mainConflict.trim()}` : '',
    episode.endingSuspense.trim() ? `结尾悬念：${episode.endingSuspense.trim()}` : '',
  ].filter(Boolean)
  return `${headerLines.join('\n')}\n\n${episode.script.trim()}`
}

/**
 * 解析分集任务的模型输出。
 *
 * 优先识别 episodes JSON 数组；识别不到时按「第X集」标题行切分纯文本；
 * 两者都失败返回空数组，由调用方降级为整段单节点输出。
 */
export function parseSplitEpisodesOutput(text: string): ParsedSplitEpisode[] {
  const value = text.trim()
  if (!value) return []
  const fromJson = parseSplitEpisodesFromJson(value)
  if (fromJson.length > 0) return fromJson
  return parseSplitEpisodesFromPlainText(value)
}

const EPISODES_CONTAINER_KEYS = [
  'episodes',
  'episodeList',
  'splits',
  'items',
  'list',
  'results',
  'data',
  'result',
] as const

const EPISODE_NO_KEYS = [
  'episodeNo',
  'episode_no',
  'episodeNumber',
  'episode_number',
  'no',
  'number',
  'index',
  '集号',
  '集数',
] as const

const EPISODE_TITLE_KEYS = ['title', 'episodeTitle', 'episode_title', 'name', '标题', '集名'] as const
const EPISODE_SCRIPT_KEYS = [
  'script',
  'screenplay',
  'content',
  'text',
  'body',
  '剧本正文',
  '正文',
  '剧本',
] as const
const EPISODE_HOOK_KEYS = ['openingHook', 'opening_hook', 'hook', '开场钩子', '开场'] as const
const EPISODE_CONFLICT_KEYS = ['mainConflict', 'main_conflict', 'conflict', '主要冲突', '冲突'] as const
const EPISODE_SUSPENSE_KEYS = [
  'endingSuspense',
  'ending_suspense',
  'cliffhanger',
  '结尾悬念',
  '悬念',
] as const

function parseSplitEpisodesFromJson(text: string): ParsedSplitEpisode[] {
  for (const candidate of parseCanvasJsonCandidates(text)) {
    const rawEpisodes = readEpisodesArray(candidate, 0)
    if (!rawEpisodes) continue
    const episodes: ParsedSplitEpisode[] = []
    for (const [index, item] of rawEpisodes.entries()) {
      const parsed = parseEpisodeRecord(item, index)
      if (parsed) episodes.push(parsed)
    }
    if (episodes.length > 0) return episodes
  }
  return []
}

/** 容器键允许嵌套一层（如 {"data":{"episodes":[...]}}），最多下钻两层。 */
function readEpisodesArray(root: unknown, depth: number): Array<Record<string, unknown>> | null {
  if (Array.isArray(root)) return filterEpisodeRecords(root)
  if (!root || typeof root !== 'object' || depth >= 2) return null
  const record = root as Record<string, unknown>
  for (const key of EPISODES_CONTAINER_KEYS) {
    const value = record[key]
    if (Array.isArray(value)) {
      const records = filterEpisodeRecords(value)
      if (records.length > 0) return records
      continue
    }
    if (value && typeof value === 'object') {
      const nested = readEpisodesArray(value, depth + 1)
      if (nested) return nested
    }
  }
  return null
}

function filterEpisodeRecords(items: readonly unknown[]): Array<Record<string, unknown>> {
  return items.filter(
    (item): item is Record<string, unknown> =>
      item != null && typeof item === 'object' && !Array.isArray(item),
  )
}

function parseEpisodeRecord(
  record: Record<string, unknown>,
  index: number,
): ParsedSplitEpisode | null {
  const script = readFirstTrimmedString(record, EPISODE_SCRIPT_KEYS)
  if (!script) return null
  return {
    episodeNo: readEpisodeNo(record) ?? index + 1,
    title: readFirstTrimmedString(record, EPISODE_TITLE_KEYS),
    openingHook: readFirstTrimmedString(record, EPISODE_HOOK_KEYS),
    mainConflict: readFirstTrimmedString(record, EPISODE_CONFLICT_KEYS),
    endingSuspense: readFirstTrimmedString(record, EPISODE_SUSPENSE_KEYS),
    script,
  }
}

function readFirstTrimmedString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function readEpisodeNo(record: Record<string, unknown>): number | null {
  for (const key of EPISODE_NO_KEYS) {
    const value = record[key]
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = parseEpisodeNoText(value.trim())
      if (parsed != null) return parsed
    }
  }
  return null
}

/** 兼容阿拉伯数字与常见中文数字（千以内）。 */
function parseEpisodeNoText(value: string): number | null {
  if (/^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  }
  const chinese = parseChineseEpisodeNumber(value)
  return chinese != null && chinese > 0 ? chinese : null
}

function parseChineseEpisodeNumber(value: string): number | null {
  if (!/^[零一二两三四五六七八九十百]+$/.test(value)) return null
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    两: 2,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  let total = 0
  let current = 0
  for (const char of value) {
    const digit = digits[char]
    if (digit != null) {
      current = digit
      continue
    }
    if (char === '十') {
      total += (current || 1) * 10
      current = 0
    } else if (char === '百') {
      total += (current || 1) * 100
      current = 0
    }
  }
  return total + current
}

/** 「第1集」「## 第十二集：风起」「EPISODE 3 - …」等分集标题行。 */
const EPISODE_HEADING_PATTERN =
  /^\s*(?:#{1,6}\s*)?(?:【\s*|〖\s*)?(?:第\s*([0-9]+|[零一二两三四五六七八九十百]+)\s*集|EPISODE\s*([0-9]+))(?=[\s｜|:：】〗\-—·、(（]|$)/i

function parseSplitEpisodesFromPlainText(text: string): ParsedSplitEpisode[] {
  const lines = text.split(/\r?\n/)
  const drafts: Array<{ episodeNo: number | null; title: string; lines: string[] }> = []
  const preambleLines: string[] = []
  let headingCount = 0

  for (const line of lines) {
    const heading = line.match(EPISODE_HEADING_PATTERN)
    if (!heading) {
      const target = drafts.length > 0 ? drafts[drafts.length - 1]!.lines : preambleLines
      target.push(line)
      continue
    }
    headingCount += 1
    drafts.push({
      episodeNo: readHeadingEpisodeNo(heading),
      title: readHeadingTitle(line),
      lines: [],
    })
  }
  // 没有任何集标题行时视为普通剧本文本，交由调用方降级为整段输出。
  if (headingCount === 0) return []
  // 第一集标题之前的前言（总说明等）并入第一集，避免静默丢弃内容。
  if (preambleLines.length > 0 && drafts.length > 0) {
    const first = drafts[0]!
    first.lines = [...preambleLines, ...first.lines]
  }

  const episodes: ParsedSplitEpisode[] = []
  let lastNo = 0
  for (const draft of drafts) {
    const script = draft.lines.join('\n').trim()
    if (!script) continue
    const episodeNo = draft.episodeNo ?? lastNo + 1
    lastNo = episodeNo
    episodes.push({
      episodeNo,
      title: draft.title,
      openingHook: '',
      mainConflict: '',
      endingSuspense: '',
      script,
    })
  }
  return episodes
}

function readHeadingEpisodeNo(heading: RegExpMatchArray): number | null {
  const raw = heading[1] ?? heading[2]
  return raw ? parseEpisodeNoText(raw) : null
}

/** 标题行去掉集号前缀后的剩余文字（如「第1集：风起」→「风起」）。 */
function readHeadingTitle(line: string): string {
  return line
    .replace(
      /^\s*(?:#{1,6}\s*)?(?:【\s*|〖\s*)?(?:第\s*[0-9零一二两三四五六七八九十百]+\s*集|EPISODE\s*[0-9]+)/i,
      '',
    )
    .replace(/^[｜|:：】〗\-—·、\s]+/, '')
    .replace(/[(（]\s*[^)）]*[)）]\s*$/, '')
    .trim()
}
