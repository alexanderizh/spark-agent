/**
 * 远程对话的富内容判定（纯函数，便于单测）。
 *
 * 目标端推过来的是纯文本事件，没有桌面端那套 UIBlock（html_block / 图片块），
 * 所以两件事要在渲染端自己判：
 *   1. 一条回答整体就是一个 HTML 文档（agent 直接把页面写进对话）→ 走隔离页面预览；
 *   2. 产物文件的扩展名 → 决定卡片图标与「能否内联预览」。
 */

/** 单条消息最多允许预览的 HTML 体积，超了只显示源码，避免卡死渲染进程 */
export const MAX_INLINE_HTML_CHARS = 400_000

const HTML_FENCE = /^\s*```(?:html|htm)\s*\n([\s\S]*?)\n?```\s*$/i
const HTML_DOC_START = /^<!doctype\s+html|^<html[\s>]/i

/**
 * 整条消息就是一个 HTML 文档时返回原文，否则返回 null。
 *
 * 判定为「整体」而非「包含」是刻意的：只把整段都是页面的回答换成预览，
 * 正常讲解里顺手贴的一小段 html 仍按普通代码块展示。
 */
export function extractHtmlDocument(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null

  const fenced = HTML_FENCE.exec(trimmed)
  if (fenced != null) {
    const body = (fenced[1] ?? '').trim()
    return body.length > 0 && body.length <= MAX_INLINE_HTML_CHARS ? body : null
  }

  if (!HTML_DOC_START.test(trimmed)) return null
  return trimmed.length <= MAX_INLINE_HTML_CHARS ? trimmed : null
}

export type RemoteContentSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'html'; html: string }

const HTML_FENCE_GLOBAL = /```(?:html|htm)[ \t]*\r?\n([\s\S]*?)\r?\n?```/gi

/**
 * 把「讲解文字 + 完整 HTML 文档块」混排的正文拆成段：文档围栏抽出为 html 段
 * （渲染成隔离预览卡片），其余原样留给 markdown 渲染。
 *
 * 只抽出「完整文档」（doctype / <html> 开头）：讲解里随手贴的 html 片段仍是
 * 普通代码块，不会被误升级成页面预览。正文里没有任何可预览块时返回 null，
 * 调用方走原来的整段 markdown 路径（行为零变化）。
 */
export function splitRemoteHtmlSegments(text: string): RemoteContentSegment[] | null {
  const segments: RemoteContentSegment[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  HTML_FENCE_GLOBAL.lastIndex = 0

  while ((match = HTML_FENCE_GLOBAL.exec(text)) != null) {
    const body = (match[1] ?? '').trim()
    // 片段围栏不算文档：留在 markdown 里按代码块展示
    if (body.length === 0 || body.length > MAX_INLINE_HTML_CHARS || !HTML_DOC_START.test(body)) {
      continue
    }
    const before = text.slice(cursor, match.index)
    if (before.trim().length > 0) segments.push({ kind: 'markdown', text: before })
    segments.push({ kind: 'html', html: body })
    cursor = match.index + match[0].length
  }

  if (segments.length === 0) return null
  const tail = text.slice(cursor)
  if (tail.trim().length > 0) segments.push({ kind: 'markdown', text: tail })
  return segments
}

export type RemoteFileKind =
  | 'html'
  | 'image'
  | 'markdown'
  | 'text'
  | 'code'
  /** 二进制文档（Office / PDF）：取回本机后交给桌面端文档预览器渲染 */
  | 'document'
  | 'other'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const TEXT_EXTENSIONS = new Set(['.txt', '.log', '.csv', '.json', '.yml', '.yaml'])
/**
 * 与桌面端 FilePreviewPanel 的 FLYFISH_VIEWER_EXTENSIONS 对齐：
 * 只有这些后缀才值得开抽屉（不在表里的话预览器只会显示「不支持」）。
 */
const DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.docm',
  '.dotx',
  '.rtf',
  '.odt',
  '.odp',
  '.ofd',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.xlsb',
  '.ods',
  '.numbers',
  '.ppt',
  '.pptx',
  '.pptm',
  '.ppsx',
])
const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.less',
  '.html5',
  '.py',
  '.go',
  '.rs',
  '.sh',
  '.sql',
  '.xml',
  '.toml',
])

/** 取路径扩展名（小写，含点）。远程路径可能是 Windows 反斜杠。 */
export function fileExtension(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

export function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

export function classifyRemoteFile(filePath: string): RemoteFileKind {
  const ext = fileExtension(filePath)
  if (ext === '.html' || ext === '.htm') return 'html'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document'
  return 'other'
}

/** 能在对话里就地展开（图片 img、其余文本预览） */
export function canInlinePreviewRemoteFile(filePath: string): boolean {
  const kind = classifyRemoteFile(filePath)
  return (
    kind === 'html' || kind === 'image' || kind === 'markdown' || kind === 'text' || kind === 'code'
  )
}

/** 要不要开右侧文档抽屉（Office / PDF 这类二进制文档） */
export function usesDocumentPreview(filePath: string): boolean {
  return classifyRemoteFile(filePath) === 'document'
}

/** 任何形式的预览入口（就地或抽屉）；'other' 只能「打开」 */
export function canPreviewRemoteFile(filePath: string): boolean {
  const kind = classifyRemoteFile(filePath)
  return kind !== 'other'
}

/** 卡片标题已写「产物」，这里只补数量，避免「产物 · 3 个产物」 */
export function describeFileCount(count: number): string {
  return `${count} 个`
}
