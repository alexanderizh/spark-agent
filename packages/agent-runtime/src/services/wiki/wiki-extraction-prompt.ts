/**
 * @module wiki-extraction-prompt
 *
 * 抽取提示词与输出解析（S2，纯函数、可单测）。
 *
 * 三条硬约束在这里落地：
 *   1. **无来源不入库**（§9.4）：模型必须为每条候选标注来自哪一轮
 *      （turnIndex）+ 依据片段（excerpt）；turnIndex 不在本次采样集合内的
 *      条目整条作废——不允许"凭空捏造的知识"。
 *   2. **不猜内容**：解析失败 / 字段缺失 / 类型不符一律作废该条，
 *      绝不做启发式补全（知识库的可信度高于召回率）。
 *   3. **敏感内容前置拦截**：疑似凭据形态的正文在此丢弃，不进入候选区。
 */

/** 允许的候选类型（与 WikiPageKind 对齐，note 作为兜底） */
export const WIKI_EXTRACTION_KINDS = [
  'knowledge',
  'experience',
  'pattern',
  'reference',
  'note',
] as const

export type WikiExtractionKind = (typeof WIKI_EXTRACTION_KINDS)[number]

/** 单次抽取产出的候选上限（防一次刷屏；也限制 token 成本） */
export const WIKI_EXTRACTION_MAX_ITEMS = 8

const TITLE_MAX_CHARS = 80
const SUMMARY_MAX_CHARS = 240
const BODY_MAX_CHARS = 4000
const EXCERPT_MAX_CHARS = 300
const MAX_TAGS = 6
const TAG_MAX_CHARS = 20

export interface WikiExtractedItem {
  kind: WikiExtractionKind
  title: string
  summary: string
  body: string
  tags: string[]
  confidence: number
  rationale: string
  /** 依据轮次（必须落在本次采样集合内） */
  turnIndex: number
  excerpt: string
}

export type WikiExtractionParseResult =
  | { ok: true; items: WikiExtractedItem[] }
  | {
      ok: false
      reason: 'not_json' | 'not_array' | 'empty' | 'all_invalid'
      /** 被逐条判废的条目数（0 = 还没进到逐条校验就失败） */
      invalid: number
    }

export const WIKI_EXTRACTION_SYSTEM_PROMPT = [
  '你是知识库抽取器。任务：从给定对话片段中找出值得长期沉淀的知识，输出 JSON 数组。',
  '',
  '可沉淀的内容：排查结论与根因、方案取舍及理由、可复用流程、踩坑与修复方式、稳定的事实性参考。',
  '不可沉淀：寒暄、一次性任务进度、代码原文大段、任何密钥或凭据、用户私人敏感信息。',
  '',
  '输出要求（严格遵守）：',
  '- 只输出一个 JSON 数组，不要解释、不要 Markdown 代码围栏。',
  `- 每个元素字段：kind（${WIKI_EXTRACTION_KINDS.join(' / ')}）、title（≤${TITLE_MAX_CHARS}字，结论式短语）、summary（≤${SUMMARY_MAX_CHARS}字）、body（Markdown，写清"是什么/为什么/怎么做"）、tags（≤${MAX_TAGS}个）、confidence（0~1）、rationale（一句话入选理由）、turnIndex（来源轮次编号）、excerpt（该条知识的原文依据，≤${EXCERPT_MAX_CHARS}字）。`,
  '- turnIndex 必须取自输入中标注的轮次编号；excerpt 必须是该轮里真实出现过的内容，不得改写或拼凑。',
  '- 没有值得沉淀的内容时输出空数组 []，不要硬凑。',
  '- 每条知识必须自洽：脱离对话也能读懂，不出现"如上所述""这个方案"之类指代。',
].join('\n')

export function buildWikiExtractionPrompt(renderedTurns: string): string {
  return ['下面是按轮次编号的对话片段。请抽取值得沉淀的知识：', '', renderedTurns].join('\n')
}

/**
 * 解析模型输出为候选条目。
 *
 * @param raw           模型原始文本
 * @param sampledIndexes 本次采样轮次编号集合（溯源校验用）
 */
export function parseWikiExtractionResponse(
  raw: string,
  sampledIndexes: ReadonlySet<number>,
): WikiExtractionParseResult {
  const jsonText = stripCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: 'not_json', invalid: 0 }
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: 'not_array', invalid: 0 }
  if (parsed.length === 0) return { ok: false, reason: 'empty', invalid: 0 }

  const items: WikiExtractedItem[] = []
  for (const entry of parsed) {
    const item = normalizeItem(entry, sampledIndexes)
    if (item != null) items.push(item)
    if (items.length >= WIKI_EXTRACTION_MAX_ITEMS) break
  }
  if (items.length === 0) return { ok: false, reason: 'all_invalid', invalid: parsed.length }
  return { ok: true, items }
}

function normalizeItem(
  entry: unknown,
  sampledIndexes: ReadonlySet<number>,
): WikiExtractedItem | null {
  if (entry == null || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>

  const kind = typeof record.kind === 'string' ? record.kind.trim() : ''
  if (!isExtractionKind(kind)) return null

  const title = typeof record.title === 'string' ? record.title.trim() : ''
  if (title.length === 0 || title.length > TITLE_MAX_CHARS) return null

  const body = typeof record.body === 'string' ? record.body.trim() : ''
  if (body.length === 0) return null
  if (looksSensitive(body) || looksSensitive(title) || looksSensitive(summaryOf(record)))
    return null

  const summary = normalizeSummary(record.summary, body)
  const tags = normalizeTags(record.tags)
  const confidence = normalizeConfidence(record.confidence)
  const rationale =
    typeof record.rationale === 'string' ? record.rationale.trim().slice(0, 240) : ''

  // 强制溯源：turnIndex 必须是本次采样真实存在的轮次，excerpt 必须非空。
  const turnIndex = typeof record.turnIndex === 'number' ? Math.floor(record.turnIndex) : Number.NaN
  if (!Number.isFinite(turnIndex) || !sampledIndexes.has(turnIndex)) return null
  const excerpt = typeof record.excerpt === 'string' ? record.excerpt.trim() : ''
  if (excerpt.length === 0) return null

  return {
    kind,
    title,
    summary,
    body: body.slice(0, BODY_MAX_CHARS),
    tags,
    confidence,
    rationale,
    turnIndex,
    excerpt: excerpt.slice(0, EXCERPT_MAX_CHARS),
  }
}

function summaryOf(record: Record<string, unknown>): string {
  return typeof record.summary === 'string' ? record.summary : ''
}

function isExtractionKind(value: string): value is WikiExtractionKind {
  return (WIKI_EXTRACTION_KINDS as readonly string[]).includes(value)
}

function normalizeSummary(raw: unknown, body: string): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text.length > 0) return text.slice(0, SUMMARY_MAX_CHARS)
  // summary 缺失时用正文首行兜底（检索层依赖 summary，不允许为空）。
  const firstLine = body.split('\n').find((line) => line.trim().length > 0) ?? ''
  return firstLine
    .replace(/^#+\s*/, '')
    .trim()
    .slice(0, SUMMARY_MAX_CHARS)
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const tag = entry.trim().slice(0, TAG_MAX_CHARS)
    if (tag.length === 0 || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

function normalizeConfidence(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number.NaN
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

/** 去掉模型可能自加的 Markdown 代码围栏。 */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced?.[1] ?? trimmed
}

/**
 * 疑似凭据 / 敏感信息拦截（粗粒度形态匹配，宁可误杀不漏放）。
 * 与 WikiWriteService.scanSensitiveContent 同思路：抽取侧先挡一道，
 * 写入侧再挡一道（双闸门）。
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(sk|pk)-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/i,
]

function looksSensitive(text: string): boolean {
  if (text.length === 0) return false
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))
}
