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
import type { MediaErrorContract, MediaModelParamPolicy } from './media-model-contract.js'
import { MediaErrorContractSchema, MediaModelParamPolicySchema } from './media-model-contract.js'
import { validateMediaModelManifestSemantics } from './media-model-manifest-validation.js'
import {
  apimartVideoCapabilityDefaults,
  apimartVideoInputContracts,
} from './apimart-video-input-contracts.js'
import {
  MediaInputRolePolicySchema,
  type MediaInputRolePolicy,
} from './media-config.js'
import { XAI_TTS_PARAM_SCHEMA, XAI_VIDEO_15_MANIFESTS } from './xai-media-model-manifests.js'
import { VOLCENGINE_ARK_MEDIA_MODEL_MANIFESTS } from './volcengine-ark-media-model-manifests.js'
import { BAILIAN_MEDIA_MODEL_MANIFESTS } from './bailian-media-model-manifests.js'
import {
  googleGenerativeAiErrorContract,
  googleImageParamPolicy,
  googleImageSchema,
  googleVeoVideoSchema,
  googleOmniVideoSchema,
  midjourneyGatewayImageSchema,
  bailianImageSchema,
  apimartSeedance2VideoSchema,
  klingVideoSchema,
  minimaxImageSchema,
  minimaxSpeechSchema,
  minimaxMusicSchema,
  minimaxHailuoVideoSchema,
  audioSpeechSchema,
  agnesImageSchema,
  agnesVideoSchema,
} from './media-model-shared-manifest-parts.js'

export type MediaDomain =
  | 'image'
  | 'audio'
  | 'video'
  | 'text'
  | 'document'
  | 'web'
  | 'slide'
  | 'sheet'

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

export type MediaManifestInputKind =
  | 'prompt'
  | 'image'
  | 'images'
  | 'video'
  | 'audio'
  | 'mask'
  | 'text'
  | 'file'
export type MediaManifestOutputKind = 'image' | 'video' | 'audio' | 'text' | 'file'
export type MediaInvocationMode =
  | 'sync'
  | 'async_polling'
  | 'async_callback'
  | 'stream'
  | 'file_job'
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
    maxVideos?: number | undefined
    maxAudios?: number | undefined
    acceptedMimeTypes?: string[] | undefined
  }
  /** 特殊模型可显式覆盖通用角色推断；画布本身不感知 provider。 */
  rolePolicy?: MediaInputRolePolicy | undefined
  output: {
    types: MediaManifestOutputKind[]
    mimeTypes?: string[] | undefined
  }
  /** JSON Schema object used by tools and canvas parameter panels. */
  paramSchema: Record<string, unknown>
  defaults?: Record<string, unknown> | undefined
  /** Normalized param name -> provider native field name. */
  aliases?: Record<string, string> | undefined
  /**
   * Contract V2 参数策略：是否严格、哪些字段允许透传、字段重命名/值映射/条件裁剪。
   * 缺省时 compiler 退回兼容模式（按 paramSchema.additionalProperties 推断）。
   */
  paramPolicy?: MediaModelParamPolicy | undefined
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
    polling?:
      | {
          intervalMs: number
          timeoutMs: number
          statusMap: Record<string, 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'>
          retry?: { maxAttempts: number; backoffMs: number } | undefined
        }
      | undefined
  }
  docs: {
    sourceUrls: string[]
    lastCheckedAt?: string | undefined
    docMcp?: { serverName: string; toolName: string } | undefined
  }
  safety?:
    | {
        /** Provider-documented reference threshold; never a local hard limit. */
        maxPromptLength?: number | undefined
        promptLengthUnit?: 'characters' | 'tokens' | 'provider_specific' | undefined
        /** What the provider documents doing after the reference threshold. */
        promptOverflowBehavior?: 'truncate' | 'reject' | 'unknown' | undefined
        allowLocalFiles?: boolean | undefined
        maxInputBytes?: number | undefined
      }
    | undefined
  /**
   * Contract V2 错误归一规则。声明 provider 错误响应中 code/message/requestId/
   * paramName 的 JSON 路径，以及 provider code -> 内部 code 的映射表。
   * 缺省时 fetchJson 退回 `errorExtractor` 或默认 HTTP 兜底。
   */
  error?: MediaErrorContract | undefined
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

export const MediaArtifactRetrievalSchema: z.ZodType<MediaArtifactRetrieval> = z.discriminatedUnion(
  'kind',
  [
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
  ],
)

export const MediaModelCapabilityManifestSchema: z.ZodType<MediaModelCapabilityManifest> = z.object(
  {
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(120),
    input: z.object({
      required: z
        .array(z.enum(['prompt', 'image', 'images', 'video', 'audio', 'mask', 'text', 'file']))
        .max(20),
      maxImages: z.number().int().min(1).max(64).optional(),
      maxVideos: z.number().int().min(1).max(16).optional(),
      maxAudios: z.number().int().min(1).max(16).optional(),
      acceptedMimeTypes: z.array(z.string().min(1).max(120)).max(100).optional(),
    }),
    rolePolicy: MediaInputRolePolicySchema.optional(),
    output: z.object({
      types: z
        .array(z.enum(['image', 'video', 'audio', 'text', 'file']))
        .min(1)
        .max(20),
      mimeTypes: z.array(z.string().min(1).max(120)).max(100).optional(),
    }),
    paramSchema: JsonObjectSchema,
    defaults: JsonObjectSchema.optional(),
    aliases: z.record(z.string().min(1).max(120)).optional(),
    paramPolicy: MediaModelParamPolicySchema.optional(),
  },
)

export const MediaModelManifestSchema: z.ZodType<MediaModelManifest> = z.object({
  id: z.string().min(1).max(160),
  providerKind: z.string().min(1).max(120),
  modelId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  version: z.string().min(1).max(80).optional(),
  domains: z
    .array(z.enum(['image', 'audio', 'video', 'text', 'document', 'web', 'slide', 'sheet']))
    .min(1)
    .max(20),
  capabilities: z.array(MediaModelCapabilityManifestSchema).min(1).max(50),
  invocation: z.object({
    mode: z.enum(['sync', 'async_polling', 'async_callback', 'stream', 'file_job']),
    endpoint: z.string().min(1).max(500),
    method: z.enum(['GET', 'POST']),
    contentType: z.enum(['json', 'multipart', 'binary']),
    headers: JsonObjectSchema.optional(),
    requestTemplate: JsonObjectSchema,
    response: MediaArtifactRetrievalSchema,
    polling: z
      .object({
        intervalMs: z.number().int().min(250).max(300_000),
        // 上限对齐火山方舟异步视频任务默认 48h（与 ProviderMediaDefaultsSchema 一致）。
        timeoutMs: z.number().int().min(1_000).max(172_800_000),
        statusMap: z.record(z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])),
        retry: z
          .object({
            maxAttempts: z.number().int().min(0).max(20),
            backoffMs: z.number().int().min(0).max(300_000),
          })
          .optional(),
      })
      .optional(),
  }),
  docs: z.object({
    sourceUrls: z.array(z.string().min(1).max(800)).max(50),
    lastCheckedAt: z.string().min(1).max(80).optional(),
    docMcp: z
      .object({
        serverName: z.string().min(1).max(120),
        toolName: z.string().min(1).max(120),
      })
      .optional(),
  }),
  safety: z
    .object({
      maxPromptLength: z.number().int().min(1).max(1_000_000).optional(),
      promptLengthUnit: z.enum(['characters', 'tokens', 'provider_specific']).optional(),
      promptOverflowBehavior: z.enum(['truncate', 'reject', 'unknown']).optional(),
      allowLocalFiles: z.boolean().optional(),
      maxInputBytes: z.number().int().min(1).optional(),
    })
    .optional(),
  error: MediaErrorContractSchema.optional(),
})

export const ProviderMediaModelRefSchema: z.ZodType<ProviderMediaModelRef> = z
  .object({
    manifestId: z.string().min(1).max(160),
    modelId: z.string().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    defaults: JsonObjectSchema.optional(),
    manifest: MediaModelManifestSchema.optional(),
  })
  .superRefine((ref, ctx) => {
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
      enum: [
        'auto',
        '1:1',
        '3:2',
        '2:3',
        '4:3',
        '3:4',
        '5:4',
        '4:5',
        '16:9',
        '9:16',
        '2:1',
        '1:2',
        '3:1',
        '1:3',
        '21:9',
        '9:21',
      ],
      default: '1:1',
    },
    resolution: { type: 'string', title: '分辨率', enum: ['1k', '2k', '4k'], default: '1k' },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 1, default: 1 },
    official_fallback: { type: 'boolean', title: '官方兜底', default: false },
  },
}

/**
 * APIMart GPT Image 2 Contract V2 参数策略。
 *
 * APIMart 是聚合平台，不同上游模型对参数支持差异较大。GPT Image 2 的原生画幅字段
 * 是 `size`（值为 2:1 / 16:9 等比例），不是像素尺寸，也不是 `aspect_ratio`。内部遗留的
 * aspectRatio / aspect_ratio 通过 capability alias 统一映射到 provider 的 `size`。
 *
 * 关键设计：`strict: true` + `passthrough.enabled: true` 的组合。strict=true 让未声明
 * 字段在编译期就被裁掉；passthrough.enabled=true + allow 列表给聚合平台留出**显式**
 * 透传少量字段的口子。未来若新增字段（如 style_preset），由 manifest 维护者显式加入
 * allow，不再回到全量透传。
 *
 * 参考：docs/multimedia-model-platform-adapters-design.md §APIMart 适配器
 */
const apimartGptImage2ParamPolicy: MediaModelParamPolicy = {
  strict: true,
  passthrough: {
    enabled: true,
    allow: ['aspectRatio', 'outputFormat'],
    allowScalarsOnly: true,
    deny: ['filename', 'image', 'images', 'prompt', 'mask', 'tools'],
  },
}

/**
 * APIMart 错误响应归一规则。APIMart 走 OpenAI 兼容风格，但 task polling
 * 端点错误结构包含 task 字段，与火山 task_poll 类似：
 *   { error: { code: 'invalid_request_error', message: '...' } }
 *   { status: 'FAILED', error: { message: '...' } }
 */
const apimartErrorContract: MediaErrorContract = {
  codePaths: ['error.code', 'error.type', 'status'],
  messagePaths: ['error.message', 'message'],
  requestIdPaths: ['request_id', 'task_id', 'id'],
  paramNamePaths: ['error.param'],
  paramNamePatterns: ['parameter[:\\s]+`?([a-z_]+)`?'],
  mappings: {
    invalid_request_error: 'invalid_parameter_value',
    invalid_api_key: 'auth_failed',
    rate_limit_exceeded: 'rate_limited',
    FAILED: 'task_failed',
  },
  retryableCodes: ['rate_limit_exceeded', 'service_unavailable'],
}

const apimartImageModelSchemas: Record<
  string,
  { schema: Record<string, unknown>; defaults: Record<string, unknown> }
> = {
  'wan2.7-image': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: {
          type: 'string',
          title: '画幅 / 尺寸',
          enum: ['1K', '2K', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
        },
        resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K'] },
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
        size: {
          type: 'string',
          title: '画幅',
          enum: ['1:1', '4:3', '3:4', '16:9', '9:16'],
          default: '16:9',
        },
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
        size: {
          type: 'string',
          title: '画幅',
          enum: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
          default: '1:1',
        },
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
        size: {
          type: 'string',
          title: '画幅',
          enum: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', 'auto'],
          default: '1:1',
        },
        resolution: { type: 'string', title: '分辨率', enum: ['2K', '3K', '4K'], default: '2K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 15, default: 1 },
        output_format: {
          type: 'string',
          title: '输出格式',
          enum: ['jpeg', 'png'],
          default: 'jpeg',
        },
        sequential_image_generation: {
          type: 'string',
          title: '连续生成',
          enum: ['disabled', 'auto'],
          default: 'disabled',
        },
        watermark: { type: 'boolean', title: '水印', default: false },
      },
    },
    defaults: {
      size: '1:1',
      resolution: '2K',
      n: 1,
      output_format: 'jpeg',
      sequential_image_generation: 'disabled',
      watermark: false,
    },
  },
  'gemini-3.1-flash-image-preview': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: {
          type: 'string',
          title: '画幅',
          enum: [
            'auto',
            '1:1',
            '3:2',
            '2:3',
            '4:3',
            '3:4',
            '16:9',
            '9:16',
            '5:4',
            '4:5',
            '21:9',
            '1:4',
            '4:1',
            '1:8',
            '8:1',
          ],
        },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['0.5K', '1K', '2K', '4K'],
          default: '1K',
        },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 1, default: 1 },
        google_search: { type: 'boolean', title: 'Google 搜索', default: false },
        google_image_search: { type: 'boolean', title: 'Google 图片搜索', default: false },
        official_fallback: { type: 'boolean', title: '官方兜底', default: false },
      },
    },
    defaults: {
      resolution: '1K',
      n: 1,
      google_search: false,
      google_image_search: false,
      official_fallback: false,
    },
  },
  'gemini-3-pro-image-preview': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: {
          type: 'string',
          title: '画幅',
          enum: ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
        },
        resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K', '4K'], default: '1K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 1, default: 1 },
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
        size: {
          type: 'string',
          title: '画幅',
          enum: ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
        },
        resolution: { type: 'string', title: '分辨率', enum: ['1K'], default: '1K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 1, default: 1 },
        mask_url: { type: 'string', title: '遮罩 URL' },
        official_fallback: { type: 'boolean', title: '官方兜底', default: false },
      },
    },
    defaults: { resolution: '1K', n: 1, official_fallback: false },
  },
  /* ─── GPT-Image-1 / GPT-Image-1.5（APIMart OpenAI 兼容聚合）：官方 model id `*-official` ─── */
  'gpt-image-1-official': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: { type: 'string', title: '画幅', enum: ['1:1', '2:3', '3:2'], default: '1:1' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 1 },
        quality: {
          type: 'string',
          title: '质量',
          enum: ['auto', 'low', 'medium', 'high'],
          default: 'auto',
        },
        background: {
          type: 'string',
          title: '背景',
          enum: ['auto', 'opaque', 'transparent'],
          default: 'auto',
        },
        moderation: { type: 'string', title: '审核', enum: ['auto', 'low'], default: 'auto' },
        output_format: { type: 'string', title: '输出格式', enum: ['png', 'jpeg'], default: 'png' },
        output_compression: { type: 'integer', title: '压缩率', minimum: 0, maximum: 100 },
      },
    },
    defaults: {
      size: '1:1',
      n: 1,
      quality: 'auto',
      background: 'auto',
      moderation: 'auto',
      output_format: 'png',
    },
  },
  'gpt-image-1.5-official': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: { type: 'string', title: '画幅', enum: ['1:1', '2:3', '3:2'], default: '1:1' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 1 },
        quality: {
          type: 'string',
          title: '质量',
          enum: ['auto', 'low', 'medium', 'high'],
          default: 'auto',
        },
        background: {
          type: 'string',
          title: '背景',
          enum: ['auto', 'opaque', 'transparent'],
          default: 'auto',
        },
        moderation: { type: 'string', title: '审核', enum: ['auto', 'low'], default: 'auto' },
        output_format: { type: 'string', title: '输出格式', enum: ['png', 'jpeg'], default: 'png' },
        output_compression: { type: 'integer', title: '压缩率', minimum: 0, maximum: 100 },
      },
    },
    defaults: {
      size: '1:1',
      n: 1,
      quality: 'auto',
      background: 'auto',
      moderation: 'auto',
      output_format: 'png',
    },
  },
  /* ─── Seedream-4.0 / 4.5 / 5.0-Pro（APIMart 聚合，model id 与火山不同）─── */
  'doubao-seedream-4-0': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: {
          type: 'string',
          title: '画幅',
          enum: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'],
          default: '1:1',
        },
        resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K', '4K'], default: '2K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 15, default: 1 },
        optimize_prompt_options: {
          type: 'string',
          title: '提示词优化',
          enum: ['standard', 'fast'],
          default: 'standard',
        },
        sequential_image_generation: {
          type: 'string',
          title: '连续生成',
          enum: ['disabled', 'auto'],
          default: 'disabled',
        },
        watermark: { type: 'boolean', title: '水印', default: false },
      },
    },
    defaults: {
      size: '1:1',
      resolution: '2K',
      n: 1,
      optimize_prompt_options: 'standard',
      sequential_image_generation: 'disabled',
      watermark: false,
    },
  },
  'doubao-seedream-4-5': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: {
          type: 'string',
          title: '画幅',
          enum: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'],
          default: '1:1',
        },
        resolution: { type: 'string', title: '分辨率', enum: ['2K', '4K'], default: '2K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 15, default: 1 },
        optimize_prompt_options: {
          type: 'string',
          title: '提示词优化',
          enum: ['standard', 'fast'],
          default: 'standard',
        },
        sequential_image_generation: {
          type: 'string',
          title: '连续生成',
          enum: ['disabled', 'auto'],
          default: 'disabled',
        },
        watermark: { type: 'boolean', title: '水印', default: false },
      },
    },
    defaults: {
      size: '1:1',
      resolution: '2K',
      n: 1,
      optimize_prompt_options: 'standard',
      sequential_image_generation: 'disabled',
      watermark: false,
    },
  },
  'doubao-seedream-5-0-pro': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: {
          type: 'string',
          title: '画幅',
          enum: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', 'auto'],
          default: '1:1',
        },
        resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K'], default: '2K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 1, default: 1 },
        output_format: {
          type: 'string',
          title: '输出格式',
          enum: ['jpeg', 'png'],
          default: 'jpeg',
        },
        watermark: { type: 'boolean', title: '水印', default: false },
      },
    },
    defaults: { size: '1:1', resolution: '2K', n: 1, output_format: 'jpeg', watermark: false },
  },
  /* ─── Z-Image-Turbo（APIMart 自托管轻量模型）─── */
  'z-image-turbo': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: {
          type: 'string',
          title: '画幅',
          enum: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
          default: '1:1',
        },
        resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K'], default: '1K' },
        prompt_extend: { type: 'boolean', title: '提示词扩展', default: false },
      },
    },
    defaults: { size: '1:1', resolution: '1K', prompt_extend: false },
  },
  /* ─── Qwen Image 2.0 Pro（APIMart 平台增强文本渲染）─── */
  'qwen-image-2.0-pro': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: {
          type: 'string',
          title: '画幅',
          enum: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
          default: '1:1',
        },
        resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K'], default: '1K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 6, default: 1 },
        negative_prompt: { type: 'string', title: '负面提示词', maxLength: 500 },
      },
    },
    defaults: { size: '1:1', resolution: '1K', n: 1 },
  },
  /* ─── Grok Imagine 1.5 图片（APIMart 平台转售 xAI 模型）─── */
  'grok-imagine-1.5-apimart': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: {
          type: 'string',
          title: '画幅',
          enum: ['1:1', '16:9', '9:16', '3:2', '2:3'],
          default: '1:1',
        },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 10, default: 1 },
      },
    },
    defaults: { size: '1:1', n: 1 },
  },
  /* ─── Nano Banana 官方版本别名（直接走 OpenAI 兼容模型 id）─── */
  'gemini-2.5-flash-image-preview-official': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: {
          type: 'string',
          title: '画幅',
          enum: ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
        },
        resolution: { type: 'string', title: '分辨率', enum: ['1K'], default: '1K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 1, default: 1 },
        image_urls: {
          type: 'array',
          items: { type: 'string' },
          title: '参考图 URL 列表',
          maxItems: 14,
        },
      },
    },
    defaults: { resolution: '1K', n: 1 },
  },
  'gemini-3-pro-image-preview-official': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: {
          type: 'string',
          title: '画幅',
          enum: ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
        },
        resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K', '4K'], default: '1K' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 1, default: 1 },
        image_urls: {
          type: 'array',
          items: { type: 'string' },
          title: '参考图 URL 列表',
          maxItems: 14,
        },
      },
    },
    defaults: { resolution: '1K', n: 1 },
  },
  'gemini-3.1-flash-image-preview-official': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: {
          type: 'string',
          title: '画幅',
          enum: [
            'auto',
            '1:1',
            '3:2',
            '2:3',
            '4:3',
            '3:4',
            '16:9',
            '9:16',
            '5:4',
            '4:5',
            '21:9',
            '1:4',
            '4:1',
            '1:8',
            '8:1',
          ],
        },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['0.5K', '1K', '2K', '4K'],
          default: '1K',
        },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 1, default: 1 },
        image_urls: {
          type: 'array',
          items: { type: 'string' },
          title: '参考图 URL 列表',
          maxItems: 14,
        },
      },
    },
    defaults: { resolution: '1K', n: 1 },
  },
}

/**
 * APIMart 视频模型参数 schema 映射。
 *
 * 与 apimartImageModelSchemas 同样按 model id 分键；adapter 走 OpenAiCompatibleMediaAdapter，
 * 模型差异由 manifest 通过 paramSchema + aliases 显式声明，避免硬编码到 adapter。
 * 大多数模型复用统一的 videoSchema（aspect_ratio / duration / seed / quality 等），
 * 必要时（如 Kling Omni / SkyReels Omni）暴露特有字段。
 */
const apimartVideoModelSchemas: Record<
  string,
  { schema: Record<string, unknown>; defaults: Record<string, unknown> }
> = {
  /* ─── Sora 2 / Sora 2 Pro（APIMart：aspect_ratio 仅 16:9/9:16；无 resolution；
         sora-2 时长 10/15s，sora-2-pro 时长 15/25s；支持 watermark）─── */
  'sora-2': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16'], default: '16:9' },
        durationSeconds: { type: 'integer', title: '时长（秒）', enum: [4, 8, 12, 16, 20], default: 4 },
        resolution: { type: 'string', title: '分辨率', enum: ['720p'], default: '720p' },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 4, resolution: '720p' },
  },
  'sora-2-pro': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16'], default: '16:9' },
        durationSeconds: { type: 'integer', title: '时长（秒）', enum: [4, 8, 12, 16, 20], default: 4 },
        resolution: { type: 'string', title: '分辨率', enum: ['720p', '1024p', '1080p'], default: '720p' },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 4, resolution: '720p' },
  },
  /* ─── Doubao Seedance 系列（APIMart 平台独立 model id，与火山方舟同名但走 apimart 路径）─── */
  'doubao-seedance-1-5-pro': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 4, maximum: 12, default: 5 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['480p', '720p', '1080p'],
          default: '720p',
        },
        seed: { type: 'integer', title: '随机种子' },
        audio: { type: 'boolean', title: '生成音频', default: true },
        camerafixed: { type: 'boolean', title: '固定摄像头', default: false },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 5, resolution: '720p', audio: true, camerafixed: false },
  },
  'doubao-seedance-1-0-pro-fast': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 2, maximum: 12, default: 5 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['480p', '720p', '1080p'],
          default: '1080p',
        },
        seed: { type: 'integer', title: '随机种子' },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 5, resolution: '1080p' },
  },
  'doubao-seedance-1-0-pro-quality': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 2, maximum: 12, default: 5 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['480p', '720p', '1080p'],
          default: '1080p',
        },
        seed: { type: 'integer', title: '随机种子' },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 5, resolution: '1080p' },
  },
  /* ─── VEO 3.x 系列（APIMart 走 veo3.1-fast / -quality / -lite）─── */
  'veo3.1-fast': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16'] },
        durationSeconds: { type: 'integer', title: '时长', enum: [8], default: 8 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['720p', '1080p', '4k'],
          default: '720p',
        },
        enable_gif: { type: 'boolean', title: '启用 GIF', default: false },
        official_fallback: { type: 'boolean', title: '官方兜底', default: false },
      },
    },
    defaults: {
      durationSeconds: 8,
      resolution: '720p',
      enable_gif: false,
      official_fallback: false,
    },
  },
  'veo3.1-quality': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16'] },
        durationSeconds: { type: 'integer', title: '时长', enum: [8], default: 8 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['720p', '1080p', '4k'],
          default: '720p',
        },
        enable_gif: { type: 'boolean', title: '启用 GIF', default: false },
        official_fallback: { type: 'boolean', title: '官方兜底', default: false },
      },
    },
    defaults: {
      durationSeconds: 8,
      resolution: '720p',
      enable_gif: false,
      official_fallback: false,
    },
  },
  'veo3.1-lite': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16'] },
        durationSeconds: { type: 'integer', title: '时长', enum: [8], default: 8 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['720p', '1080p', '4k'],
          default: '720p',
        },
        enable_gif: { type: 'boolean', title: '启用 GIF', default: false },
      },
    },
    defaults: { durationSeconds: 8, resolution: '720p', enable_gif: false },
  },
  /* ─── MiniMax Hailuo 2.3 / Fast / Hailuo-02（APIMart 平台独立 slug）─── */
  'MiniMax-Hailuo-2.3': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        durationSeconds: { type: 'integer', title: '时长', enum: [6, 10], default: 6 },
        resolution: { type: 'string', title: '分辨率', enum: ['768p', '1080p'], default: '768p' },
        prompt_optimizer: { type: 'boolean', title: '提示词优化', default: true },
        fast_pretreatment: { type: 'boolean', title: '快速预处理', default: false },
        watermark: { type: 'boolean', title: '水印', default: false },
        useFirstFrame: { type: 'boolean', title: '使用首帧', default: true },
      },
    },
    defaults: {
      durationSeconds: 6,
      resolution: '768p',
      prompt_optimizer: true,
      fast_pretreatment: false,
      watermark: false,
      useFirstFrame: true,
    },
  },
  'MiniMax-Hailuo-02': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        durationSeconds: { type: 'integer', title: '时长', enum: [5, 10], default: 5 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['512p', '768p', '1080p'],
          default: '768p',
        },
        prompt_optimizer: { type: 'boolean', title: '提示词优化', default: true },
        fast_pretreatment: { type: 'boolean', title: '快速预处理', default: false },
        watermark: { type: 'boolean', title: '水印', default: false },
      },
    },
    defaults: {
      durationSeconds: 5,
      resolution: '768p',
      prompt_optimizer: true,
      fast_pretreatment: false,
      watermark: false,
    },
  },
  /* ─── SkyReels V4 fast / std ─── */
  'skyreels-v4-fast': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '4:3', '1:1', '9:16', '3:4'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 15, default: 5 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['480p', '720p', '1080p'],
          default: '1080p',
        },
        prompt_optimizer: { type: 'boolean', title: '提示词优化', default: true },
      },
    },
    defaults: {
      aspectRatio: '16:9',
      durationSeconds: 5,
      resolution: '1080p',
      prompt_optimizer: true,
    },
  },
  'skyreels-v4-std': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '4:3', '1:1', '9:16', '3:4'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 15, default: 5 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['480p', '720p', '1080p'],
          default: '1080p',
        },
        prompt_optimizer: { type: 'boolean', title: '提示词优化', default: true },
      },
    },
    defaults: {
      aspectRatio: '16:9',
      durationSeconds: 5,
      resolution: '1080p',
      prompt_optimizer: true,
    },
  },
  /* ─── HappyHorse 1.0 / 1.1（APIMart 统一入口，T2V/I2V/R2V 自适应）─── */
  'happyhorse-1.0': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 15, default: 5 },
        resolution: { type: 'string', title: '分辨率', enum: ['720P', '1080P'], default: '1080P' },
        watermark: { type: 'boolean', title: '水印', default: false },
        seed: { type: 'integer', title: '随机种子', minimum: 0, maximum: 2147483647 },
        audio_setting: {
          type: 'string',
          title: '声音设置',
          enum: ['auto', 'origin'],
          default: 'auto',
        },
      },
    },
    defaults: {
      aspectRatio: '16:9',
      durationSeconds: 5,
      resolution: '1080P',
      watermark: false,
      audio_setting: 'auto',
    },
  },
  'happyhorse-1.1': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 15, default: 5 },
        resolution: { type: 'string', title: '分辨率', enum: ['720P', '1080P'], default: '1080P' },
        watermark: { type: 'boolean', title: '水印', default: false },
        seed: { type: 'integer', title: '随机种子', minimum: 0, maximum: 2147483647 },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 5, resolution: '1080P', watermark: false },
  },
  /* ─── Wan 2.5/2.6/2.7 全系（APIMart 统一入口）─── */
  'wan2.5-preview': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', enum: [5, 10], default: 5 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['480p', '720p', '1080p'],
          default: '720p',
        },
        seed: { type: 'integer', title: '随机种子' },
        prompt_extend: { type: 'boolean', title: '提示词扩展', default: true },
        audio: { type: 'boolean', title: '生成音频', enum: [true], default: true },
        watermark: { type: 'boolean', title: '水印', default: false },
      },
    },
    defaults: {
      aspectRatio: '16:9',
      durationSeconds: 5,
      resolution: '720p',
      prompt_extend: true,
      audio: true,
      watermark: false,
    },
  },
  'wan2.6': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', enum: [5, 10, 15], default: 5 },
        resolution: { type: 'string', title: '分辨率', enum: ['720p', '1080p'], default: '720p' },
        seed: { type: 'integer', title: '随机种子' },
        prompt_extend: { type: 'boolean', title: '提示词扩展' },
        audio: { type: 'boolean', title: '生成音频' },
        watermark: { type: 'boolean', title: '水印' },
        template: { type: 'string', title: '特效模板' },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 5, resolution: '720p' },
  },
  'wan2.7': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 2, maximum: 15, default: 5 },
        resolution: { type: 'string', title: '分辨率', enum: ['720P', '1080P'], default: '1080P' },
        prompt_extend: { type: 'boolean', title: '提示词扩展', default: true },
        watermark: { type: 'boolean', title: '水印', default: false },
        seed: { type: 'integer', title: '随机种子' },
        negative_prompt: { type: 'string', title: '负面提示词', maxLength: 500 },
      },
    },
    defaults: {
      aspectRatio: '16:9',
      durationSeconds: 5,
      resolution: '1080P',
      prompt_extend: true,
      watermark: false,
    },
  },
  'wan2.7-r2v': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 2, maximum: 15, default: 5 },
        resolution: { type: 'string', title: '分辨率', enum: ['720P', '1080P'], default: '1080P' },
        prompt_extend: { type: 'boolean', title: '提示词扩展', default: true },
        watermark: { type: 'boolean', title: '水印', default: false },
        seed: { type: 'integer', title: '随机种子' },
        negative_prompt: { type: 'string', title: '负面提示词', maxLength: 500 },
      },
    },
    defaults: {
      aspectRatio: '16:9',
      durationSeconds: 5,
      resolution: '1080P',
      prompt_extend: true,
      watermark: false,
    },
  },
  'wan2.7-videoedit': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
        durationSeconds: { type: 'integer', title: '时长', minimum: 0, maximum: 10, default: 0 },
        resolution: { type: 'string', title: '分辨率', enum: ['720P', '1080P'], default: '1080P' },
        prompt_extend: { type: 'boolean', title: '提示词扩展', default: true },
        watermark: { type: 'boolean', title: '水印', default: false },
        seed: { type: 'integer', title: '随机种子' },
        audio_setting: {
          type: 'string',
          title: '声音设置',
          enum: ['auto', 'origin'],
          default: 'auto',
        },
      },
    },
    defaults: {
      durationSeconds: 0,
      resolution: '1080P',
      prompt_extend: true,
      watermark: false,
      audio_setting: 'auto',
    },
  },
  /* ─── Kling 系列（APIMart 平台独立 model id）─── */
  'kling-v2-6': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', enum: [5, 10], default: 5 },
        mode: { type: 'string', title: '模式', enum: ['std', 'pro'], default: 'std' },
        negative_prompt: { type: 'string', title: '负面提示词' },
        audio: { type: 'boolean', title: '生成音频', default: false },
        watermark: { type: 'boolean', title: '水印', default: false },
      },
    },
    defaults: {
      aspectRatio: '16:9',
      durationSeconds: 5,
      mode: 'std',
      audio: false,
      watermark: false,
    },
  },
  'kling-v3': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 15, default: 5 },
        mode: { type: 'string', title: '模式', enum: ['std', 'pro', '4k'], default: 'std' },
        negative_prompt: { type: 'string', title: '负面提示词' },
        audio: { type: 'boolean', title: '生成音频', default: false },
        watermark: { type: 'boolean', title: '水印', default: false },
      },
    },
    defaults: {
      aspectRatio: '16:9',
      durationSeconds: 5,
      mode: 'std',
      audio: false,
      watermark: false,
    },
  },
  'kling-v3-omni': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 15, default: 5 },
        mode: { type: 'string', title: '模式', enum: ['std', 'pro', '4k'], default: 'std' },
        negative_prompt: { type: 'string', title: '负面提示词', maxLength: 2500 },
        audio: { type: 'boolean', title: '生成音频', default: false },
        watermark: { type: 'boolean', title: '水印', default: false },
        multi_shot: { type: 'boolean', title: '多镜头', default: false },
        shot_type: { type: 'string', title: '镜头类型', enum: ['customize', 'intelligence'] },
      },
    },
    defaults: {
      aspectRatio: '16:9',
      durationSeconds: 5,
      mode: 'std',
      audio: false,
      watermark: false,
      multi_shot: false,
    },
  },
  'kling-3.0-turbo': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 15, default: 5 },
        resolution: { type: 'string', title: '分辨率', enum: ['720p', '1080p'], default: '720p' },
        watermark: { type: 'boolean', title: '水印', default: false },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 5, resolution: '720p', watermark: false },
  },
  'kling-video-o1': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', enum: [5, 10], default: 5 },
        mode: { type: 'string', title: '模式', enum: ['std', 'pro'], default: 'std' },
        watermark: { type: 'boolean', title: '水印', default: false },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 5, mode: 'std', watermark: false },
  },
  /* ─── Vidu Q3 全系（APIMart 平台独立 model id）─── */
  'viduq3-pro': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16', '4:3', '3:4', '1:1'] },
        durationSeconds: { type: 'integer', title: '时长', minimum: 1, maximum: 16, default: 5 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['540p', '720p', '1080p'],
          default: '720p',
        },
        audio: { type: 'boolean', title: '生成音频', default: true },
        seed: { type: 'integer', title: '随机种子' },
      },
    },
    defaults: { durationSeconds: 5, resolution: '720p', audio: true },
  },
  'viduq3-turbo': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16', '4:3', '3:4', '1:1'] },
        durationSeconds: { type: 'integer', title: '时长', minimum: 1, maximum: 16, default: 5 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['540p', '720p', '1080p'],
          default: '720p',
        },
        audio: { type: 'boolean', title: '生成音频', default: true },
        seed: { type: 'integer', title: '随机种子' },
      },
    },
    defaults: { durationSeconds: 5, resolution: '720p', audio: true },
  },
  viduq3: {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '4:3', '3:4', '1:1'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 16, default: 5 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['540p', '720p', '1080p'],
          default: '720p',
        },
        seed: { type: 'integer', title: '随机种子' },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 5, resolution: '720p' },
  },
  'viduq3-mix': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '4:3', '3:4', '1:1'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 1, maximum: 16, default: 5 },
        resolution: { type: 'string', title: '分辨率', enum: ['720p', '1080p'], default: '720p' },
        seed: { type: 'integer', title: '随机种子' },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 5, resolution: '720p' },
  },
  /* ─── Grok Imagine 1.5 视频（APIMart 平台转售 xAI）─── */
  'grok-imagine-1.5-video-apimart': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1', '3:2', '2:3'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 6, maximum: 30, default: 6 },
        quality: { type: 'string', title: '分辨率', enum: ['480p', '720p'], default: '480p' },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 6, quality: '480p' },
  },
  /* ─── Pixverse v6（APIMart 平台独立 model id）─── */
  'pixverse-v6': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 1, maximum: 15, default: 5 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['360p', '540p', '720p', '1080p'],
          default: '540p',
        },
        seed: { type: 'integer', title: '随机种子' },
        negative_prompt: { type: 'string', title: '负面提示词', maxLength: 2048 },
        audio: { type: 'boolean', title: '生成音频', default: false },
        watermark: { type: 'boolean', title: '水印', default: false },
        motion_mode: { type: 'string', title: '运动模式', enum: ['normal'], default: 'normal' },
      },
    },
    defaults: {
      aspectRatio: '16:9',
      durationSeconds: 5,
      resolution: '540p',
      audio: false,
      watermark: false,
      motion_mode: 'normal',
    },
  },
  /* ─── Gemini Omni Flash Preview（APIMart 平台独立 model id）─── */
  'gemini-omni-flash-preview': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16'], default: '16:9' },
        resolution: { type: 'string', title: '分辨率', enum: ['720p'], default: '720p' },
        extend_from_task_id: { type: 'string', title: '续拍任务 ID' },
      },
    },
    defaults: { aspectRatio: '16:9', resolution: '720p' },
  },
  /* ─── Omni-Flash-Ext（APIMart 平台独立 model id）─── */
  'Omni-Flash-Ext': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16'], default: '16:9' },
        durationSeconds: { type: 'integer', title: '时长', enum: [4, 6, 8, 10], default: 6 },
        resolution: {
          type: 'string',
          title: '分辨率',
          enum: ['720p', '1080p', '4k'],
          default: '720p',
        },
        generation_type: { type: 'string', title: '生成类型', enum: ['frame', 'reference'] },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 6, resolution: '720p' },
  },
  /* ─── Doubao Seedance 2.0 Fast / Mini（APIMart 平台独立 model id，区别于火山方舟同名）─── */
  'doubao-seedance-2-0-fast': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 4, maximum: 15, default: 5 },
        resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p'], default: '720p' },
        seed: { type: 'integer', title: '随机种子' },
        generate_audio: { type: 'boolean', title: '生成音频', default: true },
        return_last_frame: { type: 'boolean', title: '返回尾帧', default: false },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 5, resolution: '720p', generate_audio: true, return_last_frame: false },
  },
  'doubao-seedance-2-0-mini': {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: {
          type: 'string',
          title: '比例',
          enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
          default: '16:9',
        },
        durationSeconds: { type: 'integer', title: '时长', minimum: 4, maximum: 15, default: 5 },
        resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p'], default: '720p' },
        seed: { type: 'integer', title: '随机种子' },
        generate_audio: { type: 'boolean', title: '生成音频', default: true },
        return_last_frame: { type: 'boolean', title: '返回尾帧', default: false },
      },
    },
    defaults: { aspectRatio: '16:9', durationSeconds: 5, resolution: '720p', generate_audio: true, return_last_frame: false },
  },
}

/** APIMart 视频模型中，画面比例字段在 provider 侧为 `size`（非默认 `aspect_ratio`）的 modelId 集合。
 *  通过 aliases per-model 覆盖：UI 统一的 aspectRatio 在适配器层转成 provider 要的 `size`（其余仍转 `aspect_ratio`）。
 *  依据各模型 APIMart 官方文档请求参数表。wan2.6 例外用 aspect_ratio，故不在集合内。 */
const apimartVideoSizeFieldModels = new Set([
  'happyhorse-1.0',
  'happyhorse-1.1',
  'pixverse-v6',
  'grok-imagine-1.5-video-apimart',
  'wan2.5-preview',
  'wan2.7',
  'wan2.7-r2v',
  'wan2.7-videoedit',
  'doubao-seedance-2.0',
  'doubao-seedance-2-0-fast',
  'doubao-seedance-2-0-mini',
])

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
  additionalProperties: false,
  properties: {
    aspectRatio: {
      type: 'string',
      title: '比例',
      enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
    },
    durationSeconds: { type: 'integer', title: '时长', minimum: 1, maximum: 15, default: 8 },
    resolution: { type: 'string', title: '分辨率', enum: ['480p', '720p'], default: '720p' },
    user: { type: 'string', title: '用户标识' },
  },
}

const xaiVideoReferenceSchema = {
  ...xaiVideoSchema,
  properties: {
    ...xaiVideoSchema.properties,
    durationSeconds: { type: 'integer', title: '时长', minimum: 1, maximum: 10, default: 8 },
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
 * 官方明确：扩展（/videos/extensions）duration 范围 [2, 10] 秒，默认 6 秒；
 * 从输入视频最后一帧续拍，不支持 aspect_ratio / resolution（继承输入视频）。
 */
const xaiVideoExtendSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    durationSeconds: { type: 'integer', title: '扩展时长', minimum: 2, maximum: 10, default: 6 },
    user: { type: 'string', title: '用户标识' },
  },
}

const xaiImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: {
      type: 'string',
      title: '比例',
      enum: [
        '1:1',
        '3:4',
        '4:3',
        '9:16',
        '16:9',
        '2:3',
        '3:2',
        '9:19.5',
        '19.5:9',
        '9:20',
        '20:9',
        '1:2',
        '2:1',
        'auto',
      ],
    },
    resolution: { type: 'string', title: '分辨率', enum: ['1k', '2k'] },
    n: { type: 'integer', title: '数量', minimum: 1, default: 1 },
    responseFormat: {
      type: 'string',
      title: '响应格式',
      enum: ['url', 'b64_json'],
      default: 'url',
    },
    user: { type: 'string', title: '用户标识' },
  },
}

/**
 * xAI Grok Imagine 图片 manifest 共享的 Contract V2 参数策略。
 *
 * 设计目标（参考 docs/multimedia-model-platform-adapters-design.md §xAI 适配器）：
 *   - xAI /images/generations 不接受 `size` 字段（OpenAI 兼容路径下的常见迁移误传）。
 *     旧 XaiMediaAdapter 在 `extraAllowed` 黑名单里硬编码排除 size；M5 把这一规则
 *     上提到 contract，让所有调用方（adapter / canvas / MCP）共享同一份策略。
 *   - 比例形式的 size（如 "16:9"）先转成 aspectRatio，再走 capability.alias 映射到
 *     provider 原生字段 `aspect_ratio`。非比例形式（如 "1024x1024"）会被 forbidden
 *     丢弃，并产 `forbidden_by_contract` dropped 记录，便于任务详情提示。
 *   - n / responseFormat 等仍由 schema + defaults 处理；filename 由编译器内建 local_only
 *     拦截，不在 contract 中重复声明。
 *   - strict + passthrough.enabled=false：让未知字段在编译期就被裁掉，避免
 *     "provider 400 后才发现" 的高成本反馈。
 */
const xaiImageParamPolicy: MediaModelParamPolicy = {
  strict: true,
  passthrough: { enabled: false },
  transforms: [{ kind: 'ratio_size_to_aspect', from: 'size', to: 'aspectRatio' }],
  // `aliases.size` 仅用于满足 `validateMediaModelManifestSemantics` 的「forbidden 字段必须
  // 在 schema/aliases 中声明」防呆约束（见 maintenance guide §7.4）；运行时由 transforms
  //（比例形式转 aspectRatio）+ forbidden（剩余非比例形式裁掉）处理，不会真正透传 size。
  aliases: { size: 'size' },
  forbidden: [
    // 比例形式已被 transform 转走；这里禁止的语义是"任何剩余的 size 值"（如 "1024x1024"）。
    {
      name: 'size',
      reason: 'xAI /images/generations 仅接受 aspect_ratio；非比例 size 会被 provider 400 拒绝。',
    },
  ],
}

/**
 * xAI 错误响应归一规则。xAI 走 OpenAI 兼容风格，错误结构形如：
 *   { error: { type: 'invalid_request_error', message: '...', param: '...', code: '...' } }
 * 与火山引擎的 InvalidParameter 不同，xAI 的错误 code 多为 'invalid_request_error'
 * 这类语义偏弱的 type，所以 paramName 由 error.param 直接提取，再靠 message
 * 关键词兜底（media-error-normalizer 内置 'parameter `xxx`' / '"xxx" is not supported'）。
 */
const xaiErrorContract: MediaErrorContract = {
  codePaths: ['error.code', 'error.type'],
  messagePaths: ['error.message'],
  paramNamePaths: ['error.param'],
  paramNamePatterns: ['parameter[:\\s]+`?([a-z_]+)`?'],
  mappings: {
    invalid_api_key: 'auth_failed',
    invalid_request_error: 'invalid_parameter_value',
    rate_limit_exceeded: 'rate_limited',
    unsupported_parameter: 'unsupported_parameter',
  },
  retryableCodes: ['rate_limit_exceeded', 'service_unavailable'],
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
    id: 'agnes:agnes-image-2.0-flash',
    providerKind: 'agnes',
    modelId: 'agnes-image-2.0-flash',
    displayName: 'Agnes Image 2.0 Flash',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: agnesImageSchema,
        defaults: { size: '1024x1024', responseFormat: 'url', returnBase64: false },
      },
      {
        id: 'image.edit',
        label: '图生图 / 多图合成',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 8,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: agnesImageSchema,
        defaults: { size: '1024x1024', responseFormat: 'url', returnBase64: false },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/images/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', size: '{{size}}' },
      response: { kind: 'url', jsonPaths: ['data[].url', 'data[].b64_json'], download: true },
    },
    docs: {
      sourceUrls: ['https://agnes-ai.com/zh-Hans/docs/overview'],
      lastCheckedAt: '2026-07-02',
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
  },
  {
    id: 'agnes:agnes-image-2.1-flash',
    providerKind: 'agnes',
    modelId: 'agnes-image-2.1-flash',
    displayName: 'Agnes Image 2.1 Flash',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: agnesImageSchema,
        defaults: { size: '1024x1024', responseFormat: 'url', returnBase64: false },
      },
      {
        id: 'image.edit',
        label: '图生图 / 多图合成',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 9,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: agnesImageSchema,
        defaults: { size: '1024x1024', responseFormat: 'url', returnBase64: false },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/images/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', size: '{{size}}' },
      response: { kind: 'url', jsonPaths: ['data[].url', 'data[].b64_json'], download: true },
    },
    docs: {
      sourceUrls: ['https://agnes-ai.com/zh-Hans/docs/overview'],
      lastCheckedAt: '2026-07-02',
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
  },
  {
    id: 'agnes:agnes-video-v2.0',
    providerKind: 'agnes',
    modelId: 'agnes-video-v2.0',
    displayName: 'Agnes Video V2.0',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: agnesVideoSchema,
        defaults: { aspectRatio: '16:9', resolution: '720p', durationSeconds: 5, fps: 24 },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 1,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: agnesVideoSchema,
        defaults: { aspectRatio: '16:9', resolution: '720p', durationSeconds: 5, fps: 24 },
      },
      {
        id: 'video.reference_to_video',
        label: '多图参考视频',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 8,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: agnesVideoSchema,
        defaults: { aspectRatio: '16:9', resolution: '720p', durationSeconds: 5, fps: 24 },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/videos',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['task_id', 'id'],
        statusEndpoint: '/videos/{{taskId}}',
        resultPaths: ['remixed_from_video_id'],
      },
      polling: { intervalMs: 5000, timeoutMs: 1800000, statusMap: commonStatusMap },
    },
    docs: {
      sourceUrls: ['https://agnes-ai.com/zh-Hans/docs/overview'],
      lastCheckedAt: '2026-07-02',
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
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
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: apimartGptImage2Schema,
        defaults: { n: 1, size: '1:1', resolution: '1k', official_fallback: false },
        aliases: { aspectRatio: 'size', outputFormat: 'output_format' },
        paramPolicy: apimartGptImage2ParamPolicy,
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 8,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: apimartGptImage2Schema,
        defaults: { n: 1, size: '1:1', resolution: '1k', official_fallback: false },
        aliases: { aspectRatio: 'size', outputFormat: 'output_format' },
        paramPolicy: apimartGptImage2ParamPolicy,
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/images/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['data[].url', 'data[].b64_json'],
      },
      polling: { intervalMs: 4000, timeoutMs: 300000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://docs.apimart.ai/cn'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
    error: apimartErrorContract,
  },
  {
    id: 'apimart:veo3',
    providerKind: 'apimart',
    modelId: 'veo3',
    displayName: 'APIMart VEO 3',
    domains: ['video'],
    capabilities: apimartVideoInputContracts('veo3').map((contract) => ({
      ...contract,
      output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
      paramSchema: videoSchema,
      defaults: { aspectRatio: '16:9', durationSeconds: 8 },
      aliases: {
        aspectRatio: 'aspect_ratio',
        durationSeconds: 'duration',
        editStrength: 'edit_strength',
      },
    })),
    invocation: {
      mode: 'async_polling',
      endpoint: '/videos/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        prompt: '{{prompt}}',
        first_frame_image: '{{firstFrame}}',
        last_frame_image: '{{lastFrame}}',
        image_urls: '{{referenceImageUrls}}',
        video_url: '{{videoUrl}}',
        video_urls: '{{inputVideoUrls}}',
        audio_urls: '{{inputAudioUrls}}',
      },
      response: { kind: 'task_poll', taskIdPaths: ['task_id', 'request_id', 'id'], statusEndpoint: '/tasks/{{taskId}}', resultPaths: ['data.result.videos[].url[]', 'video_url', 'data[].url', 'output.url'] },
      polling: { intervalMs: 5000, timeoutMs: 1800000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://docs.apimart.ai/cn'] },
    safety: { allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  ...[
    { id: 'apimart:wan2.7-image', modelId: 'wan2.7-image', displayName: 'APIMart Wan 2.7 Image' },
    {
      id: 'apimart:qwen-image-2.0',
      modelId: 'qwen-image-2.0',
      displayName: 'APIMart Qwen Image 2.0',
    },
    {
      id: 'apimart:doubao-seedream-5-0-lite',
      modelId: 'doubao-seedream-5-0-lite',
      displayName: 'APIMart Seedream 5.0 Lite',
    },
    {
      id: 'apimart:gemini-3.1-flash-image-preview',
      modelId: 'gemini-3.1-flash-image-preview',
      displayName: 'APIMart Gemini 3.1 Flash Image',
    },
    {
      id: 'apimart:gemini-3-pro-image-preview',
      modelId: 'gemini-3-pro-image-preview',
      displayName: 'APIMart Gemini 3 Pro Image',
    },
    {
      id: 'apimart:gemini-2.5-flash-image-preview',
      modelId: 'gemini-2.5-flash-image-preview',
      displayName: 'APIMart Gemini 2.5 Flash Image (nano-banana)',
    },
    {
      id: 'apimart:imagen-4.0-apimart',
      modelId: 'imagen-4.0-apimart',
      displayName: 'APIMart Imagen 4.0',
    },
    {
      id: 'apimart:gpt-image-1-official',
      modelId: 'gpt-image-1-official',
      displayName: 'APIMart GPT-Image-1',
    },
    {
      id: 'apimart:gpt-image-1-5-official',
      modelId: 'gpt-image-1.5-official',
      displayName: 'APIMart GPT-Image-1.5',
    },
    {
      id: 'apimart:doubao-seedream-4-0',
      modelId: 'doubao-seedream-4-0',
      displayName: 'APIMart Seedream 4.0',
    },
    {
      id: 'apimart:doubao-seedream-4-5',
      modelId: 'doubao-seedream-4-5',
      displayName: 'APIMart Seedream 4.5',
    },
    {
      id: 'apimart:doubao-seedream-5-0-pro',
      modelId: 'doubao-seedream-5-0-pro',
      displayName: 'APIMart Seedream 5.0 Pro',
    },
    { id: 'apimart:z-image-turbo', modelId: 'z-image-turbo', displayName: 'APIMart Z-Image-Turbo' },
    {
      id: 'apimart:qwen-image-2.0-pro',
      modelId: 'qwen-image-2.0-pro',
      displayName: 'APIMart Qwen Image 2.0 Pro',
    },
    {
      id: 'apimart:grok-imagine-1.5-apimart',
      modelId: 'grok-imagine-1.5-apimart',
      displayName: 'APIMart Grok Imagine 1.5 Image',
    },
    {
      id: 'apimart:gemini-2.5-flash-image-preview-official',
      modelId: 'gemini-2.5-flash-image-preview-official',
      displayName: 'APIMart Nano Banana (Official)',
    },
    {
      id: 'apimart:gemini-3-pro-image-preview-official',
      modelId: 'gemini-3-pro-image-preview-official',
      displayName: 'APIMart Nano Banana Pro (Official)',
    },
    {
      id: 'apimart:gemini-3.1-flash-image-preview-official',
      modelId: 'gemini-3.1-flash-image-preview-official',
      displayName: 'APIMart Nano Banana 2 (Official)',
    },
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
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: apimartImageModelSchemas[entry.modelId]?.schema ?? imageSizeSchema,
        defaults: apimartImageModelSchemas[entry.modelId]?.defaults ?? { n: 1 },
        aliases: { aspectRatio: 'aspect_ratio', outputFormat: 'output_format' },
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 8,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
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
      response: {
        kind: 'task_poll' as const,
        taskIdPaths: ['task_id', 'request_id', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['data[].url', 'data[].b64_json'],
      },
      polling: { intervalMs: 4000, timeoutMs: 300000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://docs.apimart.ai/cn'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
  })),
  ...[
    { id: 'apimart:sora-2', modelId: 'sora-2', displayName: 'APIMart Sora 2' },
    {
      id: 'apimart:doubao-seedance-2.0',
      modelId: 'doubao-seedance-2.0',
      displayName: 'APIMart Doubao Seedance 2.0',
    },
    { id: 'apimart:sora-2-pro', modelId: 'sora-2-pro', displayName: 'APIMart Sora 2 Pro' },
    { id: 'apimart:veo3.1-fast', modelId: 'veo3.1-fast', displayName: 'APIMart VEO 3.1 Fast' },
    {
      id: 'apimart:veo3.1-quality',
      modelId: 'veo3.1-quality',
      displayName: 'APIMart VEO 3.1 Quality',
    },
    { id: 'apimart:veo3.1-lite', modelId: 'veo3.1-lite', displayName: 'APIMart VEO 3.1 Lite' },
    {
      id: 'apimart:doubao-seedance-1-5-pro-apimart',
      modelId: 'doubao-seedance-1-5-pro',
      displayName: 'APIMart Seedance 1.5 Pro',
    },
    {
      id: 'apimart:doubao-seedance-2-0-fast-apimart',
      modelId: 'doubao-seedance-2-0-fast',
      displayName: 'APIMart Seedance 2.0 Fast',
    },
    {
      id: 'apimart:doubao-seedance-2-0-mini-apimart',
      modelId: 'doubao-seedance-2-0-mini',
      displayName: 'APIMart Seedance 2.0 Mini',
    },
    {
      id: 'apimart:doubao-seedance-1-0-pro-fast',
      modelId: 'doubao-seedance-1-0-pro-fast',
      displayName: 'APIMart Seedance 1.0 Pro Fast',
    },
    {
      id: 'apimart:doubao-seedance-1-0-pro-quality',
      modelId: 'doubao-seedance-1-0-pro-quality',
      displayName: 'APIMart Seedance 1.0 Pro Quality',
    },
    {
      id: 'apimart:MiniMax-Hailuo-2.3-apimart',
      modelId: 'MiniMax-Hailuo-2.3',
      displayName: 'APIMart Hailuo 2.3',
    },
    {
      id: 'apimart:MiniMax-Hailuo-02-apimart',
      modelId: 'MiniMax-Hailuo-02',
      displayName: 'APIMart Hailuo 02',
    },
    {
      id: 'apimart:skyreels-v4-fast',
      modelId: 'skyreels-v4-fast',
      displayName: 'APIMart SkyReels V4 Fast',
    },
    {
      id: 'apimart:skyreels-v4-std',
      modelId: 'skyreels-v4-std',
      displayName: 'APIMart SkyReels V4 Standard',
    },
    {
      id: 'apimart:happyhorse-1.0',
      modelId: 'happyhorse-1.0',
      displayName: 'APIMart HappyHorse 1.0',
    },
    {
      id: 'apimart:happyhorse-1.1',
      modelId: 'happyhorse-1.1',
      displayName: 'APIMart HappyHorse 1.1',
    },
    {
      id: 'apimart:wan2.5-preview',
      modelId: 'wan2.5-preview',
      displayName: 'APIMart Wan 2.5 Preview',
    },
    { id: 'apimart:wan2.6', modelId: 'wan2.6', displayName: 'APIMart Wan 2.6' },
    { id: 'apimart:wan2.7', modelId: 'wan2.7', displayName: 'APIMart Wan 2.7' },
    { id: 'apimart:wan2.7-r2v', modelId: 'wan2.7-r2v', displayName: 'APIMart Wan 2.7 R2V' },
    {
      id: 'apimart:wan2.7-videoedit',
      modelId: 'wan2.7-videoedit',
      displayName: 'APIMart Wan 2.7 VideoEdit',
    },
    { id: 'apimart:kling-v2-6', modelId: 'kling-v2-6', displayName: 'APIMart Kling v2.6' },
    { id: 'apimart:kling-v3', modelId: 'kling-v3', displayName: 'APIMart Kling v3' },
    { id: 'apimart:kling-v3-omni', modelId: 'kling-v3-omni', displayName: 'APIMart Kling v3 Omni' },
    {
      id: 'apimart:kling-3.0-turbo',
      modelId: 'kling-3.0-turbo',
      displayName: 'APIMart Kling 3.0 Turbo',
    },
    {
      id: 'apimart:kling-video-o1',
      modelId: 'kling-video-o1',
      displayName: 'APIMart Kling Video O1',
    },
    { id: 'apimart:viduq3-pro', modelId: 'viduq3-pro', displayName: 'APIMart Vidu Q3 Pro' },
    { id: 'apimart:viduq3-turbo', modelId: 'viduq3-turbo', displayName: 'APIMart Vidu Q3 Turbo' },
    { id: 'apimart:viduq3', modelId: 'viduq3', displayName: 'APIMart Vidu Q3' },
    { id: 'apimart:viduq3-mix', modelId: 'viduq3-mix', displayName: 'APIMart Vidu Q3 Mix' },
    {
      id: 'apimart:grok-imagine-1.5-video-apimart',
      modelId: 'grok-imagine-1.5-video-apimart',
      displayName: 'APIMart Grok Imagine 1.5 Video',
    },
    { id: 'apimart:pixverse-v6', modelId: 'pixverse-v6', displayName: 'APIMart Pixverse v6' },
    {
      id: 'apimart:gemini-omni-flash-preview',
      modelId: 'gemini-omni-flash-preview',
      displayName: 'APIMart Gemini Omni Flash Preview',
    },
    {
      id: 'apimart:Omni-Flash-Ext',
      modelId: 'Omni-Flash-Ext',
      displayName: 'APIMart Omni-Flash-Ext',
    },
  ].map((entry) => ({
    id: entry.id,
    providerKind: 'apimart',
    modelId: entry.modelId,
    displayName: entry.displayName,
    domains: ['video'] as MediaDomain[],
    capabilities: apimartVideoInputContracts(entry.modelId).map((contract) => ({
      ...contract,
      output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
      // Seedance 2.0（APIMart flavor）走专用 schema；其余模型按 modelId 取独立 schema。
      paramSchema:
        entry.modelId === 'doubao-seedance-2.0'
          ? apimartSeedance2VideoSchema
          : (apimartVideoModelSchemas[entry.modelId]?.schema ?? videoSchema),
      defaults: apimartVideoCapabilityDefaults(
        entry.modelId,
        contract.id,
        entry.modelId === 'doubao-seedance-2.0'
          ? {
              aspectRatio: '16:9',
              durationSeconds: 5,
              resolution: '720p',
              generate_audio: true,
              return_last_frame: false,
            }
          : (apimartVideoModelSchemas[entry.modelId]?.defaults ?? {
              aspectRatio: '16:9',
              durationSeconds: 5,
            }),
      ),
      aliases: {
        aspectRatio: apimartVideoSizeFieldModels.has(entry.modelId) ? 'size' : 'aspect_ratio',
        durationSeconds: 'duration',
        editStrength: 'edit_strength',
      },
    })),
    invocation: {
      mode: 'async_polling' as MediaInvocationMode,
      endpoint: '/videos/generations',
      method: 'POST' as const,
      contentType: 'json' as const,
      requestTemplate: {
        model: '{{modelId}}',
        prompt: '{{prompt}}',
        first_frame_image: '{{firstFrame}}',
        last_frame_image: '{{lastFrame}}',
        image_urls: '{{referenceImageUrls}}',
        video_url: '{{videoUrl}}',
        video_urls: '{{inputVideoUrls}}',
        audio_urls: '{{inputAudioUrls}}',
      },
      response: { kind: 'task_poll' as const, taskIdPaths: ['task_id', 'request_id', 'id'], statusEndpoint: '/tasks/{{taskId}}', resultPaths: ['data.result.videos[].url[]', 'video_url', 'data[].url', 'output.url'] },
      polling: { intervalMs: 5000, timeoutMs: 1800000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://docs.apimart.ai/cn'] },
    safety: { allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
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
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: xaiImageSchema,
        defaults: { n: 1, responseFormat: 'url' },
        aliases: { aspectRatio: 'aspect_ratio', responseFormat: 'response_format' },
        paramPolicy: xaiImageParamPolicy,
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: {
          required: ['prompt', 'image'],
          maxImages: 3,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: xaiImageSchema,
        defaults: { n: 1, responseFormat: 'url' },
        aliases: { aspectRatio: 'aspect_ratio', responseFormat: 'response_format' },
        paramPolicy: xaiImageParamPolicy,
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
    error: xaiErrorContract,
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
        aliases: {
          aspectRatio: 'aspect_ratio',
          durationSeconds: 'duration',
          editStrength: 'edit_strength',
        },
      },
      {
        id: 'video.reference_to_video',
        label: '参考图生视频',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 7,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: xaiVideoReferenceSchema,
        defaults: { durationSeconds: 8, resolution: '720p' },
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: xaiVideoSchema,
        defaults: { durationSeconds: 8, resolution: '720p' },
        aliases: {
          aspectRatio: 'aspect_ratio',
          durationSeconds: 'duration',
          editStrength: 'edit_strength',
        },
      },
      {
        id: 'video.edit',
        label: '视频编辑',
        input: {
          required: ['prompt', 'video'] as MediaManifestInputKind[],
          acceptedMimeTypes: ['video/mp4'],
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        // 编辑端点由 XaiMediaAdapter.editVideo 处理（POST /videos/edits，输入 video 对象，
        // 忽略 duration/aspect_ratio/resolution，输出继承输入视频）。schema 仅用于 UI 参数面板展示。
        paramSchema: xaiVideoEditSchema,
        aliases: { durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.extend',
        label: '视频扩展',
        input: {
          required: ['prompt', 'video'] as MediaManifestInputKind[],
          acceptedMimeTypes: ['video/mp4'],
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        // 扩展端点由 XaiMediaAdapter.editVideo 处理（POST /videos/extensions，
        // duration 范围 [2,10] 默认 6，从输入视频最后一帧续拍）。
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
      requestTemplate: {
        model: '{{modelId}}',
        prompt: '{{prompt}}',
        image: { url: '{{firstFrame}}' },
        video: '{{video}}',
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['request_id', 'id'],
        statusEndpoint: '/videos/{{taskId}}',
        resultPaths: ['video.url', 'video_url', 'data[].url'],
      },
      polling: { intervalMs: 5000, timeoutMs: 1800000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://docs.x.ai/developers/model-capabilities/imagine'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true },
  },
  ...XAI_VIDEO_15_MANIFESTS,
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
        paramSchema: XAI_TTS_PARAM_SCHEMA,
        defaults: {
          voiceId: 'eve',
          language: 'auto',
          outputFormat: 'mp3',
          withTimestamps: false,
        },
        aliases: {
          voiceId: 'voice_id',
          outputFormat: 'output_format',
          sampleRate: 'sample_rate',
          bitRate: 'bit_rate',
          optimizeStreamingLatency: 'optimize_streaming_latency',
          textNormalization: 'text_normalization',
          withTimestamps: 'with_timestamps',
        },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/tts',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        text: '{{text}}',
        voice_id: '{{voiceId}}',
        language: '{{language}}',
        output_format: '{{outputFormat}}',
      },
      response: { kind: 'binary_response' },
    },
    docs: {
      sourceUrls: ['https://docs.x.ai/developers/model-capabilities/audio/text-to-speech'],
      lastCheckedAt: '2026-07-16',
    },
  },
  ...BAILIAN_MEDIA_MODEL_MANIFESTS,
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
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: imageSizeSchema,
        defaults: { n: 1, size: '1024x1024' },
      },
      {
        id: 'image.edit',
        label: '图片编辑',
        input: {
          required: ['prompt', 'image'],
          maxImages: 16,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
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
    {
      id: 'google:gemini-3.1-flash-image',
      modelId: 'gemini-3.1-flash-image',
      displayName: 'Google Gemini 3.1 Flash Image',
    },
    {
      id: 'google:gemini-3.1-flash-lite-image',
      modelId: 'gemini-3.1-flash-lite-image',
      displayName: 'Google Gemini 3.1 Flash Lite Image',
    },
    {
      id: 'google:gemini-3-pro-image',
      modelId: 'gemini-3-pro-image',
      displayName: 'Google Gemini 3 Pro Image',
    },
    {
      id: 'google:gemini-2.5-flash-image',
      modelId: 'gemini-2.5-flash-image',
      displayName: 'Google Gemini 2.5 Flash Image',
    },
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
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: googleImageSchema,
        defaults: { n: 1, resolution: '1K', outputFormat: 'png' },
        aliases: { outputFormat: 'output_format' },
        paramPolicy: googleImageParamPolicy,
      },
      {
        id: 'image.edit',
        label: '多轮图片编辑 / 图生图',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 8,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: googleImageSchema,
        defaults: { n: 1, resolution: '1K', outputFormat: 'png' },
        aliases: { outputFormat: 'output_format' },
        paramPolicy: googleImageParamPolicy,
      },
    ],
    invocation: {
      mode: 'sync' as MediaInvocationMode,
      endpoint: '/interactions',
      method: 'POST' as const,
      contentType: 'json' as const,
      requestTemplate: { model: '{{modelId}}', input: '{{prompt}}' },
      response: {
        kind: 'inline_base64' as const,
        jsonPaths: ['output_image.data', 'outputImage.data'],
      },
    },
    docs: {
      sourceUrls: ['https://ai.google.dev/gemini-api/docs/image-generation'],
      lastCheckedAt: '2026-07-01',
    },
    safety: { maxPromptLength: 32000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
    error: googleGenerativeAiErrorContract,
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
        input: {
          required: ['prompt', 'image'],
          maxImages: 3,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: googleVeoVideoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p' },
      },
      {
        id: 'video.reference_to_video',
        label: '参考图生视频',
        input: {
          required: ['prompt', 'images'],
          maxImages: 3,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
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
      response: {
        kind: 'task_poll',
        taskIdPaths: ['name'],
        statusEndpoint: '/{{taskId}}',
        resultPaths: [
          'response.videos[].uri',
          'response.generateVideoResponse.generatedSamples[].video.uri',
        ],
      },
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
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 3,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: googleOmniVideoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 6, resolution: '720p' },
      },
      {
        id: 'video.edit',
        label: '自然语言视频编辑',
        input: {
          required: ['prompt', 'video'] as MediaManifestInputKind[],
          acceptedMimeTypes: ['video/mp4', 'video/webm'],
        },
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
      response: {
        kind: 'task_poll',
        taskIdPaths: ['name'],
        statusEndpoint: '/{{taskId}}',
        resultPaths: [
          'response.generateVideoResponse.generatedSamples[].video.uri',
          'response.generatedVideos[].video.uri',
        ],
      },
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
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: midjourneyGatewayImageSchema,
        defaults: { submitPath: '/imagine', statusPath: '/tasks/{{taskId}}' },
      },
      {
        id: 'image.edit',
        label: '参考图生图（外部网关）',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 8,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: midjourneyGatewayImageSchema,
        defaults: { submitPath: '/imagine', statusPath: '/tasks/{{taskId}}' },
      },
      {
        id: 'image.variations',
        label: '图片变体（外部网关）',
        input: {
          required: ['image'] as MediaManifestInputKind[],
          maxImages: 1,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
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
      response: {
        kind: 'task_poll',
        taskIdPaths: ['task_id', 'taskId', 'id'],
        statusEndpoint: '/tasks/{{taskId}}',
        resultPaths: ['data[].url', 'image_url', 'url'],
      },
      polling: { intervalMs: 5000, timeoutMs: 900000, statusMap: commonStatusMap },
    },
    docs: {
      sourceUrls: ['https://docs.midjourney.com/', 'https://www.midjourney.com/'],
      lastCheckedAt: '2026-07-01',
    },
    safety: { maxPromptLength: 6000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
  },
  ...VOLCENGINE_ARK_MEDIA_MODEL_MANIFESTS,
  ...[
    {
      id: 'kling:kling-video-3.0-omni',
      modelId: 'kling-video-3.0-omni',
      displayName: 'Kling 3.0 Omni',
      modes: ['standard', 'professional'],
      audio: true,
    },
    {
      id: 'kling:kling-video-o1',
      modelId: 'kling-video-o1',
      displayName: 'Kling O1',
      modes: ['standard', 'professional'],
    },
    {
      id: 'kling:kling-v2.6-pro',
      modelId: 'kling-v2.6-pro',
      displayName: 'Kling 2.6 Pro',
      modes: ['standard', 'professional'],
      audio: true,
    },
    {
      id: 'kling:kling-v2.6-std',
      modelId: 'kling-v2.6-std',
      displayName: 'Kling 2.6 Standard',
      modes: ['standard'],
      audio: true,
    },
    {
      id: 'kling:kling-v2.5-turbo',
      modelId: 'kling-v2.5-turbo',
      displayName: 'Kling 2.5 Turbo',
      modes: [],
    },
  ].map((entry) => {
    const schema = {
      ...klingVideoSchema,
      properties: {
        ...klingVideoSchema.properties,
        ...(entry.modelId.includes('3.0')
          ? {
              durationSeconds: { type: 'integer', title: '时长', enum: [3, 5, 10, 15] },
              aspectRatio: {
                type: 'string',
                title: '比例',
                enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
              },
            }
          : {}),
        ...(entry.modes.length > 0
          ? { mode: { type: 'string', title: '模式', enum: entry.modes } }
          : {}),
        ...(entry.audio
          ? {}
          : { audio: { type: 'boolean', title: '生成音频', readOnly: true, default: false } }),
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
          aliases: {
            aspectRatio: 'aspect_ratio',
            durationSeconds: 'duration',
            editStrength: 'edit_strength',
          },
        },
        {
          id: 'video.image_to_video',
          label: '图生视频',
          input: {
            required: ['prompt', 'image'] as MediaManifestInputKind[],
            maxImages: 1,
            acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          },
          output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
          paramSchema: schema,
          aliases: {
            aspectRatio: 'aspect_ratio',
            durationSeconds: 'duration',
            editStrength: 'edit_strength',
          },
        },
        {
          id: 'video.edit',
          label: '视频编辑',
          input: {
            required: ['prompt', 'video'] as MediaManifestInputKind[],
            maxImages: 2,
            acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'],
          },
          output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
          paramSchema: schema,
          aliases: {
            aspectRatio: 'aspect_ratio',
            durationSeconds: 'duration',
            editStrength: 'edit_strength',
          },
        },
      ],
      invocation: {
        mode: 'async_polling' as MediaInvocationMode,
        endpoint: '/v1/videos/text2video',
        method: 'POST' as const,
        contentType: 'json' as const,
        requestTemplate: {
          model: '{{modelId}}',
          prompt: '{{prompt}}',
          first_frame_image: '{{firstFrame}}',
          last_frame_image: '{{lastFrame}}',
          video: '{{video}}',
          reference_images: '{{referenceImages}}',
        },
        response: {
          kind: 'task_poll' as const,
          taskIdPaths: ['task_id', 'id'],
          statusEndpoint: '/v1/videos/text2video/{{taskId}}',
          resultPaths: ['video_url', 'output.video_url', 'data.video_url', 'data.url'],
        },
        polling: { intervalMs: 5000, timeoutMs: 1800000, statusMap: commonStatusMap },
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
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: minimaxImageSchema,
        defaults: {
          aspectRatio: '1:1',
          response_format: 'url',
          n: 1,
          prompt_optimizer: false,
          aigc_watermark: false,
        },
        aliases: { aspectRatio: 'aspect_ratio' },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/v1/image_generation',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: {
        kind: 'url',
        jsonPaths: ['data.image_urls[]', 'data.image_base64[]'],
        download: true,
      },
    },
    docs: { sourceUrls: ['https://platform.minimaxi.com/document/image_generation'] },
    safety: { maxPromptLength: 1500 },
  },
  ...[
    {
      id: 'minimax:speech-2.8-hd',
      modelId: 'speech-2.8-hd',
      displayName: 'MiniMax Speech 2.8 HD',
      subtitles: true,
    },
    {
      id: 'minimax:speech-2.8-turbo',
      modelId: 'speech-2.8-turbo',
      displayName: 'MiniMax Speech 2.8 Turbo',
      subtitles: false,
    },
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
        output: {
          types: ['audio'] as MediaManifestOutputKind[],
          mimeTypes: ['audio/mpeg', 'audio/wav'],
        },
        paramSchema: entry.subtitles
          ? minimaxSpeechSchema
          : {
              ...minimaxSpeechSchema,
              properties: Object.fromEntries(
                Object.entries(minimaxSpeechSchema.properties).filter(
                  ([key]) => key !== 'subtitle_enable' && key !== 'subtitle_type',
                ),
              ),
            },
        defaults: {
          format: 'mp3',
          output_format: 'url',
          speed: 1,
          vol: 1,
          pitch: 0,
          aigc_watermark: false,
        },
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
        voice_setting: {
          voice_id: '{{voice}}',
          speed: '{{speed}}',
          vol: '{{vol}}',
          pitch: '{{pitch}}',
        },
        audio_setting: { format: '{{format}}' },
        language_boost: '{{language_boost}}',
        subtitle_enable: '{{subtitle_enable}}',
        subtitle_type: '{{subtitle_type}}',
      },
      response: {
        kind: 'url' as const,
        jsonPaths: ['data.audio', 'data.audio_file', 'data.url'],
        download: true,
      },
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
        output: {
          types: ['audio'] as MediaManifestOutputKind[],
          mimeTypes: ['audio/mpeg', 'audio/wav'],
        },
        paramSchema: minimaxMusicSchema,
        defaults: {
          output_format: 'url',
          format: 'mp3',
          aigc_watermark: false,
          lyrics_optimizer: false,
          is_instrumental: false,
        },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/v1/music_generation',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        prompt: '{{prompt}}',
        output_format: '{{output_format}}',
      },
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
        defaults: {
          durationSeconds: 6,
          resolution: '768P',
          prompt_optimizer: true,
          fast_pretreatment: false,
          aigc_watermark: false,
        },
        aliases: { durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: {
          required: ['prompt', 'image'],
          maxImages: 1,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: minimaxHailuoVideoSchema,
        defaults: {
          durationSeconds: 6,
          resolution: '768P',
          prompt_optimizer: true,
          fast_pretreatment: false,
          aigc_watermark: false,
        },
        aliases: { durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
      {
        id: 'video.edit',
        label: '视频编辑',
        input: {
          required: ['prompt', 'video'],
          maxImages: 2,
          acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'],
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: minimaxHailuoVideoSchema,
        defaults: {
          durationSeconds: 6,
          resolution: '768P',
          prompt_optimizer: true,
          fast_pretreatment: false,
          aigc_watermark: false,
        },
        aliases: { durationSeconds: 'duration', editStrength: 'edit_strength' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/v1/video_generation',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        prompt: '{{prompt}}',
        first_frame_image: '{{firstFrame}}',
        last_frame_image: '{{lastFrame}}',
        video: '{{video}}',
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['task_id', 'data.task_id'],
        statusEndpoint: '/v1/query/video_generation?task_id={{taskId}}',
        resultPaths: ['data.video_url', 'data.file_url', 'file_url', 'video_url'],
      },
      polling: { intervalMs: 5000, timeoutMs: 1800000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://platform.minimaxi.com/document/video_generation'] },
    safety: { maxPromptLength: 2000, allowLocalFiles: true },
  },
]

export function mediaManifestCapabilities(
  manifest: Pick<MediaModelManifest, 'capabilities'>,
): string[] {
  return Array.from(new Set(manifest.capabilities.map((capability) => capability.id)))
}
