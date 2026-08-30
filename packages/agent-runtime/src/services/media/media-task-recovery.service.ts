import type {
  MediaArtifactRetrieval,
  MediaInvocationRequest,
  VideoChannelTask,
} from '@spark/protocol'
import { migrateMediaModelManifestToV2 } from '@spark/protocol'
import { MediaArtifactService } from './media-artifact.service.js'
import { MinimaxHailuoFilesClient } from './minimax-hailuo-files.client.js'
import { VolcengineArkVideoTaskClient } from './video-channel-task-client.js'
import { BailianVideoTaskClient } from './bailian-video-task-client.js'
import { MediaProviderError } from './media-adapter.types.js'
import type { MediaGeneratedAsset, MediaGenerateInput } from './media-adapter.types.js'
import type { MediaTaskPollingDescriptor } from './media-task-polling.types.js'
import { compileInvocationRequest } from './media-invocation-compiler.js'
import { fetchJson } from './media-http.util.js'

export type MediaTaskRecoveryStatus = 'succeeded' | 'failed' | 'cancelled' | 'stopped'

export interface MediaTaskRecoveryResult {
  status: MediaTaskRecoveryStatus
  provider: string
  model: string
  assets: MediaGeneratedAsset[]
  rawResponse?: unknown
  error?: { code: string; message: string }
}

export interface MediaTaskRecoveryInput {
  descriptor: MediaTaskPollingDescriptor
  taskId: string
  apiKey: string
  apiEndpoint?: string
  input: MediaGenerateInput
  fetch?: typeof fetch
  shouldContinue: () => boolean
}

/**
 * Resumes a previously submitted task using its persisted query contract.
 * This service never calls a create/submit endpoint.
 */
export async function recoverMediaTask(
  input: MediaTaskRecoveryInput,
): Promise<MediaTaskRecoveryResult> {
  const descriptor = input.descriptor
  if (!input.taskId.trim()) throw new MediaProviderError('invalid_input', 'Provider Task ID 为空')
  if (!input.apiKey.trim())
    throw new MediaProviderError('api_key_missing', 'Provider API Key 不可用')

  switch (descriptor.strategy) {
    case 'volcengine-ark':
      return recoverVideoChannel(
        input,
        new VolcengineArkVideoTaskClient({
          apiKey: input.apiKey,
          ...(input.apiEndpoint ? { apiEndpoint: input.apiEndpoint } : {}),
          ...(input.fetch ? { fetch: input.fetch } : {}),
        }),
      )
    case 'bailian':
      return recoverVideoChannel(
        input,
        new BailianVideoTaskClient({
          apiKey: input.apiKey,
          ...(input.apiEndpoint ? { apiEndpoint: input.apiEndpoint } : {}),
          ...(input.fetch ? { fetch: input.fetch } : {}),
        }),
      )
    case 'minimax-hailuo':
      return recoverMinimax(input)
    case 'openai-sora':
      return recoverOpenAiSora(input)
    case 'google-generative-ai':
      return recoverGoogleOperation(input)
    case 'google-interactions':
      return recoverGoogleInteraction(input)
    case 'tencent-tokenhub':
      return recoverTencent(input)
    case 'manifest':
      return recoverManifest(input)
    case 'apimart':
    case 'agnes':
    case 'midjourney':
    case 'xai':
      return recoverKnownJsonTask(input)
    default:
      throw new MediaProviderError(
        'provider_not_configured',
        `Provider ${descriptor.providerKind} 没有可恢复的轮询协议`,
      )
  }
}

async function recoverVideoChannel(
  input: MediaTaskRecoveryInput,
  client: {
    get(taskId: string, context: { providerProfileId: string }): Promise<VideoChannelTask>
  },
): Promise<MediaTaskRecoveryResult> {
  const result = await pollUntil(
    input,
    async () => client.get(input.taskId, { providerProfileId: 'recovery' }),
    {
      isDone: (value) => Boolean(value.videoUrl),
      status: (value) => value.status,
    },
  )
  if (result.kind === 'stopped') return stopped(input)
  if (result.kind === 'failed') return failed(input, result.raw, result.message)
  const videoUrl = result.raw.videoUrl
  if (!videoUrl)
    throw new MediaProviderError('provider_http_error', 'Provider 成功响应缺少视频地址')
  const assets = await downloadAssets(input, [videoUrl], 'video')
  return {
    status: 'succeeded',
    provider: input.descriptor.providerKind,
    model: result.raw.model ?? input.descriptor.modelId ?? '',
    assets,
    rawResponse: result.raw,
  }
}

async function recoverManifest(input: MediaTaskRecoveryInput): Promise<MediaTaskRecoveryResult> {
  const rawManifest = input.descriptor.manifest
  const manifestCapability = input.descriptor.manifestCapability
  if (!rawManifest || !manifestCapability) {
    throw new MediaProviderError('provider_not_configured', '历史任务缺少 manifest 轮询协议')
  }
  const manifest = migrateMediaModelManifestToV2(rawManifest)
  const response = manifest.invocation.response
  if (response.kind !== 'task_poll') {
    throw new MediaProviderError(
      'provider_not_configured',
      '该 manifest 不是可恢复的 task_poll 协议',
    )
  }
  const submitAuth = manifest.invocation.request?.auth
  const pollRequest = buildPollRequest(response, input.taskId, submitAuth)
  const compiled = await compileInvocationRequest(pollRequest, {
    apiEndpoint: input.apiEndpoint ?? '',
    apiKey: input.apiKey,
    variables: { taskId: input.taskId, poll: { taskId: input.taskId } },
    inputFiles: [],
    defaultAuth: submitAuth ?? { kind: 'bearer', credentialRef: 'apiKey' },
  })
  const result = await pollUntil(
    input,
    async () =>
      fetchJson(compiled.url, {
        method: compiled.method,
        headers: compiled.headers,
        ...(compiled.body !== undefined ? { body: compiled.body } : {}),
        fetchImpl: input.fetch,
        timeoutMs: 60_000,
        ...(manifest.error ? { errorContract: manifest.error } : {}),
      }),
    {
      isDone: (value) => response.resultPaths.some((path) => stringAtPath(value, path) != null),
      status: (value) => stringAtPath(value, response.statusPaths?.[0] ?? 'status') ?? '',
    },
  )
  if (result.kind === 'stopped') return stopped(input)
  if (result.kind === 'failed') return failed(input, result.raw, result.message)
  let raw: unknown = result.raw
  let retrieval: MediaArtifactRetrieval = response
  if (response.artifact) {
    const artifactRequest = replaceTaskIdInRequest(response.artifact.request, input.taskId)
    const artifactCompiled = await compileInvocationRequest(artifactRequest, {
      apiEndpoint: input.apiEndpoint ?? '',
      apiKey: input.apiKey,
      variables: { taskId: input.taskId, poll: raw },
      inputFiles: [],
      defaultAuth: artifactRequest.auth ?? { kind: 'bearer', credentialRef: 'apiKey' },
    })
    raw = await fetchJson(artifactCompiled.url, {
      method: artifactCompiled.method,
      headers: artifactCompiled.headers,
      ...(artifactCompiled.body !== undefined ? { body: artifactCompiled.body } : {}),
      fetchImpl: input.fetch,
      timeoutMs: 300_000,
      binary: response.artifact.response.kind === 'binary_response',
      ...(manifest.error ? { errorContract: manifest.error } : {}),
    })
    retrieval = response.artifact.response
  }
  const assets = await materializeRetrieval(input, retrieval, raw)
  return {
    status: 'succeeded',
    provider: descriptorProvider(input),
    model: input.descriptor.modelId ?? '',
    assets,
    rawResponse: raw,
  }
}

async function recoverKnownJsonTask(
  input: MediaTaskRecoveryInput,
): Promise<MediaTaskRecoveryResult> {
  const base = trimBase(input.apiEndpoint)
  if (!base) throw new MediaProviderError('provider_not_configured', 'Provider Endpoint 未配置')
  const taskId = encodeURIComponent(input.taskId)
  let endpoint: string
  if (input.descriptor.strategy === 'agnes' && input.input.modelParams?.videoId) {
    const url = new URL(`${base}/agnesapi`)
    url.searchParams.set('video_id', String(input.input.modelParams.videoId))
    url.searchParams.set('model_name', input.descriptor.modelId ?? '')
    endpoint = url.toString()
  } else if (
    input.descriptor.strategy === 'midjourney' &&
    typeof input.input.modelParams?.statusPath === 'string'
  ) {
    endpoint = `${base}${withLeadingSlash(input.input.modelParams.statusPath).replace('{{taskId}}', taskId)}`
  } else if (input.descriptor.strategy === 'xai') {
    endpoint = `${base}/videos/${taskId}`
  } else {
    endpoint = `${base}/${input.descriptor.strategy === 'apimart' ? 'tasks' : 'videos'}/${taskId}`
  }
  const result = await pollUntil(
    input,
    async () =>
      fetchJson(endpoint, {
        headers: authHeaders(input.apiKey),
        fetchImpl: input.fetch,
        timeoutMs: 60_000,
      }),
    {
      isDone: (value) => collectMediaUrls(value).length > 0 || collectBase64(value).length > 0,
      status: (value) => findStatus(value),
    },
  )
  if (result.kind === 'stopped') return stopped(input)
  if (result.kind === 'failed') return failed(input, result.raw, result.message)
  const values = collectMediaUrls(result.raw)
  const assets =
    values.length > 0
      ? await downloadAssets(input, values, input.descriptor.outputType)
      : await materializeValues(input, collectBase64(result.raw), input.descriptor.outputType, true)
  if (assets.length === 0)
    throw new MediaProviderError('provider_http_error', 'Provider 成功响应缺少产物')
  return {
    status: 'succeeded',
    provider: descriptorProvider(input),
    model: input.descriptor.modelId ?? '',
    assets,
    rawResponse: result.raw,
  }
}

async function recoverOpenAiSora(input: MediaTaskRecoveryInput): Promise<MediaTaskRecoveryResult> {
  const base = trimBase(input.apiEndpoint) || 'https://api.openai.com/v1'
  if (!base) throw new MediaProviderError('provider_not_configured', 'OpenAI Endpoint 未配置')
  const taskId = encodeURIComponent(input.taskId)
  const result = await pollUntil(
    input,
    async () =>
      fetchJson(`${base}/videos/${taskId}`, {
        headers: authHeaders(input.apiKey),
        fetchImpl: input.fetch,
        timeoutMs: 60_000,
      }),
    {
      isDone: (value) => findStatus(value) === 'completed',
      status: (value) => findStatus(value),
    },
  )
  if (result.kind === 'stopped') return stopped(input)
  if (result.kind === 'failed') return failed(input, result.raw, result.message)
  const binary = await fetchJson<Buffer>(`${base}/videos/${taskId}/content`, {
    headers: authHeaders(input.apiKey),
    fetchImpl: input.fetch,
    timeoutMs: 300_000,
    binary: true,
  })
  const artifact = new MediaArtifactService()
  const asset = await artifact.writeBinaryAsset(
    'video',
    binary,
    input.input.outputDir,
    `recovered-${safeFileName(input.taskId)}.mp4`,
    'video/mp4',
  )
  return {
    status: 'succeeded',
    provider: 'openai-images',
    model: input.descriptor.modelId ?? '',
    assets: [asset],
    rawResponse: result.raw,
  }
}

async function recoverGoogleOperation(
  input: MediaTaskRecoveryInput,
): Promise<MediaTaskRecoveryResult> {
  const base = trimBase(input.apiEndpoint) || 'https://generativelanguage.googleapis.com/v1beta'
  if (!base) throw new MediaProviderError('provider_not_configured', 'Google Endpoint 未配置')
  const operation = input.taskId.replace(/^\/+/, '')
  const result = await pollUntil(
    input,
    async () =>
      fetchJson(`${base}/${operation}`, {
        headers: googleHeaders(input.apiKey),
        fetchImpl: input.fetch,
        timeoutMs: 60_000,
      }),
    {
      isDone: (value) => collectMediaUrls(value).length > 0 || collectBase64(value).length > 0,
      status: (value) => {
        if (readBoolean(value, 'done')) return 'done'
        return findStatus(value)
      },
    },
  )
  if (result.kind === 'stopped') return stopped(input)
  if (result.kind === 'failed') return failed(input, result.raw, result.message)
  const urls = collectMediaUrls(result.raw)
  const base64 = collectBase64(result.raw)
  await waitForGoogleFilesActive(input, urls)
  if (!input.shouldContinue()) return stopped(input)
  const assets =
    urls.length > 0
      ? await downloadAssets(input, urls, 'video')
      : await materializeValues(input, base64, 'video', true)
  return {
    status: 'succeeded',
    provider: input.descriptor.providerKind,
    model: input.descriptor.modelId ?? '',
    assets,
    rawResponse: result.raw,
  }
}

async function recoverGoogleInteraction(
  input: MediaTaskRecoveryInput,
): Promise<MediaTaskRecoveryResult> {
  const base = trimBase(input.apiEndpoint) || 'https://generativelanguage.googleapis.com/v1beta'
  if (!base) throw new MediaProviderError('provider_not_configured', 'Omni Endpoint 未配置')
  const result = await pollUntil(
    input,
    async () =>
      fetchJson(`${base}/interactions/${encodeURIComponent(input.taskId)}`, {
        headers: googleHeaders(input.apiKey),
        fetchImpl: input.fetch,
        timeoutMs: 60_000,
      }),
    {
      isDone: (value) => collectMediaUrls(value).length > 0 || collectBase64(value).length > 0,
      status: (value) => findStatus(value),
    },
  )
  if (result.kind === 'stopped') return stopped(input)
  if (result.kind === 'failed') return failed(input, result.raw, result.message)
  const urls = collectMediaUrls(result.raw)
  const base64 = collectBase64(result.raw)
  await waitForGoogleFilesActive(input, urls)
  if (!input.shouldContinue()) return stopped(input)
  const assets =
    urls.length > 0
      ? await downloadAssets(input, urls, 'video')
      : await materializeValues(input, base64, 'video', true)
  return {
    status: 'succeeded',
    provider: 'omni',
    model: input.descriptor.modelId ?? '',
    assets,
    rawResponse: result.raw,
  }
}

async function recoverTencent(input: MediaTaskRecoveryInput): Promise<MediaTaskRecoveryResult> {
  const base = trimBase(input.apiEndpoint)
  if (!base) throw new MediaProviderError('provider_not_configured', 'TokenHub Endpoint 未配置')
  const kind = input.descriptor.outputType === 'image' ? 'image' : 'video'
  const endpoint = `${base}/v1/api/${kind}/query`
  const result = await pollUntil(
    input,
    async () =>
      fetchJson(endpoint, {
        method: 'POST',
        headers: { ...authHeaders(input.apiKey), 'content-type': 'application/json' },
        body: JSON.stringify({ model: input.descriptor.modelId, id: input.taskId }),
        fetchImpl: input.fetch,
        timeoutMs: 60_000,
      }),
    {
      isDone: (value) => collectMediaUrls(value).length > 0 || collectBase64(value).length > 0,
      status: (value) => findStatus(value),
    },
  )
  if (result.kind === 'stopped') return stopped(input)
  if (result.kind === 'failed') return failed(input, result.raw, result.message)
  const values = collectMediaUrls(result.raw)
  const assets =
    values.length > 0
      ? await downloadAssets(input, values, input.descriptor.outputType)
      : await materializeValues(input, collectBase64(result.raw), input.descriptor.outputType, true)
  return {
    status: 'succeeded',
    provider: 'tencent-tokenhub',
    model: input.descriptor.modelId ?? '',
    assets,
    rawResponse: result.raw,
  }
}

async function recoverMinimax(input: MediaTaskRecoveryInput): Promise<MediaTaskRecoveryResult> {
  const base = trimBase(input.apiEndpoint) || 'https://api.minimaxi.com'
  if (!base) throw new MediaProviderError('provider_not_configured', 'MiniMax Endpoint 未配置')
  const taskId = encodeURIComponent(input.taskId)
  const isTemplate = Boolean(
    input.input.modelParams?.templateId ?? input.input.modelParams?.template_id,
  )
  const isV2 = (input.descriptor.modelId ?? '').toLowerCase().includes('h3')
  const endpoint = isV2
    ? `${base}/v2/query/video_generation/${taskId}`
    : `${base}/v1/query/${isTemplate ? 'video_template_generation' : 'video_generation'}?task_id=${taskId}`
  const result = await pollUntil(
    input,
    async () =>
      fetchJson(endpoint, {
        headers: authHeaders(input.apiKey),
        fetchImpl: input.fetch,
        timeoutMs: 60_000,
      }),
    {
      isDone: (value) =>
        collectMediaUrls(value).length > 0 ||
        findStatus(value) === 'success' ||
        findStatus(value) === 'succeeded',
      status: (value) => findStatus(value),
    },
  )
  if (result.kind === 'stopped') return stopped(input)
  if (result.kind === 'failed') return failed(input, result.raw, result.message)
  const urls = collectMediaUrls(result.raw)
  if (urls.length > 0)
    return {
      status: 'succeeded',
      provider: 'minimax-hailuo',
      model: input.descriptor.modelId ?? '',
      assets: await downloadAssets(input, urls, 'video'),
      rawResponse: result.raw,
    }
  const fileId = firstPath(result.raw, ['file_id', 'data.file_id'])
  if (fileId) {
    const file = await new MinimaxHailuoFilesClient({
      apiKey: input.apiKey,
      apiEndpoint: base,
      ...(input.fetch ? { fetch: input.fetch } : {}),
    }).retrieve(fileId)
    if (file.downloadUrl)
      return {
        status: 'succeeded',
        provider: 'minimax-hailuo',
        model: input.descriptor.modelId ?? '',
        assets: await downloadAssets(input, [file.downloadUrl], 'video'),
        rawResponse: result.raw,
      }
  }
  throw new MediaProviderError('provider_http_error', 'MiniMax 成功响应缺少视频产物')
}

async function pollUntil<T>(
  input: MediaTaskRecoveryInput,
  query: () => Promise<T>,
  options: { isDone: (value: T) => boolean; status: (value: T) => string },
): Promise<
  { kind: 'done'; raw: T } | { kind: 'failed'; raw: T; message: string } | { kind: 'stopped' }
> {
  const deadline = Date.now() + input.descriptor.timeoutMs
  const maxAttempts = input.descriptor.maxAttempts ?? Number.POSITIVE_INFINITY
  let attempts = 0
  while (Date.now() <= deadline && attempts < maxAttempts) {
    if (!input.shouldContinue()) return { kind: 'stopped' }
    const raw = await query()
    attempts += 1
    if (!input.shouldContinue()) return { kind: 'stopped' }
    if (options.isDone(raw)) return { kind: 'done', raw }
    const status = options.status(raw).toLowerCase()
    if (FAILED_STATUSES.has(status)) {
      return { kind: 'failed', raw, message: `Provider 任务已进入 ${status} 终态` }
    }
    if (Date.now() + input.descriptor.intervalMs > deadline || attempts >= maxAttempts) break
    await delay(input.descriptor.intervalMs)
  }
  throw Object.assign(new Error('Provider 任务恢复轮询超时'), { code: 'task_timeout' })
}

async function materializeRetrieval(
  input: MediaTaskRecoveryInput,
  retrieval: MediaArtifactRetrieval,
  raw: unknown,
): Promise<MediaGeneratedAsset[]> {
  if (retrieval.kind === 'binary_response') {
    if (!Buffer.isBuffer(raw))
      throw new MediaProviderError('provider_http_error', '轮询产物不是二进制响应')
    const artifact = new MediaArtifactService()
    return [
      await artifact.writeBinaryAsset(
        input.descriptor.outputType === 'audio' ? 'audio' : 'video',
        raw,
        input.input.outputDir,
        `recovered-${safeFileName(input.taskId)}`,
        input.descriptor.outputType === 'audio' ? 'audio/mpeg' : 'video/mp4',
      ),
    ]
  }
  const paths = retrieval.kind === 'task_poll' ? retrieval.resultPaths : retrieval.jsonPaths
  const values = paths.flatMap((path) => stringsAtPath(raw, path))
  const download = retrieval.kind === 'url' ? retrieval.download : true
  return materializeValues(input, values, input.descriptor.outputType, download)
}

async function downloadAssets(
  input: MediaTaskRecoveryInput,
  urls: string[],
  kind: MediaTaskPollingDescriptor['outputType'],
): Promise<MediaGeneratedAsset[]> {
  const artifact = new MediaArtifactService()
  const fetchImpl = mediaDownloadFetch(input)
  return Promise.all(
    urls.map((url, index) => {
      const name = `recovered-${safeFileName(input.taskId)}-${index + 1}`
      if (kind === 'image')
        return artifact.writeImage(
          { kind: 'url', value: url },
          input.input.outputDir,
          `${name}.png`,
          fetchImpl,
          300_000,
        )
      if (kind === 'audio')
        return artifact.downloadMediaAsset(
          'audio',
          url,
          input.input.outputDir,
          `${name}.mp3`,
          fetchImpl,
          300_000,
        )
      return artifact.downloadMediaAsset(
        'video',
        url,
        input.input.outputDir,
        `${name}.mp4`,
        fetchImpl,
        300_000,
      )
    }),
  )
}

async function materializeValues(
  input: MediaTaskRecoveryInput,
  values: string[],
  kind: MediaTaskPollingDescriptor['outputType'],
  download: boolean,
): Promise<MediaGeneratedAsset[]> {
  const artifact = new MediaArtifactService()
  const fetchImpl = mediaDownloadFetch(input)
  return Promise.all(
    values.map((value, index) => {
      const name = `recovered-${safeFileName(input.taskId)}-${index + 1}`
      if (kind === 'text')
        return artifact.writeTextAsset(value, input.input.outputDir, `${name}.txt`)
      if (isHttpUrl(value) && download) {
        if (kind === 'image')
          return artifact.writeImage(
            { kind: 'url', value },
            input.input.outputDir,
            `${name}.png`,
            fetchImpl,
            300_000,
          )
        return artifact.downloadMediaAsset(
          kind === 'audio' ? 'audio' : 'video',
          value,
          input.input.outputDir,
          `${name}.${kind === 'audio' ? 'mp3' : 'mp4'}`,
          fetchImpl,
          300_000,
        )
      }
      if (kind === 'image')
        return artifact.writeImage(
          { kind: 'base64', value: normalizeBase64(value), mimeType: 'image/png' },
          input.input.outputDir,
          `${name}.png`,
          fetchImpl,
          300_000,
        )
      return artifact.writeBinaryAsset(
        kind === 'audio' ? 'audio' : 'video',
        Buffer.from(normalizeBase64(value), 'base64'),
        input.input.outputDir,
        `${name}.${kind === 'audio' ? 'mp3' : 'mp4'}`,
        kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
      )
    }),
  )
}

function buildPollRequest(
  response: Extract<MediaArtifactRetrieval, { kind: 'task_poll' }>,
  taskId: string,
  submitAuth: MediaInvocationRequest['auth'],
): MediaInvocationRequest {
  const placement = response.taskId ?? { location: 'path' as const, name: 'taskId' }
  const base = response.poll ?? {
    method: 'GET' as const,
    endpoint: (response.statusEndpoint ?? '').replace(/{{\s*taskId\s*}}/g, '{taskId}'),
    auth: { kind: 'inherit' as const },
    body: { kind: 'none' as const },
  }
  const next: MediaInvocationRequest = { ...base, auth: base.auth ?? { kind: 'inherit' } }
  if (placement.location === 'path') {
    const replaced = next.endpoint.replace(
      /\{taskId\}|{{\s*taskId\s*}}/g,
      encodeURIComponent(taskId),
    )
    if (replaced === next.endpoint) {
      throw new MediaProviderError('provider_not_configured', '轮询 path 缺少 Task ID 占位符')
    }
    next.endpoint = replaced
  }
  if (placement.location === 'query')
    next.query = { ...(next.query ?? {}), [placement.name]: '{{taskId}}' }
  if (placement.location === 'header')
    next.headers = { ...(next.headers ?? {}), [placement.name]: '{{taskId}}' }
  if (placement.location === 'body') {
    if (next.body?.kind !== 'json') {
      throw new MediaProviderError(
        'provider_not_configured',
        '历史任务的 body Task ID 查询协议无法安全恢复',
      )
    }
    next.body = {
      kind: 'json',
      template: {
        ...(isRecord(next.body.template) ? next.body.template : {}),
        [placement.name]: '{{taskId}}',
      },
    }
  }
  if (next.auth?.kind === 'inherit' && submitAuth?.kind === 'none') next.auth = { kind: 'none' }
  return next
}

function replaceTaskIdInRequest(
  request: MediaInvocationRequest,
  taskId: string,
): MediaInvocationRequest {
  return {
    ...request,
    endpoint: request.endpoint.replace(/\{taskId\}|{{\s*taskId\s*}}/g, encodeURIComponent(taskId)),
  }
}

function descriptorProvider(input: MediaTaskRecoveryInput): string {
  return input.descriptor.providerKind
}
function stopped(input: MediaTaskRecoveryInput): MediaTaskRecoveryResult {
  return {
    status: 'stopped',
    provider: descriptorProvider(input),
    model: input.descriptor.modelId ?? '',
    assets: [],
  }
}
function failed(
  input: MediaTaskRecoveryInput,
  raw: unknown,
  message: string,
): MediaTaskRecoveryResult {
  return {
    status: 'failed',
    provider: descriptorProvider(input),
    model: input.descriptor.modelId ?? '',
    assets: [],
    rawResponse: raw,
    error: { code: 'task_failed', message },
  }
}
function trimBase(value?: string): string {
  return (value ?? '').replace(/\/+$/, '')
}
function withLeadingSlash(value: string): string {
  return value.startsWith('/') ? value : `/${value}`
}
function authHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}`, accept: 'application/json' }
}
function googleHeaders(apiKey: string): Record<string, string> {
  return { 'x-goog-api-key': apiKey, authorization: `Bearer ${apiKey}`, accept: 'application/json' }
}
async function waitForGoogleFilesActive(
  input: MediaTaskRecoveryInput,
  urls: readonly string[],
): Promise<void> {
  const fileNames = [
    ...new Set(urls.map(googleFileNameFromUri).filter((value): value is string => value != null)),
  ]
  if (fileNames.length === 0) return
  const base = trimBase(input.apiEndpoint) || 'https://generativelanguage.googleapis.com/v1beta'
  await Promise.all(
    fileNames.map(async (fileName) => {
      const deadline = Date.now() + input.descriptor.timeoutMs
      while (Date.now() <= deadline) {
        if (!input.shouldContinue()) return
        const payload = await fetchJson(`${base}/files/${encodeURIComponent(fileName)}`, {
          headers: googleHeaders(input.apiKey),
          fetchImpl: input.fetch,
          timeoutMs: 60_000,
        })
        const state = String(firstPath(payload, ['state', 'file.state']) ?? '').toUpperCase()
        if (state === 'ACTIVE') return
        if (state === 'FAILED' || state === 'ERROR') {
          throw new MediaProviderError(
            'provider_http_error',
            `Google 文件 ${fileName} 进入失败状态`,
          )
        }
        await delay(input.descriptor.intervalMs)
      }
      throw Object.assign(new Error(`Google 文件 ${fileName} 就绪超时`), { code: 'task_timeout' })
    }),
  )
}
function googleFileNameFromUri(uri: string): string | null {
  const match = /\/files\/([^/:?]+)(?::download)?(?:\?|$)/i.exec(uri)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}
function mediaDownloadFetch(input: MediaTaskRecoveryInput): typeof fetch | undefined {
  if (!['google-generative-ai', 'google-interactions'].includes(input.descriptor.strategy))
    return input.fetch
  const baseFetch = input.fetch ?? fetch
  const fetchWrapper = ((url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const target = typeof url === 'string' ? url : url instanceof Request ? url.url : url.toString()
    const parsed = safeUrl(target)
    const configuredOrigin = safeUrl(
      trimBase(input.apiEndpoint) || 'https://generativelanguage.googleapis.com/v1beta',
    )?.origin
    if (
      parsed &&
      (/generativelanguage\.googleapis\.com$/i.test(parsed.hostname) ||
        parsed.origin === configuredOrigin) &&
      !headers.has('x-goog-api-key')
    )
      headers.set('x-goog-api-key', input.apiKey)
    return baseFetch(url, { ...init, headers })
  }) as typeof fetch
  return fetchWrapper
}
function safeUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
}
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}
function normalizeBase64(value: string): string {
  return value.replace(/^data:[^;]+;base64,/, '')
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
function stringAtPath(value: unknown, path: string): string | undefined {
  const resolved = path
    .split('.')
    .reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value)
  return typeof resolved === 'string' && resolved.trim() ? resolved.trim() : undefined
}
function firstPath(value: unknown, paths: string[]): string | undefined {
  return paths.map((path) => stringAtPath(value, path)).find((item): item is string => item != null)
}
function stringsAtPath(value: unknown, path: string): string[] {
  const resolved = path
    .split('.')
    .reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value)
  if (typeof resolved === 'string' && resolved.trim()) return [resolved.trim()]
  if (Array.isArray(resolved))
    return resolved
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
  return []
}
function collectMediaUrls(value: unknown): string[] {
  const out = new Set<string>()
  const visit = (current: unknown, key = ''): void => {
    if (
      typeof current === 'string' &&
      isHttpUrl(current) &&
      /(url|uri|video|audio|image|content|public)/i.test(key)
    )
      out.add(current)
    else if (Array.isArray(current)) current.forEach((item) => visit(item, key))
    else if (isRecord(current)) Object.entries(current).forEach(([name, item]) => visit(item, name))
  }
  visit(value)
  return [...out]
}
function collectBase64(value: unknown): string[] {
  const out: string[] = []
  const visit = (current: unknown, key = ''): void => {
    if (typeof current === 'string' && current.length > 32 && /(b64|base64|bytes)/i.test(key))
      out.push(current)
    else if (Array.isArray(current)) current.forEach((item) => visit(item, key))
    else if (isRecord(current)) Object.entries(current).forEach(([name, item]) => visit(item, name))
  }
  visit(value)
  return out
}
function findStatus(value: unknown): string {
  const candidates = ['status', 'task_status', 'state', 'task_state', 'phase', 'code']
  for (const path of candidates) {
    const found = stringAtPath(value, path)
    if (found) return found.toLowerCase()
  }
  return ''
}
function readBoolean(value: unknown, path: string): boolean {
  const resolved = path
    .split('.')
    .reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value)
  return resolved === true
}
const FAILED_STATUSES = new Set([
  'failed',
  'failure',
  'error',
  'cancelled',
  'canceled',
  'expired',
  'unknown',
  'done',
])
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
