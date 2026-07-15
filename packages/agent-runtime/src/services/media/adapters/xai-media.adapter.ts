/**
 * xAI (Grok) 多媒体 adapter。
 *
 * 见 https://docs.x.ai/developers/rest-api-reference/inference/images + /videos:
 *   - 图片生成：POST /images/generations（Imagine，默认 grok-imagine-image），仅 prompt。
 *   - 图片编辑/图生图：POST /images/edits，源图按 image（单图：{url|file_id}）
 *     或 images（多图：[{url|file_id}, ...]，最多 3 图）传入。url 可为公网 URL
 *     或 base64 data URI。响应结构与 /images/generations 一致（extractImages 可解析）。
 *   - 视频生成：POST /videos/generations → 返回 request_id → 轮询 GET /videos/{id}
 *   - 视频编辑：POST /videos/edits，输入 video 对象（{url}），prompt 描述修改。
 *     官方明确：编辑忽略 duration/aspect_ratio/resolution（输出继承输入视频，最长 8.7 秒，分辨率上限 720p）。
 *   - 视频扩展：POST /videos/extensions，输入 video 对象，从最后一帧续拍。
 *     duration 范围 [2,10] 秒。
 *   - 语音合成：POST /tts（不发送 model 字段）
 *
 * xAI 暂未公开通用语音转写（Whisper）端点，因此 capability 集不含 audio.transcription。
 *
 * 默认 endpoint: https://api.x.ai/v1
 */

import { OpenAiCompatibleMediaAdapter } from './openai-compatible-media.adapter.js'
import { MediaProviderError } from '../media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaProviderContext,
} from '../media-adapter.types.js'
import { extractImages, extractStatus, extractTaskId, fetchJson, pollTask } from '../media-http.util.js'
import type { ExtractedImage } from '../media-http.util.js'
import { FAILED_STATUSES } from './openai-compatible-media.adapter.js'
import { filenameHelper } from './openai-compatible-media.adapter.js'
import { logMediaCall, logMediaResult } from '../media-debug-log.js'
import { resolveXaiMediaReference, type XaiMediaReference } from '../xai-media-input.js'

export class XaiMediaAdapter extends OpenAiCompatibleMediaAdapter {
  constructor() {
    super({
      id: 'xai',
      capabilities: [
        'image.generate',
        'image.edit',
        'audio.speech',
        'video.generate',
        'video.image_to_video',
        'video.reference_to_video',
        'video.edit',
        'video.extend',
      ],
      videoTaskPath: (taskId) => `/videos/${encodeURIComponent(taskId)}`,
      genericTaskPath: (taskId) => `/videos/${encodeURIComponent(taskId)}`,
    })
  }

  protected override async generateImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const imageInputs = (input.inputFiles ?? []).filter((file) => file.type === 'image' || file.type === 'file')
    if (imageInputs.length > 0) return this.editImage(input, ctx)
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) throw new MediaProviderError('invalid_input', 'xAI image generation requires a prompt')
    const params = normalizeXaiImageParams(input.modelParams)
    const n = positiveInteger(params.n) ?? 1
    const body: Record<string, unknown> = {
      model: ctx.defaultModel,
      prompt,
      n,
      ...(stringParam(params.aspect_ratio) ? { aspect_ratio: stringParam(params.aspect_ratio) } : {}),
      ...(stringParam(params.resolution) ? { resolution: stringParam(params.resolution) } : {}),
      ...(xaiResponseFormat(params.response_format) ? { response_format: xaiResponseFormat(params.response_format) } : {}),
      storage_options: buildStorageOptions(input, xaiImageExtension(params)),
      ...(stringParam(params.user) ? { user: stringParam(params.user) } : {}),
    }
    return this.requestXaiImages('/images/generations', 'image.generate', input, ctx, body)
  }

  protected override async generateVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = input.capability ?? 'video.generate'
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) throw new MediaProviderError('invalid_input', `xAI ${capability} requires a prompt`)

    const model = ctx.defaultModel
    const isVideo15 = model.startsWith('grok-imagine-video-1.5')
    if (isVideo15 && capability !== 'video.image_to_video') {
      throw new MediaProviderError('invalid_input', `${model} 仅支持图生视频`)
    }
    if ((input.inputFiles ?? []).some((file) => file.type === 'video')) {
      throw new MediaProviderError('invalid_input', 'xAI 视频生成不支持参考视频输入')
    }
    if ((input.inputFiles ?? []).some((file) => file.role === 'last_frame')) {
      throw new MediaProviderError('invalid_input', 'xAI 视频生成不支持尾帧输入')
    }

    const images = (input.inputFiles ?? []).filter(
      (file) => file.type === 'image' || file.type === 'file',
    )
    const resolvedImages = await Promise.all(images.map(async (file) => ({
      file,
      reference: await resolveXaiMediaReference(file, 'image', ctx),
    })))
    const firstFrameEntry = resolvedImages.find(({ file }) => file.role === 'first_frame')
    const firstFrame = firstFrameEntry
      ? firstFrameEntry.reference
      : capability === 'video.image_to_video'
        ? resolvedImages[0]?.reference
        : undefined
    const explicitReferences = resolvedImages.filter(({ file }) => file.role === 'reference')
    const referenceRefs = (explicitReferences.length > 0 ? explicitReferences : resolvedImages)
      .map(({ reference }) => reference)

    if (capability === 'video.image_to_video' && !firstFrame) {
      throw new MediaProviderError('invalid_input', `xAI ${model} requires a first-frame image`)
    }
    if (capability === 'video.reference_to_video') {
      if (referenceRefs.length === 0) {
        throw new MediaProviderError('invalid_input', 'xAI reference-to-video requires reference images')
      }
      if (referenceRefs.length > 7) {
        throw new MediaProviderError('invalid_input', 'xAI reference-to-video supports at most 7 images')
      }
    }

    const params = input.modelParams ?? {}
    const duration = numericParam(params.durationSeconds ?? params.duration)
    const maxDuration = capability === 'video.reference_to_video' ? 10 : 15
    if (duration !== undefined && (duration < 1 || duration > maxDuration)) {
      throw new MediaProviderError(
        'invalid_input',
        `xAI ${capability} duration must be between 1 and ${maxDuration} seconds`,
      )
    }
    const aspectRatio = stringParam(params.aspectRatio ?? params.aspect_ratio)
      ?? ctx.mediaDefaults?.video?.aspectRatio
    const resolution = stringParam(params.resolution) ?? ctx.mediaDefaults?.video?.resolution
    if (resolution === '1080p' && !isVideo15) {
      throw new MediaProviderError('invalid_input', 'xAI 1080p video is only supported by Grok Imagine Video 1.5 I2V')
    }

    const body: Record<string, unknown> = {
      model,
      prompt,
      ...(capability === 'video.image_to_video' && firstFrame ? { image: firstFrame } : {}),
      ...(capability === 'video.reference_to_video'
        ? { reference_images: referenceRefs }
        : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
      storage_options: buildStorageOptions(input, 'mp4'),
      ...(stringParam(params.user) ? { user: stringParam(params.user) } : {}),
    }
    const url = `${baseEndpoint(ctx)}/videos/generations`
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120), inputImages: images.length },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const taskId = extractTaskId(data)
    if (!taskId) {
      throw new MediaProviderError('provider_http_error', `No xAI video request_id: ${JSON.stringify(data).slice(0, 800)}`)
    }
    const raw = await pollTask(`${baseEndpoint(ctx)}/videos/${encodeURIComponent(taskId)}`, authHeaders(ctx), {
      fetchImpl: ctx.fetch,
      intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
      timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 600_000,
      inspect: (response) => {
        if (extractXaiPublicVideoUrls(response).length > 0 || extractXaiPublicUrlError(response)) return 'done'
        return FAILED_STATUSES.includes(extractStatus(response)) ? 'failed' : 'pending'
      },
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const videoUrls = extractXaiPublicVideoUrls(raw)
    if (videoUrls.length === 0) {
      const publicUrlError = extractXaiPublicUrlError(raw)
      throw new MediaProviderError(
        'provider_http_error',
        `xAI 视频已生成但官方 CDN 持久化失败${publicUrlError ? `：${publicUrlError}` : ''}`,
      )
    }
    const assets = await Promise.all(
      videoUrls.map((videoUrl, index) =>
        this.artifact.downloadMediaAsset(
          'video',
          videoUrl,
          input.outputDir,
          filenameHelper(input, 'video', index, videoUrls.length),
          ctx.fetch,
        ),
      ),
    )
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: assets.length, requestId: taskId })
    return { provider: this.id, model, mode: 'async', requestId: taskId, assets, rawResponse: raw }
  }

  protected override async generateSpeech(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const text = (input.prompt ?? '').trim()
    if (!text) throw new MediaProviderError('invalid_input', 'xAI TTS requires text')
    if (text.length > 15_000) throw new MediaProviderError('invalid_input', 'xAI TTS text exceeds 15,000 characters')

    const params = input.modelParams ?? {}
    const outputFormat = normalizeTtsOutputFormat(params.outputFormat ?? params.output_format)
    const withTimestamps = params.withTimestamps === true || params.with_timestamps === true
    const body: Record<string, unknown> = {
      text,
      voice_id: stringParam(params.voiceId ?? params.voice_id) ?? 'eve',
      language: stringParam(params.language) ?? 'auto',
      output_format: outputFormat,
      ...(numericParam(params.speed) !== undefined ? { speed: numericParam(params.speed) } : {}),
      ...(typeof params.optimizeStreamingLatency === 'boolean'
        ? { optimize_streaming_latency: params.optimizeStreamingLatency }
        : typeof params.optimize_streaming_latency === 'boolean'
          ? { optimize_streaming_latency: params.optimize_streaming_latency }
          : {}),
      ...(typeof params.textNormalization === 'boolean'
        ? { text_normalization: params.textNormalization }
        : typeof params.text_normalization === 'boolean'
          ? { text_normalization: params.text_normalization }
          : {}),
      ...(withTimestamps ? { with_timestamps: true } : {}),
    }
    const url = `${baseEndpoint(ctx)}/tts`
    const response = await fetchJson<Buffer | { audio?: string; audio_timestamps?: unknown }>(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      ...(!withTimestamps ? { binary: true } : {}),
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const buffer = Buffer.isBuffer(response)
      ? response
      : typeof response.audio === 'string'
        ? Buffer.from(response.audio, 'base64')
        : null
    if (!buffer) throw new MediaProviderError('provider_http_error', 'xAI TTS response did not contain audio')
    const codec = stringParam(outputFormat.codec) ?? 'mp3'
    const asset = await this.artifact.writeBinaryAsset(
      'audio',
      buffer,
      input.outputDir,
      filenameHelper(input, 'audio', 0, 1),
      mimeFromTtsCodec(codec),
    )
    return {
      provider: this.id,
      model: ctx.defaultModel,
      mode: 'sync',
      assets: [asset],
      rawResponse: Buffer.isBuffer(response)
        ? { bytes: response.length }
        : { bytes: buffer.length, audio_timestamps: response.audio_timestamps },
    }
  }

  protected override async editImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    // 参考图取值复用 mediaInputRef（与视频路径 generateVideo 一致）：
    // safe-file:// 本地协议地址第三方 API 无法访问，必须过滤；优先 base64 dataUrl。
    const imageFiles = (input.inputFiles ?? []).filter((file) => file.type === 'image' || file.type === 'file')
    if (imageFiles.length === 0) {
      throw new MediaProviderError('invalid_input', 'xAI image edit requires input image(s)')
    }
    if (imageFiles.length > 3) throw new MediaProviderError('invalid_input', 'xAI image edit supports at most 3 images')
    const imageRefs = await Promise.all(imageFiles.map((file) => resolveXaiMediaReference(file, 'image', ctx)))
    const model = ctx.defaultModel
    const params = normalizeXaiImageParams(input.modelParams)
    // xAI 图片编辑走 POST /images/edits（不是 /images/generations）：
    // 源图按 image（单图）或 images（多图，最多 3 图）传入，值为 {url, type:"image_url"} 对象。
    // url 可为公网 URL 或 base64 data URI。发错端点或字符串字段会被 xAI 静默忽略 → 产物与参考图无关。
    // 见 https://docs.x.ai/developers/rest-api-reference/inference/images 的 Image edit 一节。
    const imageObjects = imageRefs
    const body: Record<string, unknown> = {
      model,
      prompt,
      ...(imageObjects.length === 1
        ? { image: imageObjects[0] }
        : { images: imageObjects }),
      ...(stringParam(params.aspect_ratio) ? { aspect_ratio: stringParam(params.aspect_ratio) } : {}),
      ...(stringParam(params.resolution) ? { resolution: stringParam(params.resolution) } : {}),
      ...(xaiResponseFormat(params.response_format) ? { response_format: xaiResponseFormat(params.response_format) } : {}),
      storage_options: buildStorageOptions(input, xaiImageExtension(params)),
      ...(stringParam(params.user) ? { user: stringParam(params.user) } : {}),
    }
    return this.requestXaiImages('/images/edits', 'image.edit', input, ctx, body)
  }

  /**
   * 视频编辑 / 视频扩展。按 capability 分流到 xAI 独立端点：
   *   - video.edit   → POST /videos/edits（输入 video 对象，忽略 duration/aspect_ratio/resolution）
   *   - video.extend → POST /videos/extensions（duration 范围 [2,10]，默认 6）
   * 两者都返回 request_id，复用 GET /videos/{id} 轮询（与 generate 同一查询端点）。
   * 见 https://docs.x.ai/developers/model-capabilities/video/editing 与 .../extension。
   */
  protected override async editVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = input.capability ?? 'video.edit'
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) {
      throw new MediaProviderError('invalid_input', `xAI ${capability} requires a prompt`)
    }
    const inputVideoFile = (input.inputFiles ?? []).find(
      (file) => file.type === 'video' || (file.type === 'file' && file.role === 'input'),
    )
    const videoRef = inputVideoFile ? await resolveXaiMediaReference(inputVideoFile, 'video', ctx) : undefined
    if (!videoRef) {
      throw new MediaProviderError('invalid_input', `xAI ${capability} requires an input video`)
    }
    const model = ctx.defaultModel
    const isExtend = capability === 'video.extend'
    const endpoint = isExtend ? '/videos/extensions' : '/videos/edits'
    // 编辑端点：官方明确输出继承输入视频（duration/aspect_ratio/resolution 被忽略），仅传 video + prompt。
    // 扩展端点：额外支持 duration [2,10] 默认 6（视频编辑不支持 duration，故不透传）。
    const body: Record<string, unknown> = {
      model,
      prompt,
      video: videoRef,
      storage_options: buildStorageOptions(input, 'mp4'),
    }
    if (isExtend) {
      const duration = numericParam(input.modelParams?.durationSeconds) ?? 6
      if (!Number.isInteger(duration) || duration < 2 || duration > 10) {
        throw new MediaProviderError('invalid_input', 'xAI video extension duration must be between 2 and 10 seconds')
      }
      body.duration = duration
    }
    const url = `${baseEndpoint(ctx)}${endpoint}`
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120), inputVideo: JSON.stringify(videoRef).slice(0, 80) },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    // 同步直出视频 url（少数情况），否则取 request_id 轮询。
    let videoUrls = extractXaiPublicVideoUrls(data)
    let requestId: string | undefined
    let mode: 'sync' | 'async' = 'sync'
    let raw = data
    if (videoUrls.length === 0) {
      const taskId = extractTaskId(data)
      if (!taskId) {
        logMediaResult({ provider: this.id, capability, ok: false, error: 'No video url or task id' })
        throw new MediaProviderError('provider_http_error', `No video url or task id: ${JSON.stringify(data).slice(0, 800)}`)
      }
      requestId = taskId
      mode = 'async'
      const pollUrl = `${baseEndpoint(ctx)}/videos/${encodeURIComponent(taskId)}`
      raw = await pollTask(pollUrl, authHeaders(ctx), {
        fetchImpl: ctx.fetch,
        intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
        timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 600_000,
        inspect: (d) => {
          const urls = extractXaiPublicVideoUrls(d)
          if (urls.length > 0) return 'done'
          const s = extractStatus(d)
          return FAILED_STATUSES.includes(s) ? 'failed' : 'pending'
        },
        ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
      })
      videoUrls = extractXaiPublicVideoUrls(raw)
    }
    if (videoUrls.length === 0) {
      logMediaResult({ provider: this.id, capability, ok: false, error: 'No video produced' })
      const publicUrlError = extractXaiPublicUrlError(raw)
      throw new MediaProviderError('provider_http_error', `xAI 视频已生成但官方 CDN 持久化失败${publicUrlError ? `：${publicUrlError}` : ''}`)
    }
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: videoUrls.length, requestId })
    const assets = await Promise.all(
      videoUrls.map((u, i) =>
        this.artifact.downloadMediaAsset('video', u, input.outputDir, filenameHelper(input, isExtend ? 'extend' : 'edit', i, videoUrls.length), ctx.fetch),
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

  private async requestXaiImages(
    endpoint: '/images/generations' | '/images/edits',
    capability: 'image.generate' | 'image.edit',
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
    body: Record<string, unknown>,
  ): Promise<MediaGenerateOutput> {
    const url = `${baseEndpoint(ctx)}${endpoint}`
    logMediaCall({ provider: this.id, capability, model: ctx.defaultModel, method: 'POST', url, body })
    const data = await fetchJson(url, {
      method: 'POST', headers: authHeaders(ctx), body: JSON.stringify(body), fetchImpl: ctx.fetch, timeoutMs: 120_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const images = extractXaiImages(data)
    if (images.length === 0) {
      throw new MediaProviderError('provider_http_error', `No images in xAI response: ${JSON.stringify(data).slice(0, 800)}`)
    }
    const warnings: string[] = []
    const assets = await Promise.all(images.map(async (image, index) => {
      const asset = await this.artifact.writeImage(
        image.extracted,
        input.outputDir,
        filenameHelper(input, capability === 'image.edit' ? 'edit' : 'image', index, images.length),
        ctx.fetch,
      )
      if (image.publicUrl) return { ...asset, url: image.publicUrl }
      if (ctx.fallbackUploader?.canHandle('xai') && asset.filePath) {
        try {
          const uploaded = await ctx.fallbackUploader.upload({
            buffer: await this.artifact.readLocalFile(asset.filePath),
            filename: filenameHelper(input, capability === 'image.edit' ? 'edit' : 'image', index, images.length),
            ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
          })
          const publicUrl = uploaded.publicUrl ?? uploaded.url
          if (publicUrl) return { ...asset, url: publicUrl }
        } catch (error) {
          warnings.push(`xAI 图片官方 CDN 创建失败，Spark 平台公开地址回退也失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      warnings.push('xAI 图片官方 CDN 未返回 public_url，已保留本地产物。')
      return asset
    }))
    return {
      provider: this.id,
      model: ctx.defaultModel,
      mode: 'sync',
      assets,
      rawResponse: data,
      ...(warnings.length > 0
        ? { contractWarnings: warnings.map((message) => ({ code: 'compat_passthrough' as const, message })) }
        : {}),
    }
  }
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

function normalizeXaiImageParams(modelParams: Record<string, unknown> | undefined): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(modelParams ?? {})) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    next[key] = value
  }
  if (next.aspect_ratio == null && next.aspectRatio != null) next.aspect_ratio = next.aspectRatio
  if (next.aspect_ratio == null && typeof next.size === 'string' && /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(next.size)) {
    next.aspect_ratio = next.size
  }
  if (next.response_format == null) {
    if (next.responseFormat != null) next.response_format = next.responseFormat
    if (next.output_format === 'url' || next.output_format === 'b64_json') next.response_format = next.output_format
    if (next.outputFormat === 'url' || next.outputFormat === 'b64_json') next.response_format = next.outputFormat
  }
  if (next.image_format == null) {
    if (next.output_format != null && next.output_format !== 'url' && next.output_format !== 'b64_json') next.image_format = next.output_format
    if (next.outputFormat != null && next.outputFormat !== 'url' && next.outputFormat !== 'b64_json') next.image_format = next.outputFormat
  }
  delete next.aspectRatio
  delete next.responseFormat
  delete next.outputFormat
  delete next.output_format
  delete next.size
  return next
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numericParam(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function buildStorageOptions(input: MediaGenerateInput, extension: string): Record<string, unknown> {
  const configured = stringParam(input.modelParams?.filename)
  return {
    filename: configured ?? `spark-${Date.now()}.${extension}`,
    public_url: true,
  }
}

function extractXaiPublicVideoUrls(value: unknown): string[] {
  return extractXaiFileOutputStrings(value, 'public_url').filter((url) => /^https?:\/\//i.test(url))
}

function extractXaiPublicUrlError(value: unknown): string | undefined {
  return extractXaiFileOutputStrings(value, 'public_url_error')[0]
}

function extractXaiFileOutputStrings(value: unknown, key: 'public_url' | 'public_url_error'): string[] {
  const found: string[] = []
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    const direct = record[key]
    if (typeof direct === 'string' && direct.trim()) found.push(direct)
    const fileOutput = record.file_output
    if (fileOutput && typeof fileOutput === 'object') {
      const nested = (fileOutput as Record<string, unknown>)[key]
      if (typeof nested === 'string' && nested.trim()) found.push(nested)
    }
    Object.values(record).forEach(visit)
  }
  visit(value)
  return [...new Set(found)]
}

function extractXaiImages(value: unknown): Array<{
  extracted: ExtractedImage
  publicUrl?: string
}> {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const items = Array.isArray(root.data) ? root.data : [value]
  const results: Array<{ extracted: ExtractedImage; publicUrl?: string }> = []
  for (const item of items) {
    const publicUrl = extractXaiFileOutputStrings(item, 'public_url')[0]
    if (publicUrl && /^https?:\/\//i.test(publicUrl)) {
      results.push({ extracted: { kind: 'url', value: publicUrl }, publicUrl })
      continue
    }
    const extracted = extractImages(item)[0]
    if (extracted) results.push({ extracted })
  }
  return results
}

function normalizeTtsOutputFormat(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = value as Record<string, unknown>
    return {
      ...(stringParam(source.codec) ? { codec: stringParam(source.codec) } : { codec: 'mp3' }),
      ...(numericParam(source.sample_rate) !== undefined ? { sample_rate: numericParam(source.sample_rate) } : {}),
      ...(numericParam(source.bit_rate) !== undefined ? { bit_rate: numericParam(source.bit_rate) } : {}),
    }
  }
  return { codec: stringParam(value) ?? 'mp3' }
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = numericParam(value)
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function xaiResponseFormat(value: unknown): 'url' | 'b64_json' | undefined {
  return value === 'url' || value === 'b64_json' ? value : undefined
}

function xaiImageExtension(params: Record<string, unknown>): string {
  const format = stringParam(params.image_format)
  return format === 'jpeg' || format === 'jpg' ? 'jpg' : format === 'webp' ? 'webp' : 'png'
}

function mimeFromTtsCodec(codec: string): string {
  const normalized = codec.toLowerCase()
  if (normalized === 'wav' || normalized === 'pcm') return `audio/${normalized}`
  if (normalized === 'opus') return 'audio/opus'
  if (normalized === 'flac') return 'audio/flac'
  return 'audio/mpeg'
}
