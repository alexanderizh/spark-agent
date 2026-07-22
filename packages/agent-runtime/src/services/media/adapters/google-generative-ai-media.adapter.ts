/**
 * Google Gemini / Veo / Omni media adapter.
 *
 * Google media endpoints do not use Bearer auth. Image generation goes through
 * the Interactions API, while Veo/Omni video generation uses
 * models/{model}:predictLongRunning and operation polling.
 */

import type { MediaCapabilityId, MediaProviderKind } from '@spark/protocol'
import { MediaProviderError } from '../media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaInputFile,
  MediaProviderAdapter,
  MediaProviderContext,
} from '../media-adapter.types.js'
import { MediaArtifactService } from '../media-artifact.service.js'
import {
  extractImages,
  extractMediaUrls,
  fetchJson,
  pollTask,
  type ExtractedImage,
} from '../media-http.util.js'
import { logMediaCall, logMediaResult } from '../media-debug-log.js'
import { filenameHelper } from './openai-compatible-media.adapter.js'

const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta'
const CAPABILITIES: readonly MediaCapabilityId[] = [
  'image.generate',
  'image.edit',
  'audio.music',
  'video.generate',
  'video.image_to_video',
  'video.reference_to_video',
  'video.edit',
  'video.extend',
]

export class GoogleGenerativeAiMediaAdapter implements MediaProviderAdapter {
  readonly id: MediaProviderKind
  private readonly artifact = new MediaArtifactService()

  constructor(
    id: Extract<MediaProviderKind, 'google-generative-ai' | 'omni'> = 'google-generative-ai',
  ) {
    this.id = id
  }

  supports(capability: MediaCapabilityId): boolean {
    return CAPABILITIES.includes(capability)
  }

  async invoke(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    if (!ctx.apiKey) throw new MediaProviderError('api_key_missing', 'Missing Gemini API key')
    const capability = input.capability
    if (!capability || !this.supports(capability)) {
      throw new MediaProviderError(
        'capability_not_supported',
        `${this.id} does not support ${capability ?? '(unknown)'}`,
      )
    }
    const model = ctx.defaultModel
    if (capability === 'audio.music') return this.generateMusic(input, ctx)
    if (capability.startsWith('image.')) {
      return model.startsWith('imagen-')
        ? this.generateImagen(input, ctx)
        : this.generateImage(input, ctx)
    }
    if (this.id === 'google-generative-ai' && model.startsWith('gemini-omni-')) {
      return this.generateInteractionVideo(input, ctx)
    }
    return this.generateVideo(input, ctx)
  }

  private async generateImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) throw new MediaProviderError('invalid_input', 'prompt is required')
    const model = ctx.defaultModel
    const imageInputs = await Promise.all(
      (input.inputFiles ?? [])
        .filter((file) => file.type === 'image' || file.type === 'file')
        .map((file) => googleImagePart(file, this.artifact)),
    )
    const body: Record<string, unknown> = {
      model,
      input: [{ type: 'text', text: prompt }, ...imageInputs],
      ...googleImageParams(input.modelParams, ctx),
    }
    const tools = googleTools(input.modelParams)
    if (tools.length > 0) body.tools = tools
    const url = `${baseEndpoint(ctx)}/interactions`
    logMediaCall({
      provider: this.id,
      capability: input.capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { inputImages: imageInputs.length, prompt: prompt.slice(0, 120) },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: googleHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 120_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const images = googleOutputImages(data)
    if (images.length === 0) {
      logMediaResult({
        provider: this.id,
        capability: input.capability,
        ok: false,
        error: 'No images in response',
      })
      throw new MediaProviderError(
        'provider_http_error',
        `No images in response: ${JSON.stringify(data).slice(0, 800)}`,
      )
    }
    const assets = await Promise.all(
      images.map((image, index) =>
        this.artifact.writeImage(
          image,
          input.outputDir,
          filenameHelper(input, 'gemini', index, images.length),
          googleDownloadFetch(ctx),
        ),
      ),
    )
    logMediaResult({
      provider: this.id,
      capability: input.capability,
      ok: true,
      assetCount: assets.length,
    })
    return { provider: this.id, model, mode: 'sync', assets, rawResponse: data }
  }

  private async generateImagen(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) throw new MediaProviderError('invalid_input', 'prompt is required')
    const model = ctx.defaultModel
    const body = {
      instances: [{ prompt }],
      parameters: googleImagenParams(input.modelParams),
    }
    const url = `${baseEndpoint(ctx)}/models/${encodeURIComponent(model)}:predict`
    logMediaCall({
      provider: this.id,
      capability: input.capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120) },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: googleHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 180_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const images = googleImagenImages(data)
    if (images.length === 0) {
      throw new MediaProviderError(
        'provider_http_error',
        `No Imagen output: ${JSON.stringify(data).slice(0, 800)}`,
      )
    }
    const assets = await Promise.all(
      images.map((image, index) =>
        this.artifact.writeImage(
          image,
          input.outputDir,
          filenameHelper(input, 'imagen', index, images.length),
          googleDownloadFetch(ctx),
        ),
      ),
    )
    logMediaResult({
      provider: this.id,
      capability: input.capability,
      ok: true,
      assetCount: assets.length,
    })
    return { provider: this.id, model, mode: 'sync', assets, rawResponse: data }
  }

  private async generateMusic(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    if (!prompt)
      throw new MediaProviderError('invalid_input', 'prompt is required for music generation')
    const model = ctx.defaultModel
    const inputParts = await googleInteractionInput(input, this.artifact, false)
    const body = { model, input: inputParts, response_format: { type: 'audio' } }
    const url = `${baseEndpoint(ctx)}/interactions`
    logMediaCall({
      provider: this.id,
      capability: input.capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120), referenceImages: inputParts.length - 1 },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: googleHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 300_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const audios = googleInlineAudios(data)
    const audioUrls = [
      ...new Set([
        ...extractMediaUrls(data, { kind: 'audio' }),
        ...googleTypedMediaUris(data, 'audio'),
      ]),
    ]
    if (audios.length === 0 && audioUrls.length === 0) {
      throw new MediaProviderError(
        'provider_http_error',
        `No Lyria audio output: ${JSON.stringify(data).slice(0, 800)}`,
      )
    }
    const assets = [
      ...(await Promise.all(
        audios.map((audio, index) =>
          this.artifact.writeBinaryAsset(
            'audio',
            Buffer.from(audio.data, 'base64'),
            input.outputDir,
            filenameHelper(input, 'lyria', index, audios.length),
            audio.mimeType,
          ),
        ),
      )),
      ...(await Promise.all(
        audioUrls.map((audioUrl, index) =>
          this.artifact.downloadMediaAsset(
            'audio',
            audioUrl,
            input.outputDir,
            filenameHelper(input, 'lyria-url', index, audioUrls.length),
            googleDownloadFetch(ctx),
          ),
        ),
      )),
    ]
    logMediaResult({
      provider: this.id,
      capability: input.capability,
      ok: true,
      assetCount: assets.length,
    })
    return { provider: this.id, model, mode: 'sync', assets, rawResponse: data }
  }

  private async generateInteractionVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    if (!prompt)
      throw new MediaProviderError('invalid_input', 'prompt is required for Omni video generation')
    const model = ctx.defaultModel
    const inputParts = await googleInteractionInput(input, this.artifact, true)
    const params = input.modelParams ?? {}
    const task = omniTask(input.capability)
    const body = {
      model,
      input: inputParts,
      background: true,
      response_format: {
        type: 'video',
        aspect_ratio: params.aspectRatio ?? params.aspect_ratio ?? '16:9',
        delivery: params.delivery ?? 'base64',
      },
      generation_config: {
        video_config: {
          task,
          duration_seconds: params.durationSeconds ?? 6,
        },
      },
    }
    const url = `${baseEndpoint(ctx)}/interactions`
    logMediaCall({
      provider: this.id,
      capability: input.capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120), task },
    })
    const initial = await fetchJson(url, {
      method: 'POST',
      headers: googleHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 120_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const interactionId = stringProperty(initial, 'id')
    const initialArtifacts = googleInlineVideos(initial).length + googleVideoUrls(initial).length
    let raw = initial
    let mode: 'sync' | 'async' = 'sync'
    if (initialArtifacts === 0 && interactionId) {
      mode = 'async'
      ctx.onTaskSubmitted?.({ requestId: interactionId, response: initial })
      raw = await pollTask(
        `${baseEndpoint(ctx)}/interactions/${encodeURIComponent(interactionId)}`,
        googleHeaders(ctx),
        {
          fetchImpl: ctx.fetch,
          intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
          timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 1_800_000,
          inspect: (payload) => {
            if (googleInlineVideos(payload).length > 0 || googleVideoUrls(payload).length > 0)
              return 'done'
            const status = stringProperty(payload, 'status').toLowerCase()
            if (status === 'failed' || status === 'cancelled') return 'failed'
            return 'pending'
          },
          ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
        },
      )
    }
    const inlineVideos = googleInlineVideos(raw)
    const urlVideos = googleVideoUrls(raw)
    if (inlineVideos.length === 0 && urlVideos.length === 0) {
      throw new MediaProviderError(
        'provider_http_error',
        `No Omni video output: ${JSON.stringify(raw).slice(0, 800)}`,
      )
    }
    await waitForGoogleFilesActive(urlVideos, ctx)
    const assets = [
      ...(await Promise.all(
        inlineVideos.map((video, index) =>
          this.artifact.writeBinaryAsset(
            'video',
            Buffer.from(video.data, 'base64'),
            input.outputDir,
            filenameHelper(input, 'omni', index, inlineVideos.length),
            video.mimeType,
          ),
        ),
      )),
      ...(await Promise.all(
        urlVideos.map((videoUrl, index) =>
          this.artifact.downloadMediaAsset(
            'video',
            videoUrl,
            input.outputDir,
            filenameHelper(input, 'omni-url', index, urlVideos.length),
            googleDownloadFetch(ctx),
          ),
        ),
      )),
    ]
    logMediaResult({
      provider: this.id,
      capability: input.capability,
      ok: true,
      assetCount: assets.length,
      requestId: interactionId,
    })
    return {
      provider: this.id,
      model,
      mode,
      ...(interactionId ? { requestId: interactionId } : {}),
      assets,
      rawResponse: raw,
    }
  }

  private async generateVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    if (!prompt && input.capability === 'video.generate') {
      throw new MediaProviderError('invalid_input', 'prompt is required for video generation')
    }
    const model = ctx.defaultModel
    const instance: Record<string, unknown> = {}
    if (prompt) instance.prompt = prompt
    await attachVideoInputs(instance, input, this.artifact)
    const parameters = googleVideoParams(input.modelParams, ctx)
    const body: Record<string, unknown> = { instances: [instance] }
    if (Object.keys(parameters).length > 0) body.parameters = parameters
    const url = `${baseEndpoint(ctx)}/models/${encodeURIComponent(model)}:predictLongRunning`
    logMediaCall({
      provider: this.id,
      capability: input.capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120) },
    })
    const initial = await fetchJson(url, {
      method: 'POST',
      headers: googleHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const operationName = operationNameFrom(initial)
    if (!operationName) {
      throw new MediaProviderError(
        'provider_http_error',
        `No operation name in response: ${JSON.stringify(initial).slice(0, 800)}`,
      )
    }
    ctx.onTaskSubmitted?.({ requestId: operationName, response: initial })
    const pollUrl = `${baseEndpoint(ctx)}/${operationName.replace(/^\/+/, '')}`
    const raw = await pollTask(pollUrl, googleHeaders(ctx), {
      fetchImpl: ctx.fetch,
      intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 10_000,
      timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 1_800_000,
      inspect: (payload) => {
        if (googleVideoUrls(payload).length > 0 || googleInlineVideos(payload).length > 0) {
          return 'done'
        }
        if (operationDone(payload)) return 'failed'
        return 'pending'
      },
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const inlineVideos = googleInlineVideos(raw)
    const urlVideos = googleVideoUrls(raw)
    if (inlineVideos.length === 0 && urlVideos.length === 0) {
      throw new MediaProviderError(
        'provider_http_error',
        `No video produced: ${JSON.stringify(raw).slice(0, 800)}`,
      )
    }
    const assets = [
      ...(await Promise.all(
        inlineVideos.map((video, index) =>
          this.artifact.writeBinaryAsset(
            'video',
            Buffer.from(video.data, 'base64'),
            input.outputDir,
            filenameHelper(input, 'google-video', index, inlineVideos.length),
            video.mimeType,
          ),
        ),
      )),
      ...(await Promise.all(
        urlVideos.map((videoUrl, index) =>
          this.artifact.downloadMediaAsset(
            'video',
            videoUrl,
            input.outputDir,
            filenameHelper(input, 'google-video-url', index, urlVideos.length),
            googleDownloadFetch(ctx),
          ),
        ),
      )),
    ]
    logMediaResult({
      provider: this.id,
      capability: input.capability,
      ok: true,
      assetCount: assets.length,
      requestId: operationName,
    })
    return {
      provider: this.id,
      model,
      mode: 'async',
      requestId: operationName,
      assets,
      rawResponse: raw,
    }
  }
}

function baseEndpoint(ctx: MediaProviderContext): string {
  return (ctx.apiEndpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '')
}

function googleHeaders(ctx: MediaProviderContext): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-goog-api-key': ctx.apiKey,
  }
}

function googleDownloadFetch(ctx: MediaProviderContext): typeof fetch {
  const baseFetch = ctx.fetch ?? fetch
  return ((input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
    let shouldAuthenticate = /(^|\.)generativelanguage\.googleapis\.com$/i.test(
      safeUrl(url)?.hostname ?? '',
    )
    const configuredOrigin = safeUrl(baseEndpoint(ctx))?.origin
    if (configuredOrigin && safeUrl(url)?.origin === configuredOrigin) shouldAuthenticate = true
    if (shouldAuthenticate && !headers.has('x-goog-api-key')) {
      headers.set('x-goog-api-key', ctx.apiKey)
    }
    return baseFetch(input, { ...init, headers })
  }) as typeof fetch
}

async function googleImagePart(
  file: MediaInputFile,
  artifact: MediaArtifactService,
): Promise<{ type: 'image'; mime_type: string; data: string }> {
  const { data, mimeType } = await inlineImage(file, artifact)
  return { type: 'image', mime_type: mimeType, data }
}

async function googleInteractionInput(
  input: MediaGenerateInput,
  artifact: MediaArtifactService,
  includeVideo: boolean,
): Promise<Array<Record<string, unknown>>> {
  const parts: Array<Record<string, unknown>> = [
    { type: 'text', text: (input.prompt ?? '').trim() },
  ]
  const imageFiles = (input.inputFiles ?? []).filter(
    (file) => file.type === 'image' || file.type === 'file',
  )
  for (const file of imageFiles) parts.push(await googleImagePart(file, artifact))
  if (includeVideo) {
    const videoFile = (input.inputFiles ?? []).find((file) => file.type === 'video')
    if (videoFile?.url && /^https?:\/\//i.test(videoFile.url)) {
      parts.push({ type: 'video', uri: videoFile.url })
    } else if (videoFile?.dataUrl) {
      const match = /^data:([^;,]+);base64,(.*)$/i.exec(videoFile.dataUrl)
      if (!match?.[2]) throw new MediaProviderError('invalid_input', 'Invalid base64 video input')
      parts.push({
        type: 'video',
        mime_type: match[1] ?? videoFile.mimeType ?? 'video/mp4',
        data: match[2],
      })
    } else if (videoFile?.path) {
      const data = await artifact.readLocalFile(videoFile.path)
      parts.push({
        type: 'video',
        mime_type: videoFile.mimeType ?? 'video/mp4',
        data: data.toString('base64'),
      })
    }
  }
  return parts
}

async function attachVideoInputs(
  instance: Record<string, unknown>,
  input: MediaGenerateInput,
  artifact: MediaArtifactService,
): Promise<void> {
  const imageFiles = (input.inputFiles ?? []).filter(
    (file) => file.type === 'image' || file.type === 'file',
  )
  if (input.capability === 'video.reference_to_video') {
    const explicitReferences = imageFiles.filter((file) => file.role === 'reference')
    const referenceFiles = (explicitReferences.length > 0 ? explicitReferences : imageFiles).slice(
      0,
      3,
    )
    instance.referenceImages = await Promise.all(
      referenceFiles.map(async (file) => ({
        image: { inlineData: await inlineImage(file, artifact) },
        referenceType: 'asset',
      })),
    )
  } else if (input.capability === 'video.image_to_video') {
    const firstFrame =
      imageFiles.find((file) => file.role === 'first_frame') ??
      imageFiles.find((file) => file.role !== 'last_frame')
    const lastFrame = imageFiles.find((file) => file.role === 'last_frame')
    if (firstFrame) instance.image = { inlineData: await inlineImage(firstFrame, artifact) }
    if (lastFrame) instance.lastFrame = { inlineData: await inlineImage(lastFrame, artifact) }
  }
  const videoFile = (input.inputFiles ?? []).find((file) => file.type === 'video')
  if (videoFile?.url && /^https?:\/\//i.test(videoFile.url)) {
    instance.video = { uri: videoFile.url }
  }
}

async function inlineImage(
  file: MediaInputFile,
  artifact: MediaArtifactService,
): Promise<{ mimeType: string; data: string }> {
  if (file.dataUrl) {
    const match = /^data:([^;,]+);base64,(.*)$/i.exec(file.dataUrl)
    return {
      mimeType: match?.[1] ?? file.mimeType ?? 'image/png',
      data: match?.[2] ?? file.dataUrl,
    }
  }
  if (file.path) {
    const buffer = await artifact.readLocalFile(file.path)
    return { mimeType: file.mimeType ?? 'image/png', data: buffer.toString('base64') }
  }
  throw new MediaProviderError(
    'invalid_input',
    'Google media inputs require dataUrl or local path images',
  )
}

function googleImageParams(
  modelParams: Record<string, unknown> | undefined,
  ctx: MediaProviderContext,
): Record<string, unknown> {
  const filtered = filterByManifestSchema(ctx, {
    aspectRatio: modelParams?.aspectRatio ?? modelParams?.aspect_ratio,
    imageSize: modelParams?.imageSize ?? modelParams?.image_size,
    outputFormat: modelParams?.outputFormat ?? modelParams?.mime_type,
    delivery: modelParams?.delivery,
  })
  const outputFormat = filtered.outputFormat
  return {
    response_format: {
      type: 'image',
      ...(filtered.aspectRatio ? { aspect_ratio: filtered.aspectRatio } : {}),
      ...(filtered.imageSize ? { image_size: filtered.imageSize } : {}),
      ...(outputFormat ? { mime_type: outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png' } : {}),
      ...(filtered.delivery ? { delivery: filtered.delivery } : {}),
    },
  }
}

function googleImagenParams(
  modelParams: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const source = modelParams ?? {}
  return Object.fromEntries(
    Object.entries({
      sampleCount: source.numberOfImages ?? 4,
      imageSize: source.imageSize ?? '1K',
      aspectRatio: source.aspectRatio ?? '1:1',
      personGeneration: source.personGeneration ?? 'allow_adult',
    }).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
}

function googleVideoParams(
  modelParams: Record<string, unknown> | undefined,
  ctx: MediaProviderContext,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  const defaults = ctx.mediaDefaults?.video
  const values: Record<string, unknown> = {
    aspectRatio: modelParams?.aspectRatio ?? modelParams?.aspect_ratio ?? defaults?.aspectRatio,
    durationSeconds:
      modelParams?.durationSeconds ?? modelParams?.duration ?? defaults?.durationSeconds,
    resolution: modelParams?.resolution ?? defaults?.resolution,
    personGeneration: modelParams?.personGeneration,
    seed: modelParams?.seed,
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params[key] = value
  }
  return filterByManifestSchema(ctx, params)
}

/**
 * 按 manifest.paramSchema.properties 与 paramPolicy 过滤。
 *
 * Gemini/Veo 不同模型对 outputFormat/resolution/duration 的支持差异已上提到
 * manifest（M5 已落地 googleImageParamPolicy；Veo 模型各自声明 paramSchema）。
 * adapter 在此仅做兜底过滤：未在 schema.properties 中声明的字段不进入 provider 请求，
 * 防止 preset/旧配置的兜底默认值被平台拒绝。
 *
 * capability 缺失（custom 模型 / 旧路径）时保持后向兼容，原样返回。
 */
function filterByManifestSchema(
  ctx: MediaProviderContext,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const capability = ctx.mediaManifestCapability
  if (!capability) return params
  const schemaProperties = (capability.paramSchema?.properties ?? {}) as Record<string, unknown>
  const declared = new Set(Object.keys(schemaProperties))
  const aliases = capability.aliases ?? {}
  const forbidden = new Set((capability.paramPolicy?.forbidden ?? []).map((entry) => entry.name))
  const allow = new Set(capability.paramPolicy?.passthrough?.allow ?? [])
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (forbidden.has(key)) continue
    if (declared.has(key) || allow.has(key)) {
      filtered[key] = value
      continue
    }
    const canonicalOfProvider = Object.entries(aliases).find(
      ([, provider]) => provider === key,
    )?.[0]
    if (
      canonicalOfProvider &&
      (declared.has(canonicalOfProvider) || allow.has(canonicalOfProvider))
    ) {
      filtered[key] = value
    }
  }
  return filtered
}

function googleTools(
  modelParams: Record<string, unknown> | undefined,
): Array<Record<string, string>> {
  const tools: Array<Record<string, string>> = []
  if (modelParams?.google_search === true) tools.push({ type: 'google_search' })
  if (modelParams?.google_image_search === true) tools.push({ type: 'google_image_search' })
  return tools
}

function googleOutputImages(data: unknown): ExtractedImage[] {
  const images = extractImages(data)
  const blocks = findInlineData(data, ['output_image', 'outputImage', 'image'])
  for (const block of blocks) {
    images.push({ kind: 'base64', value: block.data, mimeType: block.mimeType })
  }
  return dedupeImages(images)
}

function googleImagenImages(data: unknown): ExtractedImage[] {
  const images: ExtractedImage[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    for (const key of ['bytesBase64Encoded', 'imageBytes']) {
      const image = record[key]
      if (typeof image === 'string' && image.length > 64) {
        images.push({ kind: 'base64', value: image, mimeType: 'image/png' })
      }
    }
    for (const child of Object.values(record)) visit(child)
  }
  visit(data)
  return dedupeImages(images)
}

function googleInlineVideos(data: unknown): Array<{ data: string; mimeType: string }> {
  return findInlineData(data, ['video'])
}

function googleInlineAudios(data: unknown): Array<{ data: string; mimeType: string }> {
  return findInlineData(data, ['output_audio', 'outputAudio', 'audio']).map((audio) => ({
    ...audio,
    mimeType: audio.mimeType.startsWith('audio/') ? audio.mimeType : 'audio/mpeg',
  }))
}

function googleVideoUrls(data: unknown): string[] {
  return [
    ...new Set([
      ...extractMediaUrls(data, { kind: 'video' }),
      ...googleTypedMediaUris(data, 'video'),
    ]),
  ]
}

function googleTypedMediaUris(data: unknown, kind: 'audio' | 'video'): string[] {
  const values: string[] = []
  const parentKeys =
    kind === 'audio'
      ? new Set(['audio', 'output_audio', 'outputAudio'])
      : new Set(['video', 'output_video', 'outputVideo'])
  const visit = (value: unknown, parentKey = ''): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, parentKey)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const nodeType = typeof record.type === 'string' ? record.type.toLowerCase() : ''
    const mimeType = String(record.mime_type ?? record.mimeType ?? '').toLowerCase()
    if (nodeType === kind || parentKeys.has(parentKey) || mimeType.startsWith(`${kind}/`)) {
      for (const key of ['uri', 'url']) {
        const candidate = record[key]
        if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) values.push(candidate)
      }
    }
    for (const [key, child] of Object.entries(record)) visit(child, key)
  }
  visit(data)
  return [...new Set(values)]
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

async function waitForGoogleFilesActive(
  urls: readonly string[],
  ctx: MediaProviderContext,
): Promise<void> {
  const fileNames = [
    ...new Set(urls.map(googleFileNameFromUri).filter((value): value is string => value != null)),
  ]
  await Promise.all(
    fileNames.map((fileName) =>
      pollTask(`${baseEndpoint(ctx)}/files/${encodeURIComponent(fileName)}`, googleHeaders(ctx), {
        fetchImpl: ctx.fetch,
        intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
        timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 1_800_000,
        inspect: (payload) => {
          const state = firstStringByKey(payload, 'state').toUpperCase()
          if (state === 'ACTIVE') return 'done'
          if (state === 'FAILED') return 'failed'
          return 'pending'
        },
        ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
      }),
    ),
  )
}

function googleFileNameFromUri(uri: string): string | null {
  const match = /\/files\/([^/:?]+)(?::download)?(?:\?|$)/i.exec(uri)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

function firstStringByKey(data: unknown, key: string): string {
  if (Array.isArray(data)) {
    for (const item of data) {
      const value = firstStringByKey(item, key)
      if (value) return value
    }
    return ''
  }
  if (!data || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  if (typeof record[key] === 'string') return record[key]
  for (const value of Object.values(record)) {
    const found = firstStringByKey(value, key)
    if (found) return found
  }
  return ''
}

function findInlineData(
  data: unknown,
  parentKeys: string[],
): Array<{ data: string; mimeType: string }> {
  const found: Array<{ data: string; mimeType: string }> = []
  const visit = (value: unknown, parentKey = ''): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, parentKey)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const dataValue = record.data
    if (
      typeof dataValue === 'string' &&
      dataValue.length > 0 &&
      (parentKeys.includes(parentKey) || record.mime_type || record.mimeType)
    ) {
      found.push({
        data: dataValue,
        mimeType: String(
          record.mime_type ??
            record.mimeType ??
            (parentKey === 'video'
              ? 'video/mp4'
              : parentKey === 'audio' || parentKey === 'output_audio' || parentKey === 'outputAudio'
                ? 'audio/mpeg'
                : 'image/png'),
        ),
      })
    }
    const inlineData = record.inlineData
    if (inlineData && typeof inlineData === 'object') visit(inlineData, parentKey)
    for (const [key, child] of Object.entries(record)) visit(child, key)
  }
  visit(data)
  return found
}

function dedupeImages(images: ExtractedImage[]): ExtractedImage[] {
  const seen = new Set<string>()
  return images.filter((image) => {
    const key = `${image.kind}:${image.value.slice(0, 120)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function operationNameFrom(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const name = (data as Record<string, unknown>).name
  return typeof name === 'string' ? name : ''
}

function stringProperty(data: unknown, key: string): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const value = (data as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

function omniTask(capability: MediaCapabilityId | undefined): string {
  if (capability === 'video.image_to_video') return 'image_to_video'
  if (capability === 'video.reference_to_video') return 'reference_to_video'
  if (capability === 'video.edit') return 'edit'
  return 'text_to_video'
}

function operationDone(data: unknown): boolean {
  return Boolean(
    data && typeof data === 'object' && (data as Record<string, unknown>).done === true,
  )
}
