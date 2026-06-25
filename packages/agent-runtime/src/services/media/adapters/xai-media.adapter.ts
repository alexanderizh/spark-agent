/**
 * xAI (Grok) 多媒体 adapter。
 *
 * 见 https://docs.x.ai/developers/rest-api-reference/inference/images + /videos:
 *   - 图片生成：POST /images/generations（Imagine，默认 grok-imagine-image），仅 prompt。
 *   - 图片编辑/图生图：POST /images/edits，源图按 image（单图：{url, type:"image_url"}）
 *     或 images（多图：[{url, type:"image_url"}, ...]，最多 3 图）传入。url 可为公网 URL
 *     或 base64 data URI。响应结构与 /images/generations 一致（extractImages 可解析）。
 *   - 视频生成：POST /videos/generations → 返回 request_id → 轮询 GET /videos/{id}
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
import { extractImages, fetchJson } from '../media-http.util.js'
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
        'video.edit',
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
      // 黑名单只列「已显式设置、需防覆盖」的键；aspect_ratio / resolution / image_format /
      // negative_prompt 等合法 xAI 参数应继续从 modelParams 透传。
      // (n / size 由 extraAllowed 固定排除集处理，无需重复。)
      ...extraAllowed(ctx.extraParams, input.modelParams, [
        'image',
        'images',
        'prompt',
        'response_format',
      ]),
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
