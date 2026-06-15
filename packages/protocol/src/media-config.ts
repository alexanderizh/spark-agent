/**
 * @module media-config
 *
 * 统一多媒体能力（图片 / 语音 / 视频）协议类型 + zod schema。
 *
 * 设计目标（见 docs/multimedia-model-platform-adapters-design.md §5.1）：
 *   - 在现有 provider `config_json` 中新增可选字段，保持向后兼容。
 *   - 旧 `modelType=image + imageProvider + imageApiType` 继续可用，
 *     保存 image provider 时同步写入 media 字段。
 *   - 图片、语音、视频共用同一套能力描述和 adapter，减少重复逻辑。
 */

import { z } from 'zod'

/** 多媒体平台 adapter 种类 */
export type MediaProviderKind =
  | 'apimart'
  | 'xai'
  | 'openai-compatible'
  | 'openai-images'
  | 'google-generative-ai'
  | 'volcengine-ark'
  | 'kling'
  | 'pixverse'
  | 'minimax-hailuo'
  | 'wan'
  | 'happyhorse'
  | 'omni'
  | 'custom'

/**
 * 一次 provider HTTP 调用的摘要，用于在任务详情里展示「请求地址 + 请求参数」。
 *
 * body 已经过截断处理（base64 / data: URI 压缩成 `…<truncated>`），
 * 既避免一张图刷屏，也避免把大体积 base64 落进画布快照。
 * multipart / binary 等非 JSON 体用字符串占位（如 `[multipart N bytes]`）。
 */
export interface MediaRequestCall {
  method: string
  url: string
  body?: unknown
}
/** 调用方式：同步 / 异步轮询 / 自动兼容 */
export type MediaApiType = 'sync' | 'async' | 'auto'

/**
 * 统一能力 ID。canvas operation 通过映射表转换为 capability，
 * provider profile 声明它支持哪些 capability。
 */
export type MediaCapabilityId =
  | 'image.generate'
  | 'image.edit'
  | 'image.variations'
  | 'audio.speech'
  | 'audio.transcription'
  | 'video.generate'
  | 'video.image_to_video'
  | 'video.edit'

export const MEDIA_PROVIDER_KINDS = [
  'apimart',
  'xai',
  'openai-compatible',
  'openai-images',
  'google-generative-ai',
  'volcengine-ark',
  'kling',
  'pixverse',
  'minimax-hailuo',
  'wan',
  'happyhorse',
  'omni',
  'custom',
] as const satisfies readonly MediaProviderKind[]

export const MEDIA_API_TYPES = ['sync', 'async', 'auto'] as const satisfies readonly MediaApiType[]

export const MEDIA_CAPABILITY_IDS = [
  'image.generate',
  'image.edit',
  'image.variations',
  'audio.speech',
  'audio.transcription',
  'video.generate',
  'video.image_to_video',
  'video.edit',
] as const satisfies readonly MediaCapabilityId[]

/** image.generate / image.edit / image.variations */
export const IMAGE_CAPABILITIES: readonly MediaCapabilityId[] = [
  'image.generate',
  'image.edit',
  'image.variations',
]
/** audio.speech / audio.transcription */
export const AUDIO_CAPABILITIES: readonly MediaCapabilityId[] = [
  'audio.speech',
  'audio.transcription',
]
/** video.generate / video.image_to_video / video.edit */
export const VIDEO_CAPABILITIES: readonly MediaCapabilityId[] = [
  'video.generate',
  'video.image_to_video',
  'video.edit',
]

export function isMediaCapabilityId(value: unknown): value is MediaCapabilityId {
  return typeof value === 'string' && (MEDIA_CAPABILITY_IDS as readonly string[]).includes(value)
}

export function isMediaProviderKind(value: unknown): value is MediaProviderKind {
  return typeof value === 'string' && (MEDIA_PROVIDER_KINDS as readonly string[]).includes(value)
}

export function isMediaApiType(value: unknown): value is MediaApiType {
  return typeof value === 'string' && (MEDIA_API_TYPES as readonly string[]).includes(value)
}

/** Provider 多媒体能力默认值（按能力族分组） */
export interface ProviderMediaDefaults {
  image?: {
    size?: string | undefined
    aspectRatio?: string | undefined
    resolution?: string | undefined
    quality?: string | undefined
    n?: number | undefined
    outputFormat?: 'png' | 'jpeg' | 'webp' | undefined
    responseFormat?: 'url' | 'b64_json' | 'base64' | undefined
  } | undefined
  audio?: {
    voice?: string | undefined
    format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm' | undefined
    speed?: number | undefined
    language?: string | undefined
  } | undefined
  video?: {
    aspectRatio?: string | undefined
    durationSeconds?: number | undefined
    quality?: string | undefined
    resolution?: string | undefined
    fps?: number | undefined
  } | undefined
  polling?: {
    intervalMs?: number | undefined
    timeoutMs?: number | undefined
  } | undefined
}

/**
 * Provider Profile 中的多媒体能力配置。
 *
 * 全部字段可选，缺省时由 adapter 用平台默认值兜底。
 */
export interface ProviderMediaConfig {
  mediaProvider?: MediaProviderKind
  mediaApiType?: MediaApiType
  mediaCapabilities?: MediaCapabilityId[]
  mediaDefaults?: ProviderMediaDefaults
}

// ─── zod schema ──────────────────────────────────────────────────────────────

export const MediaProviderKindSchema = z.enum(MEDIA_PROVIDER_KINDS)
export const MediaApiTypeSchema = z.enum(MEDIA_API_TYPES)
export const MediaCapabilityIdSchema = z.enum(MEDIA_CAPABILITY_IDS)

export const ProviderMediaDefaultsSchema = z.object({
  image: z
    .object({
      size: z.string().max(80).optional(),
      aspectRatio: z.string().max(40).optional(),
      resolution: z.string().max(80).optional(),
      quality: z.string().max(80).optional(),
      n: z.number().int().min(1).max(16).optional(),
      outputFormat: z.enum(['png', 'jpeg', 'webp']).optional(),
      responseFormat: z.enum(['url', 'b64_json', 'base64']).optional(),
    })
    .optional(),
  audio: z
    .object({
      voice: z.string().max(120).optional(),
      format: z.enum(['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm']).optional(),
      speed: z.number().min(0.25).max(4).optional(),
      language: z.string().max(40).optional(),
    })
    .optional(),
  video: z
    .object({
      aspectRatio: z.string().max(40).optional(),
      durationSeconds: z.number().int().min(1).max(600).optional(),
      quality: z.string().max(80).optional(),
      resolution: z.string().max(80).optional(),
      fps: z.number().int().min(1).max(120).optional(),
    })
    .optional(),
  polling: z
    .object({
      intervalMs: z.number().int().min(500).max(300_000).optional(),
      timeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
    })
    .optional(),
})

/** Provider 多媒体能力 schema —— 用于 create/update/import 校验 */
export const ProviderMediaConfigSchema = z.object({
  mediaProvider: MediaProviderKindSchema.optional(),
  mediaApiType: MediaApiTypeSchema.optional(),
  mediaCapabilities: z.array(MediaCapabilityIdSchema).max(20).optional(),
  mediaDefaults: ProviderMediaDefaultsSchema.optional(),
})

/**
 * canvas operation → capability 映射。
 * 见 design doc §5.2。
 */
export type CanvasOperationType =
  | 'text_to_image'
  | 'image_to_image'
  | 'image_edit'
  | 'image_compose'
  | 'text_generate'
  | 'text_rewrite'
  | 'prompt_optimize'
  | 'text_to_audio'
  | 'audio_transcribe'
  | 'text_to_video'
  | 'image_to_video'
  | 'video_edit'

/** operation → 所需 capability（多候选时取首个 provider 支持的） */
export function capabilityForOperation(operation: CanvasOperationType): MediaCapabilityId[] {
  switch (operation) {
    case 'text_to_image':
      return ['image.generate']
    case 'image_to_image':
      return ['image.edit']
    case 'image_edit':
      return ['image.edit']
    case 'image_compose':
      return ['image.edit']
    case 'text_to_audio':
      return ['audio.speech']
    case 'audio_transcribe':
      return ['audio.transcription']
    case 'text_to_video':
      return ['video.generate']
    case 'image_to_video':
      return ['video.image_to_video']
    case 'video_edit':
      return ['video.edit']
    // text_generate / text_rewrite / prompt_optimize 走文本模型，不经过 media adapter
    case 'text_generate':
    case 'text_rewrite':
    case 'prompt_optimize':
      return []
    default:
      return []
  }
}
