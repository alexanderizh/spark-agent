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

export function getDataTransferFilePaths(dataTransfer: DataTransfer | null | undefined): string[] {
  if (dataTransfer == null) return []
  const paths: string[] = []

  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== 'file') continue
    addFilePath(paths, item.getAsFile())
  }
  for (const file of Array.from(dataTransfer.files ?? [])) {
    addFilePath(paths, file)
  }

  if (paths.length === 0) {
    addTextPaths(paths, dataTransfer.getData?.('text/uri-list'))
    addTextPaths(paths, dataTransfer.getData?.('text/plain'))
  }

  return Array.from(new Set(paths))
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

function addFilePath(paths: string[], file: File | null | undefined): void {
  const maybePath = (file as (File & { path?: string }) | null | undefined)?.path
  if (typeof maybePath === 'string' && maybePath.trim().length > 0) paths.push(maybePath.trim())
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
