import type { MediaModelManifest } from './media-model-manifest.js'
import { DEFAULT_VIDEO_POLL_TIMEOUT_MS } from './media-config.js'

const xaiVideo15Schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    aspectRatio: {
      type: 'string',
      title: '比例',
      enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
    },
    durationSeconds: { type: 'integer', title: '时长', minimum: 1, maximum: 15, default: 8 },
    resolution: {
      type: 'string',
      title: '分辨率',
      enum: ['480p', '720p', '1080p'],
      default: '720p',
    },
    user: { type: 'string', title: '用户标识' },
  },
}

const xaiVideoStatusMap = {
  pending: 'queued',
  processing: 'running',
  done: 'succeeded',
  failed: 'failed',
  expired: 'failed',
} as const

const XAI_VIDEO_15_MODEL_IDS = [
  'grok-imagine-video-1.5',
  'grok-imagine-video-1.5-preview',
  'grok-imagine-video-1.5-2026-05-30',
] as const

export const XAI_VIDEO_15_MANIFESTS: readonly MediaModelManifest[] = XAI_VIDEO_15_MODEL_IDS.map(
  (modelId) => ({
    id: `xai:${modelId}`,
    providerKind: 'xai',
    modelId,
    displayName:
      modelId === 'grok-imagine-video-1.5'
        ? 'xAI Grok Imagine Video 1.5（推荐）'
        : `xAI Grok Imagine Video 1.5 (${modelId.replace('grok-imagine-video-1.5-', '')})`,
    domains: ['video'],
    capabilities: [
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: {
          required: ['image'],
          maxImages: 1,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: { types: ['video'], mimeTypes: ['video/mp4'] },
        paramSchema: xaiVideo15Schema,
        defaults: { durationSeconds: 8, resolution: '720p' },
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/videos/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        prompt: '{{prompt}}',
        image: { url: '{{firstFrame}}' },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['request_id', 'id'],
        statusEndpoint: '/videos/{{taskId}}',
        resultPaths: ['video.file_output.public_url', 'video.url', 'video_url', 'data[].url'],
      },
      polling: {
        intervalMs: 5000,
        timeoutMs: DEFAULT_VIDEO_POLL_TIMEOUT_MS,
        statusMap: xaiVideoStatusMap,
      },
    },
    docs: {
      sourceUrls: ['https://docs.x.ai/developers/model-capabilities/video/generation'],
      lastCheckedAt: '2026-07-16',
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true },
  }),
)

// 字段与枚举来源 docs/integrations/xai/audio.md §1.1（参数表）/ §1.3（输出格式枚举）。
// 注意：xAI TTS 文档未列 speed 参数（区别于 OpenAI TTS），不要臆测添加。
export const XAI_TTS_PARAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    voiceId: {
      type: 'string',
      title: '音色',
      default: 'eve',
      // 精选 8 个高频内置音色（来源 §1.5 内置音色清单，共 26 个）。
      // x-allow-custom 让画布渲染为 AutoComplete：既可选推荐值，也可输入自定义音色 ID。
      examples: ['eve', 'leo', 'rex', 'sal', 'orion', 'luna', 'iris', 'helios'],
      'x-allow-custom': true,
    },
    language: { type: 'string', title: '语言', default: 'auto' },
    outputFormat: {
      // §1.3 Codec 表：mp3/wav/pcm/mulaw/alaw（无 opus/flac）
      type: 'string',
      title: '输出格式',
      enum: ['mp3', 'wav', 'pcm', 'mulaw', 'alaw'],
      default: 'mp3',
    },
    // §1.3 采样率枚举：8000/16000/22050/24000(默认)/44100/48000
    sampleRate: {
      type: 'integer',
      title: '采样率',
      enum: [8000, 16000, 22050, 24000, 44100, 48000],
    },
    // §1.3 比特率枚举（仅 mp3）：32000/64000/96000/128000(默认)/192000
    bitRate: {
      type: 'integer',
      title: '码率',
      enum: [32000, 64000, 96000, 128000, 192000],
    },
    // §1.1 L47：integer 0/1/2（同步 REST 文档未列 2，保守暴露 0/1/2 三档）
    optimizeStreamingLatency: {
      type: 'integer',
      title: '优化流式延迟',
      enum: [0, 1, 2],
    },
    textNormalization: { type: 'boolean', title: '文本规范化' },
    withTimestamps: { type: 'boolean', title: '返回时间戳', default: false },
  },
}
