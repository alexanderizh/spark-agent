import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { MediaInputFile, MediaProviderContext } from './media-adapter.types.js'
import { MediaProviderError } from './media-adapter.types.js'

type TencentInputKind = 'image' | 'audio' | 'video'

/**
 * 把本地/已有 file 解析成腾讯 TokenHub 接受的引用：
 *   - image：HTTPS/asset:// URL，本地文件优先 fallbackUploader 上传，否则 base64 data URL 兜底
 *   - audio/video：必须 HTTPS URL；本地文件走 fallbackUploader
 *
 * 腾讯 TokenHub images/image 字段官方示例只展示公网 URL；
 * 对图片 base64 data URL 是否被官方接受未明确（1668 旧接口历史接受 base64），
 * 因此图片允许 data URL 兜底，视频则严格要求公网 URL。
 */
export async function resolveTencentMediaReference(
  file: MediaInputFile,
  kind: TencentInputKind,
  context: MediaProviderContext,
): Promise<string> {
  const direct = directReference(file, kind)
  if (direct) return direct

  const localPath = file.path?.trim()
  if (!localPath) {
    throw new MediaProviderError(
      'invalid_input',
      `腾讯 TokenHub ${kindLabel(kind)}素材必须是 HTTP/HTTPS URL、asset:// 素材、可读取的本地文件或（仅图片）Base64 data URL`,
    )
  }

  let buffer: Buffer
  try {
    buffer = await readFile(localPath)
  } catch (error) {
    throw new MediaProviderError(
      'invalid_input',
      `无法读取腾讯 TokenHub ${kindLabel(kind)}素材 ${path.basename(localPath)}：${errorMessage(error)}`,
    )
  }

  const mimeType = file.mimeType?.trim() || mimeTypeForPath(localPath, kind)

  // 图片：本地文件优先公开上传（腾讯 images 字段更稳），无 uploader 时 base64 兜底
  if (kind === 'image') {
    if (context.fallbackUploader?.canHandle('tencent-tokenhub')) {
      const uploaded = await uploadPublicUrl(buffer, localPath, mimeType, context)
      if (uploaded) return uploaded
    }
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  }

  // 音频/视频：必须公开 URL
  if (!context.fallbackUploader?.canHandle('tencent-tokenhub')) {
    throw new MediaProviderError(
      'invalid_input',
      `腾讯 TokenHub 本地参考${kindLabel(kind)}需要先上传为 HTTPS URL 或 asset:// 素材，当前没有可用的公开上传服务`,
    )
  }
  const uploaded = await uploadPublicUrl(buffer, localPath, mimeType, context)
  if (!uploaded) {
    throw new MediaProviderError(
      'auth_required',
      `腾讯 TokenHub 本地参考${kindLabel(kind)}公开上传失败：上传结果缺少 HTTPS URL`,
    )
  }
  return uploaded
}

async function uploadPublicUrl(
  buffer: Buffer,
  localPath: string,
  mimeType: string,
  context: MediaProviderContext,
): Promise<string | undefined> {
  const uploader = context.fallbackUploader
  if (!uploader) return undefined
  try {
    const uploaded = await uploader.upload({
      buffer,
      filename: path.basename(localPath) || 'reference-media',
      mimeType,
      targetProvider: 'tencent-tokenhub',
    })
    const publicUrl = uploaded.publicUrl ?? uploaded.url
    if (publicUrl && /^https?:\/\//i.test(publicUrl)) return publicUrl
    return undefined
  } catch (error) {
    throw new MediaProviderError(
      'auth_required',
      `腾讯 TokenHub 本地素材公开上传失败，请改用 HTTPS/asset:// 素材：${errorMessage(error)}`,
    )
  }
}

function directReference(file: MediaInputFile, kind: TencentInputKind): string | undefined {
  const candidates = [file.dataUrl, file.url]
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (!value || value.startsWith('safe-file://')) continue
    if (/^https?:\/\//i.test(value) || value.startsWith('asset://')) return value
    if (!value.startsWith('data:')) continue
    if (kind !== 'image') {
      throw new MediaProviderError(
        'invalid_input',
        `腾讯 TokenHub ${kindLabel(kind)}不支持 Base64 data URL，请改用 HTTPS URL 或 asset:// 素材`,
      )
    }
    const expectedPrefix = 'data:image/'
    if (value.toLowerCase().startsWith(expectedPrefix)) return value
    throw new MediaProviderError('invalid_input', `腾讯 TokenHub 图片素材的 Base64 MIME 类型不匹配`)
  }
  return undefined
}

function mimeTypeForPath(filePath: string, kind: TencentInputKind): string {
  const extension = path.extname(filePath).toLowerCase()
  const known: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
  }
  return known[extension] ?? `${kind}/octet-stream`
}

function kindLabel(kind: TencentInputKind): string {
  if (kind === 'image') return '图片'
  return kind === 'audio' ? '音频' : '视频'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
