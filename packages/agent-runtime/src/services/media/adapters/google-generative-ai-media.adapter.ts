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
  'video.generate',
  'video.image_to_video',
  'video.reference_to_video',
  'video.edit',
  'video.extend',
]

export class GoogleGenerativeAiMediaAdapter implements MediaProviderAdapter {
  readonly id: MediaProviderKind
  private readonly artifact = new MediaArtifactService()

  constructor(id: Extract<MediaProviderKind, 'google-generative-ai' | 'omni'> = 'google-generative-ai') {
    this.id = id
  }

  supports(capability: MediaCapabilityId): boolean {
    return CAPABILITIES.includes(capability)
  }

  async invoke(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    if (!ctx.apiKey) throw new MediaProviderError('api_key_missing', 'Missing Gemini API key')
    const capability = input.capability
    if (!capability || !this.supports(capability)) {
      throw new MediaProviderError('capability_not_supported', `${this.id} does not support ${capability ?? '(unknown)'}`)
    }
    if (capability.startsWith('image.')) return this.generateImage(input, ctx)
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
      input: [
        { type: 'text', text: prompt },
        ...imageInputs,
      ],
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
      logMediaResult({ provider: this.id, capability: input.capability, ok: false, error: 'No images in response' })
      throw new MediaProviderError('provider_http_error', `No images in response: ${JSON.stringify(data).slice(0, 800)}`)
    }
    const assets = await Promise.all(
      images.map((image, index) =>
        this.artifact.writeImage(image, input.outputDir, filenameHelper(input, 'gemini', index, images.length), googleDownloadFetch(ctx)),
      ),
    )
    logMediaResult({ provider: this.id, capability: input.capability, ok: true, assetCount: assets.length })
    return { provider: this.id, model, mode: 'sync', assets, rawResponse: data }
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
      throw new MediaProviderError('provider_http_error', `No operation name in response: ${JSON.stringify(initial).slice(0, 800)}`)
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
      throw new MediaProviderError('provider_http_error', `No video produced: ${JSON.stringify(raw).slice(0, 800)}`)
    }
    const assets = [
      ...(await Promise.all(
        inlineVideos.map((video, index) =>
          this.artifact.writeBinaryAsset('video', Buffer.from(video.data, 'base64'), input.outputDir, filenameHelper(input, 'google-video', index, inlineVideos.length), video.mimeType),
        ),
      )),
      ...(await Promise.all(
        urlVideos.map((videoUrl, index) =>
          this.artifact.downloadMediaAsset('video', videoUrl, input.outputDir, filenameHelper(input, 'google-video-url', index, urlVideos.length), googleDownloadFetch(ctx)),
        ),
      )),
    ]
    logMediaResult({ provider: this.id, capability: input.capability, ok: true, assetCount: assets.length, requestId: operationName })
    return { provider: this.id, model, mode: 'async', requestId: operationName, assets, rawResponse: raw }
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
    const url = typeof input === 'string' ? input : input.toString()
    if (/generativelanguage\.googleapis\.com/i.test(url) && !headers.has('x-goog-api-key')) {
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

async function attachVideoInputs(
  instance: Record<string, unknown>,
  input: MediaGenerateInput,
  artifact: MediaArtifactService,
): Promise<void> {
  const imageFiles = (input.inputFiles ?? []).filter((file) => file.type === 'image' || file.type === 'file')
  const firstFrame = imageFiles.find((file) => file.role === 'first_frame') ?? imageFiles[0]
  const lastFrame = imageFiles.find((file) => file.role === 'last_frame')
  const referenceFiles = imageFiles.filter((file) => file.role === 'reference').slice(0, 3)
  if (firstFrame) instance.image = { inlineData: await inlineImage(firstFrame, artifact) }
  if (lastFrame) instance.lastFrame = { inlineData: await inlineImage(lastFrame, artifact) }
  if (referenceFiles.length > 0) {
    instance.referenceImages = await Promise.all(
      referenceFiles.map(async (file) => ({
        image: { inlineData: await inlineImage(file, artifact) },
        referenceType: 'asset',
      })),
    )
  }
}

async function inlineImage(
  file: MediaInputFile,
  artifact: MediaArtifactService,
): Promise<{ mimeType: string; data: string }> {
  if (file.dataUrl) {
    const match = /^data:([^;,]+);base64,(.*)$/i.exec(file.dataUrl)
    return { mimeType: match?.[1] ?? file.mimeType ?? 'image/png', data: match?.[2] ?? file.dataUrl }
  }
  if (file.path) {
    const buffer = await artifact.readLocalFile(file.path)
    return { mimeType: file.mimeType ?? 'image/png', data: buffer.toString('base64') }
  }
  throw new MediaProviderError('invalid_input', 'Google media inputs require dataUrl or local path images')
}

function googleImageParams(
  modelParams: Record<string, unknown> | undefined,
  ctx: MediaProviderContext,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [source, target] of [
    ['size', 'size'],
    ['resolution', 'resolution'],
    ['n', 'candidate_count'],
    ['outputFormat', 'output_format'],
    ['output_format', 'output_format'],
  ] as const) {
    const value = modelParams?.[source]
    if (value !== undefined && value !== null && value !== '') params[target] = value
  }
  return filterByManifestSchema(ctx, params)
}

function googleVideoParams(
  modelParams: Record<string, unknown> | undefined,
  ctx: MediaProviderContext,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  const defaults = ctx.mediaDefaults?.video
  const values: Record<string, unknown> = {
    aspectRatio: modelParams?.aspectRatio ?? modelParams?.aspect_ratio ?? defaults?.aspectRatio,
    durationSeconds: modelParams?.durationSeconds ?? modelParams?.duration ?? defaults?.durationSeconds,
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
    const canonicalOfProvider = Object.entries(aliases).find(([, provider]) => provider === key)?.[0]
    if (canonicalOfProvider && (declared.has(canonicalOfProvider) || allow.has(canonicalOfProvider))) {
      filtered[key] = value
    }
  }
  return filtered
}

function googleTools(modelParams: Record<string, unknown> | undefined): Array<Record<string, string>> {
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

function googleInlineVideos(data: unknown): Array<{ data: string; mimeType: string }> {
  return findInlineData(data, ['video'])
}

function googleVideoUrls(data: unknown): string[] {
  return [...new Set([...extractMediaUrls(data, { kind: 'video' }), ...stringsByKey(data, ['uri'])])]
}

function findInlineData(data: unknown, parentKeys: string[]): Array<{ data: string; mimeType: string }> {
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
      dataValue.length > 64 &&
      (parentKeys.includes(parentKey) || record.mime_type || record.mimeType)
    ) {
      found.push({
        data: dataValue,
        mimeType: String(record.mime_type ?? record.mimeType ?? (parentKey === 'video' ? 'video/mp4' : 'image/png')),
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

function stringsByKey(data: unknown, keys: string[]): string[] {
  const values: string[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (keys.includes(key) && typeof child === 'string' && /^https?:\/\//i.test(child)) {
        values.push(child)
      }
      visit(child)
    }
  }
  visit(data)
  return values
}

function operationNameFrom(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const name = (data as Record<string, unknown>).name
  return typeof name === 'string' ? name : ''
}

function operationDone(data: unknown): boolean {
  return Boolean(data && typeof data === 'object' && (data as Record<string, unknown>).done === true)
}
