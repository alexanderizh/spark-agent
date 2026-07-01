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
import { validateMediaModelManifestSemantics } from './media-model-manifest-validation.js'

export type MediaDomain = 'image' | 'audio' | 'video' | 'text' | 'document' | 'web' | 'slide' | 'sheet'

export type MediaManifestCapabilityId =
  | 'image.generate'
  | 'image.image_to_image'
  | 'image.edit'
  | 'image.compose'
  | 'video.generate'
  | 'video.image_to_video'
  | 'video.reference_to_video'
  | 'video.edit'
  | 'video.extend'
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
    headers?: Record<string, unknown> | undefined
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
  /** Complete user-defined contract. Built-in references keep this omitted. */
  manifest?: MediaModelManifest | undefined
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
    headers: JsonObjectSchema.optional(),
    requestTemplate: JsonObjectSchema,
    response: MediaArtifactRetrievalSchema,
    polling: z.object({
      intervalMs: z.number().int().min(250).max(300_000),
      // 上限对齐火山方舟异步视频任务默认 48h（与 ProviderMediaDefaultsSchema 一致）。
      timeoutMs: z.number().int().min(1_000).max(172_800_000),
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
  manifest: MediaModelManifestSchema.optional(),
}).superRefine((ref, ctx) => {
  if (ref.manifest && ref.manifest.id !== ref.manifestId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['manifestId'],
      message: 'manifestId must match manifest.id',
    })
  }
  if (ref.manifest) {
    for (const issue of validateMediaModelManifestSemantics(ref.manifest)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['manifest', ...issue.path],
        message: issue.message,
      })
    }
  }
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

/**
 * xAI 视频编辑参数。
 * 官方明确：编辑输出继承输入视频的 duration / aspect_ratio / resolution（不支持自定义），
 * 故 schema 仅暴露与编辑语义相关的字段，避免 UI 误导用户填写被忽略的参数。
 */
const xaiVideoEditSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    user: { type: 'string', title: '用户标识' },
  },
}

/**
 * xAI 视频扩展参数。
 * 官方明确：扩展（/videos/extensions）duration 范围 [1, 15] 秒，默认 6 秒；
 * 从输入视频最后一帧续拍，不支持 aspect_ratio / resolution（继承输入视频）。
 */
const xaiVideoExtendSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    durationSeconds: { type: 'integer', title: '扩展时长', minimum: 1, maximum: 15, default: 6 },
    user: { type: 'string', title: '用户标识' },
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

const googleImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    size: { type: 'string', title: '画幅', enum: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9'] },
    resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K', '4K'], default: '1K' },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 1 },
    outputFormat: { type: 'string', title: '输出格式', enum: ['png', 'jpeg', 'webp'], default: 'png' },
    google_search: { type: 'boolean', title: 'Google 搜索', default: false },
    google_image_search: { type: 'boolean', title: 'Google 图片搜索', default: false },
  },
}

const googleVeoVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16'], default: '16:9' },
    durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 10, default: 8 },
    resolution: { type: 'string', title: '分辨率', enum: ['720p', '1080p', '4k'], default: '720p' },
    personGeneration: { type: 'string', title: '人物生成', enum: ['allow_adult', 'dont_allow'] },
    seed: { type: 'integer', title: '随机种子' },
    useFirstFrame: { type: 'boolean', title: '使用首帧', default: true },
    useLastFrame: { type: 'boolean', title: '使用尾帧', default: false },
  },
}

const googleOmniVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16', '1:1'], default: '16:9' },
    durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 10, default: 6 },
    resolution: { type: 'string', title: '分辨率', enum: ['720p'], default: '720p' },
    seed: { type: 'integer', title: '随机种子' },
    useFirstFrame: { type: 'boolean', title: '使用首帧/参考图', default: true },
  },
}

const midjourneyGatewayImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: { type: 'string', title: '比例', examples: ['1:1', '16:9', '9:16'] },
    stylize: { type: 'integer', title: 'Stylize', minimum: 0, maximum: 1000 },
    chaos: { type: 'integer', title: 'Chaos', minimum: 0, maximum: 100 },
    seed: { type: 'integer', title: '随机种子' },
    submitPath: { type: 'string', title: '提交路径', default: '/imagine' },
    statusPath: { type: 'string', title: '轮询路径', default: '/tasks/{{taskId}}' },
  },
}

const bailianImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    size: { type: 'string', title: '画幅', enum: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', 'auto'], default: '1:1' },
    resolution: { type: 'string', title: '分辨率', enum: ['2K', '4K', 'auto'], default: '2K' },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 1 },
    negative_prompt: { type: 'string', title: '负面提示词' },
    seed: { type: 'integer', title: '随机种子' },
    prompt_extend: { type: 'boolean', title: '提示词扩展', default: false },
    watermark: { type: 'boolean', title: '水印', default: false },
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
    aspectRatio: {
      type: 'string',
      title: '视频比例',
      // "智能比例" 在 adapter 层翻译为平台值 ratio=adaptive；其余原样透传。
      enum: ['智能比例', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      default: '智能比例',
    },
    resolution: {
      type: 'string',
      title: '分辨率',
      // 4k 仅 Seedance 2.0（非 Fast/Mini）支持，Fast/Mini 各自的 manifest 会覆盖 enum。
      enum: ['480p', '720p', '1080p', '4k'],
      default: '720p',
    },
    durationSeconds: {
      type: 'integer',
      title: '时长（秒）',
      minimum: 4,
      maximum: 15,
      default: 5,
    },
    generateAudio: { type: 'boolean', title: '生成同步音频', default: true },
    watermark: { type: 'boolean', title: '水印', default: true },
    returnLastFrame: { type: 'boolean', title: '返回尾帧图', default: false },
    seed: { type: 'integer', title: '随机种子', default: -1 },
    serviceTier: {
      type: 'string',
      title: '推理档位',
      // flex = 离线推理（更便宜、不保证时效）；留空为在线推理。
      enum: ['flex', ''],
      default: '',
    },
    searchEnabled: { type: 'boolean', title: '联网搜索', default: false },
  },
}

/**
 * Seedance 1.5 Pro 视频参数。
 * 文档（model-api-doc/seedance.md）：
 *  - duration [2,12]，1.5 pro 不支持 frames
 *  - 1.5 pro 默认 resolution=720p
 *  - 仅 1.5 pro 支持 generate_audio
 *  - 支持 ratio adaptive
 *  - 1.5 pro 不支持 camera_fixed（参考图场景不支持）
 *  - 支持 draft（样片模式）/ return_last_frame
 */
const volcengineSeedance15ProVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: {
      type: 'string',
      title: '视频比例',
      enum: ['智能比例', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      default: '智能比例',
    },
    resolution: {
      type: 'string',
      title: '分辨率',
      // 参考图场景不支持 1080p；UI 不做条件枚举，由用户基于场景选择。
      enum: ['480p', '720p', '1080p'],
      default: '720p',
    },
    durationSeconds: {
      type: 'integer',
      title: '时长（秒）',
      minimum: 2,
      maximum: 12,
      default: 5,
    },
    generateAudio: { type: 'boolean', title: '生成同步音频（人声/音效/配乐）', default: false },
    draft: { type: 'boolean', title: '样片模式', default: false },
    watermark: { type: 'boolean', title: '水印', default: false },
    returnLastFrame: { type: 'boolean', title: '返回尾帧图', default: false },
    seed: { type: 'integer', title: '随机种子', default: -1 },
  },
}

/**
 * Seedance 1.0 Pro / Pro Fast 视频参数。
 * 文档（model-api-doc/seedance.md）：
 *  - 默认 resolution=1080p（参考图场景不支持 1080p）
 *  - duration [2,12]
 *  - 不支持 generate_audio（仅 1.5 pro 支持）
 *  - 支持 frames（按 25+4n 取值；与 duration 二选一，frames 优先级高）
 *  - 支持 camera_fixed（参考图场景不支持）
 *  - 支持 ratio adaptive
 */
const volcengineSeedance10ProVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
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
      default: '1080p',
    },
    durationSeconds: {
      type: 'integer',
      title: '时长（秒）',
      minimum: 2,
      maximum: 12,
      default: 5,
    },
    cameraFixed: { type: 'boolean', title: '固定摄像头', default: false },
    watermark: { type: 'boolean', title: '水印', default: false },
    returnLastFrame: { type: 'boolean', title: '返回尾帧图', default: false },
    seed: { type: 'integer', title: '随机种子', default: -1 },
  },
}

/**
 * Seedream 5.0 lite 图片参数（基准 schema）。
 * 5.0 lite 文档支持：
 *  - 分辨率档位 2K / 3K / 4K（或显式像素如 2048x2048）
 *  - 输出格式 png / jpeg（默认 png）
 *  - 组图生成（sequential_image_generation=auto + max_images 1-15）
 *  - 联网搜索（tools:[{type:'web_search'}]）
 */
const volcengineSeedream5ImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    size: { type: 'string', title: '分辨率', enum: ['2K', '3K', '4K', '2048x2048'], default: '2K' },
    outputFormat: { type: 'string', title: '输出格式', enum: ['png', 'jpeg'], default: 'png' },
    responseFormat: { type: 'string', title: '响应格式', enum: ['url', 'b64_json'], default: 'url' },
    watermark: { type: 'boolean', title: '水印', default: false },
    seed: { type: 'integer', title: '随机种子' },
    sequentialImageGeneration: { type: 'string', title: '组图模式', enum: ['disabled', 'auto'], default: 'disabled' },
    maxImages: { type: 'integer', title: '组图数量', minimum: 1, maximum: 15, default: 4 },
    searchEnabled: { type: 'boolean', title: '联网搜索', default: false },
  },
}

/**
 * Seedream 4.5 图片参数：
 *  - 文档明确只支持 2K / 4K
 *  - 输出格式仅 jpeg（无 png）
 *  - 联网搜索由模型本身不支持
 */
const volcengineSeedream45ImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    size: { type: 'string', title: '分辨率', enum: ['2K', '4K', '2048x2048'], default: '2K' },
    outputFormat: { type: 'string', title: '输出格式', enum: ['jpeg'], default: 'jpeg' },
    responseFormat: { type: 'string', title: '响应格式', enum: ['url', 'b64_json'], default: 'url' },
    watermark: { type: 'boolean', title: '水印', default: false },
    seed: { type: 'integer', title: '随机种子' },
    sequentialImageGeneration: { type: 'string', title: '组图模式', enum: ['disabled', 'auto'], default: 'disabled' },
    maxImages: { type: 'integer', title: '组图数量', minimum: 1, maximum: 15, default: 4 },
  },
}

/**
 * Seedream 4.0 图片参数：
 *  - 文档支持 1K / 2K / 4K
 *  - 输出格式仅 jpeg
 *  - 独有提示词优化模式（标准 / 极速）
 *  - 联网搜索不支持
 */
const volcengineSeedream40ImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    size: { type: 'string', title: '分辨率', enum: ['1K', '2K', '4K', '2048x2048'], default: '2K' },
    outputFormat: { type: 'string', title: '输出格式', enum: ['jpeg'], default: 'jpeg' },
    responseFormat: { type: 'string', title: '响应格式', enum: ['url', 'b64_json'], default: 'url' },
    watermark: { type: 'boolean', title: '水印', default: false },
    seed: { type: 'integer', title: '随机种子' },
    promptOptimizationMode: { type: 'string', title: '提示词优化模式', enum: ['standard', 'fast'], default: 'standard' },
    sequentialImageGeneration: { type: 'string', title: '组图模式', enum: ['disabled', 'auto'], default: 'disabled' },
    maxImages: { type: 'integer', title: '组图数量', minimum: 1, maximum: 15, default: 4 },
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

/**
 * 百炼视频系列（HappyHorse 全系列 + Wan 2.7 全系列）返回的 task_status 为大写枚举
 * （PENDING / RUNNING / SUCCEEDED / FAILED / CANCELED / UNKNOWN），
 * 需在 commonStatusMap 基础上补齐大写映射；UNKNOWN 视为 failed，避免无限轮询。
 */
const bailianVideoStatusMap = {
  ...commonStatusMap,
  PENDING: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'cancelled',
  UNKNOWN: 'failed',
} as const

/**
 * HappyHorse 文生视频 / 参考生视频参数（两者参数集一致）。
 * 枚举严格对齐官方文档：resolution 大写 720P/1080P 默认 1080P；
 * ratio 9 档默认 16:9；duration 为 [3,15] 整数默认 5；watermark 默认 true。
 */
const happyhorseTextOrReferenceVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    resolution: { type: 'string', title: '分辨率', enum: ['720P', '1080P'], default: '1080P' },
    ratio: {
      type: 'string',
      title: '宽高比',
      enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9'],
      default: '16:9',
    },
    duration: { type: 'integer', title: '时长（秒）', minimum: 3, maximum: 15, default: 5 },
    watermark: { type: 'boolean', title: '水印', default: true },
    seed: { type: 'integer', title: '随机种子', minimum: 0, maximum: 2147483647 },
  },
}

/**
 * HappyHorse 图生视频（基于首帧）参数。
 * 文档明确：图生视频不支持 ratio，输出宽高比自动跟随首帧图像。
 */
const happyhorseImageToVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    resolution: { type: 'string', title: '分辨率', enum: ['720P', '1080P'], default: '1080P' },
    duration: { type: 'integer', title: '时长（秒）', minimum: 3, maximum: 15, default: 5 },
    watermark: { type: 'boolean', title: '水印', default: true },
    seed: { type: 'integer', title: '随机种子', minimum: 0, maximum: 2147483647 },
  },
}

/**
 * HappyHorse 视频编辑参数。
 * 不支持 ratio / duration（输出时长跟随输入视频，最长 15 秒）；
 * audio_setting 控制声音：auto（模型控制，默认）/ origin（保留原声）。
 */
const happyhorseVideoEditSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    resolution: { type: 'string', title: '分辨率', enum: ['720P', '1080P'], default: '1080P' },
    watermark: { type: 'boolean', title: '水印', default: true },
    audio_setting: { type: 'string', title: '声音控制', enum: ['auto', 'origin'], default: 'auto' },
    seed: { type: 'integer', title: '随机种子', minimum: 0, maximum: 2147483647 },
  },
}

/**
 * Wan 2.7 图生视频 / 参考生视频参数。
 * 枚举对齐官方文档：resolution 大写 720P/1080P 默认 1080P；
 * i2v 不支持 ratio（宽高比跟随首帧素材），r2v 支持所以单独提供 schema；
 * duration [2,15] 默认 5；prompt_extend 默认 true；watermark 默认 false。
 */
const wanVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    resolution: { type: 'string', title: '分辨率', enum: ['720P', '1080P'], default: '1080P' },
    duration: { type: 'integer', title: '时长（秒）', minimum: 2, maximum: 15, default: 5 },
    prompt_extend: { type: 'boolean', title: '提示词智能改写', default: true },
    watermark: { type: 'boolean', title: '水印', default: false },
    seed: { type: 'integer', title: '随机种子', minimum: 0, maximum: 2147483647 },
  },
}

/**
 * Wan 2.7 文生视频参数。
 * 与图生视频相比多了 ratio（5 档：16:9 / 9:16 / 1:1 / 4:3 / 3:4）。
 */
const wanTextToVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    resolution: { type: 'string', title: '分辨率', enum: ['720P', '1080P'], default: '1080P' },
    ratio: {
      type: 'string',
      title: '宽高比',
      enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      default: '16:9',
    },
    duration: { type: 'integer', title: '时长（秒）', minimum: 2, maximum: 15, default: 5 },
    prompt_extend: { type: 'boolean', title: '提示词智能改写', default: true },
    watermark: { type: 'boolean', title: '水印', default: false },
    seed: { type: 'integer', title: '随机种子', minimum: 0, maximum: 2147483647 },
  },
}

/**
 * Wan 2.7 视频编辑参数。
 * duration 默认 0（使用输入视频时长，需截断时设 [2,10]）；
 * audio_setting：auto（默认，模型智能判断）/ origin（强制保留原声）。
 */
const wanVideoEditSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    resolution: { type: 'string', title: '分辨率', enum: ['720P', '1080P'], default: '1080P' },
    ratio: {
      type: 'string',
      title: '宽高比',
      enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    },
    duration: { type: 'integer', title: '时长（秒，0 表示跟随输入视频）', minimum: 0, maximum: 10, default: 0 },
    audio_setting: { type: 'string', title: '声音设置', enum: ['auto', 'origin'], default: 'auto' },
    prompt_extend: { type: 'boolean', title: '提示词智能改写', default: true },
    watermark: { type: 'boolean', title: '水印', default: false },
    seed: { type: 'integer', title: '随机种子', minimum: 0, maximum: 2147483647 },
  },
}

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
      // 文生图与图生图/编辑共用一个模板：image 字段渲染为空对象时会被模板渲染器剔除，
      // 故文生图请求只剩 { model, prompt }。图生图/编辑时 image 取首张参考图（{ url }）。
      // 注意：xAI 走 XaiMediaAdapter 优先（image.edit 实际走 /images/edits，支持多图 images 数组），
      // 此模板仅作 skill manifest 回退路径，按官方 image edit 语义传 image 对象而非字符串字段。
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', image: { url: '{{image}}' } },
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
        id: 'video.reference_to_video',
        label: '参考图生视频',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 4, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: xaiVideoSchema,
        defaults: { durationSeconds: 8, resolution: '720p' },
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration' },
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
        input: { required: ['prompt', 'video'] as MediaManifestInputKind[], acceptedMimeTypes: ['video/mp4'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        // 编辑端点由 XaiMediaAdapter.editVideo 处理（POST /videos/edits，输入 video 对象，
        // 忽略 duration/aspect_ratio/resolution，输出继承输入视频）。schema 仅用于 UI 参数面板展示。
        paramSchema: xaiVideoEditSchema,
        aliases: { durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.extend',
        label: '视频扩展',
        input: { required: ['prompt', 'video'] as MediaManifestInputKind[], acceptedMimeTypes: ['video/mp4'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        // 扩展端点由 XaiMediaAdapter.editVideo 处理（POST /videos/extensions，
        // duration 范围 [1,15] 默认 6，从输入视频最后一帧续拍）。
        paramSchema: xaiVideoExtendSchema,
        defaults: { durationSeconds: 6 },
        aliases: { durationSeconds: 'duration' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/videos/generations',
      method: 'POST',
      contentType: 'json',
      // 生成 / 图生视频共用此模板：image 为图生视频的首帧（官方明确支持）。
      // 注意：官方视频生成不支持 last_frame_image（尾帧），故不再传该字段。
      // video.edit / video.extend 走独立端点（/videos/edits、/videos/extensions），
      // 由 XaiMediaAdapter 优先处理，不经过此模板。
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', image: { url: '{{firstFrame}}' }, video: '{{video}}' },
      response: { kind: 'task_poll', taskIdPaths: ['request_id', 'id'], statusEndpoint: '/videos/{{taskId}}', resultPaths: ['video.url', 'video_url', 'data[].url'] },
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
    id: 'bailian:wan2.7-image-pro',
    providerKind: 'bailian',
    modelId: 'wan2.7-image-pro',
    displayName: 'Wan 2.7 Image Pro',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: bailianImageSchema,
        defaults: { size: '1:1', resolution: '2K', n: 1, prompt_extend: false, watermark: false },
        aliases: { aspectRatio: 'size', outputFormat: 'output_format' },
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 8, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: bailianImageSchema,
        defaults: { size: '1:1', resolution: '2K', n: 1, prompt_extend: false, watermark: false },
        aliases: { aspectRatio: 'size', outputFormat: 'output_format' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/image-generation/generation',
      method: 'POST',
      contentType: 'json',
      headers: { 'X-DashScope-Async': 'enable' },
      requestTemplate: {
        model: '{{modelId}}',
        input: {
          messages: [
            {
              role: 'user',
              content: [
                { text: '{{prompt}}' },
                { image: '{{image}}' },
                { image: '{{firstFrame}}' },
                { image: '{{lastFrame}}' },
              ],
            },
          ],
        },
        parameters: {
          size: '{{size}}',
          resolution: '{{resolution}}',
          n: '{{n}}',
          negative_prompt: '{{negative_prompt}}',
          seed: '{{seed}}',
          prompt_extend: '{{prompt_extend}}',
          watermark: '{{watermark}}',
        },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['data[].url', 'data[].image_url', 'data.image_url', 'output.url', 'url'],
      },
      polling: { intervalMs: 5000, timeoutMs: 600000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://bailian.console.aliyun.com/cn-beijing/?tab=model#/model-market'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
  },
  {
    id: 'bailian:wan2.7-i2v-2026-04-25',
    providerKind: 'bailian',
    modelId: 'wan2.7-i2v-2026-04-25',
    displayName: 'Wan 2.7 Image-to-Video',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['image'] as MediaManifestInputKind[], maxImages: 2, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'audio/wav', 'audio/mpeg'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: wanVideoSchema,
        defaults: { resolution: '1080P', duration: 5, prompt_extend: true, watermark: false },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/video-generation/video-synthesis',
      method: 'POST',
      contentType: 'json',
      headers: { 'X-DashScope-Async': 'enable' },
      requestTemplate: {
        model: '{{modelId}}',
        input: {
          prompt: '{{prompt}}',
          negative_prompt: '{{negativePrompt}}',
          media: '{{media}}',
        },
        parameters: {
          resolution: '{{resolution}}',
          duration: '{{duration}}',
          prompt_extend: '{{prompt_extend}}',
          watermark: '{{watermark}}',
          seed: '{{seed}}',
        },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['output.task_id', 'task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['output.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 15000, timeoutMs: 600000, statusMap: bailianVideoStatusMap },
    },
    docs: { sourceUrls: ['https://help.aliyun.com/zh/model-studio/wan-image-to-video-guide'] },
    safety: { maxPromptLength: 5000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'bailian:wan2.7-t2v',
    providerKind: 'bailian',
    modelId: 'wan2.7-t2v',
    displayName: 'Wan 2.7 Text-to-Video',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: wanTextToVideoSchema,
        defaults: { resolution: '1080P', ratio: '16:9', duration: 5, prompt_extend: true, watermark: false },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/video-generation/video-synthesis',
      method: 'POST',
      contentType: 'json',
      headers: { 'X-DashScope-Async': 'enable' },
      requestTemplate: {
        model: '{{modelId}}',
        input: {
          prompt: '{{prompt}}',
          negative_prompt: '{{negativePrompt}}',
          audio_url: '{{audio}}',
        },
        parameters: {
          resolution: '{{resolution}}',
          ratio: '{{ratio}}',
          duration: '{{duration}}',
          prompt_extend: '{{prompt_extend}}',
          watermark: '{{watermark}}',
          seed: '{{seed}}',
        },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['output.task_id', 'task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['output.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 15000, timeoutMs: 600000, statusMap: bailianVideoStatusMap },
    },
    docs: { sourceUrls: ['https://help.aliyun.com/zh/model-studio/text-to-video-guide'] },
    safety: { maxPromptLength: 5000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'bailian:wan2.7-r2v',
    providerKind: 'bailian',
    modelId: 'wan2.7-r2v',
    displayName: 'Wan 2.7 Reference-to-Video',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.image_to_video',
        label: '参考生视频',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 5, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'video/mp4', 'video/quicktime'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: wanTextToVideoSchema,
        defaults: { resolution: '1080P', ratio: '16:9', duration: 5, prompt_extend: true, watermark: false },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/video-generation/video-synthesis',
      method: 'POST',
      contentType: 'json',
      headers: { 'X-DashScope-Async': 'enable' },
      requestTemplate: {
        model: '{{modelId}}',
        input: {
          prompt: '{{prompt}}',
          negative_prompt: '{{negativePrompt}}',
          media: '{{media}}',
        },
        parameters: {
          resolution: '{{resolution}}',
          ratio: '{{ratio}}',
          duration: '{{duration}}',
          prompt_extend: '{{prompt_extend}}',
          watermark: '{{watermark}}',
          seed: '{{seed}}',
        },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['output.task_id', 'task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['output.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 15000, timeoutMs: 600000, statusMap: bailianVideoStatusMap },
    },
    docs: { sourceUrls: ['https://help.aliyun.com/zh/model-studio/wan-image-to-video-guide'] },
    safety: { maxPromptLength: 5000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'bailian:wan2.7-videoedit',
    providerKind: 'bailian',
    modelId: 'wan2.7-videoedit',
    displayName: 'Wan 2.7 Video Edit',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.edit',
        label: '视频编辑',
        input: { required: ['video'] as MediaManifestInputKind[], maxImages: 5, acceptedMimeTypes: ['video/mp4', 'video/quicktime', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: wanVideoEditSchema,
        defaults: { resolution: '1080P', duration: 0, audio_setting: 'auto', prompt_extend: true, watermark: false },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/video-generation/video-synthesis',
      method: 'POST',
      contentType: 'json',
      headers: { 'X-DashScope-Async': 'enable' },
      requestTemplate: {
        model: '{{modelId}}',
        input: {
          prompt: '{{prompt}}',
          negative_prompt: '{{negativePrompt}}',
          media: '{{media}}',
        },
        parameters: {
          resolution: '{{resolution}}',
          ratio: '{{ratio}}',
          duration: '{{duration}}',
          audio_setting: '{{audio_setting}}',
          prompt_extend: '{{prompt_extend}}',
          watermark: '{{watermark}}',
          seed: '{{seed}}',
        },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['output.task_id', 'task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['output.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 15000, timeoutMs: 600000, statusMap: bailianVideoStatusMap },
    },
    docs: { sourceUrls: ['https://help.aliyun.com/zh/model-studio/wan-image-to-video-guide'] },
    safety: { maxPromptLength: 5000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'bailian:happyhorse-1.0-t2v',
    providerKind: 'bailian',
    // 模型 ID 统一小写：阿里云百炼文档所有 happyhorse 模型 ID 均为小写
    // （happyhorse-1.0-t2v / 1.1-t2v / 1.0-i2v / 1.1-i2v / 1.1-r2v / 1.0-video-edit）。
    modelId: 'happyhorse-1.0-t2v',
    displayName: 'HappyHorse 1.0 Text-to-Video',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: happyhorseTextOrReferenceVideoSchema,
        defaults: { resolution: '1080P', ratio: '16:9', duration: 5, watermark: true },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/video-generation/video-synthesis',
      method: 'POST',
      contentType: 'json',
      headers: { 'X-DashScope-Async': 'enable' },
      requestTemplate: {
        model: '{{modelId}}',
        input: { prompt: '{{prompt}}' },
        parameters: {
          resolution: '{{resolution}}',
          ratio: '{{ratio}}',
          duration: '{{duration}}',
          watermark: '{{watermark}}',
          seed: '{{seed}}',
        },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['output.task_id', 'task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['output.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 15000, timeoutMs: 600000, statusMap: bailianVideoStatusMap },
    },
    docs: { sourceUrls: ['https://help.aliyun.com/zh/model-studio/happyhorse-text-to-video-api-reference'] },
    safety: { maxPromptLength: 5000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'bailian:happyhorse-1.1-t2v',
    providerKind: 'bailian',
    modelId: 'happyhorse-1.1-t2v',
    displayName: 'HappyHorse 1.1 Text-to-Video',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: happyhorseTextOrReferenceVideoSchema,
        defaults: { resolution: '1080P', ratio: '16:9', duration: 5, watermark: true },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/video-generation/video-synthesis',
      method: 'POST',
      contentType: 'json',
      headers: { 'X-DashScope-Async': 'enable' },
      requestTemplate: {
        model: '{{modelId}}',
        input: { prompt: '{{prompt}}' },
        parameters: {
          resolution: '{{resolution}}',
          ratio: '{{ratio}}',
          duration: '{{duration}}',
          watermark: '{{watermark}}',
          seed: '{{seed}}',
        },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['output.task_id', 'task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['output.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 15000, timeoutMs: 600000, statusMap: bailianVideoStatusMap },
    },
    docs: { sourceUrls: ['https://help.aliyun.com/zh/model-studio/happyhorse-text-to-video-api-reference'] },
    safety: { maxPromptLength: 5000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'bailian:happyhorse-1.1-i2v',
    providerKind: 'bailian',
    modelId: 'happyhorse-1.1-i2v',
    displayName: 'HappyHorse 1.1 Image-to-Video',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: happyhorseImageToVideoSchema,
        defaults: { resolution: '1080P', duration: 5, watermark: true },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/video-generation/video-synthesis',
      method: 'POST',
      contentType: 'json',
      headers: { 'X-DashScope-Async': 'enable' },
      requestTemplate: {
        model: '{{modelId}}',
        input: { prompt: '{{prompt}}', media: '{{media}}' },
        parameters: {
          resolution: '{{resolution}}',
          duration: '{{duration}}',
          watermark: '{{watermark}}',
          seed: '{{seed}}',
        },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['output.task_id', 'task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['output.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 15000, timeoutMs: 600000, statusMap: bailianVideoStatusMap },
    },
    docs: { sourceUrls: ['https://help.aliyun.com/zh/model-studio/happyhorse-image-to-video-api-reference'] },
    safety: { maxPromptLength: 5000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'bailian:happyhorse-1.0-i2v',
    providerKind: 'bailian',
    modelId: 'happyhorse-1.0-i2v',
    displayName: 'HappyHorse 1.0 Image-to-Video',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: happyhorseImageToVideoSchema,
        defaults: { resolution: '1080P', duration: 5, watermark: true },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/video-generation/video-synthesis',
      method: 'POST',
      contentType: 'json',
      headers: { 'X-DashScope-Async': 'enable' },
      requestTemplate: {
        model: '{{modelId}}',
        input: { prompt: '{{prompt}}', media: '{{media}}' },
        parameters: {
          resolution: '{{resolution}}',
          duration: '{{duration}}',
          watermark: '{{watermark}}',
          seed: '{{seed}}',
        },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['output.task_id', 'task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['output.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 15000, timeoutMs: 600000, statusMap: bailianVideoStatusMap },
    },
    docs: { sourceUrls: ['https://help.aliyun.com/zh/model-studio/happyhorse-image-to-video-api-reference'] },
    safety: { maxPromptLength: 5000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'bailian:happyhorse-1.1-r2v',
    providerKind: 'bailian',
    modelId: 'happyhorse-1.1-r2v',
    displayName: 'HappyHorse 1.1 Reference-to-Video',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.image_to_video',
        label: '参考生视频',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 9, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: happyhorseTextOrReferenceVideoSchema,
        defaults: { resolution: '1080P', ratio: '16:9', duration: 5, watermark: true },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/video-generation/video-synthesis',
      method: 'POST',
      contentType: 'json',
      headers: { 'X-DashScope-Async': 'enable' },
      requestTemplate: {
        model: '{{modelId}}',
        input: { prompt: '{{prompt}}', media: '{{media}}' },
        parameters: {
          resolution: '{{resolution}}',
          ratio: '{{ratio}}',
          duration: '{{duration}}',
          watermark: '{{watermark}}',
          seed: '{{seed}}',
        },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['output.task_id', 'task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['output.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 15000, timeoutMs: 600000, statusMap: bailianVideoStatusMap },
    },
    docs: { sourceUrls: ['https://help.aliyun.com/zh/model-studio/happyhorse-reference-to-video-api-reference'] },
    safety: { maxPromptLength: 5000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'bailian:happyhorse-1.0-video-edit',
    providerKind: 'bailian',
    modelId: 'happyhorse-1.0-video-edit',
    displayName: 'HappyHorse 1.0 Video Edit',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.edit',
        label: '视频编辑',
        input: { required: ['prompt', 'video'] as MediaManifestInputKind[], maxImages: 2, acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: happyhorseVideoEditSchema,
        defaults: { resolution: '1080P', watermark: true, audio_setting: 'auto' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/video-generation/video-synthesis',
      method: 'POST',
      contentType: 'json',
      headers: { 'X-DashScope-Async': 'enable' },
      requestTemplate: {
        model: '{{modelId}}',
        input: { prompt: '{{prompt}}', media: '{{media}}' },
        parameters: {
          resolution: '{{resolution}}',
          watermark: '{{watermark}}',
          audio_setting: '{{audio_setting}}',
          seed: '{{seed}}',
        },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['output.task_id', 'task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['output.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 15000, timeoutMs: 600000, statusMap: bailianVideoStatusMap },
    },
    docs: { sourceUrls: ['https://help.aliyun.com/zh/model-studio/happyhorse-video-edit-api-reference'] },
    safety: { maxPromptLength: 5000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'bailian:qwen3-tts-flash',
    providerKind: 'bailian',
    modelId: 'qwen3-tts-flash',
    displayName: 'Qwen3 TTS Flash',
    domains: ['audio'],
    capabilities: [
      {
        id: 'audio.speech',
        label: '文生音频',
        input: { required: ['text'] as MediaManifestInputKind[] },
        output: { types: ['audio'] as MediaManifestOutputKind[], mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg'] },
        paramSchema: audioSpeechSchema,
        defaults: { format: 'mp3', voice: 'default', speed: 1 },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/audio/speech',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', input: '{{text}}', voice: '{{voice}}', format: '{{format}}', speed: '{{speed}}' },
      response: { kind: 'binary_response' },
    },
    docs: { sourceUrls: ['https://bailian.console.aliyun.com/cn-beijing/?tab=model#/model-market'] },
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
  ...[
    { id: 'google:gemini-3.1-flash-image', modelId: 'gemini-3.1-flash-image', displayName: 'Google Gemini 3.1 Flash Image' },
    { id: 'google:gemini-3.1-flash-lite-image', modelId: 'gemini-3.1-flash-lite-image', displayName: 'Google Gemini 3.1 Flash Lite Image' },
    { id: 'google:gemini-3-pro-image', modelId: 'gemini-3-pro-image', displayName: 'Google Gemini 3 Pro Image' },
    { id: 'google:gemini-2.5-flash-image', modelId: 'gemini-2.5-flash-image', displayName: 'Google Gemini 2.5 Flash Image' },
  ].map((entry) => ({
    id: entry.id,
    providerKind: 'google-generative-ai',
    modelId: entry.modelId,
    displayName: entry.displayName,
    domains: ['image'] as MediaDomain[],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: googleImageSchema,
        defaults: { n: 1, resolution: '1K', outputFormat: 'png' },
        aliases: { outputFormat: 'output_format' },
      },
      {
        id: 'image.edit',
        label: '多轮图片编辑 / 图生图',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 8, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: googleImageSchema,
        defaults: { n: 1, resolution: '1K', outputFormat: 'png' },
        aliases: { outputFormat: 'output_format' },
      },
    ],
    invocation: {
      mode: 'sync' as MediaInvocationMode,
      endpoint: '/interactions',
      method: 'POST' as const,
      contentType: 'json' as const,
      requestTemplate: { model: '{{modelId}}', input: '{{prompt}}' },
      response: { kind: 'inline_base64' as const, jsonPaths: ['output_image.data', 'outputImage.data'] },
    },
    docs: {
      sourceUrls: ['https://ai.google.dev/gemini-api/docs/image-generation'],
      lastCheckedAt: '2026-07-01',
    },
    safety: { maxPromptLength: 32000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
  })),
  {
    id: 'google:veo',
    providerKind: 'google-generative-ai',
    modelId: 'veo-3.1-generate-preview',
    displayName: 'Google Veo 3.1',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: googleVeoVideoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p' },
      },
      {
        id: 'video.image_to_video',
        label: '首尾帧 / 参考图生视频',
        input: { required: ['prompt', 'image'], maxImages: 3, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: googleVeoVideoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p' },
      },
      {
        id: 'video.reference_to_video',
        label: '参考图生视频',
        input: { required: ['prompt', 'images'], maxImages: 3, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: googleVeoVideoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p' },
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
    docs: {
      sourceUrls: ['https://ai.google.dev/gemini-api/docs/veo'],
      lastCheckedAt: '2026-07-01',
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
  },
  {
    id: 'omni:gemini-omni-flash-preview',
    providerKind: 'omni',
    modelId: 'gemini-omni-flash-preview',
    displayName: 'Gemini Omni Flash Preview',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '对话式文生视频',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: googleOmniVideoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 6, resolution: '720p' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频 / 视频编辑',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 3, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: googleOmniVideoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 6, resolution: '720p' },
      },
      {
        id: 'video.edit',
        label: '自然语言视频编辑',
        input: { required: ['prompt', 'video'] as MediaManifestInputKind[], acceptedMimeTypes: ['video/mp4', 'video/webm'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: googleOmniVideoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 6, resolution: '720p' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/models/{{modelId}}:predictLongRunning',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { instances: [{ prompt: '{{prompt}}' }] },
      response: { kind: 'task_poll', taskIdPaths: ['name'], statusEndpoint: '/{{taskId}}', resultPaths: ['response.generateVideoResponse.generatedSamples[].video.uri', 'response.generatedVideos[].video.uri'] },
      polling: { intervalMs: 10000, timeoutMs: 1800000, statusMap: commonStatusMap },
    },
    docs: {
      sourceUrls: ['https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash'],
      lastCheckedAt: '2026-07-01',
    },
    safety: { maxPromptLength: 32000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'midjourney:gateway',
    providerKind: 'midjourney',
    modelId: 'midjourney',
    displayName: 'Midjourney Gateway',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图（外部网关）',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: midjourneyGatewayImageSchema,
        defaults: { submitPath: '/imagine', statusPath: '/tasks/{{taskId}}' },
      },
      {
        id: 'image.edit',
        label: '参考图生图（外部网关）',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 8, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: midjourneyGatewayImageSchema,
        defaults: { submitPath: '/imagine', statusPath: '/tasks/{{taskId}}' },
      },
      {
        id: 'image.variations',
        label: '图片变体（外部网关）',
        input: { required: ['image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: midjourneyGatewayImageSchema,
        defaults: { submitPath: '/variations', statusPath: '/tasks/{{taskId}}' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/imagine',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', image_urls: '{{imageUrls}}' },
      response: { kind: 'task_poll', taskIdPaths: ['task_id', 'taskId', 'id'], statusEndpoint: '/tasks/{{taskId}}', resultPaths: ['data[].url', 'image_url', 'url'] },
      polling: { intervalMs: 5000, timeoutMs: 900000, statusMap: commonStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://docs.midjourney.com/',
        'https://www.midjourney.com/',
      ],
      lastCheckedAt: '2026-07-01',
    },
    safety: { maxPromptLength: 6000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
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
        label: '文生视频 / 多模态参考',
        // 多模态参考：文本 + 图片(0-9) + 视频(0-3) + 音频(0-3)
        input: { required: ['prompt'], maxImages: 9, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedanceVideoSchema,
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', generateAudio: true, watermark: true, returnLastFrame: false, seed: -1, serviceTier: '', searchEnabled: false },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame', serviceTier: 'service_tier', searchEnabled: 'enable_search' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频（首帧/首尾帧）',
        input: { required: ['prompt', 'image'], maxImages: 2, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedanceVideoSchema,
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', generateAudio: true, watermark: true, returnLastFrame: false, seed: -1, serviceTier: '' },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame', serviceTier: 'service_tier' },
      },
      {
        id: 'video.edit',
        label: '视频编辑',
        input: { required: ['prompt', 'video'], maxImages: 2, acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedanceVideoSchema,
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', generateAudio: true, watermark: true, returnLastFrame: false, seed: -1, serviceTier: '' },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame', serviceTier: 'service_tier' },
      },
      {
        id: 'video.extend',
        label: '视频延长',
        // 最多 3 段视频串联；可向前/向后延长。maxImages 复用为视频条数上限（adapter
        // 用 inputFiles.filter(video) 数量约束）；画布 UI 据此提示用户。
        input: { required: ['prompt', 'video'], maxImages: 3, acceptedMimeTypes: ['video/mp4'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedanceVideoSchema,
        defaults: { aspectRatio: '智能比例', durationSeconds: 8, resolution: '720p', generateAudio: true, watermark: true, returnLastFrame: false, seed: -1, serviceTier: '' },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame', serviceTier: 'service_tier' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      // 真实 API：POST /contents/generations/tasks，请求体为 model + content[]。
      // VolcengineArkMediaAdapter 构造 content[] 数组（type+role），requestTemplate
      // 不再生效（专用 adapter 优先于模板适配器），保留占位以维持 schema 完整性。
      endpoint: '/contents/generations/tasks',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', content: [] },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id', 'task_id', 'request_id'],
        statusEndpoint: '/contents/generations/tasks/{{taskId}}',
        resultPaths: ['content.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 8000, timeoutMs: 172_800_000, statusMap: commonStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://www.volcengine.com/docs/82379/2291680',
        'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0',
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
        label: '文生视频 / 多模态参考',
        input: { required: ['prompt'], maxImages: 9, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        // Fast 仅支持 480p/720p，覆盖 resolution enum。
        paramSchema: { ...volcengineSeedanceVideoSchema, properties: { ...volcengineSeedanceVideoSchema.properties, resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p'], default: '720p' } } },
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', generateAudio: true, watermark: true, returnLastFrame: false, seed: -1, serviceTier: '', searchEnabled: false },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame', serviceTier: 'service_tier', searchEnabled: 'enable_search' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频（首帧/首尾帧）',
        input: { required: ['prompt', 'image'], maxImages: 2, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: { ...volcengineSeedanceVideoSchema, properties: { ...volcengineSeedanceVideoSchema.properties, resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p'], default: '720p' } } },
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', generateAudio: true, watermark: true, returnLastFrame: false, seed: -1, serviceTier: '' },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame', serviceTier: 'service_tier' },
      },
      {
        id: 'video.edit',
        label: '视频编辑',
        input: { required: ['prompt', 'video'], maxImages: 2, acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: { ...volcengineSeedanceVideoSchema, properties: { ...volcengineSeedanceVideoSchema.properties, resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p'], default: '720p' } } },
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', generateAudio: true, watermark: true, returnLastFrame: false, seed: -1, serviceTier: '' },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame', serviceTier: 'service_tier' },
      },
      {
        id: 'video.extend',
        label: '视频延长',
        input: { required: ['prompt', 'video'], acceptedMimeTypes: ['video/mp4'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: { ...volcengineSeedanceVideoSchema, properties: { ...volcengineSeedanceVideoSchema.properties, resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p'], default: '720p' } } },
        defaults: { aspectRatio: '智能比例', durationSeconds: 8, resolution: '720p', generateAudio: true, watermark: true, returnLastFrame: false, seed: -1, serviceTier: '' },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame', serviceTier: 'service_tier' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/contents/generations/tasks',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', content: [] },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id', 'task_id', 'request_id'],
        statusEndpoint: '/contents/generations/tasks/{{taskId}}',
        resultPaths: ['content.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 8000, timeoutMs: 172_800_000, statusMap: commonStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://www.volcengine.com/docs/82379/2291680',
        'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0-fast',
        'https://seed.bytedance.com/zh/seedance2_0',
      ],
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'volcengine:doubao-seedance-2-0-mini-260615',
    providerKind: 'volcengine-ark',
    modelId: 'doubao-seedance-2-0-mini-260615',
    displayName: 'Doubao Seedance 2.0 Mini',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频 / 多模态参考',
        input: { required: ['prompt'], maxImages: 9, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: { ...volcengineSeedanceVideoSchema, properties: { ...volcengineSeedanceVideoSchema.properties, resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p'], default: '720p' } } },
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', generateAudio: true, watermark: true, returnLastFrame: false, seed: -1, serviceTier: '', searchEnabled: false },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame', serviceTier: 'service_tier', searchEnabled: 'enable_search' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频（首帧/首尾帧）',
        input: { required: ['prompt', 'image'], maxImages: 2, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: { ...volcengineSeedanceVideoSchema, properties: { ...volcengineSeedanceVideoSchema.properties, resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p'], default: '720p' } } },
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', generateAudio: true, watermark: true, returnLastFrame: false, seed: -1, serviceTier: '' },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame', serviceTier: 'service_tier' },
      },
      {
        id: 'video.edit',
        label: '视频编辑',
        input: { required: ['prompt', 'video'], maxImages: 2, acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: { ...volcengineSeedanceVideoSchema, properties: { ...volcengineSeedanceVideoSchema.properties, resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p'], default: '720p' } } },
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', generateAudio: true, watermark: true, returnLastFrame: false, seed: -1, serviceTier: '' },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame', serviceTier: 'service_tier' },
      },
      {
        id: 'video.extend',
        label: '视频延长',
        input: { required: ['prompt', 'video'], acceptedMimeTypes: ['video/mp4'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: { ...volcengineSeedanceVideoSchema, properties: { ...volcengineSeedanceVideoSchema.properties, resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p'], default: '720p' } } },
        defaults: { aspectRatio: '智能比例', durationSeconds: 8, resolution: '720p', generateAudio: true, watermark: true, returnLastFrame: false, seed: -1, serviceTier: '' },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame', serviceTier: 'service_tier' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/contents/generations/tasks',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', content: [] },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id', 'task_id', 'request_id'],
        statusEndpoint: '/contents/generations/tasks/{{taskId}}',
        resultPaths: ['content.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 8000, timeoutMs: 172_800_000, statusMap: commonStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://www.volcengine.com/docs/82379/2291680',
        'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0-mini',
      ],
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  /* ─── Seedance 1.5 / 1.0 系列 ─── */
  {
    id: 'volcengine:doubao-seedance-1-5-pro-251215',
    providerKind: 'volcengine-ark',
    modelId: 'doubao-seedance-1-5-pro-251215',
    displayName: 'Doubao Seedance 1.5 Pro',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'], maxImages: 4, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedance15ProVideoSchema,
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', generateAudio: false, watermark: false, returnLastFrame: false, seed: -1 },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频（首帧/首尾帧）',
        input: { required: ['prompt', 'image'], maxImages: 2, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedance15ProVideoSchema,
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', generateAudio: false, watermark: false, returnLastFrame: false, seed: -1 },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', generateAudio: 'generate_audio', returnLastFrame: 'return_last_frame' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/contents/generations/tasks',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', content: [] },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id', 'task_id', 'request_id'],
        statusEndpoint: '/contents/generations/tasks/{{taskId}}',
        resultPaths: ['content.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 8000, timeoutMs: 172_800_000, statusMap: commonStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://www.volcengine.com/docs/82379/1520757',
        'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-1-5-pro',
      ],
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'volcengine:doubao-seedance-1-0-pro-250528',
    providerKind: 'volcengine-ark',
    modelId: 'doubao-seedance-1-0-pro-250528',
    displayName: 'Doubao Seedance 1.0 Pro',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'], maxImages: 4, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedance10ProVideoSchema,
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '1080p', cameraFixed: false, watermark: false, returnLastFrame: false, seed: -1 },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', cameraFixed: 'camera_fixed', returnLastFrame: 'return_last_frame' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频（首帧/首尾帧）',
        input: { required: ['prompt', 'image'], maxImages: 2, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedance10ProVideoSchema,
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', cameraFixed: false, watermark: false, returnLastFrame: false, seed: -1 },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', cameraFixed: 'camera_fixed', returnLastFrame: 'return_last_frame' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/contents/generations/tasks',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', content: [] },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id', 'task_id', 'request_id'],
        statusEndpoint: '/contents/generations/tasks/{{taskId}}',
        resultPaths: ['content.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 8000, timeoutMs: 172_800_000, statusMap: commonStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://www.volcengine.com/docs/82379/1520757',
        'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-1-0-pro',
      ],
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'volcengine:doubao-seedance-1-0-pro-fast-251015',
    providerKind: 'volcengine-ark',
    modelId: 'doubao-seedance-1-0-pro-fast-251015',
    displayName: 'Doubao Seedance 1.0 Pro Fast',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'], maxImages: 4, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedance10ProVideoSchema,
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '1080p', cameraFixed: false, watermark: false, returnLastFrame: false, seed: -1 },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', cameraFixed: 'camera_fixed', returnLastFrame: 'return_last_frame' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频（首帧/首尾帧）',
        input: { required: ['prompt', 'image'], maxImages: 2, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: volcengineSeedance10ProVideoSchema,
        defaults: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p', cameraFixed: false, watermark: false, returnLastFrame: false, seed: -1 },
        aliases: { aspectRatio: 'ratio', durationSeconds: 'duration', cameraFixed: 'camera_fixed', returnLastFrame: 'return_last_frame' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/contents/generations/tasks',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', content: [] },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id', 'task_id', 'request_id'],
        statusEndpoint: '/contents/generations/tasks/{{taskId}}',
        resultPaths: ['content.video_url', 'data[].video_url', 'data[].url', 'data.video_url', 'output.video_url', 'output.url', 'video_url', 'url'],
      },
      polling: { intervalMs: 8000, timeoutMs: 172_800_000, statusMap: commonStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://www.volcengine.com/docs/82379/1520757',
        'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-1-0-pro-fast',
      ],
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'volcengine:doubao-seedream-4-0-250828',
    providerKind: 'volcengine-ark',
    modelId: 'doubao-seedream-4-0-250828',
    displayName: 'Doubao Seedream 4.0',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/jpeg'] },
        paramSchema: volcengineSeedream40ImageSchema,
        defaults: { size: '2K', outputFormat: 'jpeg', responseFormat: 'url', watermark: false, sequentialImageGeneration: 'disabled', promptOptimizationMode: 'standard' },
        aliases: { outputFormat: 'output_format', responseFormat: 'response_format', sequentialImageGeneration: 'sequential_image_generation', maxImages: 'max_images', promptOptimizationMode: 'prompt_optimization_mode' },
      },
      {
        id: 'image.edit',
        label: '图文生图 / 多图融合',
        input: { required: ['prompt', 'image'], maxImages: 15, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/jpeg'] },
        paramSchema: volcengineSeedream40ImageSchema,
        defaults: { size: '2K', outputFormat: 'jpeg', responseFormat: 'url', watermark: false, sequentialImageGeneration: 'disabled', promptOptimizationMode: 'standard' },
        aliases: { outputFormat: 'output_format', responseFormat: 'response_format', sequentialImageGeneration: 'sequential_image_generation', maxImages: 'max_images', promptOptimizationMode: 'prompt_optimization_mode' },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/images/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: { kind: 'inline_base64', jsonPaths: ['data[].url', 'data[].b64_json'] },
    },
    docs: {
      sourceUrls: [
        'https://www.volcengine.com/docs/82379/1541523',
        'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedream-4-0',
      ],
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'volcengine:doubao-seedream-4-5-251128',
    providerKind: 'volcengine-ark',
    modelId: 'doubao-seedream-4-5-251128',
    displayName: 'Doubao Seedream 4.5',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        // Seedream 4.5 文档明确仅 jpeg 输出。
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/jpeg'] },
        paramSchema: volcengineSeedream45ImageSchema,
        defaults: { size: '2K', outputFormat: 'jpeg', responseFormat: 'url', watermark: false, sequentialImageGeneration: 'disabled' },
        aliases: { outputFormat: 'output_format', responseFormat: 'response_format', sequentialImageGeneration: 'sequential_image_generation', maxImages: 'max_images' },
      },
      {
        id: 'image.edit',
        label: '图文生图 / 多图融合',
        // 单图（图文生图）或多图（多图融合）：image 字段单图为 string、多图为 string[]。
        input: { required: ['prompt', 'image'], maxImages: 15, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/jpeg'] },
        paramSchema: volcengineSeedream45ImageSchema,
        defaults: { size: '2K', outputFormat: 'jpeg', responseFormat: 'url', watermark: false, sequentialImageGeneration: 'disabled' },
        aliases: { outputFormat: 'output_format', responseFormat: 'response_format', sequentialImageGeneration: 'sequential_image_generation', maxImages: 'max_images' },
      },
    ],
    invocation: {
      mode: 'sync',
      // OpenAI 兼容：POST /images/generations。VolcengineArkMediaAdapter 组装
      // model/prompt/image/size/output_format/sequential_image_generation/tools 等。
      endpoint: '/images/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: { kind: 'inline_base64', jsonPaths: ['data[].url', 'data[].b64_json'] },
    },
    docs: {
      sourceUrls: [
        'https://www.volcengine.com/docs/82379/1541523',
        'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedream-4-5',
      ],
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  {
    id: 'volcengine:doubao-seedream-5-0-260128',
    providerKind: 'volcengine-ark',
    modelId: 'doubao-seedream-5-0-260128',
    // 该 model ID 是 Seedream 5.0 主模型；同时支持 lite 版本 doubao-seedream-5-0-lite-260128。
    displayName: 'Doubao Seedream 5.0',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg'] },
        paramSchema: volcengineSeedream5ImageSchema,
        defaults: { size: '2K', outputFormat: 'png', responseFormat: 'url', watermark: false, sequentialImageGeneration: 'disabled', searchEnabled: false },
        aliases: { outputFormat: 'output_format', responseFormat: 'response_format', sequentialImageGeneration: 'sequential_image_generation', maxImages: 'max_images', searchEnabled: 'enable_search' },
      },
      {
        id: 'image.edit',
        label: '图文生图 / 多图融合',
        input: { required: ['prompt', 'image'], maxImages: 15, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg'] },
        paramSchema: volcengineSeedream5ImageSchema,
        defaults: { size: '2K', outputFormat: 'png', responseFormat: 'url', watermark: false, sequentialImageGeneration: 'disabled' },
        aliases: { outputFormat: 'output_format', responseFormat: 'response_format', sequentialImageGeneration: 'sequential_image_generation', maxImages: 'max_images', searchEnabled: 'enable_search' },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/images/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: { kind: 'inline_base64', jsonPaths: ['data[].url', 'data[].b64_json'] },
    },
    docs: {
      sourceUrls: [
        'https://www.volcengine.com/docs/82379/1541523',
        'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedream-5-0',
      ],
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  ...[
    { id: 'kling:kling-video-3.0-omni', modelId: 'kling-video-3.0-omni', displayName: 'Kling 3.0 Omni', modes: ['standard', 'professional'], audio: true },
    { id: 'kling:kling-video-o1', modelId: 'kling-video-o1', displayName: 'Kling O1', modes: ['standard', 'professional'] },
    { id: 'kling:kling-v2.6-pro', modelId: 'kling-v2.6-pro', displayName: 'Kling 2.6 Pro', modes: ['standard', 'professional'], audio: true },
    { id: 'kling:kling-v2.6-std', modelId: 'kling-v2.6-std', displayName: 'Kling 2.6 Standard', modes: ['standard'], audio: true },
    { id: 'kling:kling-v2.5-turbo', modelId: 'kling-v2.5-turbo', displayName: 'Kling 2.5 Turbo', modes: [] },
  ].map((entry) => {
    const schema = {
      ...klingVideoSchema,
      properties: {
        ...klingVideoSchema.properties,
        ...(entry.modelId.includes('3.0')
          ? {
              durationSeconds: { type: 'integer', title: '时长', enum: [3, 5, 10, 15] },
              aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
            }
          : {}),
        ...(entry.modes.length > 0 ? { mode: { type: 'string', title: '模式', enum: entry.modes } } : {}),
        ...(entry.audio ? {} : { audio: { type: 'boolean', title: '生成音频', readOnly: true, default: false } }),
        ...(entry.modelId.includes('3.0') || entry.modelId.includes('omni')
          ? {
              motion_strength: { type: 'number', title: '运动强度', minimum: 0, maximum: 1 },
              camera_control: { type: 'string', title: '镜头控制' },
              multilingual_mix: { type: 'boolean', title: '多语言混合', default: false },
              native_text: { type: 'boolean', title: '原生文本', default: false },
            }
          : {}),
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
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', first_frame_image: '{{firstFrame}}', last_frame_image: '{{lastFrame}}', video: '{{video}}', reference_images: '{{referenceImages}}' },
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
]

export function mediaManifestCapabilities(manifest: Pick<MediaModelManifest, 'capabilities'>): string[] {
  return Array.from(new Set(manifest.capabilities.map((capability) => capability.id)))
}
