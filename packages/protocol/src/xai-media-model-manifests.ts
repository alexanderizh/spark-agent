import type { MediaModelManifest } from './media-model-manifest.js'

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
        timeoutMs: 1800000,
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

export const XAI_TTS_PARAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    voiceId: { type: 'string', title: '音色', default: 'eve' },
    language: { type: 'string', title: '语言', default: 'auto' },
    outputFormat: {
      type: 'string',
      title: '输出格式',
      enum: ['mp3', 'wav', 'pcm', 'opus', 'flac'],
      default: 'mp3',
    },
    sampleRate: { type: 'integer', title: '采样率', minimum: 8000 },
    bitRate: { type: 'integer', title: '码率', minimum: 8000 },
    speed: { type: 'number', title: '语速', minimum: 0.7, maximum: 1.5, default: 1 },
    optimizeStreamingLatency: { type: 'boolean', title: '优化流式延迟' },
    textNormalization: { type: 'boolean', title: '文本规范化' },
    withTimestamps: { type: 'boolean', title: '返回时间戳', default: false },
  },
}
