/**
 * Manifest-driven media adapter.
 *
 * This adapter turns MediaModelManifest invocation metadata into a provider HTTP
 * call. Platform-specific adapters still handle richer protocols, while this
 * covers the common "JSON submit + optional polling + url/base64/binary result"
 * shape used by many media providers and aggregators.
 */

import type {
  MediaArtifactRetrieval,
  MediaCapabilityId,
  MediaModelCapabilityManifest,
  MediaModelManifest,
} from '@spark/protocol'
import { MediaProviderError } from '../media-adapter.types.js'
import type {
  MediaArtifactType,
  MediaGeneratedAsset,
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaProviderContext,
} from '../media-adapter.types.js'
import { MediaArtifactService } from '../media-artifact.service.js'
import { extractStatus, fetchJson, pollTask } from '../media-http.util.js'
import { filenameHelper, mimeFromFormat } from './openai-compatible-media.adapter.js'

type TemplateValue = string | number | boolean | null | TemplateValue[] | { [key: string]: TemplateValue }

export class TemplateMediaAdapter {
  private readonly artifact = new MediaArtifactService()

  supports(manifest: MediaModelManifest, capability: MediaCapabilityId): boolean {
    return manifest.capabilities.some((item) => item.id === capability)
  }

  async invoke(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const manifest = ctx.mediaManifest
    const capability = ctx.mediaManifestCapability
    if (!manifest || !capability) {
      throw new MediaProviderError('provider_not_configured', 'Manifest adapter requires mediaManifest context')
    }
    if (!input.capability || !this.supports(manifest, input.capability)) {
      throw new MediaProviderError('capability_not_supported', `${manifest.id} does not support ${input.capability ?? '(unknown)'}`)
    }
    if (manifest.invocation.contentType !== 'json') {
      throw new MediaProviderError('capability_not_supported', `Manifest contentType ${manifest.invocation.contentType} is not supported yet`)
    }

    const model = ctx.defaultModel || manifest.modelId
    const variables = buildVariables(input, capability, model)
    const endpoint = renderTemplateString(manifest.invocation.endpoint, variables)
    const url = resolveUrl(ctx.apiEndpoint, endpoint)
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${ctx.apiKey}`,
    }

    const requestBody = renderTemplate(manifest.invocation.requestTemplate, variables)
    const body = mergeProviderParams(requestBody, variables.providerParams)
    let raw = await fetchJson(url, {
      method: manifest.invocation.method,
      headers,
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      binary: manifest.invocation.response.kind === 'binary_response',
    })
    let mode: 'sync' | 'async' = manifest.invocation.mode === 'async_polling' ? 'async' : 'sync'
    let requestId: string | undefined

    if (manifest.invocation.response.kind === 'task_poll') {
      const taskId = firstStringAtPaths(raw, manifest.invocation.response.taskIdPaths)
      if (!taskId) {
        throw new MediaProviderError('provider_http_error', `No task id in response: ${JSON.stringify(raw).slice(0, 800)}`)
      }
      requestId = taskId
      mode = 'async'
      raw = await this.pollManifestTask(manifest, taskId, ctx, headers)
    }

    const assets = await this.materialize(manifest.invocation.response, raw, input, capability, ctx)
    return {
      provider: manifest.providerKind,
      model,
      mode,
      ...(requestId ? { requestId } : {}),
      assets,
      rawResponse: raw,
    }
  }

  private async pollManifestTask(
    manifest: MediaModelManifest,
    taskId: string,
    ctx: MediaProviderContext,
    headers: Record<string, string>,
  ): Promise<unknown> {
    const response = manifest.invocation.response
    if (response.kind !== 'task_poll') return null
    const polling = manifest.invocation.polling
    const pollUrl = resolveUrl(
      ctx.apiEndpoint,
      renderTemplateString(response.statusEndpoint, { taskId }),
    )
    return pollTask(pollUrl, headers, {
      fetchImpl: ctx.fetch,
      intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? polling?.intervalMs ?? 5_000,
      timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? polling?.timeoutMs ?? 600_000,
      inspect: (data) => {
        if (firstStringAtPaths(data, response.resultPaths)) return 'done'
        const rawStatus = extractStatus(data).toLowerCase()
        const mapped = polling?.statusMap[rawStatus]
        if (mapped === 'succeeded') return 'done'
        if (mapped === 'failed' || mapped === 'cancelled') return 'failed'
        return 'pending'
      },
    })
  }

  private async materialize(
    retrieval: MediaArtifactRetrieval,
    data: unknown,
    input: MediaGenerateInput,
    capability: MediaModelCapabilityManifest,
    ctx: MediaProviderContext,
  ): Promise<MediaGeneratedAsset[]> {
    const outputKind = primaryOutputKind(capability)
    if (retrieval.kind === 'binary_response') {
      const buffer = Buffer.isBuffer(data) ? data : null
      if (!buffer) throw new MediaProviderError('provider_http_error', 'binary_response did not return binary data')
      const name = filenameHelper(input, outputKind, 0, 1)
      if (outputKind === 'audio' || outputKind === 'video') {
        return [await this.artifact.writeBinaryAsset(outputKind, buffer, input.outputDir, name, defaultMime(outputKind, input))]
      }
      if (outputKind === 'image') {
        return [await this.artifact.writeImage({ kind: 'base64', value: buffer.toString('base64'), mimeType: 'image/png' }, input.outputDir, name, ctx.fetch)]
      }
      return [await this.artifact.writeTextAsset(buffer.toString('utf8'), input.outputDir, name)]
    }
    if (retrieval.kind === 'inline_base64') {
      const values = stringsAtPaths(data, retrieval.jsonPaths)
      return this.materializeStrings(values, outputKind, input, ctx, { inlineBase64: true })
    }
    if (retrieval.kind === 'url') {
      const values = stringsAtPaths(data, retrieval.jsonPaths)
      return this.materializeStrings(values, outputKind, input, ctx, { download: retrieval.download })
    }
    if (retrieval.kind === 'task_poll') {
      const values = stringsAtPaths(data, retrieval.resultPaths)
      return this.materializeStrings(values, outputKind, input, ctx, { download: true })
    }
    return []
  }

  private async materializeStrings(
    values: string[],
    outputKind: MediaArtifactType,
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
    options: { download?: boolean; inlineBase64?: boolean },
  ): Promise<MediaGeneratedAsset[]> {
    if (values.length === 0) {
      throw new MediaProviderError('provider_http_error', 'No media artifacts in manifest response')
    }
    return Promise.all(values.map(async (value, index) => {
      const name = filenameHelper(input, outputKind, index, values.length)
      if (outputKind === 'text') {
        return this.artifact.writeTextAsset(value, input.outputDir, name)
      }
      if (isHttpUrl(value)) {
        if (outputKind === 'image') {
          if (options.download === false) return { type: 'image', url: value, raw: { url: value } }
          return this.artifact.writeImage({ kind: 'url', value }, input.outputDir, name, ctx.fetch)
        }
        if (outputKind === 'audio' || outputKind === 'video') {
          if (options.download === false) return { type: outputKind, url: value, raw: { url: value } }
          return this.artifact.downloadMediaAsset(outputKind, value, input.outputDir, name, ctx.fetch)
        }
      }
      if (outputKind === 'image') {
        return this.artifact.writeImage(
          { kind: 'base64', value: normalizeBase64(value), mimeType: mimeFromDataUrl(value) ?? 'image/png' },
          input.outputDir,
          name,
          ctx.fetch,
        )
      }
      if (outputKind === 'audio' || outputKind === 'video') {
        const buffer = Buffer.from(normalizeBase64(value), 'base64')
        return this.artifact.writeBinaryAsset(outputKind, buffer, input.outputDir, name, mimeFromDataUrl(value) ?? defaultMime(outputKind, input))
      }
      return this.artifact.writeTextAsset(value, input.outputDir, name)
    }))
  }
}

export function buildVariables(
  input: MediaGenerateInput,
  capability: MediaModelCapabilityManifest,
  modelId: string,
): Record<string, unknown> {
  const inputFiles = input.inputFiles ?? []
  const imageRefs = inputFiles
    .filter((file) => file.type === 'image' || file.type === 'file')
    .map((file) => file.url ?? file.dataUrl ?? file.path ?? '')
    .filter((value) => value.length > 0)
  const params = {
    ...(capability.defaults ?? {}),
    ...(input.modelParams ?? {}),
  }
  const providerParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    const providerKey = capability.aliases?.[key] ?? key
    providerParams[providerKey] = value
  }
  return {
    modelId,
    prompt: input.prompt ?? '',
    text: input.prompt ?? '',
    negativePrompt: input.negativePrompt ?? '',
    inputFiles,
    image: imageRefs[0] ?? '',
    images: imageRefs,
    params,
    providerParams,
    ...params,
  }
}

function mergeProviderParams(body: unknown, providerParams: unknown): unknown {
  if (!isPlainRecord(body) || !isPlainRecord(providerParams)) return body
  const next: Record<string, unknown> = { ...body }
  for (const [key, value] of Object.entries(providerParams)) {
    if (value !== undefined && value !== null && value !== '') next[key] = value
  }
  return next
}

function renderTemplate(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === 'string') return renderTemplateStringOrValue(value, variables)
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, variables)).filter((item) => item !== undefined)
  if (isPlainRecord(value)) {
    const rendered: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const next = renderTemplate(child, variables)
      if (next !== undefined && next !== '') rendered[key] = next
    }
    return rendered
  }
  return value
}

function renderTemplateStringOrValue(template: string, variables: Record<string, unknown>): unknown {
  const exact = template.match(/^{{\s*([^}]+?)\s*}}$/)
  if (exact) return getPath(variables, exact[1]?.trim() ?? '')
  return renderTemplateString(template, variables)
}

function renderTemplateString(template: string, variables: Record<string, unknown>): string {
  return template.replace(/{{\s*([^}]+?)\s*}}/g, (_match, key: string) => {
    const value = getPath(variables, key.trim())
    return value == null ? '' : String(value)
  })
}

function resolveUrl(base: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint
  const cleanBase = base.replace(/\/+$/, '')
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  return `${cleanBase}${cleanEndpoint}`
}

function primaryOutputKind(capability: MediaModelCapabilityManifest): MediaArtifactType {
  const [first] = capability.output.types
  if (first === 'audio' || first === 'video' || first === 'text') return first
  return 'image'
}

function stringsAtPaths(data: unknown, paths: string[]): string[] {
  const values = paths.flatMap((path) => valuesAtPath(data, path))
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)))
}

function firstStringAtPaths(data: unknown, paths: string[]): string {
  return stringsAtPaths(data, paths)[0] ?? ''
}

function valuesAtPath(root: unknown, path: string): unknown[] {
  const parts = path.split('.').filter(Boolean)
  let current: unknown[] = [root]
  for (const part of parts) {
    const arrayPart = part.endsWith('[]') ? part.slice(0, -2) : null
    const key = arrayPart ?? part
    const next: unknown[] = []
    for (const item of current) {
      const value = key ? getProperty(item, key) : item
      if (arrayPart != null) {
        if (Array.isArray(value)) next.push(...value)
      } else {
        next.push(value)
      }
    }
    current = next
  }
  return current.filter((value) => value !== undefined && value !== null)
}

function getPath(root: unknown, path: string): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((value, key) => getProperty(value, key), root)
}

function getProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>)[key]
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function normalizeBase64(value: string): string {
  const comma = value.indexOf(',')
  return value.startsWith('data:') && comma >= 0 ? value.slice(comma + 1) : value
}

function mimeFromDataUrl(value: string): string | undefined {
  const match = value.match(/^data:([^;,]+)[;,]/)
  return match?.[1]
}

function defaultMime(kind: 'audio' | 'video', input: MediaGenerateInput): string {
  const format = typeof input.modelParams?.format === 'string' ? input.modelParams.format : ''
  if (kind === 'audio') return mimeFromFormat(format || 'mp3')
  return 'video/mp4'
}
