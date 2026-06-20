/**
 * 剧本文稿工作台 - 章节切分与文稿数据层（设计 §S1）。
 *
 * 纯逻辑：把导入的超长文本（小说/长文稿）按章节标题切分；标题识别不到时
 * 退化为按长度分片。不依赖 DOM / Electron，便于单测与在 worker 中复用。
 *
 * 落库策略沿用「不新增表」：整部文稿存 asset(kind=manuscript) 索引，
 * 单章存 asset(kind=chapter)，分章索引同步进 project.metadata.film.manuscript。
 */

/** 解析出的单章 */
export type ParsedChapter = {
  /** 0-based 顺序 */
  index: number
  /** 章标题（标题行或自动命名） */
  title: string
  /** 章正文（不含标题行） */
  content: string
  /** 非空白字符数（用于显示字数） */
  charCount: number
}

export type ChapterSplitMode = 'heading' | 'length'

export type ChapterSplitResult = {
  mode: ChapterSplitMode
  chapters: ParsedChapter[]
}

/** 章节标题正则：中文常见卷/章/回 + 特殊章名 + 英文 Chapter */
const CHAPTER_HEADING_PATTERNS: RegExp[] = [
  // 第N章 / 第N回 / 第N节 / 第N卷 / 第N折（N 可为阿拉伯或中文数字）
  /^第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回卷节折部篇](?:\s|[:：、.．-]|$).*$/,
  // 卷N / 章N
  /^[卷章]\s*[0-9零一二三四五六七八九十百千万两]+(?:\s|[:：、.．-]|$).*$/,
  // 特殊章名
  /^(序章|序言|序幕|序|楔子|引子|引言|前言|尾声|终章|后记|番外|外传|附录)(?:\s|[:：、.．-]|$|[0-9一二三四五六七八九十]).*$/,
  // 英文 Chapter N / Chapter 名（罗马数字或阿拉伯数字）
  /^chapter\s+([0-9]+|[ivxlcdm]+)\b.*$/i,
  // PART N
  /^part\s+([0-9]+|[ivxlcdm]+)\b.*$/i,
]

const MAX_HEADING_LEN = 40

/** 判断一行是否为章节标题行 */
export function isChapterHeading(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > MAX_HEADING_LEN) return false
  return CHAPTER_HEADING_PATTERNS.some((re) => re.test(trimmed))
}

/** 非空白字符数（中文字数口径） */
export function countChars(text: string): number {
  return text.replace(/\s+/g, '').length
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** 默认分片字数（标题识别不到时退化） */
export const DEFAULT_CHUNK_CHARS = 4000

/** 按长度分片（在段落边界附近切，避免切断句子） */
export function chunkByLength(text: string, maxChars = DEFAULT_CHUNK_CHARS): ParsedChapter[] {
  const normalized = normalizeText(text).trim()
  if (!normalized) return []
  const paragraphs = normalized.split(/\n{2,}/)
  const chapters: ParsedChapter[] = []
  let buffer: string[] = []
  let bufferChars = 0

  const flush = () => {
    if (buffer.length === 0) return
    const content = buffer.join('\n\n').trim()
    if (content) {
      chapters.push({
        index: chapters.length,
        title: `分片 ${chapters.length + 1}`,
        content,
        charCount: countChars(content),
      })
    }
    buffer = []
    bufferChars = 0
  }

  for (const para of paragraphs) {
    const paraChars = countChars(para)
    if (bufferChars > 0 && bufferChars + paraChars > maxChars) flush()
    buffer.push(para)
    bufferChars += paraChars
    // 单段就超长也独立成片，避免无限增长
    if (bufferChars >= maxChars) flush()
  }
  flush()
  return chapters
}

/**
 * 把长文本切分成章节。
 * 优先按标题行切；识别不到任何标题时退化为按长度分片。
 */
export function splitTextIntoChapters(
  text: string,
  options?: { maxCharsPerChunk?: number },
): ChapterSplitResult {
  const normalized = normalizeText(text)
  const lines = normalized.split('\n')
  const headingIndices: number[] = []
  lines.forEach((line, i) => {
    if (isChapterHeading(line)) headingIndices.push(i)
  })

  if (headingIndices.length === 0) {
    return {
      mode: 'length',
      chapters: chunkByLength(normalized, options?.maxCharsPerChunk ?? DEFAULT_CHUNK_CHARS),
    }
  }

  const chapters: ParsedChapter[] = []

  // 第一个标题之前的内容作为「前言」
  const firstHeading = headingIndices[0] ?? 0
  if (firstHeading > 0) {
    const preamble = lines.slice(0, firstHeading).join('\n').trim()
    if (preamble) {
      chapters.push({ index: 0, title: '前言', content: preamble, charCount: countChars(preamble) })
    }
  }

  for (let h = 0; h < headingIndices.length; h++) {
    const start = headingIndices[h] ?? 0
    const end = headingIndices[h + 1] ?? lines.length
    const title = (lines[start] ?? '').trim()
    const content = lines
      .slice(start + 1, end)
      .join('\n')
      .trim()
    chapters.push({ index: 0, title, content, charCount: countChars(content) })
  }

  // 统一重排 index
  return {
    mode: 'heading',
    chapters: chapters.map((chapter, index) => ({ ...chapter, index })),
  }
}
