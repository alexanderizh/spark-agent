/**
 * xAI (Grok) 多媒体 adapter。
 *
 * 见 design doc §6.2 + https://docs.x.ai/docs/guides/image-generations:
 *   - 图片生成：/images/generations（Imagine，默认 grok-imagine-image）
 *   - 图片编辑/图生图：同样走 /images/generations，按 image_url（单图）/
 *     image_urls（最多 3 图）传入源图。xAI 不支持 OpenAI 风格 /images/edits
 *     （multipart 被拒；JSON body 下 image 字段会被当作字符串解析，触发
 *     HTTP 422 "expected struct ImageUrl"）。
 *   - 视频生成：/videos/generations → 返回 request_id → 轮询 /videos/{id}
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
import { extraAllowed, filenameHelper } from './openai-compatible-media.adapter.js'
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
    const imageRefs = (input.inputFiles ?? [])
      .filter((file) => file.type === 'image' || file.type === 'file')
      .map((file) => file.url ?? file.dataUrl ?? file.path ?? '')
      .filter((ref) => ref.length > 0)
    if (imageRefs.length === 0) {
      throw new MediaProviderError('invalid_input', 'xAI image edit requires input image(s)')
    }
    const model = ctx.defaultModel
    // xAI image editing uses the SAME /images/generations endpoint as generation,
    // with the source image(s) passed via image_url / image_urls.
    // The OpenAI-style /images/edits endpoint is NOT supported by xAI — its multipart
    // body is rejected, and even a JSON body there deserializes `image` as a string
    // where xAI expects a struct (HTTP 422 "expected struct ImageUrl").
    // See https://docs.x.ai/docs/guides/image-generations — "use the same sample() method,
    // just add the image_url parameter".
    // xAI accepts a public URL or a base64 data URI for image_url, and up to 3 images
    // for editing via image_urls.
    const editRefs = imageRefs.slice(0, 3)
    const body: Record<string, unknown> = {
      model,
      prompt,
      ...(editRefs.length === 1
        ? { image_url: editRefs[0] }
        : { image_urls: editRefs }),
      // 黑名单只列「已显式设置、需防覆盖」的键；aspect_ratio / resolution / image_format /
      // negative_prompt 等合法 xAI 参数应继续从 modelParams 透传。
      // (n / size 由 extraAllowed 固定排除集处理，无需重复。)
      ...extraAllowed(ctx.extraParams, input.modelParams, [
        'image_url',
        'image_urls',
        'prompt',
        'response_format',
      ]),
    }
    const url = `${baseEndpoint(ctx)}/images/generations`
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
