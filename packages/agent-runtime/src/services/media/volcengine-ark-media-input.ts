import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { MediaInputFile, MediaProviderContext } from './media-adapter.types.js'
import { MediaProviderError } from './media-adapter.types.js'
import { VolcengineArkFilesClient } from './volcengine-ark-files.client.js'
import {
  evictMediaTransferCache,
  lookupMediaTransferCache,
  mediaTransferScopeOf,
  recordMediaTransferCache,
} from './media-input-transfer-cache.js'

type VolcengineInputKind = 'image' | 'video' | 'audio'

export async function resolveVolcengineMediaReference(
  file: MediaInputFile,
  kind: VolcengineInputKind,
  context: MediaProviderContext,
): Promise<string> {
  // Ark Files API 的 file_id 不能直接放进 Seedance/Seedream content；先通过官方
  // Files 对象取得预签名 download_url，再把 URL 交给生成接口。这样不会把 file_id
  // 或本地路径传给模型端。
  const fileId = file.fileId?.trim()
  if (fileId) {
    try {
      return await new VolcengineArkFilesClient({
        apiKey: context.apiKey,
        apiEndpoint: context.apiEndpoint,
        ...(context.fetch ? { fetch: context.fetch } : {}),
      }).resolveDownloadUrl(fileId)
    } catch (error) {
      // 节点可能同时保留了用户显式提供的 URL/本地源；Files 解析失败时允许走
      // 已有安全回退，避免一次过期/删除的远端 file_id 让任务完全无法提交。
      if (!file.url?.trim() && !file.dataUrl?.trim() && !file.path?.trim()) {
        throw new MediaProviderError(
          error instanceof MediaProviderError ? error.code : 'provider_http_error',
          `火山方舟 Files file_id ${fileId} 无法转换为官方下载 URL：${errorMessage(error)}`,
          error instanceof MediaProviderError ? error.statusCode : undefined,
        )
      }
    }
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
  const officialFileUrl = await tryUploadToVolcengineFiles(localPath, context)
  if (officialFileUrl) return officialFileUrl

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

async function tryUploadToVolcengineFiles(
  filePath: string,
  context: MediaProviderContext,
): Promise<string | undefined> {
  const client = new VolcengineArkFilesClient({
    apiKey: context.apiKey,
    apiEndpoint: context.apiEndpoint,
    ...(context.fetch ? { fetch: context.fetch } : {}),
  })
  const cacheIdentity = {
    provider: 'volcengine-ark',
    scope: mediaTransferScopeOf({ apiEndpoint: context.apiEndpoint, apiKey: context.apiKey }),
  }
  // 同一份素材多次使用时复用已上传的 file_id：预签名 download_url 会过期，
  // 因此每次命中都用 file_id 现换新 URL（轻量 GET，不重传文件本体）；换不到则
  // 清掉缓存条目，走正常上传。
  const cached = await lookupMediaTransferCache(cacheIdentity, { filePath })
  if (cached?.kind === 'file_id') {
    try {
      const downloadUrl = (await client.resolveDownloadUrl(cached.fileId)).trim()
      if (/^https?:\/\//i.test(downloadUrl)) return downloadUrl
    } catch {
      await evictMediaTransferCache(cacheIdentity, { filePath })
    }
  }
  try {
    const uploaded = await client.upload({
      filePath,
      purpose: 'user_data',
      waitUntilActive: true,
    })
    const downloadUrl = uploaded.downloadUrl?.trim()
    if (!(downloadUrl && /^https?:\/\//i.test(downloadUrl))) return undefined
    if (uploaded.id?.trim()) {
      await recordMediaTransferCache(
        cacheIdentity,
        { filePath },
        {
          kind: 'file_id',
          fileId: uploaded.id.trim(),
        },
      )
    }
    return downloadUrl
  } catch {
    // Files 是火山官方首选通道，但本地任务仍保留可控回退：图片/音频可内联，
    // 视频交给已配置的 HTTPS 上传器。回退层同样禁止把本地路径放进请求体。
    return undefined
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
