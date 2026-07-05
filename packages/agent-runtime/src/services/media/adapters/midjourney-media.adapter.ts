/**
 * Midjourney external gateway adapter.
 *
 * Midjourney does not publish an official HTTP API in its public docs. This
 * adapter intentionally targets user-owned gateway services that expose a
 * simple submit + poll shape, so Spark can route canvas/skill tasks without
 * hard-coding Discord automation.
 */

import type { MediaCapabilityId } from '@spark/protocol'
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
  extractStatus,
  extractTaskId,
  fetchJson,
  pollTask,
} from '../media-http.util.js'
import { logMediaCall, logMediaResult } from '../media-debug-log.js'
import { filenameHelper } from './openai-compatible-media.adapter.js'

const FAILED_STATUSES = ['failed', 'error', 'cancelled', 'canceled', 'rejected']

export class MidjourneyMediaAdapter implements MediaProviderAdapter {
  readonly id = 'midjourney' as const
  private readonly artifact = new MediaArtifactService()
  private readonly capabilities = new Set<MediaCapabilityId>([
    'image.generate',
    'image.edit',
    'image.variations',
  ])

  supports(capability: MediaCapabilityId): boolean {
    return this.capabilities.has(capability)
  }

  async invoke(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    if (!ctx.apiKey) throw new MediaProviderError('api_key_missing', 'Missing Midjourney gateway API key')
    const capability = input.capability
    if (!capability || !this.supports(capability)) {
      throw new MediaProviderError('capability_not_supported', `midjourney does not support ${capability ?? '(unknown)'}`)
    }
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) throw new MediaProviderError('invalid_input', 'prompt is required')
    const model = ctx.defaultModel
    const imageUrls = (input.inputFiles ?? [])
      .filter((file) => file.type === 'image' || file.type === 'file')
      .map((file) => file.url ?? file.dataUrl ?? file.path ?? '')
      .filter((value) => value.length > 0)
    const body: Record<string, unknown> = {
      model,
      prompt,
      ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      ...(imageUrls.length > 0 ? { image_urls: imageUrls } : {}),
      ...(input.modelParams ?? {}),
      ...(ctx.extraParams ?? {}),
    }
    const endpoint = endpointFor(ctx, capability)
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url: endpoint,
      body,
      extra: { prompt: prompt.slice(0, 120), inputImages: imageUrls.length },
    })
    const data = await fetchJson(endpoint, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    let raw = data
    let images = extractImages(raw)
    let requestId: string | undefined
    let mode: 'sync' | 'async' = 'sync'
    if (images.length === 0) {
      const taskId = extractTaskId(data)
      if (!taskId) {
        throw new MediaProviderError('provider_http_error', `No images or task id in response: ${JSON.stringify(data).slice(0, 800)}`)
      }
      requestId = taskId
      mode = 'async'
      raw = await pollTask(statusEndpointFor(ctx, taskId), authHeaders(ctx), {
        fetchImpl: ctx.fetch,
        intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
        timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 900_000,
        inspect: (payload) => {
          if (extractImages(payload).length > 0) return 'done'
          return FAILED_STATUSES.includes(extractStatus(payload)) ? 'failed' : 'pending'
        },
        ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
      })
      images = extractImages(raw)
    }
    if (images.length === 0) {
      throw new MediaProviderError('provider_http_error', `No images in response: ${JSON.stringify(raw).slice(0, 800)}`)
    }
    const assets = await Promise.all(
      images.map((image, index) =>
        this.artifact.writeImage(image, input.outputDir, filenameHelper(input, 'midjourney', index, images.length), ctx.fetch),
      ),
    )
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: assets.length, requestId })
    return { provider: this.id, model, mode, ...(requestId ? { requestId } : {}), assets, rawResponse: raw }
  }
}

function baseEndpoint(ctx: MediaProviderContext): string {
  return (ctx.apiEndpoint || '').replace(/\/+$/, '')
}

function endpointFor(ctx: MediaProviderContext, capability: MediaCapabilityId): string {
  const base = baseEndpoint(ctx)
  if (!base) throw new MediaProviderError('provider_not_configured', 'Midjourney gateway endpoint is required')
  const configured = typeof ctx.extraParams?.submitPath === 'string' ? ctx.extraParams.submitPath : ''
  if (configured) return `${base}${configured.startsWith('/') ? configured : `/${configured}`}`
  if (capability === 'image.variations') return `${base}/variations`
  if (capability === 'image.edit') return `${base}/imagine`
  return `${base}/imagine`
}

function statusEndpointFor(ctx: MediaProviderContext, taskId: string): string {
  const base = baseEndpoint(ctx)
  const configured = typeof ctx.extraParams?.statusPath === 'string'
    ? ctx.extraParams.statusPath
    : `/tasks/${encodeURIComponent(taskId)}`
  return `${base}${configured.replace('{{taskId}}', encodeURIComponent(taskId)).startsWith('/') ? '' : '/'}${configured.replace('{{taskId}}', encodeURIComponent(taskId))}`
}

function authHeaders(ctx: MediaProviderContext): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${ctx.apiKey}`,
  }
}
