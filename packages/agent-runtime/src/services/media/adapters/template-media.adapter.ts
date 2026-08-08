/**
 * Manifest-driven media adapter.
 *
 * This adapter turns MediaModelManifest invocation metadata into a provider HTTP
 * call. Platform-specific adapters still handle richer protocols, while this
 * covers the common "JSON submit + optional polling + url/base64/binary result"
 * shape used by many media providers and aggregators.
 */

import { randomUUID } from 'node:crypto'
import type {
  MediaArtifactRetrieval,
  MediaCapabilityId,
  MediaModelCapabilityManifest,
  MediaModelManifest,
  MediaInvocationRequest,
  MediaTaskIdPlacement,
} from '@spark/protocol'
import { migrateMediaModelManifestToV2 } from '@spark/protocol'
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
import {
  compileInvocationRequest,
  executeMediaUploads,
  legacyInvocationRequest,
} from '../media-invocation-compiler.js'
import { logMediaDiag } from '../media-debug-log.js'
import {
  configuredMediaInterfaceTimeoutMs,
  mediaPollTimeoutOptions,
  resolveMediaInterfaceTimeoutMs,
} from '../media-timeout.js'
import { filenameHelper, mimeFromFormat } from './openai-compatible-media.adapter.js'

export class TemplateMediaAdapter {
  private readonly artifact = new MediaArtifactService()

  supports(manifest: MediaModelManifest, capability: MediaCapabilityId): boolean {
    return manifest.capabilities.some((item) => item.id === capability)
  }

  async invoke(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    const rawManifest = ctx.mediaManifest
    const capability = ctx.mediaManifestCapability
    if (!rawManifest || !capability) {
      throw new MediaProviderError(
        'provider_not_configured',
        'Manifest adapter requires mediaManifest context',
      )
    }
    // 只在执行边界做内存迁移，避免旧 Provider 列表/模型目录的展示数据被悄悄改形；
    // 迁移结果不回写存储，旧 manifest 仍可由旧版本导入和读取。
    const manifest = migrateMediaModelManifestToV2(rawManifest)
    const traceId = randomUUID()
    if (!input.capability || !this.supports(manifest, input.capability)) {
      throw new MediaProviderError(
        'capability_not_supported',
        `${manifest.id} does not support ${input.capability ?? '(unknown)'}`,
      )
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
      ...(ctx.skipParameterValidation ? { skipParameterValidation: true } : {}),
    })
    const blockingIssue = compiled.validationIssues.find((issue) => issue.severity === 'error')
    if (blockingIssue && !ctx.skipParameterValidation) {
      throw new MediaProviderError('invalid_input', blockingIssue.message)
    }

    const variables = buildVariables(
      input,
      capability,
      model,
      compiled.providerParams,
      compiled.canonicalParams,
    )
    const uploads = await executeMediaUploads(manifest.invocation.uploads, input.inputFiles, {
      apiEndpoint: ctx.apiEndpoint,
      apiKey: ctx.apiKey,
      fetchImpl: ctx.fetch,
      variables,
    })
    const invocationVariables = { ...variables, uploads }
    const legacy = manifest.invocation.request == null
    const baseRequest =
      manifest.invocation.request ??
      legacyInvocationRequest({
        endpoint: manifest.invocation.endpoint,
        method: manifest.invocation.method,
        headers: manifest.invocation.headers,
        requestTemplate: manifest.invocation.requestTemplate,
        contentType: manifest.invocation.contentType,
      })
    const request =
      baseRequest.body?.kind === 'json'
        ? {
            ...baseRequest,
            body: {
              kind: 'json' as const,
              template: mergeProviderParams(baseRequest.body.template, variables.providerParams),
            },
          }
        : baseRequest
    const compiledInvocation = await compileInvocationRequest(request, {
      apiEndpoint: ctx.apiEndpoint,
      apiKey: ctx.apiKey,
      variables: invocationVariables,
      inputFiles: input.inputFiles,
      defaultAuth:
        request.auth?.kind === 'inherit'
          ? { kind: 'bearer', credentialRef: 'apiKey' }
          : request.auth,
      ...(legacy ? { allowReservedHeaders: true } : {}),
    })
    logMediaDiag('template-invocation-compiled', {
      traceId,
      provider: manifest.providerKind,
      manifest: manifest.id,
      capability: input.capability,
      method: compiledInvocation.method,
      url: compiledInvocation.url,
      legacy,
      bodyKind: request.body?.kind ?? 'none',
    })
    logMediaCall({
      provider: manifest.providerKind,
      capability: input.capability,
      model,
      method: compiledInvocation.method,
      url: compiledInvocation.url,
      body: summarizeInvocationBody(compiledInvocation.body),
      extra: {
        traceId,
        manifest: manifest.id,
        prompt: (input.prompt ?? '').slice(0, 120),
        mode: manifest.invocation.mode,
      },
    })
    let raw = await fetchJson(compiledInvocation.url, {
      method: compiledInvocation.method,
      headers: compiledInvocation.headers,
      ...(compiledInvocation.body !== undefined ? { body: compiledInvocation.body } : {}),
      fetchImpl: ctx.fetch,
      timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 60_000),
      binary:
        compiledInvocation.binaryResponse ||
        manifest.invocation.response.kind === 'binary_response',
      ...(manifest.error ? { errorContract: manifest.error } : {}),
    })
    let mode: 'sync' | 'async' = manifest.invocation.mode === 'async_polling' ? 'async' : 'sync'
    let requestId: string | undefined
    let retrieval: MediaArtifactRetrieval = manifest.invocation.response

    if (manifest.invocation.response.kind === 'task_poll') {
      const immediateResult = firstStringAtPaths(raw, manifest.invocation.response.resultPaths)
      if (!immediateResult) {
        const taskId = firstStringAtPaths(raw, manifest.invocation.response.taskIdPaths)
        if (!taskId) {
          throw new MediaProviderError(
            'provider_http_error',
            `No task id in response: ${JSON.stringify(raw).slice(0, 800)}`,
          )
        }
        requestId = taskId
        mode = 'async'
        ctx.onTaskSubmitted?.({ requestId: taskId, response: raw })
        raw = await this.pollManifestTask(manifest, taskId, ctx, request, traceId)
      }
      const artifact = manifest.invocation.response.artifact
      if (artifact && requestId) {
        const artifactRequest = {
          ...artifact.request,
          endpoint: artifact.request.endpoint.replace(
            /\{\{\s*taskId\s*\}\}|\{taskId\}/g,
            encodeURIComponent(requestId),
          ),
        }
        const compiledArtifact = await compileInvocationRequest(artifactRequest, {
          apiEndpoint: ctx.apiEndpoint,
          apiKey: ctx.apiKey,
          variables: { taskId: requestId, poll: raw },
          inputFiles: [],
          defaultAuth: request.auth ?? { kind: 'bearer', credentialRef: 'apiKey' },
        })
        logMediaDiag('template-artifact-request-compiled', {
          traceId,
          provider: manifest.providerKind,
          manifest: manifest.id,
          method: compiledArtifact.method,
          url: compiledArtifact.url,
          requestId: requestId.slice(0, 80),
          responseKind: artifact.response.kind,
        })
        raw = await fetchJson(compiledArtifact.url, {
          method: compiledArtifact.method,
          headers: compiledArtifact.headers,
          ...(compiledArtifact.body !== undefined ? { body: compiledArtifact.body } : {}),
          fetchImpl: ctx.fetch,
          timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 300_000),
          binary: artifact.response.kind === 'binary_response',
          ...(manifest.error ? { errorContract: manifest.error } : {}),
        })
        retrieval = artifact.response
        logMediaDiag('template-artifact-request-finished', {
          traceId,
          provider: manifest.providerKind,
          manifest: manifest.id,
          requestId: requestId.slice(0, 80),
          responseKind: artifact.response.kind,
        })
      }
    }

    const assets = await this.materialize(retrieval, raw, input, capability, ctx)
    logMediaDiag('template-invocation-finished', {
      traceId,
      provider: manifest.providerKind,
      manifest: manifest.id,
      mode,
      assets: assets.length,
      requestId,
    })
    return {
      provider: manifest.providerKind,
      model,
      mode,
      ...(requestId ? { requestId } : {}),
      assets,
      rawResponse: raw,
      ...(compiled.droppedParams.length > 0 ? { droppedParams: compiled.droppedParams } : {}),
      ...(compiled.warnings.length > 0 ? { contractWarnings: compiled.warnings } : {}),
      ...(compiled.validationIssues.length > 0
        ? { contractIssues: compiled.validationIssues }
        : {}),
    }
  }

  private async pollManifestTask(
    manifest: MediaModelManifest,
    taskId: string,
    ctx: MediaProviderContext,
    submitRequest: MediaInvocationRequest,
    traceId: string,
  ): Promise<unknown> {
    const response = manifest.invocation.response
    if (response.kind !== 'task_poll') return null
    const polling = manifest.invocation.polling
    const pollRequest = buildPollRequest(response, taskId, submitRequest.auth)
    const variables = { taskId, poll: { taskId } }
    const compiledPoll = await compileInvocationRequest(pollRequest, {
      apiEndpoint: ctx.apiEndpoint,
      apiKey: ctx.apiKey,
      variables,
      inputFiles: [],
      defaultAuth: submitRequest.auth ?? { kind: 'bearer', credentialRef: 'apiKey' },
    })
    const statusPaths = response.statusPaths ?? ['status']
    const requestId = taskId.slice(0, 80)
    logMediaDiag('template-poll-compiled', {
      traceId,
      provider: manifest.providerKind,
      manifest: manifest.id,
      method: compiledPoll.method,
      url: compiledPoll.url,
      requestId,
      statusPaths,
      bodyKind: pollRequest.body?.kind ?? 'none',
    })
    return pollTask(compiledPoll.url, compiledPoll.headers, {
      fetchImpl: ctx.fetch,
      method: compiledPoll.method,
      ...(compiledPoll.body !== undefined ? { body: compiledPoll.body } : {}),
      intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? polling?.intervalMs ?? 5_000,
      ...(polling?.maxAttempts != null ? { maxAttempts: polling.maxAttempts } : {}),
      ...(polling?.retry
        ? {
            maxRetries: polling.retry.maxAttempts,
            retryBackoffMs: polling.retry.backoffMs,
          }
        : {}),
      ...mediaPollTimeoutOptions(
        ctx.mediaDefaults,
        polling?.timeoutMs ?? (manifest.domains.includes('video') ? 1_800_000 : 600_000),
      ),
      inspect: (data) => {
        if (firstStringAtPaths(data, response.resultPaths)) return 'done'
        const rawStatus = (firstStringAtPaths(data, statusPaths) || extractStatus(data))
          .trim()
          .toLowerCase()
        if (!rawStatus) return polling?.unknownStatus === 'running' ? 'pending' : 'failed'
        const mapped = polling?.statusMap[rawStatus]
        if (mapped === 'succeeded') return 'done'
        if (mapped === 'failed' || mapped === 'cancelled') return 'failed'
        if (!mapped && polling?.unknownStatus !== 'running') return 'failed'
        return 'pending'
      },
      logContext: `provider=${manifest.providerKind} manifest=${manifest.id} requestId=${requestId}`,
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
      if (!buffer)
        throw new MediaProviderError(
          'provider_http_error',
          'binary_response did not return binary data',
        )
      const name = filenameHelper(input, outputKind, 0, 1)
      if (outputKind === 'audio' || outputKind === 'video') {
        return [
          await this.artifact.writeBinaryAsset(
            outputKind,
            buffer,
            input.outputDir,
            name,
            defaultMime(outputKind, input),
          ),
        ]
      }
      if (outputKind === 'image') {
        return [
          await this.artifact.writeImage(
            { kind: 'base64', value: buffer.toString('base64'), mimeType: 'image/png' },
            input.outputDir,
            name,
            ctx.fetch,
            configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults),
          ),
        ]
      }
      return [await this.artifact.writeTextAsset(buffer.toString('utf8'), input.outputDir, name)]
    }
    if (retrieval.kind === 'inline_base64') {
      const values = stringsAtPaths(data, retrieval.jsonPaths)
      return this.materializeStrings(values, outputKind, input, ctx, { inlineBase64: true })
    }
    if (retrieval.kind === 'url') {
      const values = stringsAtPaths(data, retrieval.jsonPaths)
      return this.materializeStrings(values, outputKind, input, ctx, {
        download: retrieval.download,
      })
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
    return Promise.all(
      values.map(async (value, index) => {
        const name = filenameHelper(input, outputKind, index, values.length)
        if (outputKind === 'text') {
          return this.artifact.writeTextAsset(value, input.outputDir, name)
        }
        if (isHttpUrl(value)) {
          if (outputKind === 'image') {
            if (options.download === false)
              return { type: 'image', url: value, raw: { url: value } }
            return this.artifact.writeImage(
              { kind: 'url', value },
              input.outputDir,
              name,
              ctx.fetch,
              configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults),
            )
          }
          if (outputKind === 'audio' || outputKind === 'video') {
            if (options.download === false)
              return { type: outputKind, url: value, raw: { url: value } }
            return this.artifact.downloadMediaAsset(
              outputKind,
              value,
              input.outputDir,
              name,
              ctx.fetch,
              configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults),
            )
          }
        }
        if (outputKind === 'image') {
          return this.artifact.writeImage(
            {
              kind: 'base64',
              value: normalizeBase64(value),
              mimeType: mimeFromDataUrl(value) ?? 'image/png',
            },
            input.outputDir,
            name,
            ctx.fetch,
            configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults),
          )
        }
        if (outputKind === 'audio' || outputKind === 'video') {
          const buffer = Buffer.from(normalizeBase64(value), 'base64')
          return this.artifact.writeBinaryAsset(
            outputKind,
            buffer,
            input.outputDir,
            name,
            mimeFromDataUrl(value) ?? defaultMime(outputKind, input),
          )
        }
        return this.artifact.writeTextAsset(value, input.outputDir, name)
      }),
    )
  }
}

function buildPollRequest(
  response: Extract<MediaArtifactRetrieval, { kind: 'task_poll' }>,
  taskId: string,
  submitAuth: MediaInvocationRequest['auth'],
): MediaInvocationRequest {
  const placement: MediaTaskIdPlacement = response.taskId ?? { location: 'path', name: 'taskId' }
  const legacyEndpoint = response.statusEndpoint ?? ''
  const base = response.poll ?? {
    method: 'GET' as const,
    endpoint: legacyEndpoint.replace(/{{\s*taskId\s*}}/g, '{taskId}'),
    auth: { kind: 'inherit' as const },
    body: { kind: 'none' as const },
  }
  const taskValue = '{{taskId}}'
  const next: MediaInvocationRequest = {
    ...base,
    auth: base.auth ?? { kind: 'inherit' },
  }
  if (placement.location === 'path') {
    const replacement = encodeURIComponent(taskId)
    next.endpoint = next.endpoint.replace(/\{taskId\}|{{\s*taskId\s*}}/g, replacement)
    if (next.endpoint === base.endpoint) {
      throw new MediaProviderError(
        'provider_http_error',
        'poll taskId placement=path requires {taskId} in endpoint',
      )
    }
  } else if (placement.location === 'query') {
    next.query = { ...(next.query ?? {}), [placement.name]: taskValue }
  } else if (placement.location === 'header') {
    next.headers = { ...(next.headers ?? {}), [placement.name]: taskValue }
  } else {
    const body = next.body
    if (!body || body.kind === 'none' || body.kind === 'binary') {
      throw new MediaProviderError(
        'provider_http_error',
        'poll taskId placement=body requires a JSON or multipart body',
      )
    }
    if (body.kind === 'json') {
      const template = isPlainRecord(body.template)
        ? { ...body.template, [placement.name]: taskValue }
        : { [placement.name]: taskValue }
      next.body = { kind: 'json', template }
    } else {
      next.body = {
        ...body,
        parts: [...body.parts, { name: placement.name, kind: 'text', value: taskValue }],
      }
    }
  }
  if (next.auth?.kind === 'inherit' && submitAuth?.kind === 'none') {
    next.auth = { kind: 'none' }
  }
  return next
}

export function buildVariables(
  input: MediaGenerateInput,
  capability: MediaModelCapabilityManifest,
  modelId: string,
  providerParams: Record<string, unknown> = {},
  canonicalParams: Record<string, unknown> = providerParams,
): Record<string, unknown> {
  const inputFiles = input.inputFiles ?? []
  const resolveRef = (file: (typeof inputFiles)[number] | undefined): string => {
    if (!file) return ''
    if (file.url && /^https?:\/\//i.test(file.url)) return file.url
    if (file.dataUrl) return file.dataUrl
    if (file.url && !file.url.startsWith('safe-file://')) return file.url
    return file.path ?? ''
  }
  const maskFile = inputFiles.find(
    (file) => (file.type === 'image' || file.type === 'file') && file.role === 'mask',
  )
  const imageFiles = inputFiles.filter(
    (file) => (file.type === 'image' || file.type === 'file') && file.role !== 'mask',
  )
  const videoFiles = inputFiles.filter(
    (file) => file.type === 'video' || (file.type === 'file' && file.role === 'input'),
  )
  const imageRefs = imageFiles.map(resolveRef).filter((value) => value.length > 0)
  const videoRefs = videoFiles.map(resolveRef).filter((value) => value.length > 0)
  const firstFrame = imageFiles.find((file) => file.role === 'first_frame')
  const lastFrame = imageFiles.find((file) => file.role === 'last_frame')
  const referenceFiles = imageFiles.some((file) => file.role === 'reference')
    ? imageFiles.filter((file) => file.role === 'reference')
    : imageFiles.filter((file) => file !== (firstFrame ?? imageFiles[0]) && file !== lastFrame)
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
  if (resolveRef(firstFrame))
    bailianMedia.push({ type: 'first_frame', url: resolveRef(firstFrame) })
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
    mask: resolveRef(maskFile),
    firstFrame:
      resolveRef(firstFrame) ||
      (capability.id === 'video.image_to_video' ? (imageRefs[0] ?? '') : ''),
    firstFrameImage:
      resolveRef(firstFrame) ||
      (capability.id === 'video.image_to_video' ? (imageRefs[0] ?? '') : ''),
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
    audios: audioRefs,
    audioUrls: audioRefs,
    inputAudios: audioRefs,
    inputAudioUrls: audioRefs,
    referenceAudios: audioRefs,
    referenceAudioUrls: audioRefs,
    media: bailianMedia,
    params: canonicalParams,
    providerParams,
    ...canonicalParams,
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

function primaryOutputKind(capability: MediaModelCapabilityManifest): MediaArtifactType {
  const [first] = capability.output.types
  if (first === 'audio' || first === 'video' || first === 'text') return first
  return 'image'
}

function stringsAtPaths(data: unknown, paths: string[]): string[] {
  const values = paths.flatMap((path) => valuesAtPath(data, path))
  return Array.from(
    new Set(
      values.filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  )
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

function summarizeInvocationBody(body: string | Buffer | Uint8Array | undefined): unknown {
  if (body == null) return undefined
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return `[binary ${body.byteLength} bytes]`
  }
  return body
}
