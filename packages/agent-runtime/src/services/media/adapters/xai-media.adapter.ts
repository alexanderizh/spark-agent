/**
 * xAI (Grok) 多媒体 adapter。
 *
 * 见 design doc §6.2 + https://docs.x.ai/developers/model-capabilities:
 *   - 图片生成：/images/generations（Imagine，默认 grok-imagine-image）
 *   - 图片编辑/图生图：/images/edits，支持 public URL / base64 data URI / file_id
 *   - 视频生成：/videos/generations → 返回 request_id → 轮询 /videos/generations/{id}
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
      ],
      videoTaskPath: (taskId) => `/videos/generations/${encodeURIComponent(taskId)}`,
      genericTaskPath: (taskId) => `/videos/generations/${encodeURIComponent(taskId)}`,
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
    const body: Record<string, unknown> = {
      model,
      prompt,
      ...(imageRefs.length === 1 ? { image: imageRefs[0] } : { images: imageRefs }),
      ...extraAllowed(ctx.extraParams, input.modelParams, [
        'image',
        'images',
        'image_url',
        'image_urls',
        'prompt',
        'response_format',
      ]),
    }
    const data = await fetchJson(`${baseEndpoint(ctx)}/images/edits`, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 120_000,
    })
    const images = extractImages(data)
    if (images.length === 0) {
      throw new MediaProviderError('provider_http_error', `No images in xAI edit response: ${JSON.stringify(data).slice(0, 800)}`)
    }
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
