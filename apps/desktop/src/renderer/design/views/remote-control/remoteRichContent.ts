/**
 * 远程对话的富内容判定（纯函数，便于单测）。
 *
 * 目标端推过来的是纯文本事件，没有桌面端那套 UIBlock（html_block / 图片块），
 * 所以两件事要在渲染端自己判：
 *   1. 一条回答整体就是一个 HTML 文档（agent 直接把页面写进对话）→ 走沙箱预览；
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

export type RemoteFileKind = 'html' | 'image' | 'markdown' | 'text' | 'code' | 'other'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const TEXT_EXTENSIONS = new Set(['.txt', '.log', '.csv', '.json', '.yml', '.yaml'])
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
  return 'other'
}

/** 能否在对话里就地预览（图片走 img，其余走文本预览） */
export function canPreviewRemoteFile(filePath: string): boolean {
  const kind = classifyRemoteFile(filePath)
  return (
    kind === 'html' || kind === 'image' || kind === 'markdown' || kind === 'text' || kind === 'code'
  )
}

/** 卡片标题已写「产物」，这里只补数量，避免「产物 · 3 个产物」 */
export function describeFileCount(count: number): string {
  return `${count} 个`
}
