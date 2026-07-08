/**
 * APIMart 多媒体 adapter。
 *
 * APIMart 是 OpenAI 兼容聚合平台（design doc §6.1）：
 *   - 图片：/images/generations（可能返回直接产物或异步 task id）
 *   - GPT Image 2 图生图/图片编辑：/images/generations + image_urls
 *     本地 dataUrl 先经 /uploads/images 上传成平台 URL。
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
  if (file.dataUrl) return uploadApimartImage(file.dataUrl, ctx)
  if (file.path) {
    const artifact = new MediaArtifactService()
    const buffer = await artifact.readLocalFile(file.path)
    const mimeType = file.mimeType ?? 'image/png'
    return uploadApimartImage(`data:${mimeType};base64,${buffer.toString('base64')}`, ctx)
  }
  throw new MediaProviderError('invalid_input', 'APIMart image edit requires public image URL or dataUrl input')
}

async function uploadApimartImage(dataUrl: string, ctx: MediaProviderContext): Promise<string> {
  const data = await fetchJson(`${baseEndpoint(ctx)}/uploads/images`, {
    method: 'POST',
    headers: authHeaders(ctx),
    body: JSON.stringify({ image: dataUrl }),
    fetchImpl: ctx.fetch,
    timeoutMs: 120_000,
    ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
  })
  const [image] = extractImages(data)
  if (image?.kind === 'url') return image.value
  throw new MediaProviderError('provider_http_error', `No APIMart uploaded image URL: ${JSON.stringify(data).slice(0, 800)}`)
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
