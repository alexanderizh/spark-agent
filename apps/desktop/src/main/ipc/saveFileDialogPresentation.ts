/**
 * 「另存为」对话框的类型呈现（file:save-image）。
 *
 * 这条 IPC 实际同时承载图片 / 视频 / 音频产物：画布与快速创作的产物卡片共用
 * `mediaArtifactActions.saveMediaArtifact`，最终都打到这里。此前标题固定为
 * 「保存图片」、过滤器只有图片格式，保存音频/视频产物时用户会看到错误的提示与筛选项，
 * 因此这里按源文件扩展名给出标题、过滤器与展示名。
 */

export type SaveDialogMediaKind = 'image' | 'video' | 'audio' | 'file'

export interface SaveDialogPresentation {
  kind: SaveDialogMediaKind
  title: string
  filters: Array<{ name: string; extensions: string[] }>
}

const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'heic',
  'heif',
  'tif',
  'tiff',
]

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi']

const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'opus',
  'aiff',
  'aif',
  'wma',
  'pcm',
]

const ALL_FILES_FILTER = { name: '所有文件', extensions: ['*'] }

/** 按扩展名判断产物类型；无法识别的扩展名归为通用文件。 */
export function saveDialogKindOf(filePath: string): SaveDialogMediaKind {
  const match = /\.([a-z0-9]+)$/i.exec(filePath.trim())
  const extension = match?.[1]?.toLowerCase() ?? ''
  if (!extension) return 'file'
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image'
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video'
  if (AUDIO_EXTENSIONS.includes(extension)) return 'audio'
  return 'file'
}

/** 对话框标题与过滤器；图片保持既有文案，音频/视频按类型给出对应过滤器。 */
export function saveDialogPresentation(filePath: string): SaveDialogPresentation {
  const kind = saveDialogKindOf(filePath)
  if (kind === 'image') {
    return {
      kind,
      title: '保存图片',
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
        ALL_FILES_FILTER,
      ],
    }
  }
  if (kind === 'video') {
    return {
      kind,
      title: '保存视频',
      filters: [{ name: '视频', extensions: VIDEO_EXTENSIONS }, ALL_FILES_FILTER],
    }
  }
  if (kind === 'audio') {
    return {
      kind,
      title: '保存音频',
      filters: [{ name: '音频', extensions: AUDIO_EXTENSIONS }, ALL_FILES_FILTER],
    }
  }
  return { kind, title: '保存文件', filters: [ALL_FILES_FILTER] }
}
