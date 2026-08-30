import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { createLogger } from '@spark/shared'
import type { MediaInputFile, MediaProviderContext } from './media-adapter.types.js'
import { MediaProviderError } from './media-adapter.types.js'
import { XaiFilesClient } from './xai-files.client.js'
import { configuredMediaInterfaceTimeoutMs } from './media-timeout.js'
import {
  lookupMediaTransferCache,
  mediaTransferScopeOf,
  recordMediaTransferCache,
} from './media-input-transfer-cache.js'

export type XaiMediaReference = { url: string } | { file_id: string }
const log = createLogger('media:xai-input')

export async function resolveXaiMediaReference(
  file: MediaInputFile,
  kind: 'image' | 'video',
  ctx: MediaProviderContext,
): Promise<XaiMediaReference> {
  if (file.fileId?.trim()) {
    log.debug(`event=resolved kind=${kind} transport=file_id source=existing`)
    return { file_id: file.fileId.trim() }
  }
  if (file.url && /^https?:\/\//i.test(file.url)) {
    log.debug(`event=resolved kind=${kind} transport=url source=public`)
    return { url: file.url }
  }

  const materialized = await materializeInput(file)
  if (!materialized) {
    throw new MediaProviderError(
      'invalid_input',
      `xAI ${kind} input must be a public URL, file_id, data URL, or readable local file`,
    )
  }

  try {
    // 同一份素材多次使用时复用已上传的 xAI file_id（按 endpoint+apiKey 与内容指纹缓存）。
    const cacheIdentity = {
      provider: 'xai',
      scope: mediaTransferScopeOf({ apiEndpoint: ctx.apiEndpoint, apiKey: ctx.apiKey }),
    }
    const cacheContent = materialized.localPath
      ? { filePath: materialized.localPath }
      : { buffer: materialized.buffer }
    const cached = await lookupMediaTransferCache(cacheIdentity, cacheContent)
    if (cached?.kind === 'file_id') {
      log.debug(`event=resolved kind=${kind} transport=file_id source=transfer-cache`)
      return { file_id: cached.fileId }
    }

    const startedAt = Date.now()
    const timeoutMs = configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults)
    log.info(
      `event=upload-started kind=${kind} bytes=${materialized.buffer.byteLength} mime=${materialized.mimeType ?? 'unknown'}`,
    )
    const uploaded = await new XaiFilesClient({
      apiKey: ctx.apiKey,
      apiEndpoint: ctx.apiEndpoint,
      ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
      ...(timeoutMs != null ? { timeoutMs } : {}),
    }).upload({
      buffer: materialized.buffer,
      filename: materialized.filename,
      ...(materialized.mimeType ? { mimeType: materialized.mimeType } : {}),
    })
    await recordMediaTransferCache(cacheIdentity, cacheContent, {
      kind: 'file_id',
      fileId: uploaded.id,
    })
    log.info(
      `event=upload-finished kind=${kind} transport=file_id elapsedMs=${Date.now() - startedAt}`,
    )
    return { file_id: uploaded.id }
  } catch (providerUploadError) {
    if (kind === 'image') {
      // 图片优先走 Spark 平台公网 URL（避免 base64 撑大请求体）；平台不可用/未登录时
      // 保持原有 base64 内联回退，不构成登录强依赖。
      if (ctx.fallbackUploader?.canHandle('xai')) {
        try {
          const fallback = await ctx.fallbackUploader.upload({
            buffer: materialized.buffer,
            filename: materialized.filename,
            ...(materialized.mimeType ? { mimeType: materialized.mimeType } : {}),
            targetProvider: 'xai',
          })
          const publicUrl = fallback.publicUrl ?? fallback.url
          if (publicUrl && /^https?:\/\//i.test(publicUrl)) {
            log.warn(
              `event=upload-fallback kind=image transport=spark-url reason=${JSON.stringify(errorMessage(providerUploadError))}`,
            )
            return { url: publicUrl }
          }
        } catch {
          // Spark 回退失败（未登录/网络等）→ 继续 base64 兜底
        }
      }
      log.warn(
        `event=upload-fallback kind=image transport=data_url reason=${JSON.stringify(errorMessage(providerUploadError))}`,
      )
      if (file.dataUrl) return { url: file.dataUrl }
      const mimeType = materialized.mimeType ?? 'image/png'
      return { url: `data:${mimeType};base64,${materialized.buffer.toString('base64')}` }
    }
    if (ctx.fallbackUploader?.canHandle('xai')) {
      try {
        const fallback = await ctx.fallbackUploader.upload({
          buffer: materialized.buffer,
          filename: materialized.filename,
          ...(materialized.mimeType ? { mimeType: materialized.mimeType } : {}),
        })
        const publicUrl = fallback.publicUrl ?? fallback.url
        if (publicUrl && /^https?:\/\//i.test(publicUrl)) return { url: publicUrl }
      } catch (fallbackError) {
        throw new MediaProviderError(
          'auth_required',
          `xAI Files 上传失败，Spark 平台回退也失败；请登录后重试。xAI: ${errorMessage(providerUploadError)}；Spark: ${errorMessage(fallbackError)}`,
        )
      }
    }
    throw new MediaProviderError(
      'invalid_input',
      `xAI Files 上传失败，视频输入不能使用 base64，且没有可用的 Spark 公开上传回退：${errorMessage(providerUploadError)}`,
    )
  }
}

async function materializeInput(file: MediaInputFile): Promise<{
  buffer: Buffer
  filename: string
  mimeType?: string
  localPath?: string
} | null> {
  if (file.dataUrl) {
    const parsed = parseDataUrl(file.dataUrl)
    if (!parsed) throw new MediaProviderError('invalid_input', 'Invalid media data URL')
    return {
      buffer: parsed.buffer,
      filename: filenameFor(parsed.mimeType),
      mimeType: file.mimeType ?? parsed.mimeType,
    }
  }
  const localPath = file.path ?? safeFilePath(file.url)
  if (!localPath) return null
  return {
    buffer: await readFile(localPath),
    filename: basename(localPath) || filenameFor(file.mimeType),
    localPath,
    ...(file.mimeType ? { mimeType: file.mimeType } : {}),
  }
}

function parseDataUrl(value: string): { buffer: Buffer; mimeType: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/is.exec(value)
  if (!match?.[1] || match[2] == null) return null
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') }
}

function safeFilePath(value: string | undefined): string | undefined {
  if (!value?.startsWith('safe-file://')) return undefined
  const rest = value.slice('safe-file://'.length)
  const slashIndex = rest.indexOf('/')
  if (slashIndex < 0) return undefined
  const encoded = rest.slice(slashIndex + 1)
  if (!encoded) return undefined
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
  const decoded = Buffer.from(base64 + padding, 'base64').toString('utf8')
  return decoded || undefined
}

function filenameFor(mimeType: string | undefined): string {
  const extension = mimeType?.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin'
  return `spark-input-${Date.now()}.${extension}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
