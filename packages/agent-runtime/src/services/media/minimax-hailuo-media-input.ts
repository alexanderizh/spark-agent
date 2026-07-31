/**
 * @module minimax-hailuo-media-input
 *
 * 把画布通用输入角色（first_frame / last_frame / reference）解析成 MiniMax 请求字段可用的
 * 字符串引用。三条返回形态（来源：video-models-v2.md §4.2 / image-edit-models.md §3.1）：
 *   - 公网 URL：`https://...`（v1 + V2 通用）
 *   - V2 原生文件引用：`mm_file://{file_id}`（仅 V2 H3 支持；v1 first_frame_image / subject_reference 不支持）
 *   - Base64 Data URL：`data:<mime>;base64,...`（v1 + V2 通用；大文件避免，V2 请求体上限 64MB）
 *
 * 解析策略由 `allowMmFile` 开关区分目标通道：
 *   - v1 通道（image subject_reference / v1 视频 first_frame）：allowMmFile=false → 本地文件读成 base64；
 *   - V2 通道（H3 content[] 图/视频/音频）：allowMmFile=true → 本地文件上传拿 file_id → mm_file://（视频/音频强制上传，base64 过大）。
 */

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { createLogger } from '@spark/shared'
import type { MediaInputFile, MediaProviderContext } from './media-adapter.types.js'
import { MediaProviderError } from './media-adapter.types.js'
import { MinimaxHailuoFilesClient } from './minimax-hailuo-files.client.js'
import { configuredMediaInterfaceTimeoutMs } from './media-timeout.js'

const log = createLogger('media:minimax-input')

export interface ResolveMinimaxReferenceOptions {
  /** 目标通道是否接受 mm_file://{file_id}。V2=true，v1=false。 */
  allowMmFile?: boolean
}

export async function resolveMinimaxHailuoMediaReference(
  file: MediaInputFile,
  kind: 'image' | 'video' | 'audio',
  ctx: MediaProviderContext,
  options: ResolveMinimaxReferenceOptions = {},
): Promise<string> {
  const allowMmFile = options.allowMmFile ?? false

  // 1. 已有 file_id：仅 V2 可直接用 mm_file://；v1 通道不接受，落回 base64（仅图片）。
  const fileId = file.fileId?.trim()
  if (fileId) {
    if (allowMmFile) {
      log.debug(`event=resolved kind=${kind} transport=mm_file source=existing`)
      return `mm_file://${fileId}`
    }
    if (kind !== 'image') {
      throw new MediaProviderError(
        'invalid_input',
        `MiniMax v1 通道不接受 file_id 形式的 ${kind} 输入，请提供公网 URL`,
      )
    }
    // v1 图片：file_id 无公网 URL 含义，尝试从 dataUrl / 本地路径落 base64。
  }

  // 2. 公网 URL：v1 + V2 通用。
  if (file.url && /^https?:\/\//i.test(file.url)) {
    log.debug(`event=resolved kind=${kind} transport=url source=public`)
    return file.url
  }

  // 3. 物化本地文件 / dataUrl。
  const materialized = await materializeInput(file)
  if (!materialized) {
    throw new MediaProviderError(
      'invalid_input',
      `MiniMax ${kind} 输入必须是公网 URL、file_id（V2）、data URL 或可读本地文件`,
    )
  }

  if (allowMmFile) {
    // V2：上传拿 file_id → mm_file://（视频/音频必须走这条；图片也可走，避免 base64 膨胀）。
    try {
      const startedAt = Date.now()
      const timeoutMs = configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults)
      log.info(
        `event=upload-started kind=${kind} bytes=${materialized.buffer.byteLength} mime=${materialized.mimeType ?? 'unknown'}`,
      )
      const uploaded = await new MinimaxHailuoFilesClient({
        apiKey: ctx.apiKey,
        apiEndpoint: ctx.apiEndpoint,
        ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
        ...(timeoutMs != null ? { timeoutMs } : {}),
      }).upload({
        buffer: materialized.buffer,
        filename: materialized.filename,
        ...(materialized.mimeType ? { mimeType: materialized.mimeType } : {}),
        purpose: 'video_generation_input',
      })
      log.info(
        `event=upload-finished kind=${kind} transport=mm_file fileId=${uploaded.fileId} elapsedMs=${Date.now() - startedAt}`,
      )
      return `mm_file://${uploaded.fileId}`
    } catch (error) {
      // 图片上传失败可落 base64 兜底；视频/音频无 base64 路径，直接抛错。
      if (kind === 'image' && file.dataUrl) {
        log.warn(
          `event=upload-fallback kind=image transport=data_url reason=${JSON.stringify(error instanceof Error ? error.message : String(error))}`,
        )
        return file.dataUrl
      }
      throw error
    }
  }

  // v1 通道：本地文件 → base64 data URL（仅图片；v1 视频首帧也是图片）。
  if (kind !== 'image') {
    throw new MediaProviderError(
      'invalid_input',
      `MiniMax v1 通道的 ${kind} 输入必须是公网 URL，不能使用本地文件`,
    )
  }
  const mimeType = materialized.mimeType ?? 'image/png'
  return `data:${mimeType};base64,${materialized.buffer.toString('base64')}`
}

async function materializeInput(file: MediaInputFile): Promise<{
  buffer: Buffer
  filename: string
  mimeType?: string
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
