export type WorkbenchMaterializationKind = 'image' | 'video'

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
    default:
      return { kind: 'video', mimeType: 'video/mp4' }
  }
}
