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
  | 'agnes'
  | 'xai'
  | 'openai-compatible'
  | 'openai-images'
  | 'google-generative-ai'
  | 'bailian'
  | 'volcengine-ark'
  | 'kling'
  | 'pixverse'
  | 'minimax-hailuo'
  | 'wan'
  | 'happyhorse'
  | 'omni'
  | 'midjourney'
  | 'custom'

export interface MediaResponseTrace {
  status: number
  statusText?: string
  headers?: Record<string, string>
  body?: unknown
}

export interface MediaInputMetadata {
  sizeBytes?: number | undefined
  width?: number | undefined
  height?: number | undefined
  durationMs?: number | undefined
}

/**
 * 一次实际模型调用的摘要。HTTP 路径记录真实请求与响应元数据；SDK/CLI 路径记录
 * 解析后的模型地址和最终 SDK 调用参数，method 会明确标注 SDK/CLI 而不伪装成 HTTP。
 *
 * body 已经过脱敏/摘要处理（base64 / data: URI 压缩成 MIME、大小估算、
 * sha256 和短 preview），既避免一张图刷屏，也避免把大体积 base64 落进画布快照。
 * multipart / binary 等非 JSON 体用字符串占位（如 `[multipart N bytes]`）。
 */
export interface MediaRequestCall {
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
  response?: MediaResponseTrace
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
  | 'video.reference_to_video'
  | 'video.edit'
  | 'video.extend'

export const MEDIA_PROVIDER_KINDS = [
  'apimart',
  'agnes',
  'xai',
  'openai-compatible',
  'openai-images',
  'google-generative-ai',
  'bailian',
  'volcengine-ark',
  'kling',
  'pixverse',
  'minimax-hailuo',
  'wan',
  'happyhorse',
  'omni',
  'midjourney',
  'custom',
] as const satisfies readonly MediaProviderKind[]

export const MEDIA_API_TYPES = ['sync', 'async', 'auto'] as const satisfies readonly MediaApiType[]

/** 视频异步任务的统一默认轮询超时：30 分钟。Provider 可显式配置更长时间。 */
export const DEFAULT_VIDEO_POLL_TIMEOUT_MS = 30 * 60 * 1_000

export const MEDIA_CAPABILITY_IDS = [
  'image.generate',
  'image.edit',
  'image.variations',
  'audio.speech',
  'audio.transcription',
  'video.generate',
  'video.image_to_video',
  'video.reference_to_video',
  'video.edit',
  'video.extend',
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
/** video.generate / video.image_to_video / video.edit / video.extend */
export const VIDEO_CAPABILITIES: readonly MediaCapabilityId[] = [
  'video.generate',
  'video.image_to_video',
  'video.reference_to_video',
  'video.edit',
  'video.extend',
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
  image?:
    | {
        size?: string | undefined
        aspectRatio?: string | undefined
        resolution?: string | undefined
        quality?: string | undefined
        n?: number | undefined
        outputFormat?: 'png' | 'jpeg' | 'webp' | undefined
        responseFormat?: 'url' | 'b64_json' | 'base64' | undefined
      }
    | undefined
  audio?:
    | {
        voice?: string | undefined
        format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm' | undefined
        speed?: number | undefined
        language?: string | undefined
      }
    | undefined
  video?:
    | {
        aspectRatio?: string | undefined
        durationSeconds?: number | undefined
        quality?: string | undefined
        resolution?: string | undefined
        fps?: number | undefined
        watermark?: boolean | undefined
      }
    | undefined
  polling?:
    | {
        intervalMs?: number | undefined
        timeoutMs?: number | undefined
      }
    | undefined
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
      watermark: z.boolean().optional(),
    })
    .optional(),
  polling: z
    .object({
      intervalMs: z.number().int().min(500).max(300_000).optional(),
      // 上限对齐火山方舟异步视频任务默认 48h 超时（execution_expires_after
      // 默认 172800s）。原 1h 上限会让视频预设的 48h 配置被 zod 拒绝。
      timeoutMs: z.number().int().min(1_000).max(172_800_000).optional(),
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
  | 'storyboard_grid'
  | 'panorama_360'
  | 'text_generate'
  | 'text_rewrite'
  | 'prompt_optimize'
  | 'text_to_audio'
  | 'audio_transcribe'
  | 'text_to_video'
  | 'image_to_video'
  | 'video_edit'
  | 'video_extend'

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
    case 'storyboard_grid':
      return ['image.generate', 'image.edit']
    case 'panorama_360':
      return ['image.generate']
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
    case 'video_extend':
      return ['video.extend']
    // text_generate / text_rewrite / prompt_optimize 走文本模型，不经过 media adapter
    case 'text_generate':
    case 'text_rewrite':
    case 'prompt_optimize':
      return []
    default:
      return []
  }
}

/**
 * 媒体输入角色策略：描述某个 capability 支持哪些输入角色（首帧/尾帧/参考图/参考视频/参考音频），
 * 以及未手动指定 role 时的默认分配规则。UI 据此决定首尾帧/参考图选择器是否显示、
 * hint 文案、图片用量上限提示；MCP/skill 据此告知用户角色规则。
 *
 * 默认由 {@link inferRolePolicy} 根据 capability.id + input.required + input.maxImages
 * 集中推断，保持旧 manifest 向后兼容；输入模式特殊的模型可通过可选 rolePolicy
 * 显式覆盖，画布仍只消费通用角色，不感知 provider。
 */
export type MediaInputRolePolicy = {
  /** 支持的图片角色 */
  imageRoles?: Array<'first_frame' | 'last_frame' | 'reference_image'> | undefined
  /** 支持的视频角色（input_video = 被编辑/延长的输入视频；reference_video = 多模态参考视频） */
  videoRoles?: Array<'input_video' | 'reference_video'> | undefined
  /** 支持的音频角色（多模态参考音频） */
  audioRoles?: Array<'reference_audio'> | undefined
  /** 未手动指定 role 时的默认分配规则，用于 UI hint */
  defaultRoleAssignment?: 'first_then_last_then_reference' | 'all_reference' | 'none' | undefined
}

export const MediaInputRolePolicySchema = z.object({
  imageRoles: z
    .array(z.enum(['first_frame', 'last_frame', 'reference_image']))
    .max(3)
    .optional(),
  videoRoles: z
    .array(z.enum(['input_video', 'reference_video']))
    .max(2)
    .optional(),
  audioRoles: z.array(z.literal('reference_audio')).max(1).optional(),
  defaultRoleAssignment: z
    .enum(['first_then_last_then_reference', 'all_reference', 'none'])
    .optional(),
})

/**
 * 根据 capability 推断角色策略。
 *
 * 推断规则：
 *  - `video.image_to_video`：maxImages≥2 → 首帧+尾帧；maxImages>2 → 额外支持参考图
 *  - `video.edit`：input.required 含 image → 首帧+尾帧+参考图+输入视频；否则仅输入视频
 *  - `video.extend`：仅输入视频
 *  - `video.reference_to_video`：仅参考图
 *  - `video.generate`：input.required 含 image 或 maxImages>0 → 多模态参考（图/视频/音频）；否则纯文生视频
 *  - `image.edit` / `image.image_to_image` / `image.compose` / `image.variations`：仅参考图
 *  - 其他（image.generate / audio.*）：无角色输入
 */
export function inferRolePolicy(capability: {
  id: string
  input: { required?: string[]; maxImages?: number | undefined }
  rolePolicy?: MediaInputRolePolicy | undefined
}): MediaInputRolePolicy {
  if (capability.rolePolicy) return capability.rolePolicy
  const req = capability.input.required ?? []
  const hasImage = req.includes('image') || req.includes('images')
  const maxImages = capability.input.maxImages ?? 0

  switch (capability.id) {
    case 'video.image_to_video':
      return {
        imageRoles: [
          'first_frame',
          ...(maxImages >= 2 ? (['last_frame'] as const) : []),
          ...(maxImages > 2 ? (['reference_image'] as const) : []),
        ],
        defaultRoleAssignment: 'first_then_last_then_reference',
      }
    case 'video.edit':
      return hasImage
        ? {
            imageRoles: ['first_frame', 'last_frame', 'reference_image'],
            videoRoles: ['input_video'],
            defaultRoleAssignment: 'first_then_last_then_reference',
          }
        : {
            videoRoles: ['input_video'],
            defaultRoleAssignment: 'none',
          }
    case 'video.extend':
      return {
        videoRoles: ['input_video'],
        defaultRoleAssignment: 'none',
      }
    case 'video.reference_to_video':
      return {
        imageRoles: ['reference_image'],
        defaultRoleAssignment: 'all_reference',
      }
    case 'video.generate':
      // 多模态参考：Seedance 2.0 系列声明 maxImages=9 + 接受视频/音频参考。
      // 纯文生视频（其他模型）input.required 只有 prompt，无图片输入。
      if (hasImage || maxImages > 0) {
        return {
          imageRoles: ['reference_image'],
          videoRoles: ['reference_video'],
          audioRoles: ['reference_audio'],
          defaultRoleAssignment: 'all_reference',
        }
      }
      return { defaultRoleAssignment: 'none' }
    case 'image.edit':
    case 'image.image_to_image':
    case 'image.compose':
    case 'image.variations':
      return {
        imageRoles: ['reference_image'],
        defaultRoleAssignment: 'all_reference',
      }
    default:
      return { defaultRoleAssignment: 'none' }
  }
}

/**
 * 判断 capability 是否支持任何图片角色（首帧/尾帧/参考图）。
 * UI 用此决定是否显示图片角色选择器。
 */
export function capabilitySupportsImageRoles(capability: {
  id: string
  input: { required?: string[]; maxImages?: number | undefined }
  rolePolicy?: MediaInputRolePolicy | undefined
}): boolean {
  const policy = inferRolePolicy(capability)
  return (policy.imageRoles?.length ?? 0) > 0
}

/**
 * 判断 capability 是否支持首尾帧角色（区别于纯参考图）。
 * UI 用此决定是否显示"首帧/尾帧"独立选择器（vs 仅参考图）。
 * 替代原 CanvasOperationPanel 里硬编码的 operationSupportsVideoFrameRoles(operation)。
 */
export function capabilitySupportsFrameRoles(capability: {
  id: string
  input: { required?: string[]; maxImages?: number | undefined }
  rolePolicy?: MediaInputRolePolicy | undefined
}): boolean {
  const policy = inferRolePolicy(capability)
  return (
    (policy.imageRoles?.includes('first_frame') ?? false) ||
    (policy.imageRoles?.includes('last_frame') ?? false)
  )
}

/**
 * 当前 capability 支持的图片数量上限，用于 UI 的图片选择器/用量提示。
 *
 * - capability 不支持任何图片角色（如 video.extend / 纯文生视频 / 仅输入视频的 video.edit）
 *   → 0（UI 不显示图片选择器）。
 * - manifest 声明了 maxImages → 取 maxImages（向下取整，至少 1）。
 * - maxImages 缺失但支持图片角色 → 按 operation 保守兜底（正常路径走不到）。
 */
export function videoImageLimitForCapability(
  operation: CanvasOperationType,
  capability: {
    id: string
    input: { required?: string[]; maxImages?: number | undefined }
    rolePolicy?: MediaInputRolePolicy | undefined
  } | null,
): number {
  if (capability && !capabilitySupportsImageRoles(capability)) return 0
  const maxImages = capability?.input?.maxImages
  if (typeof maxImages === 'number' && Number.isFinite(maxImages) && maxImages > 0) {
    return Math.max(1, Math.floor(maxImages))
  }
  if (operation === 'video_edit') return 2
  if (operation === 'video_extend') return 0
  if (operation === 'image_to_video') return 1
  return 1
}
