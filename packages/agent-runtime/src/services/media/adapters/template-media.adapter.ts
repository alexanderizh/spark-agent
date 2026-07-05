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
import { logMediaCall } from '../media-debug-log.js'
import { compileMediaRequest } from '../media-request-compiler.js'
import { filenameHelper, mimeFromFormat } from './openai-compatible-media.adapter.js'

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
    const compiled = compileMediaRequest({
      manifest,
      capability,
      modelId: model,
      input: {
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        modelParams: input.modelParams,
        inputFiles: (input.inputFiles ?? []).map((file) => ({
          type: file.type,
          role: file.role,
        })),
      },
      mode: 'adapter',
    })
    const blockingIssue = compiled.validationIssues.find((issue) => issue.severity === 'error')
    if (blockingIssue) {
      throw new MediaProviderError('invalid_input', blockingIssue.message)
    }

    const variables = buildVariables(input, capability, model, compiled.providerParams, compiled.canonicalParams)
    const endpoint = renderTemplateString(manifest.invocation.endpoint, variables)
    const url = resolveUrl(ctx.apiEndpoint, endpoint)
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${ctx.apiKey}`,
      ...(manifest.invocation.headers ? renderHeaders(manifest.invocation.headers, variables) : {}),
    }

    const requestBody = renderTemplate(manifest.invocation.requestTemplate, variables)
    const body = mergeProviderParams(requestBody, variables.providerParams)
    logMediaCall({
      provider: manifest.providerKind,
      capability: input.capability,
      model,
      method: manifest.invocation.method,
      url,
      body,
      extra: {
        manifest: manifest.id,
        prompt: (input.prompt ?? '').slice(0, 120),
        mode: manifest.invocation.mode,
      },
    })
    let raw = await fetchJson(url, {
      method: manifest.invocation.method,
      headers,
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      binary: manifest.invocation.response.kind === 'binary_response',
      ...(manifest.error ? { errorContract: manifest.error } : {}),
    })
    let mode: 'sync' | 'async' = manifest.invocation.mode === 'async_polling' ? 'async' : 'sync'
    let requestId: string | undefined

    if (manifest.invocation.response.kind === 'task_poll') {
      const immediateResult = firstStringAtPaths(raw, manifest.invocation.response.resultPaths)
      if (!immediateResult) {
        const taskId = firstStringAtPaths(raw, manifest.invocation.response.taskIdPaths)
        if (!taskId) {
          throw new MediaProviderError('provider_http_error', `No task id in response: ${JSON.stringify(raw).slice(0, 800)}`)
        }
        requestId = taskId
        mode = 'async'
        raw = await this.pollManifestTask(manifest, taskId, ctx, headers)
      }
    }

    const assets = await this.materialize(manifest.invocation.response, raw, input, capability, ctx)
    return {
      provider: manifest.providerKind,
      model,
      mode,
      ...(requestId ? { requestId } : {}),
      assets,
      rawResponse: raw,
      ...(compiled.droppedParams.length > 0 ? { droppedParams: compiled.droppedParams } : {}),
      ...(compiled.warnings.length > 0 ? { contractWarnings: compiled.warnings } : {}),
      ...(compiled.validationIssues.length > 0 ? { contractIssues: compiled.validationIssues } : {}),
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
      ...(manifest.error ? { errorContract: manifest.error } : {}),
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
  providerParams: Record<string, unknown> = {},
  canonicalParams: Record<string, unknown> = providerParams,
): Record<string, unknown> {
  const inputFiles = input.inputFiles ?? []
  const resolveRef = (file: typeof inputFiles[number] | undefined): string => {
    if (!file) return ''
    if (file.url && /^https?:\/\//i.test(file.url)) return file.url
    if (file.dataUrl) return file.dataUrl
    if (file.url && !file.url.startsWith('safe-file://')) return file.url
    return file.path ?? ''
  }
  const imageFiles = inputFiles.filter((file) => file.type === 'image' || file.type === 'file')
  const videoFiles = inputFiles.filter((file) => file.type === 'video' || (file.type === 'file' && file.role === 'input'))
  const imageRefs = imageFiles.map(resolveRef).filter((value) => value.length > 0)
  const videoRefs = videoFiles.map(resolveRef).filter((value) => value.length > 0)
  const firstFrame = imageFiles.find((file) => file.role === 'first_frame')
  const lastFrame = imageFiles.find((file) => file.role === 'last_frame')
  const referenceFiles = imageFiles.some((file) => file.role === 'reference')
    ? imageFiles.filter((file) => file.role === 'reference')
    : imageFiles.filter((file) => file !== (firstFrame ?? imageFiles[0]) && file !== lastFrame)
  void capability

  // 百炼视频系列（HappyHorse 全系列 + Wan 2.7 全系列）共用 input.media: [{type, url}]
  // 数组结构。元素 type 覆盖：video / first_frame / last_frame / reference_image /
  // driving_audio（Wan i2v/t2v 驱动音频）。
  // 严格按 inputFiles 的 role 聚合成数组，空 url 自动跳过，避免模板渲染出
  // `{type:'first_frame', url:''}` 这种畸形元素导致平台 400。
  // 注意：不沿用 `firstFrame || imageRefs[0]` 兜底——media 数组必须严格按 role，
  // 否则参考图会被误判为首帧。
  // 元素顺序：video 优先（对齐 video-edit 文档示例，待编辑视频排在参考图之前），
  // 其后 first_frame / last_frame / reference_image / driving_audio。
  const audioFiles = inputFiles.filter((file) => file.type === 'audio')
  const audioRefs = audioFiles.map(resolveRef).filter((value) => value.length > 0)
  const bailianMedia: Array<{ type: string; url: string }> = []
  if (videoRefs[0]) bailianMedia.push({ type: 'video', url: videoRefs[0] })
  if (resolveRef(firstFrame)) bailianMedia.push({ type: 'first_frame', url: resolveRef(firstFrame) })
  if (resolveRef(lastFrame)) bailianMedia.push({ type: 'last_frame', url: resolveRef(lastFrame) })
  for (const ref of referenceFiles.map(resolveRef).filter(Boolean)) {
    bailianMedia.push({ type: 'reference_image', url: ref })
  }
  for (const ref of audioRefs) {
    bailianMedia.push({ type: 'driving_audio', url: ref })
  }

  return {
    modelId,
    prompt: input.prompt ?? '',
    text: input.prompt ?? '',
    negativePrompt: input.negativePrompt ?? '',
    inputFiles,
    image: imageRefs[0] ?? '',
    imageUrl: imageRefs[0] ?? '',
    images: imageRefs,
    inputImages: imageRefs,
    inputImageUrls: imageRefs,
    imageUrls: imageRefs,
    firstFrame: resolveRef(firstFrame) || imageRefs[0] || '',
    firstFrameImage: resolveRef(firstFrame) || imageRefs[0] || '',
    lastFrame: resolveRef(lastFrame) || '',
    lastFrameImage: resolveRef(lastFrame) || '',
    referenceImages: referenceFiles.map(resolveRef).filter(Boolean),
    referenceImageUrls: referenceFiles.map(resolveRef).filter(Boolean),
    video: videoRefs[0] || '',
    videoUrl: videoRefs[0] || '',
    videos: videoRefs,
    inputVideos: videoRefs,
    inputVideoUrls: videoRefs,
    firstClip: videoRefs[0] || '',
    audio: audioRefs[0] || '',
    audioUrl: audioRefs[0] || '',
    media: bailianMedia,
    params: canonicalParams,
    providerParams,
    ...canonicalParams,
  }
}

function renderHeaders(headers: Record<string, unknown>, variables: Record<string, unknown>): Record<string, string> {
  const rendered: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const next = renderTemplate(value, variables)
    if (next === undefined || next === null || next === '') continue
    rendered[key] = typeof next === 'string' ? next : JSON.stringify(next)
  }
  return rendered
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
