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

import { capabilityForOperation } from '@spark/protocol'
import type {
  MediaCapabilityId,
  MediaModelCapabilityManifest,
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
import { logMediaCall, logMediaResult } from '../media-debug-log.js'
import { apimartNativeModelId, buildApimartVideoInputFields } from './apimart-video-input.js'

export interface OpenAiCompatibleAdapterOptions {
  id: MediaProviderKind
  /** 该 adapter 声明支持的能力 */
  capabilities: MediaCapabilityId[]
  /** 异步视频任务状态查询 path 模板，{id} 占位 */
  videoTaskPath?: ((taskId: string) => string) | undefined
  /** 通用异步任务状态查询 path 模板（图片/通用） */
  genericTaskPath?: ((taskId: string) => string) | undefined
}

/** 终态状态集合（异步轮询判定失败用），子类（如 xAI editVideo）复用。 */
export const FAILED_STATUSES = ['failed', 'error', 'expired', 'cancelled', 'canceled']
const SUCCEEDED_STATUSES = ['completed', 'succeeded', 'success', 'done']

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
      throw new MediaProviderError(
        'capability_not_supported',
        'No capability resolved for media invoke',
      )
    }
    if (!this.supports(capability)) {
      throw new MediaProviderError(
        'capability_not_supported',
        `${this.id} does not support ${capability}`,
      )
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
      case 'video.reference_to_video':
        return this.generateVideo(input, ctx)
      case 'video.edit':
      case 'video.extend':
        return this.editVideo(input, ctx)
      default:
        throw new MediaProviderError(
          'capability_not_supported',
          `Unsupported capability: ${capability}`,
        )
    }
  }

  // ── image.generate ──────────────────────────────────────────────────────
  protected async generateImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    // 「文生图」类操作（panorama_360 / text_to_image）经 capabilityForOperation 映射到
    // image.generate，但生成端点本身只发 prompt。若节点接了上游参考图（画布连线），
    // 必须把图带给模型，否则参考图被静默丢弃、产物与参考图无关。
    // 这里复用各 provider 已实现的「图生图」路径（editImage 重写为 image_url(s)），
    // role 一律忽略（画布默认按视频帧语义给单图打 first_frame，对图片生成无意义）。
    const hasReferenceImage = (input.inputFiles ?? []).some(
      (file) => file.type === 'image' || file.type === 'file',
    )
    if (hasReferenceImage) return this.editImage(input, ctx)
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) throw new MediaProviderError('invalid_input', 'prompt is required')
    const model = ctx.defaultModel
    const defaults = ctx.mediaDefaults?.image
    const imageParams = buildImageRequestParams(
      input.modelParams,
      defaults,
      ctx.mediaProvider,
      model,
    )
    const body: Record<string, unknown> = {
      model,
      prompt,
      n: imageParams.n,
      ...(imageParams.size ? { size: imageParams.size } : {}),
      ...(imageParams.aspect_ratio ? { aspect_ratio: imageParams.aspect_ratio } : {}),
      ...(imageParams.quality ? { quality: imageParams.quality } : {}),
      ...(imageParams.resolution ? { resolution: imageParams.resolution } : {}),
      ...(imageParams.response_format ? { response_format: imageParams.response_format } : {}),
      ...(imageParams.output_format ? { output_format: imageParams.output_format } : {}),
      ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      ...extraAllowed(
        ctx.extraParams,
        normalizeImageAliasParams(input.modelParams),
        [
          'size',
          'n',
          'quality',
          'resolution',
          'output_format',
          'response_format',
          'aspect_ratio',
          ...(ctx.mediaProvider === 'xai' ? ['aspectRatio'] : ['aspectRatio', 'aspect_ratio']),
        ],
        ctx.mediaManifestCapability,
      ),
    }
    const url = `${baseEndpoint(ctx)}/images/generations`
    logMediaCall({
      provider: this.id,
      capability: 'image.generate',
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120) },
    })
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
    if (images.length === 0 && isAsync(ctx)) {
      const taskId = extractTaskId(data)
      if (taskId && (this.genericTaskPath || this.videoTaskPath)) {
        requestId = taskId
        mode = 'async'
        ctx.onTaskSubmitted?.({ requestId: taskId, response: data })
        const pollUrl = `${baseEndpoint(ctx)}${(this.genericTaskPath ?? this.videoTaskPath)!(taskId)}`
        const polled = await pollTask(pollUrl, authHeaders(ctx), {
          fetchImpl: ctx.fetch,
          intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 4_000,
          timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 600_000,
          inspect: (d) => {
            const imgs = extractImages(d)
            if (imgs.length > 0) return 'done'
            const s = extractStatus(d)
            return FAILED_STATUSES.includes(s) ? 'failed' : 'pending'
          },
          ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
        })
        images = extractImages(polled)
      }
    }
    if (images.length === 0) {
      logMediaResult({
        provider: this.id,
        capability: 'image.generate',
        ok: false,
        error: 'No images in response',
      })
      throw new MediaProviderError(
        'provider_http_error',
        `No images in response: ${JSON.stringify(data).slice(0, 800)}`,
      )
    }
    logMediaResult({
      provider: this.id,
      capability: 'image.generate',
      ok: true,
      assetCount: images.length,
      requestId,
    })
    const assets = await Promise.all(
      images.map((image, i) =>
        this.artifact.writeImage(
          image,
          input.outputDir,
          filename(input, 'img', i, images.length),
          ctx.fetch,
        ),
      ),
    )
    return {
      provider: this.id,
      model,
      mode,
      ...(requestId ? { requestId } : {}),
      assets,
      rawResponse: data,
    }
  }

  // ── image.edit / image.variations ───────────────────────────────────────
  protected async editImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    const inputs = input.inputFiles ?? []
    if (inputs.length === 0 && !prompt) {
      throw new MediaProviderError('invalid_input', 'image edit requires input image(s) or prompt')
    }
    const model = ctx.defaultModel
    const defaults = ctx.mediaDefaults?.image
    const imageParams = buildImageRequestParams(
      input.modelParams,
      defaults,
      ctx.mediaProvider,
      model,
    )
    const imageRefs = inputs
      .filter((file) => file.type === 'image' || file.type === 'file')
      .map((file) => mediaInputRef(file, ctx.mediaProvider) ?? '')
      .filter((ref) => ref.length > 0)
    const body: Record<string, unknown> = {
      model,
      prompt,
      ...(imageRefs.length > 0 ? { image: imageRefs[0] } : {}),
      ...(imageRefs.length > 1 ? { image_url: imageRefs } : {}),
      n: imageParams.n,
      ...(imageParams.size ? { size: imageParams.size } : {}),
      ...(imageParams.aspect_ratio ? { aspect_ratio: imageParams.aspect_ratio } : {}),
      ...(imageParams.quality ? { quality: imageParams.quality } : {}),
      ...(imageParams.resolution ? { resolution: imageParams.resolution } : {}),
      ...(imageParams.response_format ? { response_format: imageParams.response_format } : {}),
      ...(imageParams.output_format ? { output_format: imageParams.output_format } : {}),
      ...extraAllowed(
        ctx.extraParams,
        normalizeImageAliasParams(input.modelParams),
        [
          'size',
          'n',
          'quality',
          'resolution',
          'output_format',
          'response_format',
          'aspect_ratio',
          'mask',
          ...(ctx.mediaProvider === 'xai' ? ['aspectRatio'] : ['aspectRatio', 'aspect_ratio']),
        ],
        ctx.mediaManifestCapability,
      ),
    }
    const url = `${baseEndpoint(ctx)}/images/edits`
    logMediaCall({
      provider: this.id,
      capability: 'image.edit',
      model,
      method: 'POST',
      url,
      body,
      extra: {
        prompt: prompt.slice(0, 120),
        inputImages: imageRefs.length,
      },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const images = extractImages(data)
    if (images.length === 0) {
      logMediaResult({
        provider: this.id,
        capability: 'image.edit',
        ok: false,
        error: 'No images in edit response',
      })
      throw new MediaProviderError(
        'provider_http_error',
        `No images in edit response: ${JSON.stringify(data).slice(0, 800)}`,
      )
    }
    logMediaResult({
      provider: this.id,
      capability: 'image.edit',
      ok: true,
      assetCount: images.length,
    })
    const assets = await Promise.all(
      images.map((image, i) =>
        this.artifact.writeImage(
          image,
          input.outputDir,
          filename(input, 'edit', i, images.length),
          ctx.fetch,
        ),
      ),
    )
    return { provider: this.id, model, mode: 'sync', assets, rawResponse: data }
  }

  // ── audio.speech (TTS) ──────────────────────────────────────────────────
  protected async generateSpeech(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
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
      ...extraAllowed(
        ctx.extraParams,
        input.modelParams,
        ['voice', 'response_format', 'speed', 'input'],
        ctx.mediaManifestCapability,
      ),
    }
    const url = `${baseEndpoint(ctx)}/audio/speech`
    logMediaCall({
      provider: this.id,
      capability: 'audio.speech',
      model,
      method: 'POST',
      url,
      body,
      extra: { text: text.slice(0, 120), voice: body.voice },
    })
    const buffer = await fetchJson<Buffer>(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      binary: true,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    logMediaResult({ provider: this.id, capability: 'audio.speech', ok: true, assetCount: 1 })
    const mimeType = mimeFromFormat((body.response_format as string) ?? 'mp3')
    const asset = await this.artifact.writeBinaryAsset(
      'audio',
      buffer,
      input.outputDir,
      filename(input, 'audio', 0, 1),
      mimeType,
    )
    return {
      provider: this.id,
      model,
      mode: 'sync',
      assets: [asset],
      rawResponse: { bytes: buffer.length },
    }
  }

  // ── audio.transcription ─────────────────────────────────────────────────
  protected async transcribe(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const file = (input.inputFiles ?? []).find((f) => f.type === 'audio' || f.type === 'file')
    if (!file)
      throw new MediaProviderError('invalid_input', 'transcription requires an audio input file')
    const model = ctx.defaultModel
    const url = `${baseEndpoint(ctx)}/audio/transcriptions`
    // 先支持 url / dataUrl 模式（OpenAI compatible 部分聚合平台支持 JSON body 传 url）
    if (file.url) {
      const body: Record<string, unknown> = {
        model,
        url: file.url,
        ...(ctx.mediaDefaults?.audio?.language
          ? { language: ctx.mediaDefaults.audio.language }
          : {}),
        ...extraAllowed(
          ctx.extraParams,
          input.modelParams,
          ['language', 'response_format', 'prompt', 'url'],
          ctx.mediaManifestCapability,
        ),
      }
      logMediaCall({
        provider: this.id,
        capability: 'audio.transcription',
        model,
        method: 'POST',
        url,
        body,
        extra: { source: 'url', url: file.url.slice(0, 80) },
      })
      const data = await fetchJson(url, {
        method: 'POST',
        headers: authHeaders(ctx),
        body: JSON.stringify(body),
        fetchImpl: ctx.fetch,
        timeoutMs: 120_000,
        ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
      })
      return this.materializeTranscription(data, input, model)
    }
    // 本地文件：multipart/form-data
    const buffer = file.dataUrl
      ? Buffer.from(file.dataUrl.split(',')[1] ?? '', 'base64')
      : file.path
        ? await this.artifact.readLocalFile(file.path)
        : null
    if (!buffer)
      throw new MediaProviderError('invalid_input', 'transcription input must be url/dataUrl/path')
    const form = await buildMultipart(
      {
        model,
        ...(ctx.mediaDefaults?.audio?.language
          ? { language: ctx.mediaDefaults.audio.language }
          : {}),
      },
      [{ field: 'file', filename: 'audio.dat', content: buffer }],
    )
    logMediaCall({
      provider: this.id,
      capability: 'audio.transcription',
      model,
      method: 'POST',
      url,
      body: {
        model,
        language: ctx.mediaDefaults?.audio?.language,
        file: `[multipart ${buffer.length} bytes]`,
      },
      extra: { source: file.dataUrl ? 'dataUrl' : 'path', bytes: buffer.length },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.apiKey}`, 'content-type': form.contentType },
      body: form.body,
      fetchImpl: ctx.fetch,
      timeoutMs: 120_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    return this.materializeTranscription(data, input, model)
  }

  private async materializeTranscription(
    data: unknown,
    input: MediaGenerateInput,
    model: string,
  ): Promise<MediaGenerateOutput> {
    const text = extractText(data) ?? ''
    const asset = await this.artifact.writeTextAsset(
      text,
      input.outputDir,
      filename(input, 'transcript', 0, 1),
    )
    return { provider: this.id, model, mode: 'sync', assets: [asset], rawResponse: data }
  }

  // ── video.edit / video.extend ───────────────────────────────────────────
  /**
   * 视频编辑 / 视频扩展。默认实现回落到 generateVideo：多数 OpenAI 兼容聚合平台
   * （APIMart 等）的 video.edit 复用 /videos/generations 端点（带 video 字段）。
   * 需要独立编辑/扩展端点的 provider（如 xAI 走 /videos/edits、/videos/extensions）
   * 在子类重写此方法。
   */
  protected async editVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    return this.generateVideo(input, ctx)
  }

  // ── video.generate / video.image_to_video ───────────────────────────────
  protected async generateVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability =
      input.capability ?? capabilityForOperation(input.operation)[0] ?? 'video.generate'
    const prompt = (input.prompt ?? '').trim()
    if (!prompt && capability === 'video.generate') {
      throw new MediaProviderError('invalid_input', 'prompt is required for video generation')
    }
    const model = ctx.defaultModel
    const videoDefaults = ctx.mediaDefaults?.video
    const inputFiles = input.inputFiles ?? []
    const imageFiles = inputFiles.filter(
      (f) =>
        f.type === 'image' ||
        (f.type === 'file' && (!f.mimeType || f.mimeType.toLowerCase().startsWith('image/'))),
    )
    const firstImage =
      imageFiles.find((f) => f.role === 'first_frame') ??
      (capability === 'video.image_to_video'
        ? imageFiles.find((f) => f.role !== 'last_frame' && f.role !== 'reference')
        : undefined)
    const lastImage =
      imageFiles.find((f) => f.role === 'last_frame') ??
      (capability === 'video.image_to_video'
        ? imageFiles.find((file) => file !== firstImage && file.role == null)
        : undefined)
    const explicitReferenceImages = imageFiles.filter((f) => f.role === 'reference')
    const unassignedFrameReferences =
      capability === 'video.image_to_video'
        ? imageFiles.filter(
            (file) => file.role == null && file !== firstImage && file !== lastImage,
          )
        : []
    const referenceImages =
      capability === 'video.reference_to_video' && explicitReferenceImages.length === 0
        ? imageFiles
        : [...explicitReferenceImages, ...unassignedFrameReferences]
    const videoFiles = inputFiles.filter(
      (f) =>
        f.type === 'video' || (f.type === 'file' && f.mimeType?.toLowerCase().startsWith('video/')),
    )
    const inputVideo =
      videoFiles.find((f) => f.role === 'input') ??
      (capability === 'video.edit' || capability === 'video.extend' ? videoFiles[0] : undefined)
    const explicitReferenceVideos = videoFiles.filter((f) => f.role === 'reference')
    const referenceVideos =
      capability === 'video.reference_to_video' && explicitReferenceVideos.length === 0
        ? videoFiles
        : explicitReferenceVideos
    const explicitReferenceAudios = inputFiles.filter(
      (f) =>
        (f.type === 'audio' ||
          (f.type === 'file' && f.mimeType?.toLowerCase().startsWith('audio/'))) &&
        f.role === 'reference',
    )
    const referenceAudios =
      capability === 'video.reference_to_video' && explicitReferenceAudios.length === 0
        ? inputFiles.filter(
            (f) =>
              f.type === 'audio' ||
              (f.type === 'file' && f.mimeType?.toLowerCase().startsWith('audio/')),
          )
        : explicitReferenceAudios
    const firstImageRef = firstImage ? mediaInputRef(firstImage, ctx.mediaProvider) : undefined
    const lastImageRef = lastImage ? mediaInputRef(lastImage, ctx.mediaProvider) : undefined
    const referenceImageRefs = referenceImages
      .map((file) => mediaInputRef(file, ctx.mediaProvider))
      .filter((ref): ref is string => Boolean(ref))
    const inputVideoRef = inputVideo ? mediaInputRef(inputVideo, ctx.mediaProvider) : undefined
    const referenceVideoRefs = referenceVideos
      .map((file) => mediaInputRef(file, ctx.mediaProvider))
      .filter((ref): ref is string => Boolean(ref))
    const referenceAudioRefs = referenceAudios
      .map((file) => mediaInputRef(file, ctx.mediaProvider))
      .filter((ref): ref is string => Boolean(ref))
    const isApimart = ctx.mediaProvider === 'apimart'
    const aspectRatio =
      input.modelParams?.aspectRatio ??
      input.modelParams?.aspect_ratio ??
      input.modelParams?.size ??
      videoDefaults?.aspectRatio
    const aspectRatioField = ctx.mediaManifestCapability?.aliases?.aspectRatio ?? 'aspect_ratio'
    const duration =
      input.modelParams?.durationSeconds ??
      input.modelParams?.duration ??
      videoDefaults?.durationSeconds
    const providerVideoInputFields = isApimart
      ? buildApimartVideoInputFields({
          modelId: model,
          capability,
          firstFrame: firstImageRef,
          lastFrame: lastImageRef,
          inputVideo: inputVideoRef,
          referenceImages: referenceImageRefs,
          referenceVideos: referenceVideoRefs,
          referenceAudios: referenceAudioRefs,
        })
      : {
          ...(firstImageRef
            ? ctx.mediaProvider === 'xai'
              ? { image: { url: firstImageRef } }
              : { image: firstImageRef, first_frame_image: firstImageRef }
            : {}),
          ...(lastImageRef ? { last_frame_image: lastImageRef } : {}),
          ...(referenceImageRefs.length > 0
            ? { reference_images: referenceImageRefs.map((url) => ({ url })) }
            : {}),
          ...(inputVideoRef ? { video: inputVideoRef, video_url: inputVideoRef } : {}),
        }
    const nativeModel = isApimart ? apimartNativeModelId(model) : model
    const hasImageInput = Boolean(firstImageRef || lastImageRef || referenceImageRefs.length > 0)
    const hasVideoInput = Boolean(inputVideoRef || referenceVideoRefs.length > 0)
    const sendAspectRatio =
      aspectRatio != null &&
      (!isApimart || shouldSendApimartAspectRatio(model, capability, hasImageInput, hasVideoInput))
    const sendDuration =
      duration != null &&
      (!isApimart ||
        !(
          model === 'Omni-Flash-Ext' &&
          capability === 'video.reference_to_video' &&
          referenceVideoRefs.length > 0
        ))
    const passthroughParams = extraAllowed(
      ctx.extraParams,
      input.modelParams,
      [
        'aspectRatio',
        'aspect_ratio',
        'duration',
        'durationSeconds',
        'editStrength',
        'edit_strength',
        'fps',
        'image',
        'image_url',
        'image_urls',
        'first_frame_image',
        'last_frame_image',
        'quality',
        'reference_images',
        'resolution',
        'seed',
        'video',
        'video_url',
        'prompt',
      ],
      ctx.mediaManifestCapability,
    )
    const body: Record<string, unknown> = {
      model: nativeModel,
      ...(prompt ? { prompt } : {}),
      ...(sendAspectRatio ? { [aspectRatioField]: aspectRatio } : {}),
      ...(sendDuration ? { duration } : {}),
      ...(videoDefaults?.quality || input.modelParams?.quality
        ? { quality: input.modelParams?.quality ?? videoDefaults?.quality }
        : {}),
      ...(videoDefaults?.fps != null || input.modelParams?.fps != null
        ? { fps: input.modelParams?.fps ?? videoDefaults?.fps }
        : {}),
      ...(videoDefaults?.resolution || input.modelParams?.resolution
        ? { resolution: input.modelParams?.resolution ?? videoDefaults?.resolution }
        : {}),
      ...(input.modelParams?.seed != null ? { seed: input.modelParams.seed } : {}),
      ...(input.modelParams?.editStrength != null
        ? { edit_strength: input.modelParams.editStrength }
        : {}),
      ...passthroughParams,
      ...providerVideoInputFields,
    }
    const url = `${baseEndpoint(ctx)}/videos/generations`
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url,
      body,
      extra: {
        prompt: prompt.slice(0, 120),
        firstImage: firstImage ? 'yes' : 'none',
      },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    // 1) 同步直接返回视频 url
    let videoUrls = extractMediaUrls(data, { kind: 'video' })
    let requestId: string | undefined
    let mode: 'sync' | 'async' = 'sync'
    let raw = data
    if (videoUrls.length === 0) {
      const taskId = extractTaskId(data)
      if (!taskId || !this.videoTaskPath) {
        logMediaResult({
          provider: this.id,
          capability,
          ok: false,
          error: 'No video url or task id',
        })
        throw new MediaProviderError(
          'provider_http_error',
          `No video url or task id: ${JSON.stringify(data).slice(0, 800)}`,
        )
      }
      requestId = taskId
      mode = 'async'
      ctx.onTaskSubmitted?.({ requestId: taskId, response: data })
      const pollUrl = `${baseEndpoint(ctx)}${this.videoTaskPath(taskId)}`
      raw = await pollTask(pollUrl, authHeaders(ctx), {
        fetchImpl: ctx.fetch,
        intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
        timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 1_800_000,
        logContext: `provider=${this.id} capability=${capability} requestId=${taskId}`,
        inspect: (d) => {
          const urls = extractMediaUrls(d, { kind: 'video' })
          if (urls.length > 0) return 'done'
          const s = extractStatus(d)
          if (SUCCEEDED_STATUSES.includes(s)) return 'done'
          return FAILED_STATUSES.includes(s) ? 'failed' : 'pending'
        },
        describeResponse: (d) => ({
          status: extractStatus(d) || undefined,
          videoUrls: extractMediaUrls(d, { kind: 'video' }).length,
        }),
        ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
      })
      videoUrls = extractMediaUrls(raw, { kind: 'video' })
    }
    if (videoUrls.length === 0) {
      logMediaResult({ provider: this.id, capability, ok: false, error: 'No video produced' })
      throw new MediaProviderError(
        'provider_http_error',
        `No video produced: ${JSON.stringify(raw).slice(0, 800)}`,
      )
    }
    logMediaResult({
      provider: this.id,
      capability,
      ok: true,
      assetCount: videoUrls.length,
      requestId,
    })
    const assets = await Promise.all(
      videoUrls.map((u, i) =>
        this.artifact.downloadMediaAsset(
          'video',
          u,
          input.outputDir,
          filename(input, 'video', i, videoUrls.length),
          ctx.fetch,
        ),
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

/**
 * 把 MediaInputFile 解析成可发往第三方 provider 的引用字符串。
 *
 * safe-file:// 是渲染进程的本地协议地址，第三方 API 无法访问，绝不能原样传出。
 * 统一解析顺序（与 template-media.adapter.ts 的 resolveRef 一致）：
 *   1) 公网 http(s) URL —— 直接用
 *   2) base64 dataUrl —— 直接用（项目「优先 base64」原则）
 *   3) 其它非 safe-file 的 url（如放到 url 字段里的 data: dataUrl）—— 用
 *   4) 本地磁盘 path —— 兜底
 *
 * 该顺序对所有 provider 一致；xAI 的 image.edit / image_to_video、以及 OpenAI 兼容
 * provider 的 image.edit 都经过这里，避免「同一份输入在不同路径取值逻辑不一致」。
 */
function mediaInputRef(
  file: { url?: string | undefined; dataUrl?: string | undefined; path?: string | undefined },
  _provider: MediaProviderKind,
): string | undefined {
  if (file.url && /^https?:\/\//i.test(file.url)) return file.url
  if (file.dataUrl) return file.dataUrl
  if (file.url && !file.url.startsWith('safe-file://')) return file.url
  return file.path
}

function clampInt(
  value: unknown,
  fallback: number | undefined,
  def: number,
  min: number,
  max: number,
): number {
  const raw =
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  if (Number.isFinite(raw)) return Math.max(min, Math.min(max, raw))
  if (fallback != null) return Math.max(min, Math.min(max, fallback))
  return def
}

function buildImageRequestParams(
  modelParams: Record<string, unknown> | undefined,
  defaults: ProviderMediaDefaults['image'] | undefined,
  provider: MediaProviderKind,
  modelId?: string,
): {
  n: number
  size?: string
  aspect_ratio?: string
  quality?: unknown
  resolution?: string
  response_format?: string
  output_format?: string
} {
  const params = normalizeImageAliasParams(modelParams)
  const aspectRatio = stringParam(params.aspect_ratio)
  const explicitSize = stringParam(params.size)
  const defaultSize = stringParam(defaults?.size)
  const quality = params.quality ?? defaults?.quality
  const resolution = stringParam(params.resolution) ?? defaults?.resolution
  const responseFormat = stringParam(params.response_format) ?? defaults?.responseFormat
  const outputFormat = stringParam(params.output_format) ?? defaults?.outputFormat
  // xAI Images API 不支持 size（HTTP 400: Argument not supported: size），仅认 aspect_ratio + resolution。
  // 调用方/画布节点可能仍按 OpenAI 习惯传 size：
  //   - 比例型 size（如 16:9）→ 归一化到 aspect_ratio（xAI 官方字段）
  //   - 分辨率型 size（如 1024x1024）→ 对 xAI 无意义，丢弃
  // 故 xAI 永不发 size；aspect_ratio 取「显式 aspect_ratio 优先，否则比例型 size 回填」。
  if (provider === 'xai') {
    const sizeLikeRatio =
      explicitSize && RATIO_PATTERN.test(explicitSize) ? explicitSize : undefined
    const xaiAspect = aspectRatio ?? sizeLikeRatio
    return {
      n: clampInt(params.n, defaults?.n, 1, 1, 4),
      ...(quality != null && quality !== '' ? { quality } : {}),
      ...(resolution ? { resolution } : {}),
      ...(xaiAspect ? { aspect_ratio: xaiAspect } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(outputFormat ? { output_format: outputFormat } : {}),
    }
  }
  // APIMart GPT Image 2 文档中的 size 本身就是画幅比例，而 resolution 才是清晰度档位。
  // 兼容历史画布节点的 aspect_ratio，但绝不能再转成 OpenAI 风格像素尺寸。
  if (provider === 'apimart' && modelId === 'gpt-image-2') {
    const documentedSize =
      explicitSize && (explicitSize === 'auto' || RATIO_PATTERN.test(explicitSize))
        ? explicitSize
        : undefined
    const legacyAspect = aspectRatio && RATIO_PATTERN.test(aspectRatio) ? aspectRatio : undefined
    const documentedDefault =
      defaultSize && (defaultSize === 'auto' || RATIO_PATTERN.test(defaultSize))
        ? defaultSize
        : undefined
    const size = documentedSize ?? legacyAspect ?? documentedDefault
    return {
      n: clampInt(params.n, defaults?.n, 1, 1, 1),
      ...(size ? { size } : {}),
      ...(resolution ? { resolution } : {}),
      ...(outputFormat ? { output_format: outputFormat } : {}),
    }
  }
  const size = explicitSize ?? sizeForAspectRatio(aspectRatio) ?? defaultSize
  return {
    n: clampInt(params.n, defaults?.n, 1, 1, 4),
    ...(size ? { size } : {}),
    ...(quality != null && quality !== '' ? { quality } : {}),
    ...(resolution ? { resolution } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(outputFormat ? { output_format: outputFormat } : {}),
  }
}

function normalizeImageAliasParams(
  modelParams: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = removeBlankParams(modelParams)
  if (next.aspect_ratio == null && next.aspectRatio != null) next.aspect_ratio = next.aspectRatio
  if (next.output_format == null) {
    if (next.outputFormat != null) next.output_format = next.outputFormat
    if (next.image_format != null) next.output_format = next.image_format
  }
  if (next.image_format == null && next.output_format != null)
    next.image_format = next.output_format
  return next
}

function removeBlankParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    next[key] = value
  }
  return next
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function shouldSendApimartAspectRatio(
  model: string,
  capability: MediaCapabilityId,
  hasImageInput: boolean,
  hasVideoInput: boolean,
): boolean {
  if (
    (capability === 'video.image_to_video' || capability === 'video.edit') &&
    (model === 'happyhorse-1.0' || model === 'happyhorse-1.1')
  ) {
    return false
  }
  if (hasVideoInput || !hasImageInput) return true
  if (capability === 'video.image_to_video' && (model === 'sora-2' || model === 'sora-2-pro')) {
    return false
  }
  if (
    capability === 'video.image_to_video' &&
    (model === 'wan2.5-preview' ||
      model === 'wan2.6' ||
      model === 'wan2.7' ||
      model === 'pixverse-v6')
  ) {
    return false
  }
  if (capability === 'video.edit' && model === 'wan2.7-videoedit') return false
  return true
}

/** 匹配比例型值（如 16:9、19.5:9、1:1）。xAI 用它把「size 误传比例」归一化到 aspect_ratio。 */
const RATIO_PATTERN = /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/

function sizeForAspectRatio(aspectRatio: string | undefined): string | undefined {
  if (!aspectRatio) return undefined
  const normalized = aspectRatio.replace(/\s+/g, '').toLowerCase()
  if (normalized === '1:1') return '1024x1024'
  if (normalized === '16:9' || normalized === '3:2' || normalized === '4:3') return '1536x1024'
  if (normalized === '9:16' || normalized === '2:3' || normalized === '3:4') return '1024x1536'
  return undefined
}

function filename(input: MediaGenerateInput, prefix: string, index: number, total: number): string {
  const fromParams =
    typeof input.modelParams?.filename === 'string' ? (input.modelParams.filename as string) : ''
  const suffix = total > 1 ? `_${String(index + 1).padStart(3, '0')}` : ''
  return `${fromParams || `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`}${suffix}`
}

/**
 * 把 modelParams 中非保留键透传，排除黑名单内的（避免重复）。
 *
 * Contract V2：当传入 capability 时，按 manifest.paramPolicy 进一步过滤：
 *   - declared（schema.properties 命中）+ allow（passthrough.allow 命中）始终保留；
 *   - deny / forbidden 始终丢弃；
 *   - 兼容模式（无 paramPolicy 或 strict=false 且 passthrough.enabled=true）：未声明
 *     字段也透传，保留旧行为；
 *   - strict 模式（strict=true 且未在 allow 中）：未声明字段被丢弃，记录原因由调用方
 *     通过 compileMediaRequest 单独获取（adapter 路径下 issue 已在调用前抛错）。
 *
 * 同时识别 capability.aliases 与 paramPolicy.aliases：canonical 名（aspectRatio）
 * 与 provider-native 名（aspect_ratio）任一命中 declared 即视为已声明。
 */
function extraAllowed(
  extraParams: Record<string, unknown> | undefined,
  modelParams: Record<string, unknown> | undefined,
  blacklist: string[],
  capability?: MediaModelCapabilityManifest,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(extraParams ?? {}) }
  for (const [key, value] of Object.entries(modelParams ?? {})) {
    if (
      !blacklist.includes(key) &&
      !['filename', 'n', 'size'].includes(key) &&
      typeof value !== 'object'
    ) {
      merged[key] = value
    }
  }
  if (!capability) return merged

  const policy = capability.paramPolicy
  const schemaProperties = (capability.paramSchema?.properties ?? {}) as Record<string, unknown>
  const declared = new Set(Object.keys(schemaProperties))
  const allow = new Set(policy?.passthrough?.allow ?? [])
  const deny = new Set(policy?.passthrough?.deny ?? [])
  const forbidden = new Set((policy?.forbidden ?? []).map((entry) => entry.name))
  const strict = policy?.strict === true
  const passthroughEnabled = !strict || (policy?.passthrough?.enabled ?? false)
  const aliases: Record<string, string> = {
    ...(capability.aliases ?? {}),
    ...(policy?.aliases ?? {}),
  }
  // 反向 alias：provider-native 名 → canonical 名集合
  const providerToCanonical: Record<string, string[]> = {}
  for (const [canonical, provider] of Object.entries(aliases)) {
    if (!providerToCanonical[provider]) providerToCanonical[provider] = []
    providerToCanonical[provider].push(canonical)
  }

  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'object') continue
    if (deny.has(key) || forbidden.has(key)) continue
    if (declared.has(key) || allow.has(key)) {
      filtered[key] = value
      continue
    }
    const canonicals = providerToCanonical[key]
    if (canonicals && canonicals.some((c) => declared.has(c) || allow.has(c))) {
      filtered[key] = value
      continue
    }
    if (passthroughEnabled && !strict) {
      filtered[key] = value
    }
    // strict + 未声明 → drop
  }
  return filtered
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

export {
  buildImageRequestParams,
  clampInt,
  extraAllowed,
  filename as filenameHelper,
  mediaInputRef,
  mimeFromFormat,
  buildMultipart,
  normalizeImageAliasParams,
}
