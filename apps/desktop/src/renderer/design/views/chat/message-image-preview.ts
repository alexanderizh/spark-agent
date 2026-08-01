import type { MessageAttachment } from './ChatComposerTypes'

export interface MessageImagePreview {
  initialSrc: string
  sourcePath: string
  needsPreparedPreview: boolean
}

export function getMessageImagePreview(
  attachment: MessageAttachment,
  resolveSrc: (path: string) => string,
): MessageImagePreview {
  const sourcePath = attachment.previewPath ?? attachment.path
  const initialSrc = attachment.previewUrl ?? resolveSrc(sourcePath)
  const lower = sourcePath.trim().toLowerCase()
  const alreadyDisplayable =
    attachment.previewUrl != null ||
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('safe-file:') ||
    lower.startsWith('spark-safe-file:')

  return {
    initialSrc,
    sourcePath,
    needsPreparedPreview: sourcePath.trim().length > 0 && !alreadyDisplayable,
  }
}
