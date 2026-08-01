import type { MessageAttachment } from './ChatComposerTypes'

export interface MessageImagePreview {
  initialSrc: string | null
  sourcePath: string
  needsPreparedPreview: boolean
}

export interface MessageImageRenderState {
  resolvedSrc: string
  imgError: boolean
}

export function getMessageImagePreview(
  attachment: MessageAttachment,
  resolveSrc: (path: string) => string,
): MessageImagePreview {
  const sourcePath = attachment.previewPath ?? attachment.path
  const lower = sourcePath.trim().toLowerCase()
  const alreadyDisplayable =
    attachment.previewUrl != null ||
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('safe-file:') ||
    lower.startsWith('spark-safe-file:')
  const initialSrc =
    attachment.previewUrl ?? (alreadyDisplayable ? resolveSrc(sourcePath) : null)

  return {
    initialSrc,
    sourcePath,
    needsPreparedPreview: sourcePath.trim().length > 0 && !alreadyDisplayable,
  }
}

export function preparedMessageImageRenderState(fileUrl: string): MessageImageRenderState {
  return { resolvedSrc: fileUrl, imgError: false }
}
