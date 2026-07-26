import type { SessionAttachment } from '@spark/protocol'

export type ComposerAttachmentDraft = SessionAttachment & {
  id: string
  name: string
  previewPath?: string
  previewUrl?: string
}

export type FileKindProbe = (params: { path: string }) => Promise<{ kind: string }>
export type ImagePreviewProbe = (params: {
  sourcePath: string
}) => Promise<{ filePath: string; fileUrl: string }>

export interface BuildComposerAttachmentsOptions {
  idPrefix: string
  prepareImagePreview?: ImagePreviewProbe
  statFileKind?: FileKindProbe
  timestamp?: number
}

export function hasFileDataTransfer(dataTransfer: DataTransfer | null | undefined): boolean {
  if (dataTransfer == null) return false
  if (Array.from(dataTransfer.types ?? []).includes('Files')) return true
  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file')
}

/**
 * 把 File 解析成磁盘绝对路径。
 *
 * Electron 32 起 `File.prototype.path` 已被移除，必须走 preload 转发的
 * `webUtils.getPathForFile`（见 preload SparkApi.getPathForFile）。保留 `file.path`
 * 兜底只是为了兼容旧 Electron 与单元测试里的桩对象，生产路径依赖前者。
 */
export type FilePathResolver = (file: File) => string

function defaultFilePathResolver(file: File): string {
  // 走 globalThis 而非 window：本模块也会被 node 环境的单测导入，直接引用 window 会 ReferenceError。
  // 浏览器里 globalThis === window，语义完全一致。
  const bridge = (globalThis as { spark?: { getPathForFile?: (file: File) => string } }).spark
  const viaWebUtils = bridge?.getPathForFile?.(file)
  if (typeof viaWebUtils === 'string' && viaWebUtils.length > 0) return viaWebUtils
  const legacy = (file as File & { path?: string }).path
  return typeof legacy === 'string' ? legacy : ''
}

export function getDataTransferFilePaths(
  dataTransfer: DataTransfer | null | undefined,
  resolveFilePath: FilePathResolver = defaultFilePathResolver,
): string[] {
  if (dataTransfer == null) return []
  const paths: string[] = []

  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== 'file') continue
    addFilePath(paths, item.getAsFile(), resolveFilePath)
  }
  for (const file of Array.from(dataTransfer.files ?? [])) {
    addFilePath(paths, file, resolveFilePath)
  }

  if (paths.length === 0) {
    addTextPaths(paths, dataTransfer.getData?.('text/uri-list'))
    addTextPaths(paths, dataTransfer.getData?.('text/plain'))
  }

  return Array.from(new Set(paths))
}

/**
 * 拖拽事件里确实携带了文件，但一个路径都解析不出来。
 *
 * 用于把「静默什么都没发生」变成可解释的失败提示——这类情况通常意味着
 * webUtils 通道不可用（preload 未加载/被旧版本覆盖），必须让用户看见。
 */
export function isUnresolvableFileDrop(
  dataTransfer: DataTransfer | null | undefined,
  filePaths: string[],
): boolean {
  return filePaths.length === 0 && hasFileDataTransfer(dataTransfer)
}

export async function buildComposerAttachmentsFromPaths(
  filePaths: string[],
  options: BuildComposerAttachmentsOptions,
): Promise<ComposerAttachmentDraft[]> {
  const timestamp = options.timestamp ?? Date.now()
  return Promise.all(
    filePaths.map(async (filePath, index) => {
      let type: ComposerAttachmentDraft['type'] = isImageAttachmentPath(filePath) ? 'image' : 'file'
      try {
        const { kind } = (await options.statFileKind?.({ path: filePath })) ?? { kind: 'file' }
        if (kind === 'directory') type = 'directory'
      } catch {
        /* Keep the extension-based file/image fallback if stat is unavailable. */
      }

      const attachment: ComposerAttachmentDraft = {
        id: `${timestamp}-${options.idPrefix}-${index}-${filePath}`,
        type,
        path: filePath,
        name: getFileNameFromPath(filePath),
      }

      if (type !== 'image' || options.prepareImagePreview == null) return attachment
      try {
        const preview = await options.prepareImagePreview({ sourcePath: filePath })
        return { ...attachment, previewPath: preview.filePath, previewUrl: preview.fileUrl }
      } catch {
        return attachment
      }
    }),
  )
}

export function getFileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath
}

export function isImageAttachmentPath(filePath: string): boolean {
  const extension = getFileNameFromPath(filePath).split('.').pop()?.toLowerCase()
  return extension != null && IMAGE_ATTACHMENT_EXTENSIONS.has(extension)
}

function addFilePath(
  paths: string[],
  file: File | null | undefined,
  resolveFilePath: FilePathResolver,
): void {
  if (file == null) return
  let resolved = ''
  try {
    resolved = resolveFilePath(file)
  } catch {
    // 解析失败按「无路径」处理，交由 isUnresolvableFileDrop 统一提示
    return
  }
  if (typeof resolved === 'string' && resolved.trim().length > 0) paths.push(resolved.trim())
}

function addTextPaths(paths: string[], value: string | undefined): void {
  if (typeof value !== 'string' || value.trim().length === 0) return
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const fileUrlPath = parseFileUrlPath(line)
    if (fileUrlPath != null) {
      paths.push(fileUrlPath)
      continue
    }
    if (isAbsolutePathLike(line)) paths.push(line)
  }
}

function parseFileUrlPath(value: string): string | null {
  if (!value.toLowerCase().startsWith('file://')) return null
  try {
    const pathname = decodeURIComponent(new URL(value).pathname)
    return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname
  } catch {
    return null
  }
}

function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
])
