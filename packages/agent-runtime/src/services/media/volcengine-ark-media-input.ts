import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { MediaInputFile, MediaProviderContext } from './media-adapter.types.js'
import { MediaProviderError } from './media-adapter.types.js'

type VolcengineInputKind = 'image' | 'video' | 'audio'

export async function resolveVolcengineMediaReference(
  file: MediaInputFile,
  kind: VolcengineInputKind,
  context: MediaProviderContext,
): Promise<string> {
  if (file.fileId?.trim()) {
    throw new MediaProviderError(
      'invalid_input',
      '火山方舟 Files file_id 仅用于 Chat/Responses，不能传给 Seedance/Seedream 生成接口',
    )
  }

  const direct = directReference(file, kind)
  if (direct) return direct

  const localPath = file.path?.trim()
  if (!localPath) {
    throw new MediaProviderError(
      'invalid_input',
      `火山方舟${kindLabel(kind)}素材必须是 HTTP/HTTPS、asset://、受支持的 Base64 或可读取的本地文件`,
    )
  }

  let buffer: Buffer
  try {
    buffer = await readFile(localPath)
  } catch (error) {
    throw new MediaProviderError(
      'invalid_input',
      `无法读取火山方舟${kindLabel(kind)}素材 ${path.basename(localPath)}：${errorMessage(error)}`,
    )
  }

  const mimeType = file.mimeType?.trim() || mimeTypeForPath(localPath, kind)
  if (kind !== 'video') return `data:${mimeType};base64,${buffer.toString('base64')}`

  if (!context.fallbackUploader?.canHandle('volcengine-ark')) {
    throw new MediaProviderError(
      'invalid_input',
      '火山方舟本地参考视频需要先上传为 HTTPS URL 或 asset:// 素材，当前没有可用的公开上传服务',
    )
  }
  try {
    const uploaded = await context.fallbackUploader.upload({
      buffer,
      filename: path.basename(localPath) || 'reference-video.mp4',
      mimeType,
      targetProvider: 'volcengine-ark',
    })
    const publicUrl = uploaded.publicUrl ?? uploaded.url
    if (publicUrl && /^https?:\/\//i.test(publicUrl)) return publicUrl
    throw new Error('上传结果缺少 HTTPS URL')
  } catch (error) {
    throw new MediaProviderError(
      'auth_required',
      `火山方舟本地参考视频公开上传失败，请登录 Spark 或改用 HTTPS/asset:// 素材：${errorMessage(error)}`,
    )
  }
}

function directReference(file: MediaInputFile, kind: VolcengineInputKind): string | undefined {
  const candidates = [file.dataUrl, file.url]
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (!value || value.startsWith('safe-file://')) continue
    if (/^https?:\/\//i.test(value) || value.startsWith('asset://')) return value
    if (!value.startsWith('data:')) continue
    if (kind === 'video') {
      throw new MediaProviderError(
        'invalid_input',
        '火山方舟参考视频不支持 Base64 data URL，请改用 HTTPS URL 或 asset:// 素材',
      )
    }
    const expectedPrefix = kind === 'image' ? 'data:image/' : 'data:audio/'
    if (value.toLowerCase().startsWith(expectedPrefix)) return value
    throw new MediaProviderError(
      'invalid_input',
      `火山方舟${kindLabel(kind)}素材的 Base64 MIME 类型不匹配`,
    )
  }
  return undefined
}

function mimeTypeForPath(filePath: string, kind: VolcengineInputKind): string {
  const extension = path.extname(filePath).toLowerCase()
  const known: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
  }
  return known[extension] ?? `${kind}/octet-stream`
}

function kindLabel(kind: VolcengineInputKind): string {
  if (kind === 'image') return '图片'
  if (kind === 'video') return '视频'
  return '音频'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
