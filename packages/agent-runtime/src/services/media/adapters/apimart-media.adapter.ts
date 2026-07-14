/**
 * APIMart 多媒体 adapter。
 *
 * APIMart 是 OpenAI 兼容聚合平台（design doc §6.1）：
 *   - 图片：/images/generations（可能返回直接产物或异步 task id）
 *   - GPT Image 2 图生图/图片编辑：/images/generations + image_urls
 *     支持公网 URL 与压缩后的 base64 data URI。
 *   - 语音合成：/audio/speech（OpenAI TTS 风格，二进制返回）
 *   - 语音转写：/audio/transcriptions（Whisper 风格）
 *   - 视频：/videos/generations 创建任务 → 轮询 /videos/generations/{id} 或 /tasks/{id}
 *
 * 默认 endpoint: https://api.apimart.ai/v1
 */

import { OpenAiCompatibleMediaAdapter } from './openai-compatible-media.adapter.js'
import { MediaProviderError } from '../media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaInputFile,
  MediaProviderContext,
} from '../media-adapter.types.js'
import {
  extractImages,
  extractStatus,
  extractTaskId,
  fetchJson,
  pollTask,
} from '../media-http.util.js'
import { MediaArtifactService } from '../media-artifact.service.js'
import {
  buildImageRequestParams,
  extraAllowed,
  filenameHelper,
  normalizeImageAliasParams,
} from './openai-compatible-media.adapter.js'

const FAILED_STATUSES = ['failed', 'error', 'cancelled', 'canceled']
const APIMART_IMAGE_DATA_URL_MAX_BYTES = 3 * 1024 * 1024
const APIMART_IMAGE_MAX_EDGES = [2048, 1600, 1280, 1024, 768, 512, 384, 256] as const
const APIMART_IMAGE_WEBP_QUALITIES = [82, 70, 58, 46, 36] as const

export class ApimartMediaAdapter extends OpenAiCompatibleMediaAdapter {
  constructor() {
    super({
      id: 'apimart',
      capabilities: [
        'image.generate',
        'image.edit',
        'image.variations',
        'audio.speech',
        'audio.transcription',
        'video.generate',
        'video.image_to_video',
        'video.edit',
      ],
      // APIMart 视频任务通常用 /videos/generations/{id} 查询，部分模型走 /tasks/{id}。
      // extractMediaUrls/extractStatus 对两种返回都兼容，这里给一条兜底 path，
      // 服务端若无该 path 会返回 404，由调用方报错。
      videoTaskPath: (taskId) => `/videos/generations/${encodeURIComponent(taskId)}`,
      genericTaskPath: (taskId) => `/tasks/${encodeURIComponent(taskId)}`,
    })
  }

  protected override async editImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    const imageFiles = (input.inputFiles ?? []).filter((file) => file.type === 'image' || file.type === 'file')
    if (imageFiles.length === 0) {
      throw new MediaProviderError('invalid_input', 'image edit requires input image(s)')
    }
    const model = ctx.defaultModel
    const defaults = ctx.mediaDefaults?.image
    const imageParams = buildImageRequestParams(input.modelParams, defaults, ctx.mediaProvider)
    const imageUrls = await Promise.all(imageFiles.map((file) => resolveApimartImageUrl(file)))
    const body: Record<string, unknown> = {
      model,
      prompt,
      image_urls: imageUrls,
      n: imageParams.n,
      ...(imageParams.size ? { size: imageParams.size } : {}),
      ...(imageParams.quality ? { quality: imageParams.quality } : {}),
      ...(imageParams.resolution ? { resolution: imageParams.resolution } : {}),
      ...(imageParams.response_format ? { response_format: imageParams.response_format } : {}),
      ...(imageParams.output_format ? { output_format: imageParams.output_format } : {}),
      ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      ...extraAllowed(ctx.extraParams, normalizeImageAliasParams(input.modelParams), [
        'aspectRatio',
        'aspect_ratio',
        'image',
        'image_url',
        'image_urls',
        'images',
        'n',
        'prompt',
        'quality',
        'resolution',
        'output_format',
        'response_format',
        'size',
      ], ctx.mediaManifestCapability),
    }
    const url = `${baseEndpoint(ctx)}/images/generations`
    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })

    let images = extractImages(data)
    let mode: 'sync' | 'async' = 'sync'
    let requestId: string | undefined
    let raw = data
    if (images.length === 0 && isAsync(ctx)) {
      const taskId = extractTaskId(data)
      if (taskId) {
        requestId = taskId
        mode = 'async'
        raw = await pollTask(`${baseEndpoint(ctx)}/tasks/${encodeURIComponent(taskId)}`, authHeaders(ctx), {
          fetchImpl: ctx.fetch,
          intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 4_000,
          timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 300_000,
          inspect: (payload) => {
            if (extractImages(payload).length > 0) return 'done'
            const status = extractStatus(payload).toLowerCase()
            return FAILED_STATUSES.includes(status) ? 'failed' : 'pending'
          },
          ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
        })
        images = extractImages(raw)
      }
    }
    if (images.length === 0) {
      throw new MediaProviderError('provider_http_error', `No images in edit response: ${JSON.stringify(raw).slice(0, 800)}`)
    }
    const assets = await Promise.all(
      images.map((image, index) =>
        this.artifact.writeImage(image, input.outputDir, filenameHelper(input, 'edit', index, images.length), ctx.fetch),
      ),
    )
    return { provider: this.id, model, mode, ...(requestId ? { requestId } : {}), assets, rawResponse: raw }
  }
}

async function resolveApimartImageUrl(file: MediaInputFile): Promise<string> {
  if (file.url && /^https?:\/\//i.test(file.url)) return file.url
  if (file.dataUrl) return compressApimartImageDataUrl(file.dataUrl)
  if (file.path) {
    const artifact = new MediaArtifactService()
    const buffer = await artifact.readLocalFile(file.path)
    const mimeType = file.mimeType ?? 'image/png'
    return compressApimartImageDataUrl(`data:${mimeType};base64,${buffer.toString('base64')}`)
  }
  throw new MediaProviderError('invalid_input', 'APIMart image edit requires public image URL or dataUrl input')
}

/**
 * APIMart generation 接口支持在 image_urls 中直接传 base64 data URI，但大 PNG
 * 会使 JSON 请求体过大并触发网关 413。仅对超过安全阈值的输入副本做 WebP 压缩，
 * 原图与小图保持不变。
 */
async function compressApimartImageDataUrl(dataUrl: string): Promise<string> {
  if (Buffer.byteLength(dataUrl, 'utf8') <= APIMART_IMAGE_DATA_URL_MAX_BYTES) return dataUrl

  const match = /^data:image\/(?:png|jpe?g|webp);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!match?.[1]) {
    throw new MediaProviderError(
      'invalid_input',
      'APIMart oversized image input must be a base64 PNG, JPEG, or WebP data URL',
    )
  }

  let canvasModule: typeof import('@napi-rs/canvas')
  try {
    canvasModule = await import('@napi-rs/canvas')
  } catch (error) {
    throw new MediaProviderError(
      'provider_not_configured',
      `APIMart image compression is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  let source: Awaited<ReturnType<typeof canvasModule.loadImage>>
  try {
    source = await canvasModule.loadImage(Buffer.from(match[1].replace(/\s/g, ''), 'base64'))
  } catch (error) {
    throw new MediaProviderError(
      'invalid_input',
      `APIMart failed to decode oversized image input: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const sourceWidth = source.width
  const sourceHeight = source.height
  const sourceMaxEdge = Math.max(sourceWidth, sourceHeight)
  if (!Number.isFinite(sourceMaxEdge) || sourceMaxEdge <= 0) {
    throw new MediaProviderError('invalid_input', 'APIMart oversized image input has invalid dimensions')
  }

  let smallestDataUrl = dataUrl
  const maxEdges = Array.from(
    new Set([Math.min(sourceMaxEdge, APIMART_IMAGE_MAX_EDGES[0]), ...APIMART_IMAGE_MAX_EDGES]),
  ).filter((edge) => edge <= sourceMaxEdge)

  for (const maxEdge of maxEdges) {
    const scale = Math.min(1, maxEdge / sourceMaxEdge)
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = canvasModule.createCanvas(width, height)
    const context = canvas.getContext('2d')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, width, height)

    for (const quality of APIMART_IMAGE_WEBP_QUALITIES) {
      const encoded = await canvas.encode('webp', quality)
      const compressed = `data:image/webp;base64,${encoded.toString('base64')}`
      if (compressed.length < smallestDataUrl.length) smallestDataUrl = compressed
      if (Buffer.byteLength(compressed, 'utf8') <= APIMART_IMAGE_DATA_URL_MAX_BYTES) {
        return compressed
      }
    }
  }

  if (Buffer.byteLength(smallestDataUrl, 'utf8') <= APIMART_IMAGE_DATA_URL_MAX_BYTES) {
    return smallestDataUrl
  }
  throw new MediaProviderError(
    'invalid_input',
    `APIMart image remains too large after compression (${Buffer.byteLength(smallestDataUrl, 'utf8')} bytes)`,
  )
}

function baseEndpoint(ctx: MediaProviderContext): string {
  return (ctx.apiEndpoint ?? '').replace(/\/+$/, '')
}

function authHeaders(ctx: MediaProviderContext): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${ctx.apiKey}`,
  }
}

function isAsync(ctx: MediaProviderContext): boolean {
  return ctx.mediaApiType === 'async' || ctx.mediaApiType === 'auto'
}
