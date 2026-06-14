/**
 * xAI (Grok) 多媒体 adapter。
 *
 * 见 design doc §6.2 + https://docs.x.ai/developers/model-capabilities:
 *   - 图片生成：/images/generations（Imagine，默认 grok-imagine-image）
 *   - 视频生成：/videos/generations → 返回 request_id → 轮询 /videos/generations/{id}
 *   - 语音合成：/audio/speech（默认 grok-tts）
 *
 * xAI 暂未公开通用语音转写（Whisper）端点，因此 capability 集不含 audio.transcription。
 *
 * 默认 endpoint: https://api.x.ai/v1
 */

import { OpenAiCompatibleMediaAdapter } from './openai-compatible-media.adapter.js'

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
}
