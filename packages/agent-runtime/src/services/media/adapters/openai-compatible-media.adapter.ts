/**
 * OpenAI-compatible 多媒体 adapter 基类。
 *
 * APIMart 与 xAI 都暴露 OpenAI 风格的图片/音频/视频端点，差异主要在：
 *   - 端点 base url
 *   - 支持的能力集合（xAI 暂无 transcription）
 *   - 异步任务轮询路径（/tasks/{id} vs /videos/generations/{id}）
 *
 * 子类通过 options 注入这些差异；通用 HTTP/解析/落盘逻辑在此复用。
 */

import type {
  MediaCapabilityId,
  MediaProviderKind,
  ProviderMediaDefaults,
} from '@spark/protocol'
import { MediaProviderError } from '../media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaProviderAdapter,
  MediaProviderContext,
} from '../media-adapter.types.js'
import { MediaArtifactService } from '../media-artifact.service.js'
import {
  extractImages,
  extractMediaUrls,
  extractStatus,
  extractTaskId,
  extractText,
  fetchJson,
  pollTask,
} from '../media-http.util.js'

export interface OpenAiCompatibleAdapterOptions {
  id: MediaProviderKind
  /** 该 adapter 声明支持的能力 */
  capabilities: MediaCapabilityId[]
  /** 异步视频任务状态查询 path 模板，{id} 占位 */
  videoTaskPath?: ((taskId: string) => string) | undefined
  /** 通用异步任务状态查询 path 模板（图片/通用） */
  genericTaskPath?: ((taskId: string) => string) | undefined
}

const FAILED_STATUSES = ['failed', 'error', 'cancelled', 'canceled']

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

export abstract class OpenAiCompatibleMediaAdapter implements MediaProviderAdapter {
  readonly id: MediaProviderKind
  protected readonly artifact = new MediaArtifactService()
  private readonly capabilities: Set<MediaCapabilityId>
  private readonly videoTaskPath: ((taskId: string) => string) | undefined
  private readonly genericTaskPath: ((taskId: string) => string) | undefined

  constructor(opts: OpenAiCompatibleAdapterOptions) {
    this.id = opts.id
    this.capabilities = new Set(opts.capabilities)
    this.videoTaskPath = opts.videoTaskPath
    this.genericTaskPath = opts.genericTaskPath
  }

  supports(capability: MediaCapabilityId): boolean {
    return this.capabilities.has(capability)
  }

  async invoke(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    if (!ctx.apiKey) throw new MediaProviderError('api_key_missing', 'Missing API key')
    const capability = input.capability
    if (!capability) {
      throw new MediaProviderError('capability_not_supported', 'No capability resolved for media invoke')
    }
    if (!this.supports(capability)) {
      throw new MediaProviderError('capability_not_supported', `${this.id} does not support ${capability}`)
    }
    switch (capability) {
      case 'image.generate':
        return this.generateImage(input, ctx)
      case 'image.edit':
      case 'image.variations':
        return this.editImage(input, ctx)
      case 'audio.speech':
        return this.generateSpeech(input, ctx)
      case 'audio.transcription':
        return this.transcribe(input, ctx)
      case 'video.generate':
      case 'video.image_to_video':
        return this.generateVideo(input, ctx)
      default:
        throw new MediaProviderError('capability_not_supported', `Unsupported capability: ${capability}`)
    }
  }

  // ── image.generate ──────────────────────────────────────────────────────
  protected async generateImage(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) throw new MediaProviderError('invalid_input', 'prompt is required')
    const model = ctx.defaultModel
    const defaults = ctx.mediaDefaults?.image
    const body: Record<string, unknown> = {
      model,
      prompt,
      n: clampInt(input.modelParams?.n, defaults?.n, 1, 1, 4),
      ...(defaults?.size || input.modelParams?.size ? { size: input.modelParams?.size ?? defaults?.size } : {}),
      ...(defaults?.quality || input.modelParams?.quality ? { quality: input.modelParams?.quality ?? defaults?.quality } : {}),
      ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      ...extraAllowed(ctx.extraParams, input.modelParams, ['size', 'n', 'quality', 'response_format']),
    }
    const url = `${baseEndpoint(ctx)}/images/generations`
    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
    })
    let images = extractImages(data)
    let mode: 'sync' | 'async' = 'sync'
    let requestId: string | undefined
    if (images.length === 0 && isAsync(ctx)) {
      const taskId = extractTaskId(data)
      if (taskId && (this.genericTaskPath || this.videoTaskPath)) {
        requestId = taskId
        mode = 'async'
        const pollUrl = `${baseEndpoint(ctx)}${(this.genericTaskPath ?? this.videoTaskPath)!(taskId)}`
        const polled = await pollTask(pollUrl, authHeaders(ctx), {
          fetchImpl: ctx.fetch,
          intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 4_000,
          timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 240_000,
          inspect: (d) => {
            const imgs = extractImages(d)
            if (imgs.length > 0) return 'done'
            const s = extractStatus(d)
            return FAILED_STATUSES.includes(s) ? 'failed' : 'pending'
          },
        })
        images = extractImages(polled)
      }
    }
    if (images.length === 0) {
      throw new MediaProviderError('provider_http_error', `No images in response: ${JSON.stringify(data).slice(0, 800)}`)
    }
    const assets = await Promise.all(
      images.map((image, i) =>
        this.artifact.writeImage(image, input.outputDir, filename(input, 'img', i, images.length), ctx.fetch),
      ),
    )
    return { provider: this.id, model, mode, ...(requestId ? { requestId } : {}), assets, rawResponse: data }
  }

  // ── image.edit / image.variations ───────────────────────────────────────
  protected async editImage(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    const inputs = input.inputFiles ?? []
    if (inputs.length === 0 && !prompt) {
      throw new MediaProviderError('invalid_input', 'image edit requires input image(s) or prompt')
    }
    const model = ctx.defaultModel
    const imageRefs = inputs
      .filter((file) => file.type === 'image' || file.type === 'file')
      .map((file) => file.url ?? file.dataUrl ?? file.path ?? '')
      .filter((ref) => ref.length > 0)
    const body: Record<string, unknown> = {
      model,
      prompt,
      ...(imageRefs.length > 0 ? { image: imageRefs[0] } : {}),
      ...(imageRefs.length > 1 ? { image_url: imageRefs } : {}),
      ...extraAllowed(ctx.extraParams, input.modelParams, ['size', 'n', 'quality', 'response_format', 'mask']),
    }
    const url = `${baseEndpoint(ctx)}/images/edits`
    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
    })
    const images = extractImages(data)
    if (images.length === 0) {
      throw new MediaProviderError('provider_http_error', `No images in edit response: ${JSON.stringify(data).slice(0, 800)}`)
    }
    const assets = await Promise.all(
      images.map((image, i) =>
        this.artifact.writeImage(image, input.outputDir, filename(input, 'edit', i, images.length), ctx.fetch),
      ),
    )
    return { provider: this.id, model, mode: 'sync', assets, rawResponse: data }
  }

  // ── audio.speech (TTS) ──────────────────────────────────────────────────
  protected async generateSpeech(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    const text = (input.prompt ?? '').trim()
    if (!text) throw new MediaProviderError('invalid_input', 'text/prompt is required for speech')
    const model = ctx.defaultModel
    const audioDefaults = ctx.mediaDefaults?.audio
    const body: Record<string, unknown> = {
      model,
      input: text,
      voice: input.modelParams?.voice ?? audioDefaults?.voice ?? 'alloy',
      ...(audioDefaults?.format || input.modelParams?.format
        ? { response_format: input.modelParams?.format ?? audioDefaults?.format }
        : {}),
      ...(audioDefaults?.speed != null || input.modelParams?.speed != null
        ? { speed: input.modelParams?.speed ?? audioDefaults?.speed }
        : {}),
      ...extraAllowed(ctx.extraParams, input.modelParams, ['voice', 'response_format', 'speed', 'input']),
    }
    const url = `${baseEndpoint(ctx)}/audio/speech`
    const buffer = await fetchJson<Buffer>(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      binary: true,
    })
    const mimeType = mimeFromFormat((body.response_format as string) ?? 'mp3')
    const asset = await this.artifact.writeBinaryAsset(
      'audio',
      buffer,
      input.outputDir,
      filename(input, 'audio', 0, 1),
      mimeType,
    )
    return { provider: this.id, model, mode: 'sync', assets: [asset], rawResponse: { bytes: buffer.length } }
  }

  // ── audio.transcription ─────────────────────────────────────────────────
  protected async transcribe(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    const file = (input.inputFiles ?? []).find((f) => f.type === 'audio' || f.type === 'file')
    if (!file) throw new MediaProviderError('invalid_input', 'transcription requires an audio input file')
    const model = ctx.defaultModel
    const url = `${baseEndpoint(ctx)}/audio/transcriptions`
    // 先支持 url / dataUrl 模式（OpenAI compatible 部分聚合平台支持 JSON body 传 url）
    if (file.url) {
      const body: Record<string, unknown> = {
        model,
        url: file.url,
        ...(ctx.mediaDefaults?.audio?.language ? { language: ctx.mediaDefaults.audio.language } : {}),
        ...extraAllowed(ctx.extraParams, input.modelParams, ['language', 'response_format', 'prompt', 'url']),
      }
      const data = await fetchJson(url, {
        method: 'POST',
        headers: authHeaders(ctx),
        body: JSON.stringify(body),
        fetchImpl: ctx.fetch,
        timeoutMs: 120_000,
      })
      return this.materializeTranscription(data, input, model)
    }
    // 本地文件：multipart/form-data
    const buffer = file.dataUrl
      ? Buffer.from(file.dataUrl.split(',')[1] ?? '', 'base64')
      : file.path
        ? await this.artifact.readLocalFile(file.path)
        : null
    if (!buffer) throw new MediaProviderError('invalid_input', 'transcription input must be url/dataUrl/path')
    const form = await buildMultipart(
      {
        model,
        ...(ctx.mediaDefaults?.audio?.language ? { language: ctx.mediaDefaults.audio.language } : {}),
      },
      [{ field: 'file', filename: 'audio.dat', content: buffer }],
    )
    const data = await fetchJson(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.apiKey}`, 'content-type': form.contentType },
      body: form.body,
      fetchImpl: ctx.fetch,
      timeoutMs: 120_000,
    })
    return this.materializeTranscription(data, input, model)
  }

  private async materializeTranscription(
    data: unknown,
    input: MediaGenerateInput,
    model: string,
  ): Promise<MediaGenerateOutput> {
    const text = extractText(data) ?? ''
    const asset = await this.artifact.writeTextAsset(text, input.outputDir, filename(input, 'transcript', 0, 1))
    return { provider: this.id, model, mode: 'sync', assets: [asset], rawResponse: data }
  }

  // ── video.generate / video.image_to_video ───────────────────────────────
  protected async generateVideo(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    if (!prompt && input.capability === 'video.generate') {
      throw new MediaProviderError('invalid_input', 'prompt is required for video generation')
    }
    const model = ctx.defaultModel
    const videoDefaults = ctx.mediaDefaults?.video
    const firstImage = (input.inputFiles ?? []).find((f) => f.type === 'image' || f.type === 'file')
    const body: Record<string, unknown> = {
      model,
      prompt,
      ...(videoDefaults?.aspectRatio || input.modelParams?.aspectRatio
        ? { aspect_ratio: input.modelParams?.aspectRatio ?? videoDefaults?.aspectRatio }
        : {}),
      ...(videoDefaults?.durationSeconds != null || input.modelParams?.durationSeconds != null
        ? { duration: input.modelParams?.durationSeconds ?? videoDefaults?.durationSeconds }
        : {}),
      ...(firstImage ? { image: firstImage.url ?? firstImage.dataUrl ?? firstImage.path } : {}),
      ...extraAllowed(ctx.extraParams, input.modelParams, ['aspect_ratio', 'duration', 'quality', 'fps', 'image', 'seed']),
    }
    const url = `${baseEndpoint(ctx)}/videos/generations`
    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
    })
    // 1) 同步直接返回视频 url
    let videoUrls = extractMediaUrls(data, { kind: 'video' })
    let requestId: string | undefined
    let mode: 'sync' | 'async' = 'sync'
    let raw = data
    if (videoUrls.length === 0) {
      const taskId = extractTaskId(data)
      if (!taskId || !this.videoTaskPath) {
        throw new MediaProviderError('provider_http_error', `No video url or task id: ${JSON.stringify(data).slice(0, 800)}`)
      }
      requestId = taskId
      mode = 'async'
      const pollUrl = `${baseEndpoint(ctx)}${this.videoTaskPath(taskId)}`
      raw = await pollTask(pollUrl, authHeaders(ctx), {
        fetchImpl: ctx.fetch,
        intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
        timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 600_000,
        inspect: (d) => {
          const urls = extractMediaUrls(d, { kind: 'video' })
          if (urls.length > 0) return 'done'
          const s = extractStatus(d)
          return FAILED_STATUSES.includes(s) ? 'failed' : 'pending'
        },
      })
      videoUrls = extractMediaUrls(raw, { kind: 'video' })
    }
    if (videoUrls.length === 0) {
      throw new MediaProviderError('provider_http_error', `No video produced: ${JSON.stringify(raw).slice(0, 800)}`)
    }
    const assets = await Promise.all(
      videoUrls.map((u, i) =>
        this.artifact.downloadMediaAsset('video', u, input.outputDir, filename(input, 'video', i, videoUrls.length), ctx.fetch),
      ),
    )
    return {
      provider: this.id,
      model,
      mode,
      ...(requestId ? { requestId } : {}),
      assets,
      rawResponse: raw,
    }
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

function clampInt(value: unknown, fallback: number | undefined, def: number, min: number, max: number): number {
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  if (Number.isFinite(raw)) return Math.max(min, Math.min(max, raw))
  if (fallback != null) return Math.max(min, Math.min(max, fallback))
  return def
}

function filename(input: MediaGenerateInput, prefix: string, index: number, total: number): string {
  const fromParams = typeof input.modelParams?.filename === 'string' ? (input.modelParams.filename as string) : ''
  const suffix = total > 1 ? `_${String(index + 1).padStart(3, '0')}` : ''
  return `${fromParams || `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`}${suffix}`
}

/** 把 modelParams 中非保留键透传，排除黑名单内的（避免重复） */
function extraAllowed(
  extraParams: Record<string, unknown> | undefined,
  modelParams: Record<string, unknown> | undefined,
  blacklist: string[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(extraParams ?? {}) }
  for (const [key, value] of Object.entries(modelParams ?? {})) {
    if (!blacklist.includes(key) && !['filename', 'n', 'size'].includes(key) && typeof value !== 'object') {
      merged[key] = value
    }
  }
  return merged
}

function mimeFromFormat(format: string): string {
  const f = format.toLowerCase()
  if (f === 'mp3') return 'audio/mpeg'
  if (f === 'wav') return 'audio/wav'
  if (f === 'opus') return 'audio/opus'
  if (f === 'aac') return 'audio/aac'
  if (f === 'flac') return 'audio/flac'
  if (f === 'pcm') return 'audio/pcm'
  return 'audio/mpeg'
}

interface MultipartResult {
  body: Buffer
  contentType: string
}

/** 构造 multipart/form-data（用于 audio transcription 等文件上传场景） */
async function buildMultipart(
  fields: Record<string, string>,
  files: Array<{ field: string; filename: string; content: Buffer }>,
): Promise<MultipartResult> {
  const boundary = `----sparkmedia${Math.random().toString(16).slice(2)}`
  const parts: Buffer[] = []
  const sep = Buffer.from(`--${boundary}\r\n`)
  for (const [name, value] of Object.entries(fields)) {
    parts.push(sep)
    parts.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  for (const file of files) {
    parts.push(sep)
    parts.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
    )
    parts.push(file.content)
    parts.push(Buffer.from('\r\n'))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

export { clampInt, extraAllowed, filename as filenameHelper, mimeFromFormat, buildMultipart }
