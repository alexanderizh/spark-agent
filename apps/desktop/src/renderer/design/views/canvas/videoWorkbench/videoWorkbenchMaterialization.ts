export type WorkbenchMaterializationKind = 'image' | 'video' | 'audio'

export interface WorkbenchMaterializationMedia {
  kind: WorkbenchMaterializationKind
  mimeType: string
}

/** Resolve the canvas media type from the actual workbench artifact extension. */
export function resolveWorkbenchMaterializationMedia(
  filePath: string,
): WorkbenchMaterializationMedia {
  const fileName = filePath.split(/[\\/]/).pop() ?? ''
  const extension = fileName.includes('.')
    ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
    : ''

  switch (extension) {
    case '.gif':
      return { kind: 'image', mimeType: 'image/gif' }
    case '.png':
      return { kind: 'image', mimeType: 'image/png' }
    case '.jpg':
    case '.jpeg':
      return { kind: 'image', mimeType: 'image/jpeg' }
    case '.webp':
      return { kind: 'image', mimeType: 'image/webp' }
    case '.webm':
      return { kind: 'video', mimeType: 'video/webm' }
    case '.mov':
      return { kind: 'video', mimeType: 'video/quicktime' }
    case '.m4v':
      return { kind: 'video', mimeType: 'video/mp4' }
    case '.avi':
      return { kind: 'video', mimeType: 'video/x-msvideo' }
    case '.mkv':
      return { kind: 'video', mimeType: 'video/x-matroska' }
    case '.mp4':
      return { kind: 'video', mimeType: 'video/mp4' }
    // 音频产物（工作台「分离音频」）：按扩展名映射为音频节点
    case '.m4a':
      return { kind: 'audio', mimeType: 'audio/mp4' }
    case '.mp3':
      return { kind: 'audio', mimeType: 'audio/mpeg' }
    case '.wav':
      return { kind: 'audio', mimeType: 'audio/wav' }
    case '.aac':
      return { kind: 'audio', mimeType: 'audio/aac' }
    case '.ac3':
      return { kind: 'audio', mimeType: 'audio/ac3' }
    case '.ogg':
    case '.oga':
      return { kind: 'audio', mimeType: 'audio/ogg' }
    case '.flac':
      return { kind: 'audio', mimeType: 'audio/flac' }
    case '.mka':
      return { kind: 'audio', mimeType: 'audio/x-matroska' }
    default:
      return { kind: 'video', mimeType: 'video/mp4' }
  }
}
