/**
 * APIMart 多媒体 adapter。
 *
 * APIMart 是 OpenAI 兼容聚合平台（design doc §6.1）：
 *   - 图片：/images/generations（可能返回直接产物或异步 task id）
 *   - 图片编辑：/images/edits（首版支持 url / dataUrl 参考）
 *   - 语音合成：/audio/speech（OpenAI TTS 风格，二进制返回）
 *   - 语音转写：/audio/transcriptions（Whisper 风格）
 *   - 视频：/videos/generations 创建任务 → 轮询 /videos/generations/{id} 或 /tasks/{id}
 *
 * 默认 endpoint: https://api.apimart.ai/v1
 */

import { OpenAiCompatibleMediaAdapter } from './openai-compatible-media.adapter.js'

export class ApimartMediaAdapter extends OpenAiCompatibleMediaAdapter {
  constructor() {
    super({
      id: 'apimart',
      capabilities: [
        'image.generate',
        'image.edit',
        'image.variations',
        'audio.speech',
        'audio.transcription',
        'video.generate',
        'video.image_to_video',
      ],
      // APIMart 视频任务通常用 /videos/generations/{id} 查询，部分模型走 /tasks/{id}。
      // extractMediaUrls/extractStatus 对两种返回都兼容，这里给一条兜底 path，
      // 服务端若无该 path 会返回 404，由调用方报错。
      videoTaskPath: (taskId) => `/videos/generations/${encodeURIComponent(taskId)}`,
      genericTaskPath: (taskId) => `/tasks/${encodeURIComponent(taskId)}`,
    })
  }
}
