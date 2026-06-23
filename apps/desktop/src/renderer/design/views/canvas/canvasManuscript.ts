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

export type ChapterSplitMode = 'heading' | 'length' | 'single' | 'multi-file'

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

/**
 * 把导入文件的原始字节解码成文本，自动嗅探编码。
 *
 * 中文小说 txt 大量使用 GBK/GB2312 编码，直接按 UTF-8 解码会整篇乱码，
 * 故这里必须做编码嗅探：先看 BOM，再尝试严格 UTF-8，失败回退 GB18030
 * （GBK/GB2312 的超集）。GB18030 解码用 TextDecoder 在 Electron 渲染进程可用。
 */
export function decodeManuscriptBuffer(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  // 1) BOM 嗅探
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  // 2) 无 BOM：先严格 UTF-8，遇到非法序列说明不是 UTF-8，回退 GB18030
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes)
    } catch {
      // 3) 兜底：宽松 UTF-8（可能局部乱码，但不至于整体失败）
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
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

/** 不分章：整篇文稿作为一个章节导入 */
export function createSingleChapterResult(text: string, title = '全文'): ChapterSplitResult {
  const content = normalizeText(text).trim()
  if (!content) {
    return { mode: 'single', chapters: [] }
  }
  const chapterTitle = title.trim() || '全文'
  return {
    mode: 'single',
    chapters: [
      {
        index: 0,
        title: chapterTitle,
        content,
        charCount: countChars(content),
      },
    ],
  }
}

/**
 * 多文件导入：每个文件直接作为一章。
 *
 * 章标题用文件名（去掉扩展名），content 为该文件解码后的正文。
 * 空文件会被跳过，避免产出空章节。返回的章节 index 按入参顺序重排。
 */
export function buildChaptersFromFiles(
  files: ReadonlyArray<{ name: string; text: string }>,
): ChapterSplitResult {
  const chapters: ParsedChapter[] = []
  for (const file of files) {
    const content = normalizeText(file.text).trim()
    if (!content) continue
    const baseName = file.name.replace(/\.[^.]+$/, '').trim() || '未命名'
    chapters.push({
      index: chapters.length,
      title: baseName,
      content,
      charCount: countChars(content),
    })
  }
  return { mode: 'multi-file', chapters }
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
