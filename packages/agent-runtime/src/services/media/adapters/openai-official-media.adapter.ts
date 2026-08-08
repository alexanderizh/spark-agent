import { DEFAULT_VIDEO_POLL_TIMEOUT_MS } from '@spark/protocol'
import type { MediaCapabilityId, MediaProviderKind } from '@spark/protocol'
import { MediaProviderError, mediaAdapterModelId } from '../media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaInputFile,
  MediaProviderAdapter,
  MediaProviderContext,
} from '../media-adapter.types.js'
import { MediaArtifactService } from '../media-artifact.service.js'
import { extractImages, fetchJson, pollTask } from '../media-http.util.js'
import { logMediaCall, logMediaResult } from '../media-debug-log.js'
import {
  configuredMediaInterfaceTimeoutMs,
  mediaPollTimeoutOptions,
  resolveMediaInterfaceTimeoutMs,
} from '../media-timeout.js'
import { filenameHelper } from './openai-compatible-media.adapter.js'

const CAPABILITIES: readonly MediaCapabilityId[] = [
  'image.generate',
  'image.edit',
  'video.generate',
  'video.image_to_video',
]

export class OpenAiOfficialMediaAdapter implements MediaProviderAdapter {
  readonly id: MediaProviderKind = 'openai-images'
  private readonly artifact = new MediaArtifactService()

  supports(capability: MediaCapabilityId): boolean {
    return CAPABILITIES.includes(capability)
  }

  async invoke(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    if (!ctx.apiKey) throw new MediaProviderError('api_key_missing', 'Missing OpenAI API key')
    const capability = input.capability
    if (!capability || !this.supports(capability)) {
      throw new MediaProviderError(
        'capability_not_supported',
        `openai-images does not support ${capability ?? '(unknown)'}`,
      )
    }
    if (capability === 'image.generate') return this.generateImage(input, ctx)
    if (capability === 'image.edit') return this.editImage(input, ctx)
    return this.generateVideo(input, ctx)
  }

  private async generateImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = requiredPrompt(input)
    const model = ctx.defaultModel
    const body = {
      model,
      prompt,
      ...openAiImageParams(input, ctx, false),
    }
    const url = `${baseEndpoint(ctx)}/images/generations`
    logMediaCall({
      provider: this.id,
      capability: input.capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120), stream: false },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: jsonHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 180_000),
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    return this.materializeImages(data, input, ctx, model, 'openai-image')
  }

  private async editImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = requiredPrompt(input)
    const model = ctx.defaultModel
    const files = input.inputFiles ?? []
    const imageFiles = files.filter(
      (file) => (file.type === 'image' || file.type === 'file') && file.role !== 'mask',
    )
    if (imageFiles.length === 0) {
      throw new MediaProviderError('invalid_input', 'OpenAI image edit requires at least one image')
    }
    const maxImages = ctx.mediaManifestCapability?.input.maxImages ?? 16
    if (imageFiles.length > maxImages) {
      throw new MediaProviderError(
        'invalid_input',
        `OpenAI image edit accepts at most ${maxImages} images`,
      )
    }
    const maskFile = files.find((file) => file.role === 'mask')
    const resolvedImages = await Promise.all(
      imageFiles.map((file, index) => resolveUpload(file, `image-${index + 1}`, ctx)),
    )
    const resolvedMask = maskFile ? await resolveUpload(maskFile, 'mask', ctx) : undefined
    const params = openAiImageParams(input, ctx, true)
    const form = buildMultipart({ model, prompt, ...params }, [
      ...resolvedImages.map((file) => ({ field: 'image[]', ...file })),
      ...(resolvedMask ? [{ field: 'mask', ...resolvedMask }] : []),
    ])
    const url = `${baseEndpoint(ctx)}/images/edits`
    logMediaCall({
      provider: this.id,
      capability: input.capability,
      model,
      method: 'POST',
      url,
      body: {
        model,
        prompt,
        ...params,
        images: resolvedImages.map((file) => `[multipart ${file.content.length} bytes]`),
        ...(resolvedMask ? { mask: `[multipart ${resolvedMask.content.length} bytes]` } : {}),
      },
      extra: { prompt: prompt.slice(0, 120), inputImages: resolvedImages.length },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ctx.apiKey}`,
        'content-type': form.contentType,
      },
      body: form.body,
      fetchImpl: ctx.fetch,
      timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 180_000),
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    return this.materializeImages(data, input, ctx, model, 'openai-edit')
  }

  private async materializeImages(
    data: unknown,
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
    model: string,
    suffix: string,
  ): Promise<MediaGenerateOutput> {
    const images = extractImages(data)
    if (images.length === 0) {
      throw new MediaProviderError(
        'provider_http_error',
        `No images in OpenAI response: ${JSON.stringify(data).slice(0, 800)}`,
      )
    }
    const assets = await Promise.all(
      images.map((image, index) =>
        this.artifact.writeImage(
          image,
          input.outputDir,
          filenameHelper(input, suffix, index, images.length),
          ctx.fetch,
          configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults),
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

  private async generateVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = requiredPrompt(input)
    const model = ctx.defaultModel
    const params = openAiVideoParams(input)
    const inputReference = (input.inputFiles ?? []).find(
      (file) => file.type === 'image' || file.type === 'file',
    )
    const url = `${baseEndpoint(ctx)}/videos`
    let headers: Record<string, string>
    let requestBody: string | Buffer
    let logBody: Record<string, unknown>
    if (inputReference?.url && /^https?:\/\//i.test(inputReference.url)) {
      const body = {
        model,
        prompt,
        ...params,
        input_reference: { image_url: inputReference.url },
      }
      headers = jsonHeaders(ctx)
      requestBody = JSON.stringify(body)
      logBody = body
    } else if (inputReference) {
      const upload = await resolveUpload(inputReference, 'input-reference', ctx)
      const form = buildMultipart({ model, prompt, ...params }, [
        { field: 'input_reference', ...upload },
      ])
      headers = {
        authorization: `Bearer ${ctx.apiKey}`,
        'content-type': form.contentType,
      }
      requestBody = form.body
      logBody = {
        model,
        prompt,
        ...params,
        input_reference: `[multipart ${upload.content.length} bytes]`,
      }
    } else {
      const body = { model, prompt, ...params }
      headers = jsonHeaders(ctx)
      requestBody = JSON.stringify(body)
      logBody = body
    }
    logMediaCall({
      provider: this.id,
      capability: input.capability,
      model,
      method: 'POST',
      url,
      body: logBody,
      extra: { prompt: prompt.slice(0, 120) },
    })
    const initial = await fetchJson(url, {
      method: 'POST',
      headers,
      body: requestBody,
      fetchImpl: ctx.fetch,
      timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 120_000),
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const videoId = stringAt(initial, 'id')
    if (!videoId) {
      throw new MediaProviderError(
        'provider_http_error',
        `No video id in response: ${JSON.stringify(initial).slice(0, 800)}`,
      )
    }
    ctx.onTaskSubmitted?.({ requestId: videoId, response: initial })
    const raw = await pollTask(
      `${baseEndpoint(ctx)}/videos/${encodeURIComponent(videoId)}`,
      jsonHeaders(ctx),
      {
        fetchImpl: ctx.fetch,
        intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 10_000,
        ...mediaPollTimeoutOptions(ctx.mediaDefaults, DEFAULT_VIDEO_POLL_TIMEOUT_MS),
        inspect: (payload) => {
          const status = stringAt(payload, 'status').toLowerCase()
          if (status === 'completed') return 'done'
          if (status === 'failed' || status === 'cancelled') return 'failed'
          return 'pending'
        },
        ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
      },
    )
    const contentUrl = `${baseEndpoint(ctx)}/videos/${encodeURIComponent(videoId)}/content`
    const buffer = await fetchJson<Buffer>(contentUrl, {
      headers: { authorization: `Bearer ${ctx.apiKey}` },
      fetchImpl: ctx.fetch,
      timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 300_000),
      binary: true,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const asset = await this.artifact.writeBinaryAsset(
      'video',
      buffer,
      input.outputDir,
      filenameHelper(input, 'sora', 0, 1),
      'video/mp4',
    )
    logMediaResult({
      provider: this.id,
      capability: input.capability,
      ok: true,
      assetCount: 1,
      requestId: videoId,
    })
    return {
      provider: this.id,
      model,
      mode: 'async',
      requestId: videoId,
      assets: [asset],
      rawResponse: raw,
    }
  }
}

function requiredPrompt(input: MediaGenerateInput): string {
  const prompt = (input.prompt ?? '').trim()
  if (!prompt) throw new MediaProviderError('invalid_input', 'prompt is required')
  return prompt
}

function baseEndpoint(ctx: MediaProviderContext): string {
  return (ctx.apiEndpoint || 'https://api.openai.com/v1').replace(/\/+$/, '')
}

function jsonHeaders(ctx: MediaProviderContext): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${ctx.apiKey}` }
}

function openAiImageParams(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
  editing: boolean,
): Record<string, unknown> {
  const source = input.modelParams ?? {}
  const defaults = ctx.mediaDefaults?.image
  const values: Record<string, unknown> = {
    size: source.size ?? defaults?.size,
    quality: source.quality ?? defaults?.quality,
    background: source.background,
    moderation: source.moderation,
    n: source.n ?? defaults?.n,
    output_format: source.outputFormat ?? source.output_format ?? defaults?.outputFormat,
    output_compression: source.outputCompression ?? source.output_compression,
    user: source.user,
    ...(editing && !mediaAdapterModelId(ctx).startsWith('gpt-image-2')
      ? { input_fidelity: source.inputFidelity ?? source.input_fidelity }
      : {}),
  }
  return compact(values)
}

function openAiVideoParams(input: MediaGenerateInput): Record<string, unknown> {
  const source = input.modelParams ?? {}
  return compact({ seconds: source.seconds ?? source.durationSeconds, size: source.size })
}

function compact(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    ),
  )
}

function stringAt(value: unknown, key: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const next = (value as Record<string, unknown>)[key]
  return typeof next === 'string' ? next : ''
}

async function resolveUpload(
  file: MediaInputFile,
  fallbackName: string,
  ctx: MediaProviderContext,
): Promise<{ filename: string; contentType: string; content: Buffer }> {
  if (file.dataUrl) {
    const match = /^data:([^;,]+);base64,(.*)$/i.exec(file.dataUrl)
    if (!match?.[2]) throw new MediaProviderError('invalid_input', 'Invalid base64 image input')
    const mimeType = match[1] ?? file.mimeType ?? 'image/png'
    return {
      filename: `${fallbackName}.${extensionForMime(mimeType)}`,
      contentType: mimeType,
      content: Buffer.from(match[2], 'base64'),
    }
  }
  if (file.path) {
    const content = await new MediaArtifactService().readLocalFile(file.path)
    const mimeType = file.mimeType ?? 'image/png'
    return {
      filename: file.path.split(/[\\/]/).pop() || `${fallbackName}.${extensionForMime(mimeType)}`,
      contentType: mimeType,
      content,
    }
  }
  if (file.url && /^https?:\/\//i.test(file.url)) {
    const response = await (ctx.fetch ?? fetch)(file.url)
    if (!response.ok) {
      throw new MediaProviderError(
        'artifact_download_failed',
        `Failed to read input image: HTTP ${response.status}`,
      )
    }
    const mimeType =
      response.headers.get('content-type')?.split(';')[0] || file.mimeType || 'image/png'
    return {
      filename: `${fallbackName}.${extensionForMime(mimeType)}`,
      contentType: mimeType,
      content: Buffer.from(await response.arrayBuffer()),
    }
  }
  throw new MediaProviderError('invalid_input', 'OpenAI media input requires path, dataUrl, or URL')
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('jpeg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  return 'png'
}

function buildMultipart(
  fields: Record<string, unknown>,
  files: Array<{ field: string; filename: string; contentType: string; content: Buffer }>,
): { body: Buffer; contentType: string } {
  const boundary = `----spark-openai-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeHeader(name)}"\r\n\r\n${String(value)}\r\n`,
      ),
    )
  }
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeHeader(file.field)}"; filename="${escapeHeader(file.filename)}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
    )
    chunks.push(file.content)
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

function escapeHeader(value: string): string {
  return value.replace(/["\r\n]/g, '_')
}
