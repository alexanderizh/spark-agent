/**
 * xAI (Grok) 多媒体 adapter。
 *
 * 见 https://docs.x.ai/developers/rest-api-reference/inference/images + /videos:
 *   - 图片生成：POST /images/generations（Imagine，默认 grok-imagine-image），仅 prompt。
 *   - 图片编辑/图生图：POST /images/edits，源图按 image（单图：{url, type:"image_url"}）
 *     或 images（多图：[{url, type:"image_url"}, ...]，最多 3 图）传入。url 可为公网 URL
 *     或 base64 data URI。响应结构与 /images/generations 一致（extractImages 可解析）。
 *   - 视频生成：POST /videos/generations → 返回 request_id → 轮询 GET /videos/{id}
 *   - 视频编辑：POST /videos/edits，输入 video 对象（{url}），prompt 描述修改。
 *     官方明确：编辑忽略 duration/aspect_ratio/resolution（输出继承输入视频，最长 8.7 秒，分辨率上限 720p）。
 *   - 视频扩展：POST /videos/extensions，输入 video 对象，从最后一帧续拍。
 *     duration 范围 [1,15] 秒，默认 6 秒。
 *   - 语音合成：/audio/speech（默认 grok-tts）
 *
 * xAI 暂未公开通用语音转写（Whisper）端点，因此 capability 集不含 audio.transcription。
 *
 * 默认 endpoint: https://api.x.ai/v1
 */

import { OpenAiCompatibleMediaAdapter } from './openai-compatible-media.adapter.js'
import { MediaProviderError } from '../media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaProviderContext,
} from '../media-adapter.types.js'
import { extractImages, extractMediaUrls, extractStatus, extractTaskId, fetchJson, pollTask } from '../media-http.util.js'
import { FAILED_STATUSES } from './openai-compatible-media.adapter.js'
import { extraAllowed, filenameHelper, mediaInputRef } from './openai-compatible-media.adapter.js'
import { logMediaCall, logMediaResult } from '../media-debug-log.js'

export class XaiMediaAdapter extends OpenAiCompatibleMediaAdapter {
  constructor() {
    super({
      id: 'xai',
      capabilities: [
        'image.generate',
        'image.edit',
        'audio.speech',
        'video.generate',
        'video.image_to_video',
        'video.reference_to_video',
        'video.edit',
        'video.extend',
      ],
      videoTaskPath: (taskId) => `/videos/${encodeURIComponent(taskId)}`,
      genericTaskPath: (taskId) => `/videos/${encodeURIComponent(taskId)}`,
    })
  }

  protected override async editImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const prompt = (input.prompt ?? '').trim()
    // 参考图取值复用 mediaInputRef（与视频路径 generateVideo 一致）：
    // safe-file:// 本地协议地址第三方 API 无法访问，必须过滤；优先 base64 dataUrl。
    const imageRefs = (input.inputFiles ?? [])
      .filter((file) => file.type === 'image' || file.type === 'file')
      .map((file) => mediaInputRef(file, ctx.mediaProvider) ?? '')
      .filter((ref) => ref.length > 0)
    if (imageRefs.length === 0) {
      throw new MediaProviderError('invalid_input', 'xAI image edit requires input image(s)')
    }
    const model = ctx.defaultModel
    const params = normalizeXaiImageParams(input.modelParams)
    // xAI 图片编辑走 POST /images/edits（不是 /images/generations）：
    // 源图按 image（单图）或 images（多图，最多 3 图）传入，值为 {url, type:"image_url"} 对象。
    // url 可为公网 URL 或 base64 data URI。发错端点或字符串字段会被 xAI 静默忽略 → 产物与参考图无关。
    // 见 https://docs.x.ai/developers/rest-api-reference/inference/images 的 Image edit 一节。
    const editRefs = imageRefs.slice(0, 3)
    const imageObjects = editRefs.map((ref) => ({ url: ref, type: 'image_url' }))
    const body: Record<string, unknown> = {
      model,
      prompt,
      ...(imageObjects.length === 1
        ? { image: imageObjects[0] }
        : { images: imageObjects }),
      ...(params.response_format ? { response_format: params.response_format } : {}),
      // 黑名单只列「已显式设置、需防覆盖」的键；aspect_ratio / resolution / image_format /
      // negative_prompt 等合法 xAI 参数应继续从 modelParams 透传。
      // (n / size 由 extraAllowed 固定排除集处理，无需重复。)
      // Contract V2：传入 ctx.mediaManifestCapability 后，extraAllowed 会按 xaiImageParamPolicy
      // （strict + passthrough disabled + transforms.ratio_size_to_aspect + forbidden.size）
      // 进一步过滤掉未知字段。
      ...extraAllowed(ctx.extraParams, params, [
        'image',
        'images',
        'prompt',
        'response_format',
      ], ctx.mediaManifestCapability),
    }
    const url = `${baseEndpoint(ctx)}/images/edits`
    logMediaCall({
      provider: this.id,
      capability: 'image.edit',
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120), inputImages: editRefs.length },
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
      logMediaResult({ provider: this.id, capability: 'image.edit', ok: false, error: 'No images in xAI edit response' })
      throw new MediaProviderError('provider_http_error', `No images in xAI edit response: ${JSON.stringify(data).slice(0, 800)}`)
    }
    logMediaResult({ provider: this.id, capability: 'image.edit', ok: true, assetCount: images.length })
    const assets = await Promise.all(
      images.map((image, index) =>
        this.artifact.writeImage(image, input.outputDir, filenameHelper(input, 'edit', index, images.length), ctx.fetch),
      ),
    )
    return { provider: this.id, model, mode: 'sync', assets, rawResponse: data }
  }

  /**
   * 视频编辑 / 视频扩展。按 capability 分流到 xAI 独立端点：
   *   - video.edit   → POST /videos/edits（输入 video 对象，忽略 duration/aspect_ratio/resolution）
   *   - video.extend → POST /videos/extensions（duration 范围 [1,15]，默认 6）
   * 两者都返回 request_id，复用 GET /videos/{id} 轮询（与 generate 同一查询端点）。
   * 见 https://docs.x.ai/developers/model-capabilities/video/editing 与 .../extension。
   */
  protected override async editVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = input.capability ?? 'video.edit'
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) {
      throw new MediaProviderError('invalid_input', `xAI ${capability} requires a prompt`)
    }
    const inputVideoFile = (input.inputFiles ?? []).find(
      (file) => file.type === 'video' || (file.type === 'file' && file.role === 'input'),
    )
    const videoRef = inputVideoFile ? mediaInputRef(inputVideoFile, ctx.mediaProvider) : undefined
    if (!videoRef) {
      throw new MediaProviderError('invalid_input', `xAI ${capability} requires an input video`)
    }
    const model = ctx.defaultModel
    const isExtend = capability === 'video.extend'
    const endpoint = isExtend ? '/videos/extensions' : '/videos/edits'
    // 编辑端点：官方明确输出继承输入视频（duration/aspect_ratio/resolution 被忽略），仅传 video + prompt。
    // 扩展端点：额外支持 duration [1,15] 默认 6（视频编辑不支持 duration，故不透传）。
    const body: Record<string, unknown> = {
      model,
      prompt,
      video: { url: videoRef },
    }
    if (isExtend) {
      const duration = clampDuration(input.modelParams?.durationSeconds, ctx.mediaDefaults?.video?.durationSeconds, 6, 1, 15)
      body.duration = duration
    }
    const url = `${baseEndpoint(ctx)}${endpoint}`
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120), inputVideo: videoRef.slice(0, 80) },
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    // 同步直出视频 url（少数情况），否则取 request_id 轮询。
    let videoUrls = extractMediaUrls(data, { kind: 'video' })
    let requestId: string | undefined
    let mode: 'sync' | 'async' = 'sync'
    let raw = data
    if (videoUrls.length === 0) {
      const taskId = extractTaskId(data)
      if (!taskId) {
        logMediaResult({ provider: this.id, capability, ok: false, error: 'No video url or task id' })
        throw new MediaProviderError('provider_http_error', `No video url or task id: ${JSON.stringify(data).slice(0, 800)}`)
      }
      requestId = taskId
      mode = 'async'
      const pollUrl = `${baseEndpoint(ctx)}/videos/${encodeURIComponent(taskId)}`
      raw = await pollTask(pollUrl, authHeaders(ctx), {
        fetchImpl: ctx.fetch,
        intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
        timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 600_000,
        inspect: (d) => {
          const urls = extractMediaUrls(d, { kind: 'video' })
          if (urls.length > 0) return 'done'
          const s = extractStatus(d)
          return FAILED_STATUSES.includes(s) ? 'failed' : 'pending'
        },
        ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
      })
      videoUrls = extractMediaUrls(raw, { kind: 'video' })
    }
    if (videoUrls.length === 0) {
      logMediaResult({ provider: this.id, capability, ok: false, error: 'No video produced' })
      throw new MediaProviderError('provider_http_error', `No video produced: ${JSON.stringify(raw).slice(0, 800)}`)
    }
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: videoUrls.length, requestId })
    const assets = await Promise.all(
      videoUrls.map((u, i) =>
        this.artifact.downloadMediaAsset('video', u, input.outputDir, filenameHelper(input, isExtend ? 'extend' : 'edit', i, videoUrls.length), ctx.fetch),
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

function clampDuration(
  value: unknown,
  fallback: number | undefined,
  def: number,
  min: number,
  max: number,
): number {
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  if (Number.isFinite(raw)) return Math.max(min, Math.min(max, raw))
  if (fallback != null && Number.isFinite(fallback)) return Math.max(min, Math.min(max, fallback))
  return def
}

function normalizeXaiImageParams(modelParams: Record<string, unknown> | undefined): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(modelParams ?? {})) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    next[key] = value
  }
  if (next.aspect_ratio == null && next.aspectRatio != null) next.aspect_ratio = next.aspectRatio
  if (next.response_format == null) {
    if (next.responseFormat != null) next.response_format = next.responseFormat
    if (next.output_format === 'url' || next.output_format === 'b64_json') next.response_format = next.output_format
    if (next.outputFormat === 'url' || next.outputFormat === 'b64_json') next.response_format = next.outputFormat
  }
  if (next.image_format == null) {
    if (next.output_format != null && next.output_format !== 'url' && next.output_format !== 'b64_json') next.image_format = next.output_format
    if (next.outputFormat != null && next.outputFormat !== 'url' && next.outputFormat !== 'b64_json') next.image_format = next.outputFormat
  }
  delete next.aspectRatio
  delete next.responseFormat
  delete next.outputFormat
  delete next.output_format
  return next
}
