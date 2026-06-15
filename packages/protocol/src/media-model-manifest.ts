/**
 * @module media-model-manifest
 *
 * 多媒体模型能力清单。
 *
 * Manifest 描述“某个模型支持什么能力、需要什么输入、参数如何校验、
 * 请求如何组装、产物如何提取”。Provider 负责密钥和 endpoint，adapter
 * 负责平台协议，模型差异尽量留在 manifest 里，避免在画布或 MCP 工具里写死。
 */

import { z } from 'zod'

export type MediaDomain = 'image' | 'audio' | 'video' | 'text' | 'document' | 'web' | 'slide' | 'sheet'

export type MediaManifestCapabilityId =
  | 'image.generate'
  | 'image.image_to_image'
  | 'image.edit'
  | 'image.compose'
  | 'video.generate'
  | 'video.image_to_video'
  | 'video.edit'
  | 'audio.speech'
  | 'audio.transcription'
  | string

export type MediaManifestInputKind = 'prompt' | 'image' | 'images' | 'video' | 'audio' | 'mask' | 'text' | 'file'
export type MediaManifestOutputKind = 'image' | 'video' | 'audio' | 'text' | 'file'
export type MediaInvocationMode = 'sync' | 'async_polling' | 'async_callback' | 'stream' | 'file_job'
export type MediaRequestContentType = 'json' | 'multipart' | 'binary'

export type MediaArtifactRetrieval =
  | { kind: 'inline_base64'; jsonPaths: string[] }
  | { kind: 'url'; jsonPaths: string[]; download: boolean }
  | { kind: 'task_poll'; taskIdPaths: string[]; statusEndpoint: string; resultPaths: string[] }
  | { kind: 'binary_response' }

export interface MediaModelCapabilityManifest {
  id: MediaManifestCapabilityId
  label: string
  input: {
    required: MediaManifestInputKind[]
    maxImages?: number | undefined
    acceptedMimeTypes?: string[] | undefined
  }
  output: {
    types: MediaManifestOutputKind[]
    mimeTypes?: string[] | undefined
  }
  /** JSON Schema object used by tools and canvas parameter panels. */
  paramSchema: Record<string, unknown>
  defaults?: Record<string, unknown> | undefined
  /** Normalized param name -> provider native field name. */
  aliases?: Record<string, string> | undefined
}

export interface MediaModelManifest {
  id: string
  providerKind: string
  modelId: string
  displayName: string
  version?: string | undefined
  domains: MediaDomain[]
  capabilities: MediaModelCapabilityManifest[]
  invocation: {
    mode: MediaInvocationMode
    endpoint: string
    method: 'GET' | 'POST'
    contentType: MediaRequestContentType
    requestTemplate: Record<string, unknown>
    response: MediaArtifactRetrieval
    polling?: {
      intervalMs: number
      timeoutMs: number
      statusMap: Record<string, 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'>
      retry?: { maxAttempts: number; backoffMs: number } | undefined
    } | undefined
  }
  docs: {
    sourceUrls: string[]
    lastCheckedAt?: string | undefined
    docMcp?: { serverName: string; toolName: string } | undefined
  }
  safety?: {
    maxPromptLength?: number | undefined
    allowLocalFiles?: boolean | undefined
    maxInputBytes?: number | undefined
  } | undefined
}

export interface ProviderMediaModelRef {
  manifestId: string
  modelId?: string | undefined
  enabled?: boolean | undefined
  defaults?: Record<string, unknown> | undefined
}

const JsonObjectSchema = z.record(z.unknown())

export const MediaArtifactRetrievalSchema: z.ZodType<MediaArtifactRetrieval> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('inline_base64'),
    jsonPaths: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal('url'),
    jsonPaths: z.array(z.string().min(1)).min(1),
    download: z.boolean(),
  }),
  z.object({
    kind: z.literal('task_poll'),
    taskIdPaths: z.array(z.string().min(1)).min(1),
    statusEndpoint: z.string().min(1),
    resultPaths: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal('binary_response'),
  }),
])

export const MediaModelCapabilityManifestSchema: z.ZodType<MediaModelCapabilityManifest> = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  input: z.object({
    required: z.array(z.enum(['prompt', 'image', 'images', 'video', 'audio', 'mask', 'text', 'file'])).max(20),
    maxImages: z.number().int().min(1).max(64).optional(),
    acceptedMimeTypes: z.array(z.string().min(1).max(120)).max(100).optional(),
  }),
  output: z.object({
    types: z.array(z.enum(['image', 'video', 'audio', 'text', 'file'])).min(1).max(20),
    mimeTypes: z.array(z.string().min(1).max(120)).max(100).optional(),
  }),
  paramSchema: JsonObjectSchema,
  defaults: JsonObjectSchema.optional(),
  aliases: z.record(z.string().min(1).max(120)).optional(),
})

export const MediaModelManifestSchema: z.ZodType<MediaModelManifest> = z.object({
  id: z.string().min(1).max(160),
  providerKind: z.string().min(1).max(120),
  modelId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  version: z.string().min(1).max(80).optional(),
  domains: z.array(z.enum(['image', 'audio', 'video', 'text', 'document', 'web', 'slide', 'sheet'])).min(1).max(20),
  capabilities: z.array(MediaModelCapabilityManifestSchema).min(1).max(50),
  invocation: z.object({
    mode: z.enum(['sync', 'async_polling', 'async_callback', 'stream', 'file_job']),
    endpoint: z.string().min(1).max(500),
    method: z.enum(['GET', 'POST']),
    contentType: z.enum(['json', 'multipart', 'binary']),
    requestTemplate: JsonObjectSchema,
    response: MediaArtifactRetrievalSchema,
    polling: z.object({
      intervalMs: z.number().int().min(250).max(300_000),
      timeoutMs: z.number().int().min(1_000).max(7_200_000),
      statusMap: z.record(z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])),
      retry: z.object({
        maxAttempts: z.number().int().min(0).max(20),
        backoffMs: z.number().int().min(0).max(300_000),
      }).optional(),
    }).optional(),
  }),
  docs: z.object({
    sourceUrls: z.array(z.string().min(1).max(800)).max(50),
    lastCheckedAt: z.string().min(1).max(80).optional(),
    docMcp: z.object({
      serverName: z.string().min(1).max(120),
      toolName: z.string().min(1).max(120),
    }).optional(),
  }),
  safety: z.object({
    maxPromptLength: z.number().int().min(1).max(1_000_000).optional(),
    allowLocalFiles: z.boolean().optional(),
    maxInputBytes: z.number().int().min(1).optional(),
  }).optional(),
})

export const ProviderMediaModelRefSchema: z.ZodType<ProviderMediaModelRef> = z.object({
  manifestId: z.string().min(1).max(160),
  modelId: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  defaults: JsonObjectSchema.optional(),
})

const imageSizeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    size: { type: 'string', title: '尺寸', examples: ['1024x1024', '16:9'] },
    aspectRatio: { type: 'string', title: '比例', examples: ['1:1', '16:9', '9:16'] },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 1 },
    quality: { type: 'string', title: '质量' },
    outputFormat: { type: 'string', title: '输出格式', enum: ['png', 'jpeg', 'webp'] },
    seed: { type: 'integer', title: '随机种子' },
  },
}

const apimartGptImage2Schema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    size: {
      type: 'string',
      title: '画幅',
      enum: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
      default: '1:1',
    },
    resolution: { type: 'string', title: '分辨率', enum: ['1k', '2k', '4k'], default: '1k' },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 1, default: 1 },
    official_fallback: { type: 'boolean', title: '官方兜底', default: false },
  },
}

const apimartImageModelSchemas: Record<string, { schema: Record<string, unknown>; defaults: Record<string, unknown> }> = {
  'wan2.7-image': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: { type: 'string', title: '画幅 / 尺寸', enum: ['1K', '2K', '4K', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] },
        resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K', '4K'] },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 1 },
        negative_prompt: { type: 'string', title: '负面提示词' },
        seed: { type: 'integer', title: '随机种子', minimum: 0, maximum: 2147483647 },
        thinking_mode: { type: 'boolean', title: '思考模式', default: true },
        enable_sequential: { type: 'boolean', title: '连续生成', default: false },
        watermark: { type: 'boolean', title: '水印', default: false },
      },
    },
    defaults: { n: 1, thinking_mode: true, enable_sequential: false, watermark: false },
  },
  'imagen-4.0-apimart': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: { type: 'string', title: '画幅', enum: ['1:1', '4:3', '3:4', '16:9', '9:16'], default: '16:9' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 1, default: 1 },
      },
    },
    defaults: { n: 1, size: '16:9' },
  },
  'qwen-image-2.0': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: { type: 'string', title: '画幅', enum: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], default: '1:1' },
        resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K'], default: '1K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 6, default: 1 },
        negative_prompt: { type: 'string', title: '负面提示词', maxLength: 500 },
      },
    },
    defaults: { size: '1:1', resolution: '1K', n: 1 },
  },
  'doubao-seedream-5-0-lite': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: { type: 'string', title: '画幅', enum: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', 'auto'], default: '1:1' },
        resolution: { type: 'string', title: '分辨率', enum: ['2K', '3K', '4K'], default: '2K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 15, default: 1 },
        output_format: { type: 'string', title: '输出格式', enum: ['jpeg', 'png'], default: 'jpeg' },
        sequential_image_generation: { type: 'string', title: '连续生成', enum: ['disabled', 'auto'], default: 'disabled' },
        watermark: { type: 'boolean', title: '水印', default: false },
      },
    },
    defaults: { size: '1:1', resolution: '2K', n: 1, output_format: 'jpeg', sequential_image_generation: 'disabled', watermark: false },
  },
  'gemini-3.1-flash-image-preview': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: { type: 'string', title: '画幅', enum: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '5:4', '4:5', '21:9', '1:4', '4:1', '1:8', '8:1'] },
        resolution: { type: 'string', title: '分辨率', enum: ['0.5K', '1K', '2K', '4K'], default: '1K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 1 },
        google_search: { type: 'boolean', title: 'Google 搜索', default: false },
        google_image_search: { type: 'boolean', title: 'Google 图片搜索', default: false },
        official_fallback: { type: 'boolean', title: '官方兜底', default: false },
      },
    },
    defaults: { resolution: '1K', n: 1, google_search: false, google_image_search: false, official_fallback: false },
  },
  'gemini-3-pro-image-preview': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: { type: 'string', title: '画幅', enum: ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] },
        resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K', '4K'], default: '1K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 1 },
        mask_url: { type: 'string', title: '遮罩 URL' },
        official_fallback: { type: 'boolean', title: '官方兜底', default: false },
      },
    },
    defaults: { resolution: '1K', n: 1, official_fallback: false },
  },
  'gemini-2.5-flash-image-preview': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: { type: 'string', title: '画幅', enum: ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] },
        resolution: { type: 'string', title: '分辨率', enum: ['1K'], default: '1K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 1 },
        mask_url: { type: 'string', title: '遮罩 URL' },
        official_fallback: { type: 'boolean', title: '官方兜底', default: false },
      },
    },
    defaults: { resolution: '1K', n: 1, official_fallback: false },
  },
}

const videoSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    aspectRatio: { type: 'string', title: '比例', examples: ['16:9', '9:16', '1:1'] },
    durationSeconds: { type: 'integer', title: '时长', minimum: 1, maximum: 60 },
    resolution: { type: 'string', title: '分辨率', examples: ['720p', '1080p'] },
    fps: { type: 'integer', title: '帧率', minimum: 1, maximum: 120 },
    seed: { type: 'integer', title: '随机种子' },
    useFirstFrame: { type: 'boolean', title: '使用首帧', default: true },
    useLastFrame: { type: 'boolean', title: '使用尾帧', default: false },
    editStrength: { type: 'number', title: '编辑强度', minimum: 0, maximum: 1 },
  },
}

const xaiVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: { type: 'string', title: '比例', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] },
    durationSeconds: { type: 'integer', title: '时长', minimum: 1, maximum: 15, default: 8 },
    resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p', '1080p'], default: '720p' },
    user: { type: 'string', title: '用户标识' },
    useFirstFrame: { type: 'boolean', title: '使用首帧', default: true },
    useLastFrame: { type: 'boolean', title: '使用尾帧', default: false },
  },
}

const xaiImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: { type: 'string', title: '比例', enum: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1', 'auto'] },
    resolution: { type: 'string', title: '分辨率', enum: ['1k', '2k'] },
    n: { type: 'integer', title: '数量', minimum: 1, default: 1 },
    response_format: { type: 'string', title: '响应格式', enum: ['url', 'b64_json'], default: 'url' },
    user: { type: 'string', title: '用户标识' },
  },
}

const apimartSeedance2VideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    durationSeconds: { type: 'integer', title: '时长', minimum: 4, maximum: 15, default: 5 },
    aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'], default: '16:9' },
    resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p', '1080p'], default: '480p' },
    seed: { type: 'integer', title: '随机种子' },
    generate_audio: { type: 'boolean', title: '生成音频', default: false },
    return_last_frame: { type: 'boolean', title: '返回尾帧', default: false },
    useFirstFrame: { type: 'boolean', title: '使用首帧', default: true },
    useLastFrame: { type: 'boolean', title: '使用尾帧', default: false },
  },
}

const volcengineSeedanceVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    mode: {
      type: 'string',
      title: '生成模式',
      enum: ['参考生成', '首尾帧', '版权IP生成'],
      default: '参考生成',
    },
    aspectRatio: {
      type: 'string',
      title: '视频比例',
      enum: ['智能比例', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      default: '智能比例',
    },
    resolution: {
      type: 'string',
      title: '分辨率',
      enum: ['480p', '720p', '1080p'],
      default: '720p',
    },
    durationMode: {
      type: 'string',
      title: '视频时长模式',
      enum: ['按秒数', '智能时长'],
      default: '按秒数',
    },
    durationSeconds: { type: 'integer', title: '时长', minimum: 1, maximum: 15, default: 5 },
    count: { type: 'integer', title: '生成数量', minimum: 1, maximum: 4, default: 4 },
    generateAudio: { type: 'boolean', title: '输出声音', default: true },
    seed: { type: 'integer', title: '随机种子', default: -1 },
    searchEnabled: { type: 'boolean', title: '联网搜索', default: false },
    timeoutHours: { type: 'integer', title: '生成超时时间（小时）', minimum: 1, maximum: 48, default: 48 },
    fps: { type: 'integer', title: '帧率', minimum: 1, maximum: 24, default: 24 },
    useFirstFrame: { type: 'boolean', title: '使用首帧', default: true },
    useLastFrame: { type: 'boolean', title: '使用尾帧', default: false },
  },
}

const klingVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16', '1:1'] },
    durationSeconds: { type: 'integer', title: '时长', enum: [5, 10] },
    mode: { type: 'string', title: '模式', enum: ['standard', 'professional'] },
    negative_prompt: { type: 'string', title: '负面提示词' },
    audio: { type: 'boolean', title: '生成音频', default: false },
    useFirstFrame: { type: 'boolean', title: '使用首帧', default: true },
    useLastFrame: { type: 'boolean', title: '使用尾帧', default: false },
  },
}

const minimaxImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: { type: 'string', title: '比例', enum: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'], default: '1:1' },
    width: { type: 'integer', title: '宽度', minimum: 512, maximum: 2048 },
    height: { type: 'integer', title: '高度', minimum: 512, maximum: 2048 },
    response_format: { type: 'string', title: '响应格式', enum: ['url', 'base64'], default: 'url' },
    seed: { type: 'integer', title: '随机种子' },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 9, default: 1 },
    prompt_optimizer: { type: 'boolean', title: '提示词优化', default: false },
    aigc_watermark: { type: 'boolean', title: 'AIGC 水印', default: false },
  },
}

const minimaxSpeechSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    voice: { type: 'string', title: '音色 ID', description: '映射到 MiniMax voice_setting.voice_id' },
    speed: { type: 'number', title: '语速', minimum: 0.5, maximum: 2, default: 1 },
    vol: { type: 'number', title: '音量', minimum: 0, maximum: 10, default: 1 },
    pitch: { type: 'integer', title: '音调', minimum: -12, maximum: 12, default: 0 },
    language_boost: {
      type: 'string',
      title: '语言增强',
      enum: ['Chinese', 'Chinese,Yue', 'English', 'Japanese', 'Korean', 'French', 'German', 'Spanish', 'Portuguese', 'Russian', 'auto'],
    },
    format: { type: 'string', title: '音频格式', enum: ['mp3', 'wav', 'pcm', 'flac'], default: 'mp3' },
    output_format: { type: 'string', title: '输出格式', enum: ['url', 'hex'], default: 'hex' },
    aigc_watermark: { type: 'boolean', title: 'AIGC 水印', default: false },
    subtitle_enable: { type: 'boolean', title: '字幕', default: false },
    subtitle_type: { type: 'string', title: '字幕粒度', enum: ['sentence', 'word', 'word_streaming'], default: 'sentence' },
  },
}

const minimaxMusicSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    lyrics: { type: 'string', title: '歌词' },
    output_format: { type: 'string', title: '输出格式', enum: ['url', 'hex'], default: 'hex' },
    aigc_watermark: { type: 'boolean', title: 'AIGC 水印', default: false },
    lyrics_optimizer: { type: 'boolean', title: '歌词优化', default: false },
    is_instrumental: { type: 'boolean', title: '纯音乐', default: false },
    format: { type: 'string', title: '音频格式', enum: ['mp3', 'wav', 'pcm', 'flac'], default: 'mp3' },
  },
}

const minimaxHailuoVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    durationSeconds: { type: 'integer', title: '时长', enum: [6, 10], default: 6 },
    resolution: { type: 'string', title: '分辨率', enum: ['768P', '1080P'], default: '768P' },
    prompt_optimizer: { type: 'boolean', title: '提示词优化', default: true },
    fast_pretreatment: { type: 'boolean', title: '快速预处理', default: false },
    aigc_watermark: { type: 'boolean', title: 'AIGC 水印', default: false },
    useFirstFrame: { type: 'boolean', title: '使用首帧', default: true },
    useLastFrame: { type: 'boolean', title: '使用尾帧', default: false },
  },
}

const audioSpeechSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    voice: { type: 'string', title: '音色' },
    format: { type: 'string', title: '格式', enum: ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'] },
    speed: { type: 'number', title: '速度', minimum: 0.25, maximum: 4 },
  },
}

const commonStatusMap = {
  queued: 'queued',
  pending: 'queued',
  running: 'running',
  processing: 'running',
  succeeded: 'succeeded',
  success: 'succeeded',
  completed: 'succeeded',
  done: 'succeeded',
  failed: 'failed',
  error: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
} as const

export const BUILTIN_MEDIA_MODEL_MANIFESTS: readonly MediaModelManifest[] = [
  {
    id: 'apimart:gpt-image-2',
    providerKind: 'apimart',
    modelId: 'gpt-image-2',
    displayName: 'APIMart GPT Image 2',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: apimartGptImage2Schema,
        defaults: { n: 1, size: '1:1', resolution: '1k', official_fallback: false },
        aliases: { aspectRatio: 'aspect_ratio', outputFormat: 'output_format' },
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 8, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: apimartGptImage2Schema,
        defaults: { n: 1, size: '1:1', resolution: '1k', official_fallback: false },
        aliases: { aspectRatio: 'aspect_ratio', outputFormat: 'output_format' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/images/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: { kind: 'task_poll', taskIdPaths: ['task_id', 'request_id', 'id'], statusEndpoint: '/tasks/{{taskId}}', resultPaths: ['data[].url', 'data[].b64_json'] },
      polling: { intervalMs: 4000, timeoutMs: 300000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://docs.apimart.ai/cn'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
  },
  {
    id: 'apimart:veo3',
    providerKind: 'apimart',
    modelId: 'veo3',
    displayName: 'APIMart VEO 3',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: videoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 8 },
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: videoSchema,
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.edit',
        label: '视频编辑',
        input: { required: ['prompt', 'video'] as MediaManifestInputKind[], maxImages: 2, acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: videoSchema,
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/videos/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', first_frame_image: '{{firstFrame}}', last_frame_image: '{{lastFrame}}', video: '{{video}}' },
      response: { kind: 'task_poll', taskIdPaths: ['task_id', 'request_id', 'id'], statusEndpoint: '/videos/generations/{{taskId}}', resultPaths: ['video_url', 'data[].url', 'output.url'] },
      polling: { intervalMs: 5000, timeoutMs: 1200000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://docs.apimart.ai/cn'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  ...[
    { id: 'apimart:wan2.7-image', modelId: 'wan2.7-image', displayName: 'APIMart Wan 2.7 Image' },
    { id: 'apimart:qwen-image-2.0', modelId: 'qwen-image-2.0', displayName: 'APIMart Qwen Image 2.0' },
    { id: 'apimart:doubao-seedream-5-0-lite', modelId: 'doubao-seedream-5-0-lite', displayName: 'APIMart Seedream 5.0 Lite' },
    { id: 'apimart:gemini-3.1-flash-image-preview', modelId: 'gemini-3.1-flash-image-preview', displayName: 'APIMart Gemini 3.1 Flash Image' },
    { id: 'apimart:gemini-3-pro-image-preview', modelId: 'gemini-3-pro-image-preview', displayName: 'APIMart Gemini 3 Pro Image' },
    { id: 'apimart:gemini-2.5-flash-image-preview', modelId: 'gemini-2.5-flash-image-preview', displayName: 'APIMart Gemini 2.5 Flash Image (nano-banana)' },
    { id: 'apimart:imagen-4.0-apimart', modelId: 'imagen-4.0-apimart', displayName: 'APIMart Imagen 4.0' },
  ].map((entry) => ({
    id: entry.id,
    providerKind: 'apimart',
    modelId: entry.modelId,
    displayName: entry.displayName,
    domains: ['image'] as MediaDomain[],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: apimartImageModelSchemas[entry.modelId]?.schema ?? imageSizeSchema,
        defaults: apimartImageModelSchemas[entry.modelId]?.defaults ?? { n: 1 },
        aliases: { aspectRatio: 'aspect_ratio', outputFormat: 'output_format' },
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 8, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: apimartImageModelSchemas[entry.modelId]?.schema ?? imageSizeSchema,
        defaults: apimartImageModelSchemas[entry.modelId]?.defaults ?? { n: 1 },
        aliases: { aspectRatio: 'aspect_ratio', outputFormat: 'output_format' },
      },
    ],
    invocation: {
      mode: 'async_polling' as MediaInvocationMode,
      endpoint: '/images/generations',
      method: 'POST' as const,
      contentType: 'json' as const,
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: { kind: 'task_poll' as const, taskIdPaths: ['task_id', 'request_id', 'id'], statusEndpoint: '/tasks/{{taskId}}', resultPaths: ['data[].url', 'data[].b64_json'] },
      polling: { intervalMs: 4000, timeoutMs: 300000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://docs.apimart.ai/cn'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
  })),
  ...[
    { id: 'apimart:sora-2', modelId: 'sora-2', displayName: 'APIMart Sora 2' },
    { id: 'apimart:veo2', modelId: 'veo2', displayName: 'APIMart VEO 2' },
    { id: 'apimart:kling-v2', modelId: 'kling-v2-master', displayName: 'APIMart Kling V2' },
    { id: 'apimart:seedance', modelId: 'seedance-1-0-pro-i2v', displayName: 'APIMart Seedance 1.0 Pro' },
    { id: 'apimart:doubao-seedance-2.0', modelId: 'doubao-seedance-2.0', displayName: 'APIMart Doubao Seedance 2.0' },
    { id: 'apimart:hailuo-02', modelId: 'hailuo-02', displayName: 'APIMart Hailuo 02' },
  ].map((entry) => ({
    id: entry.id,
    providerKind: 'apimart',
    modelId: entry.modelId,
    displayName: entry.displayName,
    domains: ['video'] as MediaDomain[],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: entry.modelId === 'doubao-seedance-2.0' ? apimartSeedance2VideoSchema : videoSchema,
        defaults: entry.modelId === 'doubao-seedance-2.0'
          ? { aspectRatio: '16:9', durationSeconds: 5, resolution: '480p', generate_audio: false, return_last_frame: false }
          : { aspectRatio: '16:9', durationSeconds: 5 },
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: entry.modelId === 'doubao-seedance-2.0' ? apimartSeedance2VideoSchema : videoSchema,
        defaults: entry.modelId === 'doubao-seedance-2.0'
          ? { aspectRatio: '16:9', durationSeconds: 5, resolution: '480p', generate_audio: false, return_last_frame: false }
          : undefined,
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.edit',
        label: '视频编辑',
        input: { required: ['prompt', 'video'] as MediaManifestInputKind[], maxImages: 2, acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: entry.modelId === 'doubao-seedance-2.0' ? apimartSeedance2VideoSchema : videoSchema,
        defaults: entry.modelId === 'doubao-seedance-2.0'
          ? { aspectRatio: '16:9', durationSeconds: 5, resolution: '480p', generate_audio: false, return_last_frame: false }
          : undefined,
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
    ],
    invocation: {
      mode: 'async_polling' as MediaInvocationMode,
      endpoint: '/videos/generations',
      method: 'POST' as const,
      contentType: 'json' as const,
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', first_frame_image: '{{firstFrame}}', last_frame_image: '{{lastFrame}}', video: '{{video}}' },
      response: { kind: 'task_poll' as const, taskIdPaths: ['task_id', 'request_id', 'id'], statusEndpoint: '/videos/generations/{{taskId}}', resultPaths: ['video_url', 'data[].url', 'output.url'] },
      polling: { intervalMs: 5000, timeoutMs: 1200000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://docs.apimart.ai/cn'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  })),
  {
    id: 'xai:grok-imagine-image',
    providerKind: 'xai',
    modelId: 'grok-imagine-image-quality',
    displayName: 'xAI Grok Imagine Image',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: xaiImageSchema,
        defaults: { n: 1, response_format: 'url' },
        aliases: { aspectRatio: 'aspect_ratio' },
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: { required: ['prompt', 'image'], maxImages: 10, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: xaiImageSchema,
        defaults: { n: 1, response_format: 'url' },
        aliases: { aspectRatio: 'aspect_ratio' },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/images/generations',
      method: 'POST',
      contentType: 'json',
      // image_url 渲染为空串时会被模板渲染器剔除，故文生图与图生图/编辑可共用一个模板。
      // xAI 图片编辑复用 /images/generations，按 image_url 传入源图（单图，见 design doc / 官方指南）。
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', image_url: '{{image}}' },
      response: { kind: 'url', jsonPaths: ['data[].url', 'url'], download: true },
    },
    docs: { sourceUrls: ['https://docs.x.ai/developers/model-capabilities/imagine'] },
    safety: { maxPromptLength: 8000 },
  },
  {
    id: 'xai:grok-imagine-video',
    providerKind: 'xai',
    modelId: 'grok-imagine-video',
    displayName: 'xAI Grok Imagine Video',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: xaiVideoSchema,
        defaults: { durationSeconds: 8, resolution: '720p' },
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: xaiVideoSchema,
        defaults: { durationSeconds: 8, resolution: '720p' },
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.edit',
        label: '视频编辑',
        input: { required: ['prompt', 'video'] as MediaManifestInputKind[], maxImages: 2, acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: xaiVideoSchema,
        defaults: { durationSeconds: 8, resolution: '720p' },
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/videos/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', image: { url: '{{firstFrame}}' }, last_frame_image: '{{lastFrame}}', video: '{{video}}' },
      response: { kind: 'task_poll', taskIdPaths: ['request_id', 'id'], statusEndpoint: '/videos/{{taskId}}', resultPaths: ['video_url', 'data[].url'] },
      polling: { intervalMs: 5000, timeoutMs: 1200000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://docs.x.ai/developers/model-capabilities/imagine'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true },
  },
  {
    id: 'xai:grok-tts',
    providerKind: 'xai',
    modelId: 'grok-tts',
    displayName: 'xAI Grok TTS',
    domains: ['audio'],
    capabilities: [
      {
        id: 'audio.speech',
        label: '文生音频',
        input: { required: ['text'] },
        output: { types: ['audio'], mimeTypes: ['audio/mpeg', 'audio/wav'] },
        paramSchema: audioSpeechSchema,
        defaults: { format: 'mp3' },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/audio/speech',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', input: '{{text}}' },
      response: { kind: 'binary_response' },
    },
    docs: { sourceUrls: ['https://docs.x.ai/developers/model-capabilities/audio/text-to-speech'] },
  },
  {
    id: 'openai:gpt-image-1',
    providerKind: 'openai-images',
    modelId: 'gpt-image-1',
    displayName: 'OpenAI GPT Image 1',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: imageSizeSchema,
        defaults: { n: 1, size: '1024x1024' },
      },
      {
        id: 'image.edit',
        label: '图片编辑',
        input: { required: ['prompt', 'image'], maxImages: 16, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: imageSizeSchema,
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/images/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: { kind: 'inline_base64', jsonPaths: ['data[].b64_json', 'data[].url'] },
    },
    docs: { sourceUrls: ['https://platform.openai.com/docs/guides/image-generation'] },
    safety: { maxPromptLength: 32000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
  },
  {
    id: 'google:veo',
    providerKind: 'google-generative-ai',
    modelId: 'veo',
    displayName: 'Google Veo',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: videoSchema,
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['prompt', 'image'], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: videoSchema,
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/models/{{modelId}}:predictLongRunning',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { instances: [{ prompt: '{{prompt}}' }] },
      response: { kind: 'task_poll', taskIdPaths: ['name'], statusEndpoint: '/{{taskId}}', resultPaths: ['response.videos[].uri', 'response.generateVideoResponse.generatedSamples[].video.uri'] },
      polling: { intervalMs: 10000, timeoutMs: 1800000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://ai.google.dev/gemini-api/docs/video'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true },
  },
  {
    id: 'volcengine:doubao-seedance-2-0-260128',
    providerKind: 'volcengine-ark',
    modelId: 'doubao-seedance-2-0-260128',
    displayName: 'Doubao Seedance 2.0',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'], maxImages: 9, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedanceVideoSchema,
        defaults: { mode: '参考生成', aspectRatio: '智能比例', durationMode: '按秒数', durationSeconds: 5, resolution: '720p', count: 4, generateAudio: true, seed: -1, searchEnabled: false, timeoutHours: 48, fps: 24 },
        aliases: { aspectRatio: 'aspect_ratio', durationMode: 'duration_mode', durationSeconds: 'duration', generateAudio: 'generate_audio', searchEnabled: 'enable_search', timeoutHours: 'timeout_hours' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['prompt', 'image'], maxImages: 2, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedanceVideoSchema,
        defaults: { mode: '首尾帧', aspectRatio: '智能比例', durationMode: '按秒数', durationSeconds: 5, resolution: '720p', count: 4, generateAudio: true, seed: -1, searchEnabled: false, timeoutHours: 48, fps: 24 },
        aliases: { aspectRatio: 'aspect_ratio', durationMode: 'duration_mode', durationSeconds: 'duration', generateAudio: 'generate_audio', searchEnabled: 'enable_search', timeoutHours: 'timeout_hours' },
      },
      {
        id: 'video.edit',
        label: '视频编辑',
        input: { required: ['prompt', 'video'], maxImages: 2, acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedanceVideoSchema,
        defaults: { mode: '首尾帧', aspectRatio: '智能比例', durationMode: '按秒数', durationSeconds: 5, resolution: '720p', count: 4, generateAudio: true, seed: -1, searchEnabled: false, timeoutHours: 48, fps: 24 },
        aliases: { aspectRatio: 'aspect_ratio', durationMode: 'duration_mode', durationSeconds: 'duration', generateAudio: 'generate_audio', searchEnabled: 'enable_search', timeoutHours: 'timeout_hours' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/v3/contents/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        prompt: '{{prompt}}',
        mode: '{{mode}}',
        first_frame_image: '{{firstFrame}}',
        last_frame_image: '{{lastFrame}}',
        image_urls: '{{referenceImages}}',
        video_url: '{{video}}',
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id', 'task_id', 'request_id'],
        statusEndpoint: '/v3/contents/generations/{{taskId}}',
        resultPaths: ['data[].video_url', 'data[].url', 'data.video_url', 'output.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 5000, timeoutMs: 172800000, statusMap: commonStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision?modelId=doubao-seedance-2-0-260128&tab=GenVideo',
        'https://seed.bytedance.com/zh/seedance2_0',
      ],
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'volcengine:doubao-seedance-2-0-fast-260128',
    providerKind: 'volcengine-ark',
    modelId: 'doubao-seedance-2-0-fast-260128',
    displayName: 'Doubao Seedance 2.0 Fast',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'], maxImages: 9, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedanceVideoSchema,
        defaults: { mode: '参考生成', aspectRatio: '智能比例', durationMode: '按秒数', durationSeconds: 5, resolution: '720p', count: 4, generateAudio: true, seed: -1, searchEnabled: false, timeoutHours: 48, fps: 24 },
        aliases: { aspectRatio: 'aspect_ratio', durationMode: 'duration_mode', durationSeconds: 'duration', generateAudio: 'generate_audio', searchEnabled: 'enable_search', timeoutHours: 'timeout_hours' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['prompt', 'image'], maxImages: 2, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedanceVideoSchema,
        defaults: { mode: '首尾帧', aspectRatio: '智能比例', durationMode: '按秒数', durationSeconds: 5, resolution: '720p', count: 4, generateAudio: true, seed: -1, searchEnabled: false, timeoutHours: 48, fps: 24 },
        aliases: { aspectRatio: 'aspect_ratio', durationMode: 'duration_mode', durationSeconds: 'duration', generateAudio: 'generate_audio', searchEnabled: 'enable_search', timeoutHours: 'timeout_hours' },
      },
      {
        id: 'video.edit',
        label: '视频编辑',
        input: { required: ['prompt', 'video'], maxImages: 2, acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedanceVideoSchema,
        defaults: { mode: '首尾帧', aspectRatio: '智能比例', durationMode: '按秒数', durationSeconds: 5, resolution: '720p', count: 4, generateAudio: true, seed: -1, searchEnabled: false, timeoutHours: 48, fps: 24 },
        aliases: { aspectRatio: 'aspect_ratio', durationMode: 'duration_mode', durationSeconds: 'duration', generateAudio: 'generate_audio', searchEnabled: 'enable_search', timeoutHours: 'timeout_hours' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/v3/contents/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        prompt: '{{prompt}}',
        mode: '{{mode}}',
        first_frame_image: '{{firstFrame}}',
        last_frame_image: '{{lastFrame}}',
        image_urls: '{{referenceImages}}',
        video_url: '{{video}}',
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id', 'task_id', 'request_id'],
        statusEndpoint: '/v3/contents/generations/{{taskId}}',
        resultPaths: ['data[].video_url', 'data[].url', 'data.video_url', 'output.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 5000, timeoutMs: 172800000, statusMap: commonStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision?modelId=doubao-seedance-2-0-fast-260128&tab=GenVideo',
        'https://seed.bytedance.com/zh/seedance2_0',
      ],
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  ...[
    { id: 'kling:kling-video-o1', modelId: 'kling-video-o1', displayName: 'Kling O1', modes: ['standard', 'professional'] },
    { id: 'kling:kling-v2.6-pro', modelId: 'kling-v2.6-pro', displayName: 'Kling 2.6 Pro', modes: ['standard', 'professional'], audio: true },
    { id: 'kling:kling-v2.6-std', modelId: 'kling-v2.6-std', displayName: 'Kling 2.6 Standard', modes: ['standard'], audio: true },
    { id: 'kling:kling-v2.5-turbo', modelId: 'kling-v2.5-turbo', displayName: 'Kling 2.5 Turbo', modes: [] },
  ].map((entry) => {
    const schema = {
      ...klingVideoSchema,
      properties: {
        ...klingVideoSchema.properties,
        ...(entry.modes.length > 0 ? { mode: { type: 'string', title: '模式', enum: entry.modes } } : {}),
        ...(entry.audio ? {} : { audio: { type: 'boolean', title: '生成音频', readOnly: true, default: false } }),
      },
    }
    return {
      id: entry.id,
      providerKind: 'kling',
      modelId: entry.modelId,
      displayName: entry.displayName,
      domains: ['video'] as MediaDomain[],
      capabilities: [
        {
          id: 'video.generate',
          label: '文生视频',
          input: { required: ['prompt'] as MediaManifestInputKind[] },
          output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
          paramSchema: schema,
          aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
        },
        {
          id: 'video.image_to_video',
          label: '图生视频',
          input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
          output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
          paramSchema: schema,
          aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
        },
        {
          id: 'video.edit',
          label: '视频编辑',
          input: { required: ['prompt', 'video'] as MediaManifestInputKind[], maxImages: 2, acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'] },
          output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
          paramSchema: schema,
          aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
        },
      ],
      invocation: {
        mode: 'async_polling' as MediaInvocationMode,
        endpoint: '/v1/videos/text2video',
        method: 'POST' as const,
        contentType: 'json' as const,
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', first_frame_image: '{{firstFrame}}', last_frame_image: '{{lastFrame}}', video: '{{video}}' },
        response: { kind: 'task_poll' as const, taskIdPaths: ['task_id', 'id'], statusEndpoint: '/v1/videos/text2video/{{taskId}}', resultPaths: ['video_url', 'output.video_url', 'data.video_url', 'data.url'] },
        polling: { intervalMs: 5000, timeoutMs: 1200000, statusMap: commonStatusMap },
      },
      docs: { sourceUrls: ['https://klingapi.com/zh/docs/text-to-video'] },
      safety: { maxPromptLength: 2500, allowLocalFiles: true },
    }
  }),
  {
    id: 'minimax:image-01',
    providerKind: 'minimax-hailuo',
    modelId: 'image-01',
    displayName: 'MiniMax Image 01',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: minimaxImageSchema,
        defaults: { aspectRatio: '1:1', response_format: 'url', n: 1, prompt_optimizer: false, aigc_watermark: false },
        aliases: { aspectRatio: 'aspect_ratio' },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/v1/image_generation',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: { kind: 'url', jsonPaths: ['data.image_urls[]', 'data.image_base64[]'], download: true },
    },
    docs: { sourceUrls: ['https://platform.minimaxi.com/document/image_generation'] },
    safety: { maxPromptLength: 1500 },
  },
  ...[
    { id: 'minimax:speech-2.8-hd', modelId: 'speech-2.8-hd', displayName: 'MiniMax Speech 2.8 HD', subtitles: true },
    { id: 'minimax:speech-2.8-turbo', modelId: 'speech-2.8-turbo', displayName: 'MiniMax Speech 2.8 Turbo', subtitles: false },
  ].map((entry) => ({
    id: entry.id,
    providerKind: 'minimax-hailuo',
    modelId: entry.modelId,
    displayName: entry.displayName,
    domains: ['audio'] as MediaDomain[],
    capabilities: [
      {
        id: 'audio.speech',
        label: '文生音频',
        input: { required: ['text'] as MediaManifestInputKind[] },
        output: { types: ['audio'] as MediaManifestOutputKind[], mimeTypes: ['audio/mpeg', 'audio/wav'] },
        paramSchema: entry.subtitles ? minimaxSpeechSchema : {
          ...minimaxSpeechSchema,
          properties: Object.fromEntries(Object.entries(minimaxSpeechSchema.properties).filter(([key]) => key !== 'subtitle_enable' && key !== 'subtitle_type')),
        },
        defaults: { format: 'mp3', output_format: 'url', speed: 1, vol: 1, pitch: 0, aigc_watermark: false },
      },
    ],
    invocation: {
      mode: 'sync' as MediaInvocationMode,
      endpoint: '/v1/t2a_v2',
      method: 'POST' as const,
      contentType: 'json' as const,
      requestTemplate: {
        model: '{{modelId}}',
        text: '{{text}}',
        stream: false,
        output_format: '{{output_format}}',
        aigc_watermark: '{{aigc_watermark}}',
        voice_setting: { voice_id: '{{voice}}', speed: '{{speed}}', vol: '{{vol}}', pitch: '{{pitch}}' },
        audio_setting: { format: '{{format}}' },
        language_boost: '{{language_boost}}',
        subtitle_enable: '{{subtitle_enable}}',
        subtitle_type: '{{subtitle_type}}',
      },
      response: { kind: 'url' as const, jsonPaths: ['data.audio', 'data.audio_file', 'data.url'], download: true },
    },
    docs: { sourceUrls: ['https://platform.minimaxi.com/document/text-to-speech'] },
    safety: { maxPromptLength: 10000 },
  })),
  {
    id: 'minimax:music-2.6',
    providerKind: 'minimax-hailuo',
    modelId: 'music-2.6',
    displayName: 'MiniMax Music 2.6',
    domains: ['audio'],
    capabilities: [
      {
        id: 'audio.music',
        label: '文生音乐',
        input: { required: ['prompt'] },
        output: { types: ['audio'] as MediaManifestOutputKind[], mimeTypes: ['audio/mpeg', 'audio/wav'] },
        paramSchema: minimaxMusicSchema,
        defaults: { output_format: 'url', format: 'mp3', aigc_watermark: false, lyrics_optimizer: false, is_instrumental: false },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/v1/music_generation',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', output_format: '{{output_format}}' },
      response: { kind: 'url', jsonPaths: ['data.audio', 'data.url'], download: true },
    },
    docs: { sourceUrls: ['https://platform.minimaxi.com/document/music_generation'] },
    safety: { maxPromptLength: 3000 },
  },
  {
    id: 'minimax:hailuo-2.3',
    providerKind: 'minimax-hailuo',
    modelId: 'MiniMax-Hailuo-2.3',
    displayName: 'MiniMax Hailuo 2.3',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: minimaxHailuoVideoSchema,
        defaults: { durationSeconds: 6, resolution: '768P', prompt_optimizer: true, fast_pretreatment: false, aigc_watermark: false },
        aliases: { durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['prompt', 'image'], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: minimaxHailuoVideoSchema,
        defaults: { durationSeconds: 6, resolution: '768P', prompt_optimizer: true, fast_pretreatment: false, aigc_watermark: false },
        aliases: { durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.edit',
        label: '视频编辑',
        input: { required: ['prompt', 'video'], maxImages: 2, acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: minimaxHailuoVideoSchema,
        defaults: { durationSeconds: 6, resolution: '768P', prompt_optimizer: true, fast_pretreatment: false, aigc_watermark: false },
        aliases: { durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/v1/video_generation',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', first_frame_image: '{{firstFrame}}', last_frame_image: '{{lastFrame}}', video: '{{video}}' },
      response: { kind: 'task_poll', taskIdPaths: ['task_id', 'data.task_id'], statusEndpoint: '/v1/query/video_generation?task_id={{taskId}}', resultPaths: ['data.video_url', 'data.file_url', 'file_url', 'video_url'] },
      polling: { intervalMs: 5000, timeoutMs: 1200000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://platform.minimaxi.com/document/video_generation'] },
    safety: { maxPromptLength: 2000, allowLocalFiles: true },
  },
  ...[
    { id: 'pixverse:video', providerKind: 'pixverse', modelId: 'pixverse-video', displayName: 'PixVerse Video' },
    { id: 'wan:video', providerKind: 'wan', modelId: 'wan-video', displayName: 'Wan Video' },
    { id: 'happyhorse:video', providerKind: 'happyhorse', modelId: 'happyhorse-video', displayName: 'HappyHorse Video' },
    { id: 'omni:media', providerKind: 'omni', modelId: 'omni-media', displayName: 'Omni Media' },
  ].map((entry) => ({
    id: entry.id,
    providerKind: entry.providerKind,
    modelId: entry.modelId,
    displayName: entry.displayName,
    domains: ['video'] as MediaDomain[],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: videoSchema,
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: videoSchema,
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.edit',
        label: '视频编辑',
        input: { required: ['prompt', 'video'] as MediaManifestInputKind[], maxImages: 2, acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: videoSchema,
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
    ],
    invocation: {
      mode: 'async_polling' as MediaInvocationMode,
      endpoint: '/tasks',
      method: 'POST' as const,
      contentType: 'json' as const,
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', first_frame_image: '{{firstFrame}}', last_frame_image: '{{lastFrame}}', video: '{{video}}' },
      response: { kind: 'task_poll' as const, taskIdPaths: ['task_id', 'id'], statusEndpoint: '/tasks/{{taskId}}', resultPaths: ['video_url', 'output.video_url', 'data.url'] },
      polling: { intervalMs: 5000, timeoutMs: 1200000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: [] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true },
  })),
]

export function mediaManifestCapabilities(manifest: Pick<MediaModelManifest, 'capabilities'>): string[] {
  return Array.from(new Set(manifest.capabilities.map((capability) => capability.id)))
}
