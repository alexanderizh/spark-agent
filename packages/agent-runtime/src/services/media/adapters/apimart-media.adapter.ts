/**
 * APIMart 多媒体 adapter。
 *
 * APIMart 是 OpenAI 兼容聚合平台（design doc §6.1）：
 *   - 图片：/images/generations（可能返回直接产物或异步 task id）
 *   - GPT Image 2 图生图/图片编辑：/images/generations + image_urls
 *     支持公网 URL 与小体积 base64 data URI；大图由宿主上传后改传公网 URL。
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
        'video.reference_to_video',
        'video.edit',
        'video.extend',
      ],
      // APIMart 所有异步图片/视频任务都通过统一任务端点查询。
      videoTaskPath: (taskId) => `/tasks/${encodeURIComponent(taskId)}`,
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
    const imageParams = buildImageRequestParams(input.modelParams, defaults, ctx.mediaProvider, model)
    const imageUrls = await Promise.all(imageFiles.map((file) => resolveApimartImageUrl(file, ctx)))
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
        ctx.onTaskSubmitted?.({ requestId: taskId, response: data })
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

async function resolveApimartImageUrl(file: MediaInputFile, ctx: MediaProviderContext): Promise<string> {
  if (file.url && /^https?:\/\//i.test(file.url)) return file.url
  if (file.dataUrl) {
    const parsed = parseImageDataUrl(file.dataUrl)
    if (parsed.buffer.byteLength <= APIMART_IMAGE_DATA_URL_MAX_BYTES) return file.dataUrl
    return uploadApimartImage(parsed.buffer, parsed.mimeType, ctx)
  }
  if (file.path) {
    const artifact = new MediaArtifactService()
    const buffer = await artifact.readLocalFile(file.path)
    const mimeType = file.mimeType ?? 'image/png'
    return uploadApimartImage(buffer, mimeType, ctx)
  }
  throw new MediaProviderError(
    'invalid_input',
    'APIMart image edit requires a public image URL, dataUrl, or readable local file',
  )
}

function parseImageDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!match?.[1] || match[2] == null) {
    throw new MediaProviderError(
      'invalid_input',
      'APIMart image input must be a base64 image data URL or a public HTTP(S) URL',
    )
  }
  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2].replace(/\s/g, ''), 'base64'),
  }
}

async function uploadApimartImage(
  buffer: Buffer,
  mimeType: string,
  ctx: MediaProviderContext,
): Promise<string> {
  if (!ctx.fallbackUploader?.canHandle('apimart')) {
    throw new MediaProviderError(
      'auth_required',
      'APIMart 图片超过 3 MiB 或来自本地文件，需要先登录 Spark 以获取公开图片 URL',
    )
  }
  try {
    const uploaded = await ctx.fallbackUploader.upload({
      buffer,
      filename: `apimart-reference-${Date.now()}.${extensionForMime(mimeType)}`,
      mimeType,
      targetProvider: 'apimart',
    })
    const publicUrl = uploaded.publicUrl ?? uploaded.url
    if (publicUrl && /^https?:\/\//i.test(publicUrl)) return publicUrl
    throw new Error('上传结果缺少公开 HTTP(S) URL')
  } catch (error) {
    throw new MediaProviderError(
      'auth_required',
      `APIMart 图片上传失败，请登录 Spark 后重试：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized === 'image/jpeg') return 'jpg'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  return 'png'
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
