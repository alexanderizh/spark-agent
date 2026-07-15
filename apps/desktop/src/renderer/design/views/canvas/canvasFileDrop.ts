/**
 * 外部文件拖入画布时的分类与提取工具。
 *
 * 画布舞台 `onDrop` 只做事件接入，真正的"这个文件应该变成什么节点"判定都在这里：
 *   - 图片 / 视频 / 音频 → 对应媒体节点
 *   - 文本类文件（txt/md/json/源码……）→ 读出文字后插入文本节点
 *   - 富文档（docx/xlsx/pptx/odt/rtf）→ 解析出文字后插入文本节点（canvasDocumentParse.ts）
 *   - 其余（pdf/exe……）→ 不支持，由调用方跳过并提示
 *
 * 纯函数、无副作用、无 DOM 依赖，便于单测。
 */

/** 拖入文件的分类结果，对应画布上的目标节点类型。 */
export type DroppedFileKind = 'image' | 'video' | 'audio' | 'text' | 'document' | 'unsupported'

/** 文本节点的渲染格式（影响卡片内 markdown 渲染）。 */
export type DroppedTextFormat = 'plain' | 'markdown'

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'tif',
  'tiff',
  'avif',
  'heic',
  'heif',
])

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'])

/** 需要解析才能取出文字的富文档（OOXML / 旧版二进制 Office 等）。
 *  PDF 按需求暂不支持直接拖入解析，故不在其中。 */
const DOCUMENT_EXTENSIONS = new Set([
  'docx', // Word（OOXML）
  'doc', // Word 97-2003（二进制，目前仅按 docx 路径尝试，失败则留档提示）
  'xlsx', // Excel（OOXML）
  'xls', // Excel 97-2003
  'pptx', // PowerPoint（OOXML）
  'odt', // OpenDocument 文本
  'rtf', // 富文本
])

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'opus',
])

const TEXT_EXTENSIONS = new Set([
  // 纯文本 / 文档
  'txt',
  'text',
  'log',
  'md',
  'markdown',
  'mdx',
  // 结构化数据
  'json',
  'yaml',
  'yml',
  'csv',
  'tsv',
  'xml',
  'toml',
  'ini',
  // 常见源码
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cc',
  'cs',
  'rb',
  'php',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'sql',
  'sh',
  'bash',
  'zsh',
  'swift',
  'dart',
  'lua',
  'r',
  'vue',
  'svelte',
])

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

function kindByExtension(ext: string): DroppedFileKind {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'unsupported'
}

function kindByMimeType(mimeType: string | undefined): DroppedFileKind | null {
  if (!mimeType) return null
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  // text/* 一律按文本节点处理（html/css/源码读出来都是文本，放进文本节点最自然）。
  if (mimeType.startsWith('text/')) return 'text'
  if (mimeType === 'application/json' || mimeType === 'application/xml') return 'text'
  // Office / 富文档（按扩展名兜底更准，这里只兜 MIME 命中的情况）
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'application/vnd.ms-powerpoint' ||
    mimeType === 'application/vnd.oasis.opendocument.text' ||
    mimeType === 'application/rtf'
  ) {
    return 'document'
  }
  return null
}

/**
 * 判定拖入的文件应落地为哪种节点。
 *
 * 优先使用 MIME（浏览器/Electron 给的更准），拿不到时退回扩展名。
 * 注意：Electron 拖入磁盘文件时 `file.type` 可能为空，扩展名兜底是必须的。
 */
export function classifyDroppedFile(file: File): DroppedFileKind {
  const fromMime = kindByMimeType(file.type)
  if (fromMime) return fromMime
  return kindByExtension(getExtension(file.name))
}

/**
 * 文本节点的渲染格式：markdown 系列走 markdown 渲染，其余按纯文本。
 */
export function textFormatFromFileName(fileName: string): DroppedTextFormat {
  return MARKDOWN_EXTENSIONS.has(getExtension(fileName)) ? 'markdown' : 'plain'
}

/**
 * 从 dataTransfer 提取去重后的 File[]。
 *
 * 同时遍历 `items`（能拿到拖入网页的 Blob）和 `files`（Electron 拖入磁盘文件时较全），
 * 以 `name + size + lastModified` 去重，避免同一文件被两条路径重复处理。
 */
export function extractDroppedFiles(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return []
  const seen = new Set<string>()
  const files: File[] = []

  const push = (file: File | null | undefined) => {
    if (!file) return
    const key = `${file.name}:${file.size}:${file.lastModified}`
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }

  if (dataTransfer.items) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === 'file') push(item.getAsFile())
    }
  }
  if (dataTransfer.files) {
    for (const file of Array.from(dataTransfer.files)) push(file)
  }

  return files
}

/**
 * 多文件落地时的级联偏移布局。
 *
 * 以 drop 点为原点，按行排列，每行 3 个，行列间距均为 spacing。
 * 返回每个文件相对 origin 的绝对坐标。
 */
export function layoutDroppedFiles(
  count: number,
  origin: { x: number; y: number },
  size: { width: number; height: number },
  options?: { spacing?: number; perRow?: number },
): Array<{ x: number; y: number }> {
  if (count <= 0) return []
  const spacing = options?.spacing ?? 40
  const perRow = options?.perRow ?? 3
  const stepX = size.width + spacing
  const stepY = size.height + spacing
  const points: Array<{ x: number; y: number }> = []
  for (let index = 0; index < count; index += 1) {
    const col = index % perRow
    const row = Math.floor(index / perRow)
    points.push({
      x: Math.round(origin.x + col * stepX),
      y: Math.round(origin.y + row * stepY),
    })
  }
  return points
}
