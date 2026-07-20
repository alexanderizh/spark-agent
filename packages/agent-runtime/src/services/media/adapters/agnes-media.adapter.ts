import type { MediaCapabilityId, MediaProviderKind } from '@spark/protocol'
import { MediaProviderError } from '../media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaProviderAdapter,
  MediaProviderContext,
  MediaInputFile,
} from '../media-adapter.types.js'
import { MediaArtifactService } from '../media-artifact.service.js'
import {
  extractImages,
  extractMediaUrls,
  extractStatus,
  extractTaskId,
  fetchJson,
  pollTask,
} from '../media-http.util.js'
import { logMediaCall, logMediaResult } from '../media-debug-log.js'
import { extraAllowed, filenameHelper, mediaInputRef } from './openai-compatible-media.adapter.js'

const FAILED_STATUSES = ['failed', 'error', 'cancelled', 'canceled']

export class AgnesMediaAdapter implements MediaProviderAdapter {
  readonly id: MediaProviderKind = 'agnes'
  private readonly artifact = new MediaArtifactService()
  private readonly capabilities = new Set<MediaCapabilityId>([
    'image.generate',
    'image.edit',
    'video.generate',
    'video.image_to_video',
    'video.reference_to_video',
  ])

  supports(capability: MediaCapabilityId): boolean {
    return this.capabilities.has(capability)
  }

  async invoke(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    const capability = input.capability
    if (!capability) {
      throw new MediaProviderError('capability_not_supported', 'No capability resolved for Agnes invoke')
    }
    if (!this.supports(capability)) {
      throw new MediaProviderError('capability_not_supported', `agnes does not support ${capability}`)
    }
    if (!ctx.apiKey) throw new MediaProviderError('api_key_missing', 'Missing API key')
    switch (capability) {
      case 'image.generate':
      case 'image.edit':
        return this.generateImage(input, ctx)
      case 'video.generate':
      case 'video.image_to_video':
      case 'video.reference_to_video':
        return this.generateVideo(input, ctx)
      default:
        throw new MediaProviderError('capability_not_supported', `Unsupported capability: ${capability}`)
    }
  }

  private async generateImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    const imageRefs = await resolveAgnesImageRefs(input.inputFiles ?? [], ctx)
    if (!prompt && imageRefs.length === 0) {
      throw new MediaProviderError('invalid_input', 'Agnes image generation requires a prompt or input image(s)')
    }
    if (input.capability === 'image.edit' && imageRefs.length === 0) {
      throw new MediaProviderError('invalid_input', 'Agnes image edit requires input image(s)')
    }

    const model = ctx.defaultModel
    const params = normalizeAgnesImageParams(input.modelParams, ctx)
    const extraBody: Record<string, unknown> = {}
    if (imageRefs.length > 0) extraBody.image = imageRefs
    if (imageRefs.length > 0) {
      extraBody.response_format = params.responseFormat
    } else if (params.responseFormat === 'url') {
      extraBody.response_format = 'url'
    }
    const body: Record<string, unknown> = {
      model,
      prompt,
      size: params.size,
      ...(imageRefs.length === 0 && params.responseFormat === 'b64_json' ? { return_base64: true } : {}),
      ...(Object.keys(extraBody).length > 0 ? { extra_body: extraBody } : {}),
      ...extraAllowed(ctx.extraParams, input.modelParams, [
        'size',
        'image',
        'images',
        'prompt',
        'responseFormat',
        'response_format',
        'returnBase64',
        'return_base64',
      ], ctx.mediaManifestCapability),
    }
    const url = `${baseEndpoint(ctx)}/images/generations`
    logMediaCall({
      provider: this.id,
      capability: input.capability ?? 'image.generate',
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120), inputImages: imageRefs.length },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 120_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const images = extractImages(data)
    if (images.length === 0) {
      logMediaResult({ provider: this.id, capability: input.capability, ok: false, error: 'No images in Agnes response' })
      throw new MediaProviderError('provider_http_error', `No images in Agnes response: ${JSON.stringify(data).slice(0, 800)}`)
    }
    logMediaResult({ provider: this.id, capability: input.capability, ok: true, assetCount: images.length })
    const assets = await Promise.all(
      images.map((image, index) =>
        this.artifact.writeImage(image, input.outputDir, filenameHelper(input, imageRefs.length > 0 ? 'edit' : 'img', index, images.length), ctx.fetch),
      ),
    )
    return { provider: this.id, model, mode: 'sync', assets, rawResponse: data }
  }

  private async generateVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) throw new MediaProviderError('invalid_input', 'Agnes video generation requires a prompt')
    const imageRefs = await resolveAgnesImageRefs(input.inputFiles ?? [], ctx)
    const capability = input.capability ?? 'video.generate'
    if (capability === 'video.image_to_video' && imageRefs.length === 0) {
      throw new MediaProviderError('invalid_input', 'Agnes image-to-video requires an input image')
    }
    if (capability === 'video.reference_to_video' && imageRefs.length === 0) {
      throw new MediaProviderError('invalid_input', 'Agnes reference-to-video requires input image(s)')
    }

    const model = ctx.defaultModel
    const params = normalizeAgnesVideoParams(input.modelParams, ctx)
    const { width, height } = resolveAgnesDimensions(params)
    const fps = clampNumber(params.fps, 24, 1, 60)
    const numFrames = resolveAgnesNumFrames(params, fps)
    const extraBody: Record<string, unknown> = {}
    if (imageRefs.length > 1) extraBody.image = imageRefs
    if (params.mode === 'keyframes') extraBody.mode = 'keyframes'

    const body: Record<string, unknown> = {
      model,
      prompt,
      width,
      height,
      num_frames: numFrames,
      frame_rate: fps,
      ...(imageRefs.length === 1 ? { image: imageRefs[0] } : {}),
      ...(params.mode && params.mode !== 'keyframes' ? { mode: params.mode } : {}),
      ...(params.numInferenceSteps != null ? { num_inference_steps: params.numInferenceSteps } : {}),
      ...(params.seed != null ? { seed: params.seed } : {}),
      ...(input.negativePrompt ?? params.negativePrompt ? { negative_prompt: input.negativePrompt ?? params.negativePrompt } : {}),
      ...(Object.keys(extraBody).length > 0 ? { extra_body: extraBody } : {}),
      ...extraAllowed(ctx.extraParams, input.modelParams, [
        'aspectRatio',
        'aspect_ratio',
        'resolution',
        'durationSeconds',
        'duration',
        'fps',
        'frame_rate',
        'numFrames',
        'num_frames',
        'numInferenceSteps',
        'num_inference_steps',
        'mode',
        'negativePrompt',
        'negative_prompt',
        'width',
        'height',
        'image',
        'images',
        'prompt',
      ], ctx.mediaManifestCapability),
    }
    const url = `${baseEndpoint(ctx)}/videos`
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120), inputImages: imageRefs.length },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 120_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    let videoUrls = extractAgnesVideoUrls(data)
    let raw = data
    let mode: 'sync' | 'async' = 'sync'
    let requestId: string | undefined
    if (videoUrls.length === 0) {
      const taskId = extractTaskId(data)
      const videoId = stringParam((data as Record<string, unknown>)?.video_id)
      const pollUrl = buildAgnesPollUrl(ctx, taskId, videoId, model)
      if (!pollUrl) {
        logMediaResult({ provider: this.id, capability, ok: false, error: 'No video url or task id' })
        throw new MediaProviderError('provider_http_error', `No video url or task id: ${JSON.stringify(data).slice(0, 800)}`)
      }
      requestId = taskId || videoId
      mode = 'async'
      if (requestId) ctx.onTaskSubmitted?.({ requestId, response: data })
      raw = await pollTask(pollUrl, authHeaders(ctx), {
        fetchImpl: ctx.fetch,
        intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
        timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 1_800_000,
        inspect: (payload) => {
          const urls = extractAgnesVideoUrls(payload)
          if (urls.length > 0) return 'done'
          const status = extractStatus(payload).toLowerCase()
          return FAILED_STATUSES.includes(status) ? 'failed' : 'pending'
        },
        ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
      })
      videoUrls = extractAgnesVideoUrls(raw)
    }
    if (videoUrls.length === 0) {
      logMediaResult({ provider: this.id, capability, ok: false, error: 'No video produced' })
      throw new MediaProviderError('provider_http_error', `No video produced: ${JSON.stringify(raw).slice(0, 800)}`)
    }
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: videoUrls.length, requestId })
    const assets = await Promise.all(
      videoUrls.map((videoUrl, index) =>
        this.artifact.downloadMediaAsset('video', videoUrl, input.outputDir, filenameHelper(input, 'video', index, videoUrls.length), ctx.fetch),
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

function baseEndpoint(ctx: MediaProviderContext): string {
  return (ctx.apiEndpoint ?? '').replace(/\/+$/, '')
}

function authHeaders(ctx: MediaProviderContext): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${ctx.apiKey}`,
  }
}

async function resolveAgnesImageRefs(files: MediaInputFile[], ctx: MediaProviderContext): Promise<string[]> {
  const artifact = new MediaArtifactService()
  const refs = await Promise.all(files
    .filter((file) => file.type === 'image' || file.type === 'file')
    .map(async (file) => {
      const ref = mediaInputRef(file, ctx.mediaProvider)
      if (!ref) return ''
      if (ref.startsWith('/') || ref.startsWith('./') || ref.startsWith('../')) {
        const buffer = await artifact.readLocalFile(ref)
        return `data:${file.mimeType ?? 'image/png'};base64,${buffer.toString('base64')}`
      }
      return ref
    }))
  return refs.filter((ref) => ref.length > 0)
}

function normalizeAgnesImageParams(
  modelParams: Record<string, unknown> | undefined,
  ctx: MediaProviderContext,
): {
  size: string
  responseFormat: 'url' | 'b64_json'
} {
  const defaults = ctx.mediaDefaults?.image
  const rawSize = stringParam(modelParams?.size) ?? stringParam(defaults?.size) ?? '1024x1024'
  const responseFormat = normalizeAgnesResponseFormat(
    modelParams?.responseFormat
      ?? modelParams?.response_format
      ?? (modelParams?.returnBase64 === true || modelParams?.return_base64 === true ? 'b64_json' : undefined)
      ?? defaults?.responseFormat,
  )
  return { size: rawSize, responseFormat }
}

function normalizeAgnesVideoParams(
  modelParams: Record<string, unknown> | undefined,
  ctx: MediaProviderContext,
): {
  aspectRatio: string
  resolution: string
  durationSeconds: number
  fps: number
  numFrames?: number
  numInferenceSteps?: number
  mode?: string
  negativePrompt?: string
  seed?: number
  width?: number
  height?: number
} {
  const defaults = ctx.mediaDefaults?.video
  const numFrames = toOptionalInt(modelParams?.numFrames ?? modelParams?.num_frames)
  const numInferenceSteps = toOptionalInt(modelParams?.numInferenceSteps ?? modelParams?.num_inference_steps)
  const mode = stringParam(modelParams?.mode)
  const negativePrompt = stringParam(modelParams?.negativePrompt ?? modelParams?.negative_prompt)
  const seed = toOptionalInt(modelParams?.seed)
  const width = toOptionalInt(modelParams?.width)
  const height = toOptionalInt(modelParams?.height)
  return {
    aspectRatio: stringParam(modelParams?.aspectRatio ?? modelParams?.aspect_ratio) ?? stringParam(defaults?.aspectRatio) ?? '16:9',
    resolution: stringParam(modelParams?.resolution) ?? stringParam(defaults?.resolution) ?? '720p',
    durationSeconds: clampNumber(modelParams?.durationSeconds ?? modelParams?.duration, defaults?.durationSeconds ?? 5, 1, 18),
    fps: clampNumber(modelParams?.fps ?? modelParams?.frame_rate, defaults?.fps ?? 24, 1, 60),
    ...(numFrames != null ? { numFrames } : {}),
    ...(numInferenceSteps != null ? { numInferenceSteps } : {}),
    ...(mode ? { mode } : {}),
    ...(negativePrompt ? { negativePrompt } : {}),
    ...(seed != null ? { seed } : {}),
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
  }
}

function resolveAgnesDimensions(params: {
  aspectRatio: string
  resolution: string
  width?: number
  height?: number
}): { width: number; height: number } {
  if (params.width != null && params.height != null) {
    return { width: params.width, height: params.height }
  }
  const resolution = params.resolution.toLowerCase()
  const ratio = params.aspectRatio.replace(/\s+/g, '')
  const table: Record<string, Record<string, { width: number; height: number }>> = {
    '480p': {
      '16:9': { width: 854, height: 480 },
      '9:16': { width: 480, height: 854 },
      '1:1': { width: 480, height: 480 },
      '4:3': { width: 640, height: 480 },
      '3:4': { width: 480, height: 640 },
    },
    '720p': {
      '16:9': { width: 1280, height: 720 },
      '9:16': { width: 720, height: 1280 },
      '1:1': { width: 720, height: 720 },
      '4:3': { width: 1024, height: 768 },
      '3:4': { width: 768, height: 1024 },
    },
    '1080p': {
      '16:9': { width: 1920, height: 1080 },
      '9:16': { width: 1080, height: 1920 },
      '1:1': { width: 1080, height: 1080 },
      '4:3': { width: 1440, height: 1080 },
      '3:4': { width: 1080, height: 1440 },
    },
  }
  const fallback = table['720p']?.['16:9']
  const resolved = table[resolution]?.[ratio] ?? fallback
  if (resolved) return resolved
  return { width: 1280, height: 720 }
}

function resolveAgnesNumFrames(
  params: { numFrames?: number; durationSeconds: number },
  fps: number,
): number {
  const explicit = params.numFrames
  if (explicit != null) return normalizeAgnesFrameCount(explicit)
  return normalizeAgnesFrameCount(Math.round(params.durationSeconds * fps) + 1)
}

function normalizeAgnesFrameCount(value: number): number {
  const clamped = Math.max(9, Math.min(441, Math.round(value)))
  const n = Math.max(1, Math.round((clamped - 1) / 8))
  return Math.min(441, (n * 8) + 1)
}

function extractAgnesVideoUrls(data: unknown): string[] {
  const fromGeneric = extractMediaUrls(data, { kind: 'video' })
  const extra = stringParam((data as Record<string, unknown>)?.remixed_from_video_id)
  return Array.from(new Set(extra ? [...fromGeneric, extra] : fromGeneric))
}

function buildAgnesPollUrl(
  ctx: MediaProviderContext,
  taskId: string,
  videoId: string | undefined,
  model: string,
): string | null {
  if (videoId) {
    const origin = baseEndpoint(ctx).replace(/\/v1$/i, '')
    const url = new URL(`${origin}/agnesapi`)
    url.searchParams.set('video_id', videoId)
    url.searchParams.set('model_name', model)
    return url.toString()
  }
  if (taskId) return `${baseEndpoint(ctx)}/videos/${encodeURIComponent(taskId)}`
  return null
}

function normalizeAgnesResponseFormat(value: unknown): 'url' | 'b64_json' {
  return value === 'b64_json' ? 'b64_json' : 'url'
}

function toOptionalInt(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN
  if (Number.isFinite(parsed)) return Math.max(min, Math.min(max, parsed))
  return Math.max(min, Math.min(max, fallback))
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}
