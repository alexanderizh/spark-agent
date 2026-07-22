/**
 * 腾讯云 TokenHub 多媒体 adapter（专用）。
 *
 * 覆盖 21 个模型：图片 2（hy-image-lite 同步 / hy-image-v3.0 异步）+ 视频 19
 * （混元/优图 4 + Kling 9 + Vidu 6）。
 *
 * 为何需要专用 adapter：
 *   1. TemplateMediaAdapter.pollTask 用 GET + URL path 携带 taskId
 *      （media-http.util.ts:168）；腾讯 /v1/api/{image|video}/query 要求
 *      POST + JSON body {model, id}，模板渲染无法表达。
 *   2. 视频 query 响应 data 是对象 {url}（与图片 query 数组 [{url}] 相反），
 *      adapter 用 extractMediaUrls/extractImages 按 walkJson 统一提取，兼容两种形态。
 *   3. 不同视频模型支持参数差异大（Kling 分镜/运镜、Vidu 音视频直出），
 *      adapter 使用共享 compiler 执行 defaults、schema、aliases 与 strict 裁剪。
 *
 * 端点（OpenAI 兼容层，统一小写下划线）：
 *   - hy-image-lite 同步：POST /v1/api/image/lite            → data:[{url}]
 *   - hy-image-v3.0 异步： POST /v1/api/image/submit|query   → query data:[{url}]（数组）
 *   - 视频异步（全部）：   POST /v1/api/video/submit|query    → query data:{url}（对象）
 *
 * 注册后当 supports(capability)=true，MediaRouterService.invoke 会跳过
 * TemplateMediaAdapter，请求体由本 adapter 组装；manifest 仍驱动 UI 表单、
 * 参数校验、错误归一与 catalog 检索。
 */

import type { MediaCapabilityId, MediaProviderKind } from '@spark/protocol'
import { createLogger } from '@spark/shared'
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
  fetchJson,
  type ErrorExtractor,
} from '../media-http.util.js'
import { logMediaCall, logMediaResult } from '../media-debug-log.js'
import { resolveTencentMediaReference } from '../tencent-tokenhub-media-input.js'
import {
  buildTencentVideoRequest,
  compileTencentProviderParams,
} from '../tencent-tokenhub-media-request.js'
import { filenameHelper } from './openai-compatible-media.adapter.js'

const log = createLogger('media:tencent-tokenhub')

const VIDEO_CAPABILITIES: readonly MediaCapabilityId[] = ['video.generate', 'video.image_to_video']
const IMAGE_CAPABILITIES: readonly MediaCapabilityId[] = ['image.generate', 'image.edit']

const SYNC_IMAGE_MODELS = new Set(['hy-image-lite'])
const ASYNC_IMAGE_MODELS = new Set(['hy-image-v3.0'])

const SUCCEEDED_STATUSES = new Set(['completed', 'succeeded', 'success', 'done'])
const FAILED_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled'])

export class TencentTokenhubMediaAdapter implements MediaProviderAdapter {
  readonly id: MediaProviderKind = 'tencent-tokenhub'
  private readonly capabilities = new Set<MediaCapabilityId>([
    ...IMAGE_CAPABILITIES,
    ...VIDEO_CAPABILITIES,
  ])
  private readonly artifact = new MediaArtifactService()

  supports(capability: MediaCapabilityId): boolean {
    return this.capabilities.has(capability)
  }

  async invoke(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    if (!ctx.apiKey) {
      throw new MediaProviderError('api_key_missing', 'Missing Tencent TokenHub API key')
    }
    const capability = input.capability
    if (!capability) {
      throw new MediaProviderError(
        'capability_not_supported',
        'No capability resolved for tencent-tokenhub invoke',
      )
    }
    if (!this.supports(capability)) {
      throw new MediaProviderError(
        'capability_not_supported',
        `tencent-tokenhub does not support ${capability}`,
      )
    }
    if (VIDEO_CAPABILITIES.includes(capability)) {
      return this.generateVideo(input, ctx)
    }
    return this.generateImage(input, ctx)
  }

  // ─── 图片路径 ─────────────────────────────────────────────────────────────
  private async generateImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const model = ctx.defaultModel
    if (SYNC_IMAGE_MODELS.has(model)) return this.generateImageSync(input, ctx)
    if (ASYNC_IMAGE_MODELS.has(model)) return this.generateImageAsync(input, ctx)
    throw new MediaProviderError(
      'capability_not_supported',
      `Unsupported Tencent TokenHub image model: ${model}`,
    )
  }

  /** hy-image-lite 同步 */
  private async generateImageSync(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = 'image.generate'
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) throw new MediaProviderError('invalid_input', 'hy-image-lite requires a prompt')
    const model = ctx.defaultModel
    const base = baseEndpoint(ctx)
    const body = { model, prompt, ...compileTencentProviderParams(input, ctx) }
    const url = `${base}/v1/api/image/lite`
    logMediaCall({ provider: this.id, capability, model, method: 'POST', url, body })

    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      errorExtractor: tencentErrorExtractor,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const images = extractImages(data)
    if (images.length === 0) {
      logMediaResult({ provider: this.id, capability, ok: false, error: 'No image produced' })
      throw new MediaProviderError(
        'provider_http_error',
        `No image url in TokenHub response: ${JSON.stringify(data).slice(0, 800)}`,
      )
    }
    const assets = await Promise.all(
      images.map((img, i) =>
        this.artifact.writeImage(
          img,
          input.outputDir,
          filenameHelper(input, 'hyimage', i, images.length),
          ctx.fetch,
        ),
      ),
    )
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: assets.length })
    return { provider: this.id, model, mode: 'sync', assets, rawResponse: data }
  }

  /** hy-image-v3.0 异步（文生图 / 图生图）*/
  private async generateImageAsync(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = input.capability as MediaCapabilityId
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) {
      throw new MediaProviderError('invalid_input', `${ctx.defaultModel} requires a prompt`)
    }
    const model = ctx.defaultModel
    const base = baseEndpoint(ctx)

    const body: Record<string, unknown> = {
      model,
      prompt,
      ...compileTencentProviderParams(input, ctx),
    }
    if (capability === 'image.edit') {
      const images = await resolveImageRefs(input, ctx)
      if (images.length === 0) {
        throw new MediaProviderError('invalid_input', 'hy-image-v3.0 图生图需要至少一张参考图')
      }
      body.images = images
    }

    const submitUrl = `${base}/v1/api/image/submit`
    logMediaCall({ provider: this.id, capability, model, method: 'POST', url: submitUrl, body })
    const startedAt = Date.now()
    const submitResp = await fetchJson(submitUrl, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      errorExtractor: tencentErrorExtractor,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })

    const taskId = tencentTaskId(submitResp)
    if (!taskId) {
      // 极少数情况同步直出
      const images = extractImages(submitResp)
      if (images.length > 0) {
        const assets = await Promise.all(
          images.map((img, i) =>
            this.artifact.writeImage(
              img,
              input.outputDir,
              filenameHelper(input, 'hyimage', i, images.length),
              ctx.fetch,
            ),
          ),
        )
        return { provider: this.id, model, mode: 'sync', assets, rawResponse: submitResp }
      }
      throw new MediaProviderError(
        'provider_http_error',
        `No task id in TokenHub image submit response: ${JSON.stringify(submitResp).slice(0, 800)}`,
      )
    }
    ctx.onTaskSubmitted?.({ requestId: taskId, response: submitResp })
    log.info(
      `event=task-created capability=${capability} model=${model} requestId=${taskId} elapsedMs=${Date.now() - startedAt}`,
    )

    const queryUrl = `${base}/v1/api/image/query`
    const finalResp = await pollTencentTask({
      url: queryUrl,
      model,
      taskId,
      ctx,
      extractDone: (data) => extractImages(data).length > 0,
      capability,
      intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 3_000,
      timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 10 * 60 * 1_000,
    })
    const images = extractImages(finalResp)
    if (images.length === 0) {
      throw new MediaProviderError(
        'provider_http_error',
        `No image url in TokenHub query response: ${JSON.stringify(finalResp).slice(0, 800)}`,
      )
    }
    const assets = await Promise.all(
      images.map((img, i) =>
        this.artifact.writeImage(
          img,
          input.outputDir,
          filenameHelper(input, 'hyimage', i, images.length),
          ctx.fetch,
        ),
      ),
    )
    logMediaResult({
      provider: this.id,
      capability,
      ok: true,
      assetCount: assets.length,
      requestId: taskId,
    })
    return {
      provider: this.id,
      model,
      mode: 'async',
      requestId: taskId,
      assets,
      rawResponse: finalResp,
    }
  }

  // ─── 视频路径（全部异步）─────────────────────────────────────────────────
  private async generateVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = input.capability as MediaCapabilityId
    const model = ctx.defaultModel
    const base = baseEndpoint(ctx)

    const body = await buildTencentVideoRequest(input, ctx)

    const submitUrl = `${base}/v1/api/video/submit`
    logMediaCall({ provider: this.id, capability, model, method: 'POST', url: submitUrl, body })
    const startedAt = Date.now()
    const submitResp = await fetchJson(submitUrl, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      errorExtractor: tencentErrorExtractor,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })

    // 少数情况会同步直出视频
    let videoUrls = extractMediaUrls(submitResp, { kind: 'video' })
    let mode: 'sync' | 'async' = 'sync'
    let requestId: string | undefined
    let raw: unknown = submitResp

    if (videoUrls.length === 0) {
      const taskId = tencentTaskId(submitResp)
      if (!taskId) {
        logMediaResult({ provider: this.id, capability, ok: false, error: 'No task id' })
        throw new MediaProviderError(
          'provider_http_error',
          `No task id in TokenHub video submit response: ${JSON.stringify(submitResp).slice(0, 800)}`,
        )
      }
      requestId = taskId
      mode = 'async'
      ctx.onTaskSubmitted?.({ requestId: taskId, response: submitResp })
      log.info(
        `event=task-created capability=${capability} model=${model} requestId=${taskId} elapsedMs=${Date.now() - startedAt}`,
      )

      const queryUrl = `${base}/v1/api/video/query`
      raw = await pollTencentTask({
        url: queryUrl,
        model,
        taskId,
        ctx,
        extractDone: (data) => extractMediaUrls(data, { kind: 'video' }).length > 0,
        capability,
        intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
        timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 30 * 60 * 1_000,
      })
      videoUrls = extractMediaUrls(raw, { kind: 'video' })
    }

    if (videoUrls.length === 0) {
      logMediaResult({ provider: this.id, capability, ok: false, error: 'No video produced' })
      throw new MediaProviderError(
        'provider_http_error',
        `No video url in TokenHub query response: ${JSON.stringify(raw).slice(0, 800)}`,
      )
    }
    const downloadStartedAt = Date.now()
    const assets = await Promise.all(
      videoUrls.map((u, i) =>
        this.artifact.downloadMediaAsset(
          'video',
          u,
          input.outputDir,
          filenameHelper(input, videoPrefix(capability), i, videoUrls.length),
          ctx.fetch,
        ),
      ),
    )
    log.info(
      `event=download-finished capability=${capability} requestId=${requestId ?? 'inline'} assetCount=${assets.length} elapsedMs=${Date.now() - downloadStartedAt}`,
    )
    logMediaResult({
      provider: this.id,
      capability,
      ok: true,
      assetCount: assets.length,
      requestId,
    })
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

// ─── 自包含 POST 轮询（腾讯 query 是 POST + body {model, id}）──────────────
// 复刻 pollTask 的退避（interval*1.3，上限 15s）与超时语义；inspect 由调用方注入。
// 不复用 media-http.util.ts 的 pollTask：它写死 GET，扩展通用层仅为一家 provider 不值得
// （两个独立子代理交叉验证一致建议自包含）。
async function pollTencentTask(input: {
  url: string
  model: string
  taskId: string
  ctx: MediaProviderContext
  extractDone: (data: unknown) => boolean
  capability: MediaCapabilityId
  intervalMs: number
  timeoutMs: number
}): Promise<unknown> {
  const deadline = Date.now() + input.timeoutMs
  let interval = Math.max(1, input.intervalMs)
  let attempts = 0
  const body = JSON.stringify({ model: input.model, id: input.taskId })
  const headers = authHeaders(input.ctx)
  while (Date.now() < deadline) {
    attempts += 1
    const data = await fetchJson(input.url, {
      method: 'POST',
      headers,
      body,
      fetchImpl: input.ctx.fetch,
      timeoutMs: 30_000,
      errorExtractor: tencentErrorExtractor,
      ...(input.ctx.mediaManifest?.error ? { errorContract: input.ctx.mediaManifest.error } : {}),
    })
    if (input.extractDone(data)) return data
    const status = (extractStatus(data) || '').toLowerCase()
    if (SUCCEEDED_STATUSES.has(status)) return data
    if (FAILED_STATUSES.has(status)) {
      throw new MediaProviderError(
        'task_failed',
        `TokenHub task failed: ${JSON.stringify(data).slice(0, 800)}`,
      )
    }
    log.debug(
      `event=pending attempts=${attempts} capability=${input.capability} requestId=${input.taskId} status=${status || '(unknown)'} nextIntervalMs=${interval}`,
    )
    await new Promise((r) => setTimeout(r, interval))
    interval = Math.min(Math.max(interval * 1.3, interval), 15_000)
  }
  throw new MediaProviderError('task_timeout', `TokenHub task timed out after ${input.timeoutMs}ms`)
}

// ─── helpers ────────────────────────────────────────────────────────────────
function baseEndpoint(ctx: MediaProviderContext): string {
  return (ctx.apiEndpoint ?? '').replace(/\/+$/, '')
}

/**
 * 腾讯任务 id：submit 响应的 id 字段（任务 id，用于 query）。
 * 不能用通用 extractTaskId——它的优先级 request_id > id，而腾讯 request_id 是请求追踪 id，
 * 真正用于 query 的是 id 字段。用错会导致 query 收到 request_id 而拒绝任务。
 */
function tencentTaskId(resp: unknown): string | undefined {
  if (!resp || typeof resp !== 'object') return undefined
  const id = (resp as Record<string, unknown>).id
  return typeof id === 'string' && id ? id : undefined
}

function authHeaders(ctx: MediaProviderContext): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${ctx.apiKey}`,
  }
}

async function resolveImageRefs(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
): Promise<string[]> {
  const files = (input.inputFiles ?? []).filter(
    (file) =>
      file.type === 'image' ||
      (file.type === 'file' &&
        (!file.mimeType || file.mimeType.toLowerCase().startsWith('image/'))),
  )
  return Promise.all(files.map((f) => resolveTencentMediaReference(f, 'image', ctx)))
}

function videoPrefix(capability: MediaCapabilityId): string {
  return capability === 'video.image_to_video' ? 'i2v' : 't2v'
}

/**
 * 腾讯 TokenHub 错误提取器：优先 message_zh（中文更友好），附 code + request_id。
 */
export const tencentErrorExtractor: ErrorExtractor = (status, body, _rawText) => {
  if (!body || typeof body !== 'object') return undefined
  const root = body as Record<string, unknown>
  const errObj = (root.error && typeof root.error === 'object' ? root.error : root) as Record<
    string,
    unknown
  >
  const msg = strVal(errObj.message_zh) ?? strVal(errObj.message)
  const code =
    strVal(errObj.code) ?? (typeof errObj.code === 'number' ? String(errObj.code) : undefined)
  const requestId = strVal(errObj.request_id) ?? strVal(root.request_id)
  const head = code ? `TokenHub ${code}` : `TokenHub HTTP ${status}`
  const tail = requestId ? ` (request_id: ${requestId})` : ''
  return msg ? `${head}: ${msg}${tail}` : `${head}${tail}`
}

function strVal(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
