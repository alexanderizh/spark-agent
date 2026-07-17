/**
 * 火山方舟图片/视频模型清单。
 *
 * 这里仅保存火山模型差异；画布继续消费通用 manifest/rolePolicy，不能感知 provider。
 * 参数与枚举核对自 2026-07-16 抓取的官方文档 1330310、1520757、1541523、2582774。
 */

import type { MediaErrorContract, MediaModelParamPolicy } from './media-model-contract.js'
import type {
  MediaInvocationMode,
  MediaManifestInputKind,
  MediaModelCapabilityManifest,
  MediaModelManifest,
} from './media-model-manifest.js'
import type { MediaInputRolePolicy } from './media-config.js'

const DOC_ROOT = 'https://console.volcengine.com/ark/region:cn-beijing/docs/82379'
const VIDEO_API_DOC = `${DOC_ROOT}/1520757?lang=zh`
const VIDEO_TUTORIAL_DOC = `${DOC_ROOT}/2291680?lang=zh`
const IMAGE_API_DOC = `${DOC_ROOT}/1541523?lang=zh`
const IMAGE_TUTORIAL_DOC = `${DOC_ROOT}/1824121?lang=zh`
const SEEDREAM_PRO_DOC = `${DOC_ROOT}/2582774?lang=zh`
const SEEDREAM_INTERACTIVE_DOC = `${DOC_ROOT}/2582775?lang=zh`

const volcengineArkErrorContract: MediaErrorContract = {
  codePaths: ['error.code', 'Code', 'code'],
  messagePaths: ['error.message', 'Message', 'message'],
  requestIdPaths: ['RequestId', 'request_id', 'requestId'],
  paramNamePatterns: ['parameter[:\\s]+`?([a-z_]+)`?'],
  mappings: {
    InvalidParameter: 'unsupported_parameter',
    Unauthorized: 'auth_failed',
    Authentication: 'auth_failed',
    Throttling: 'rate_limited',
    QuotaExhausted: 'quota_exceeded',
    InternalError: 'task_failed',
  },
  retryableCodes: ['Throttling', 'InternalError', 'ServiceUnavailable'],
}

const strictParamPolicy: MediaModelParamPolicy = {
  strict: true,
  passthrough: { enabled: false },
}

const SEEDANCE_IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/gif',
  'image/heic',
  'image/heif',
]
const SEEDANCE_10_IMAGE_MIME = SEEDANCE_IMAGE_MIME.filter(
  (mime) => mime !== 'image/heic' && mime !== 'image/heif',
)
const SEEDANCE_REFERENCE_MIME = [
  ...SEEDANCE_IMAGE_MIME,
  'video/mp4',
  'video/quicktime',
  'audio/wav',
  'audio/mpeg',
]
const SEEDREAM_INPUT_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/gif',
  'image/heic',
  'image/heif',
]

const seedanceReferenceRolePolicy: MediaInputRolePolicy = {
  imageRoles: ['reference_image'],
  videoRoles: ['reference_video'],
  audioRoles: ['reference_audio'],
  defaultRoleAssignment: 'all_reference',
}

const seedanceFrameAndReferenceRolePolicy: MediaInputRolePolicy = {
  imageRoles: ['first_frame', 'last_frame', 'reference_image'],
  videoRoles: ['reference_video'],
  audioRoles: ['reference_audio'],
  defaultRoleAssignment: 'first_then_last_then_reference',
}

const seedanceFirstFrameRolePolicy: MediaInputRolePolicy = {
  imageRoles: ['first_frame'],
  defaultRoleAssignment: 'first_then_last_then_reference',
}

const seedanceFirstLastFrameRolePolicy: MediaInputRolePolicy = {
  imageRoles: ['first_frame', 'last_frame'],
  defaultRoleAssignment: 'first_then_last_then_reference',
}

const seedance2BaseProperties = {
  aspectRatio: {
    type: 'string',
    title: '视频比例',
    enum: ['智能比例', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    default: '智能比例',
  },
  durationSeconds: {
    type: 'integer',
    title: '时长（秒）',
    enum: [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    default: 5,
    description: '-1 表示由模型自选；其他合法值为 4–15。',
  },
  generateAudio: { type: 'boolean', title: '生成同步音频', default: true },
  watermark: { type: 'boolean', title: '水印', default: false },
  returnLastFrame: { type: 'boolean', title: '返回尾帧图', default: false },
  executionExpiresAfter: {
    type: 'integer',
    title: '任务过期时间（秒）',
    minimum: 3600,
    maximum: 259200,
    default: 172800,
  },
  priority: { type: 'integer', title: '队列优先级', minimum: 0, maximum: 9, default: 0 },
  safetyIdentifier: { type: 'string', title: '安全标识', maxLength: 64 },
  callbackUrl: { type: 'string', title: '回调地址', format: 'uri' },
}

function seedance2Schema(resolutions: readonly string[], includeSearch: boolean) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...seedance2BaseProperties,
      ...(includeSearch
        ? {
            searchEnabled: {
              type: 'boolean',
              title: '联网搜索（仅纯文本）',
              default: false,
            },
          }
        : {}),
      resolution: {
        type: 'string',
        title: '分辨率',
        enum: [...resolutions],
        default: '720p',
      },
    },
  }
}

const seedance2Aliases = {
  aspectRatio: 'ratio',
  durationSeconds: 'duration',
  generateAudio: 'generate_audio',
  returnLastFrame: 'return_last_frame',
  executionExpiresAfter: 'execution_expires_after',
  safetyIdentifier: 'safety_identifier',
  callbackUrl: 'callback_url',
}

function seedance2Capability(input: {
  id: MediaModelCapabilityManifest['id']
  label: string
  required: MediaManifestInputKind[]
  schema: Record<string, unknown>
  rolePolicy: MediaInputRolePolicy
}): MediaModelCapabilityManifest {
  const aliases = {
    ...seedance2Aliases,
    ...(input.id === 'video.generate' ? { searchEnabled: 'enable_search' } : {}),
  }
  return {
    id: input.id,
    label: input.label,
    input: {
      required: input.required,
      maxImages: 9,
      maxVideos: 3,
      maxAudios: 3,
      acceptedMimeTypes: SEEDANCE_REFERENCE_MIME,
    },
    rolePolicy: input.rolePolicy,
    output: { types: ['video'], mimeTypes: ['video/mp4'] },
    paramSchema: input.schema,
    defaults: {
      aspectRatio: '智能比例',
      durationSeconds: 5,
      resolution: '720p',
      generateAudio: true,
      watermark: false,
      returnLastFrame: false,
      executionExpiresAfter: 172800,
      priority: 0,
      ...(input.id === 'video.generate' ? { searchEnabled: false } : {}),
    },
    aliases,
    paramPolicy: strictParamPolicy,
  }
}

function seedance2Manifest(input: {
  modelId: string
  displayName: string
  resolutions: readonly string[]
}): MediaModelManifest {
  const textSchema = seedance2Schema(input.resolutions, true)
  const mediaSchema = seedance2Schema(input.resolutions, false)
  return {
    id: `volcengine:${input.modelId}`,
    providerKind: 'volcengine-ark',
    modelId: input.modelId,
    displayName: input.displayName,
    domains: ['video'],
    capabilities: [
      seedance2Capability({
        id: 'video.generate',
        label: '文生视频 / 多模态参考',
        required: [],
        schema: textSchema,
        rolePolicy: seedanceReferenceRolePolicy,
      }),
      seedance2Capability({
        id: 'video.image_to_video',
        label: '首帧 / 首尾帧 / 多模态参考生视频',
        required: ['image'],
        schema: mediaSchema,
        rolePolicy: seedanceFrameAndReferenceRolePolicy,
      }),
      seedance2Capability({
        id: 'video.reference_to_video',
        label: '多模态参考生视频',
        required: [],
        schema: mediaSchema,
        rolePolicy: seedanceReferenceRolePolicy,
      }),
      seedance2Capability({
        id: 'video.edit',
        label: '参考视频编辑',
        required: ['video'],
        schema: mediaSchema,
        rolePolicy: seedanceReferenceRolePolicy,
      }),
      seedance2Capability({
        id: 'video.extend',
        label: '参考视频延长',
        required: ['video'],
        schema: mediaSchema,
        rolePolicy: seedanceReferenceRolePolicy,
      }),
    ],
    invocation: seedanceInvocation(),
    docs: { sourceUrls: [VIDEO_API_DOC, VIDEO_TUTORIAL_DOC], lastCheckedAt: '2026-07-16' },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 200 * 1024 * 1024 },
    error: volcengineArkErrorContract,
  }
}

const seedance15Schema = {
  type: 'object',
  additionalProperties: false,
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
      default: '720p',
    },
    durationSeconds: {
      type: 'integer',
      title: '时长（秒）',
      enum: [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      default: 5,
      description: '-1 表示由模型自选；其他合法值为 4–12。',
    },
    generateAudio: { type: 'boolean', title: '生成同步音频', default: true },
    draft: { type: 'boolean', title: '样片模式', default: false },
    watermark: { type: 'boolean', title: '水印', default: false },
    returnLastFrame: { type: 'boolean', title: '返回尾帧图', default: false },
    seed: { type: 'integer', title: '随机种子', minimum: -1, maximum: 4294967295, default: -1 },
    serviceTier: {
      type: 'string',
      title: '服务档位',
      enum: ['default', 'flex'],
      default: 'default',
    },
    executionExpiresAfter: {
      type: 'integer',
      title: '任务过期时间（秒）',
      minimum: 3600,
      maximum: 259200,
      default: 172800,
    },
    safetyIdentifier: { type: 'string', title: '安全标识', maxLength: 64 },
    callbackUrl: { type: 'string', title: '回调地址', format: 'uri' },
  },
}

const seedance10Schema = {
  type: 'object',
  additionalProperties: false,
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
    durationSeconds: { type: 'integer', title: '时长（秒）', minimum: 2, maximum: 12, default: 5 },
    frames: {
      type: 'integer',
      title: '帧数',
      minimum: 29,
      maximum: 289,
      description: '仅允许 25+4n；与 duration 同传时 frames 优先。',
    },
    cameraFixed: { type: 'boolean', title: '固定摄像头', default: false },
    watermark: { type: 'boolean', title: '水印', default: false },
    returnLastFrame: { type: 'boolean', title: '返回尾帧图', default: false },
    seed: { type: 'integer', title: '随机种子', minimum: -1, maximum: 4294967295, default: -1 },
    serviceTier: {
      type: 'string',
      title: '服务档位',
      enum: ['default', 'flex'],
      default: 'default',
    },
    executionExpiresAfter: {
      type: 'integer',
      title: '任务过期时间（秒）',
      minimum: 3600,
      maximum: 259200,
      default: 172800,
    },
    safetyIdentifier: { type: 'string', title: '安全标识', maxLength: 64 },
    callbackUrl: { type: 'string', title: '回调地址', format: 'uri' },
  },
}

const seedance15ImageToVideoSchema = {
  ...seedance15Schema,
  properties: {
    ...seedance15Schema.properties,
    resolution: {
      ...seedance15Schema.properties.resolution,
      enum: ['480p', '720p'],
      default: '720p',
    },
  },
}

const seedance10ImageToVideoSchema = {
  ...seedance10Schema,
  properties: {
    ...omitRecordKeys(seedance10Schema.properties, ['cameraFixed']),
    resolution: {
      ...seedance10Schema.properties.resolution,
      enum: ['480p', '720p'],
      default: '720p',
    },
  },
}

const seedanceLegacyAliases = {
  aspectRatio: 'ratio',
  durationSeconds: 'duration',
  generateAudio: 'generate_audio',
  returnLastFrame: 'return_last_frame',
  cameraFixed: 'camera_fixed',
  serviceTier: 'service_tier',
  executionExpiresAfter: 'execution_expires_after',
  safetyIdentifier: 'safety_identifier',
  callbackUrl: 'callback_url',
}

function omitRecordKeys(
  values: Record<string, unknown>,
  omittedKeys: readonly string[],
): Record<string, unknown> {
  const omitted = new Set(omittedKeys)
  return Object.fromEntries(Object.entries(values).filter(([key]) => !omitted.has(key)))
}

function valuesDeclaredBySchema<T>(
  schema: Record<string, unknown>,
  values: Record<string, T>,
): Record<string, T> {
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {}
  return Object.fromEntries(Object.entries(values).filter(([key]) => key in properties))
}

function seedanceLegacyManifest(input: {
  modelId: string
  displayName: string
  schema: Record<string, unknown>
  maxImages: 1 | 2
  acceptedMimeTypes: string[]
  defaults: Record<string, unknown>
  imageToVideoSchema?: Record<string, unknown>
  imageToVideoResolution?: string
}): MediaModelManifest {
  const capability = (
    id: 'video.generate' | 'video.image_to_video',
  ): MediaModelCapabilityManifest => {
    const schema =
      id === 'video.image_to_video' ? (input.imageToVideoSchema ?? input.schema) : input.schema
    const defaults =
      id === 'video.image_to_video' && input.imageToVideoResolution
        ? { ...input.defaults, resolution: input.imageToVideoResolution }
        : input.defaults
    return {
      id,
      label:
        id === 'video.generate'
          ? '文生视频'
          : input.maxImages === 2
            ? '首帧 / 首尾帧生视频'
            : '首帧生视频',
      input:
        id === 'video.generate'
          ? { required: ['prompt'] }
          : {
              required: ['image'],
              maxImages: input.maxImages,
              acceptedMimeTypes: input.acceptedMimeTypes,
            },
      ...(id === 'video.image_to_video'
        ? {
            rolePolicy:
              input.maxImages === 2
                ? seedanceFirstLastFrameRolePolicy
                : seedanceFirstFrameRolePolicy,
          }
        : {}),
      output: { types: ['video'], mimeTypes: ['video/mp4'] },
      paramSchema: schema,
      defaults: valuesDeclaredBySchema(schema, defaults),
      aliases: valuesDeclaredBySchema(schema, seedanceLegacyAliases),
      paramPolicy: strictParamPolicy,
    }
  }
  return {
    id: `volcengine:${input.modelId}`,
    providerKind: 'volcengine-ark',
    modelId: input.modelId,
    displayName: input.displayName,
    domains: ['video'],
    capabilities: [capability('video.generate'), capability('video.image_to_video')],
    invocation: seedanceInvocation(),
    docs: { sourceUrls: [VIDEO_API_DOC], lastCheckedAt: '2026-07-16' },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 30 * 1024 * 1024 },
    error: volcengineArkErrorContract,
  }
}

function seedanceInvocation(): MediaModelManifest['invocation'] {
  return {
    mode: 'async_polling',
    endpoint: '/contents/generations/tasks',
    method: 'POST',
    contentType: 'json',
    requestTemplate: { model: '{{modelId}}', content: '{{content}}' },
    response: {
      kind: 'task_poll',
      taskIdPaths: ['id'],
      statusEndpoint: '/contents/generations/tasks/{{taskId}}',
      resultPaths: ['content.video_url'],
    },
    polling: {
      intervalMs: 5000,
      timeoutMs: 172800000,
      statusMap: {
        queued: 'queued',
        running: 'running',
        succeeded: 'succeeded',
        failed: 'failed',
        cancelled: 'cancelled',
        expired: 'failed',
      },
    },
  }
}

const SIZE_1K = [
  '1024x1024',
  '1152x864',
  '864x1152',
  '1280x720',
  '720x1280',
  '1248x832',
  '832x1248',
  '1512x648',
]
const SIZE_2K = [
  '2048x2048',
  '2304x1728',
  '1728x2304',
  '2848x1600',
  '1600x2848',
  '2496x1664',
  '1664x2496',
  '3136x1344',
]
const SIZE_3K = [
  '3072x3072',
  '3456x2592',
  '2592x3456',
  '4096x2304',
  '2304x4096',
  '2496x3744',
  '3744x2496',
  '4704x2016',
]
const SIZE_4K = [
  '4096x4096',
  '3520x4704',
  '4704x3520',
  '5504x3040',
  '3040x5504',
  '3328x4992',
  '4992x3328',
  '6240x2656',
]

function sizeProperty(tiers: readonly string[], values: readonly string[], pixelRange: string) {
  return {
    type: 'string',
    title: '尺寸',
    enum: [...tiers, ...values],
    default: '2K',
    description: `分辨率档位或宽x高；直接尺寸总像素范围 ${pixelRange}，宽高比 [1/16,16]。`,
    'x-allow-custom': true,
    pattern: '^\\d+\\s*[xX]\\s*\\d+$',
  }
}

type SeedreamVariant = 'pro' | 'lite' | '4.5' | '4.0'

function seedreamSchema(variant: SeedreamVariant): Record<string, unknown> {
  const pro = variant === 'pro'
  const lite = variant === 'lite'
  const four = variant === '4.0'
  const size = pro
    ? sizeProperty(['1K', '2K'], [...SIZE_1K, ...SIZE_2K], '[921600,4624220]')
    : lite
      ? sizeProperty(['2K', '3K', '4K'], [...SIZE_2K, ...SIZE_3K, ...SIZE_4K], '[3686400,16777216]')
      : four
        ? sizeProperty(
            ['1K', '2K', '4K'],
            [...SIZE_1K, ...SIZE_2K, ...SIZE_4K],
            '[921600,16777216]',
          )
        : sizeProperty(['2K', '4K'], [...SIZE_2K, ...SIZE_4K], '[3686400,16777216]')
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      size,
      ...(pro || lite
        ? {
            outputFormat: {
              type: 'string',
              title: '输出格式',
              enum: ['png', 'jpeg'],
              default: 'jpeg',
            },
          }
        : {}),
      responseFormat: {
        type: 'string',
        title: '响应格式',
        enum: ['url', 'b64_json'],
        default: 'url',
      },
      watermark: { type: 'boolean', title: '水印', default: true },
      ...(!pro
        ? {
            sequentialImageGeneration: {
              type: 'string',
              title: '组图模式',
              enum: ['disabled', 'auto'],
              default: 'disabled',
            },
            maxImages: {
              type: 'integer',
              title: '生成图片数',
              minimum: 1,
              maximum: 15,
              default: 15,
            },
          }
        : {}),
      optimizePromptMode: {
        type: 'string',
        title: '提示词优化',
        enum: pro || four ? ['standard', 'fast'] : ['standard'],
        default: 'standard',
      },
      ...(lite ? { searchEnabled: { type: 'boolean', title: '联网搜索', default: false } } : {}),
    },
  }
}

const seedreamAliases = {
  outputFormat: 'output_format',
  responseFormat: 'response_format',
  sequentialImageGeneration: 'sequential_image_generation',
  maxImages: 'max_images',
  searchEnabled: 'enable_search',
}

function seedreamManifest(input: {
  modelId: string
  displayName: string
  variant: SeedreamVariant
  maxInputImages: 10 | 14
}): MediaModelManifest {
  const schema = seedreamSchema(input.variant)
  const pro = input.variant === 'pro'
  const defaults: Record<string, unknown> = {
    size: '2K',
    responseFormat: 'url',
    watermark: true,
    optimizePromptMode: 'standard',
    ...(pro || input.variant === 'lite' ? { outputFormat: 'jpeg' } : {}),
    ...(!pro ? { sequentialImageGeneration: 'disabled', maxImages: 15 } : {}),
    ...(input.variant === 'lite' ? { searchEnabled: false } : {}),
  }
  const capability = (id: 'image.generate' | 'image.edit'): MediaModelCapabilityManifest => ({
    id,
    label:
      id === 'image.generate'
        ? pro
          ? '文生单图'
          : '文生图 / 组图'
        : pro
          ? '单/多图编辑'
          : '图文生图 / 多图融合',
    input:
      id === 'image.generate'
        ? { required: ['prompt'] }
        : {
            required: ['prompt', 'image'],
            maxImages: input.maxInputImages,
            acceptedMimeTypes: SEEDREAM_INPUT_MIME,
          },
    ...(id === 'image.edit'
      ? {
          rolePolicy: {
            imageRoles: ['reference_image'],
            defaultRoleAssignment: 'all_reference',
          } as MediaInputRolePolicy,
        }
      : {}),
    output: { types: ['image'], mimeTypes: ['image/png', 'image/jpeg'] },
    paramSchema:
      id === 'image.edit' && !pro
        ? {
            ...schema,
            properties: {
              ...(schema.properties as Record<string, unknown>),
              maxImages: {
                ...((schema.properties as Record<string, Record<string, unknown>>).maxImages ?? {}),
                default: 14,
              },
            },
          }
        : schema,
    defaults: id === 'image.edit' && !pro ? { ...defaults, maxImages: 14 } : defaults,
    aliases: seedreamAliases,
    paramPolicy: strictParamPolicy,
  })
  return {
    id: `volcengine:${input.modelId}`,
    providerKind: 'volcengine-ark',
    modelId: input.modelId,
    displayName: input.displayName,
    domains: ['image'],
    capabilities: [capability('image.generate'), capability('image.edit')],
    invocation: {
      mode: 'sync' as MediaInvocationMode,
      endpoint: '/images/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: { kind: 'url', jsonPaths: ['data[].url', 'data[].b64_json'], download: true },
    },
    docs: {
      sourceUrls: [
        IMAGE_API_DOC,
        IMAGE_TUTORIAL_DOC,
        ...(pro ? [SEEDREAM_PRO_DOC, SEEDREAM_INTERACTIVE_DOC] : []),
      ],
      lastCheckedAt: '2026-07-16',
    },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 30 * 1024 * 1024 },
    error: volcengineArkErrorContract,
  }
}

export const VOLCENGINE_ARK_MEDIA_MODEL_MANIFESTS: readonly MediaModelManifest[] = [
  seedance2Manifest({
    modelId: 'doubao-seedance-2-0-260128',
    displayName: 'Doubao Seedance 2.0',
    resolutions: ['480p', '720p', '1080p', '4k'],
  }),
  seedance2Manifest({
    modelId: 'doubao-seedance-2-0-fast-260128',
    displayName: 'Doubao Seedance 2.0 Fast',
    resolutions: ['480p', '720p'],
  }),
  seedance2Manifest({
    modelId: 'doubao-seedance-2-0-mini-260615',
    displayName: 'Doubao Seedance 2.0 Mini',
    resolutions: ['480p', '720p'],
  }),
  seedanceLegacyManifest({
    modelId: 'doubao-seedance-1-5-pro-251215',
    displayName: 'Doubao Seedance 1.5 Pro（即将下线）',
    schema: seedance15Schema,
    maxImages: 2,
    acceptedMimeTypes: SEEDANCE_IMAGE_MIME,
    imageToVideoSchema: seedance15ImageToVideoSchema,
    defaults: {
      aspectRatio: '智能比例',
      durationSeconds: 5,
      resolution: '720p',
      generateAudio: true,
      draft: false,
      watermark: false,
      returnLastFrame: false,
      seed: -1,
      serviceTier: 'default',
      executionExpiresAfter: 172800,
    },
  }),
  seedanceLegacyManifest({
    modelId: 'doubao-seedance-1-0-pro-250528',
    displayName: 'Doubao Seedance 1.0 Pro',
    schema: seedance10Schema,
    maxImages: 2,
    acceptedMimeTypes: SEEDANCE_10_IMAGE_MIME,
    imageToVideoSchema: seedance10ImageToVideoSchema,
    imageToVideoResolution: '720p',
    defaults: {
      aspectRatio: '智能比例',
      durationSeconds: 5,
      resolution: '1080p',
      cameraFixed: false,
      watermark: false,
      returnLastFrame: false,
      seed: -1,
      serviceTier: 'default',
      executionExpiresAfter: 172800,
    },
  }),
  seedanceLegacyManifest({
    modelId: 'doubao-seedance-1-0-pro-fast-251015',
    displayName: 'Doubao Seedance 1.0 Pro Fast',
    schema: seedance10Schema,
    maxImages: 1,
    acceptedMimeTypes: SEEDANCE_10_IMAGE_MIME,
    imageToVideoSchema: seedance10ImageToVideoSchema,
    imageToVideoResolution: '720p',
    defaults: {
      aspectRatio: '智能比例',
      durationSeconds: 5,
      resolution: '1080p',
      cameraFixed: false,
      watermark: false,
      returnLastFrame: false,
      seed: -1,
      serviceTier: 'default',
      executionExpiresAfter: 172800,
    },
  }),
  seedreamManifest({
    modelId: 'doubao-seedream-5-0-pro-260628',
    displayName: 'Doubao Seedream 5.0 Pro',
    variant: 'pro',
    maxInputImages: 10,
  }),
  seedreamManifest({
    modelId: 'doubao-seedream-5-0-lite-260128',
    displayName: 'Doubao Seedream 5.0 Lite',
    variant: 'lite',
    maxInputImages: 14,
  }),
  seedreamManifest({
    modelId: 'doubao-seedream-5-0-260128',
    displayName: 'Doubao Seedream 5.0 Lite（兼容 ID）',
    variant: 'lite',
    maxInputImages: 14,
  }),
  seedreamManifest({
    modelId: 'doubao-seedream-4-5-251128',
    displayName: 'Doubao Seedream 4.5',
    variant: '4.5',
    maxInputImages: 14,
  }),
  seedreamManifest({
    modelId: 'doubao-seedream-4-0-250828',
    displayName: 'Doubao Seedream 4.0',
    variant: '4.0',
    maxInputImages: 14,
  }),
]
