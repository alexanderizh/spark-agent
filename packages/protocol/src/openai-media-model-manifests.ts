import type {
  MediaDomain,
  MediaManifestInputKind,
  MediaManifestOutputKind,
  MediaModelManifest,
} from './media-model-manifest.js'
import { DEFAULT_VIDEO_POLL_TIMEOUT_MS } from './media-config.js'
import type { MediaErrorContract } from './media-model-contract.js'

const LAST_CHECKED_AT = '2026-07-22'

const openAiErrorContract: MediaErrorContract = {
  codePaths: ['error.code', 'error.type'],
  messagePaths: ['error.message'],
  requestIdPaths: ['request_id', 'error.request_id'],
  paramNamePatterns: [
    'parameter[:\\s]+`?([a-zA-Z0-9_.-]+)`?',
    'param(?:eter)?[:\\s]+`?([a-zA-Z0-9_.-]+)`?',
  ],
  mappings: {
    moderation_blocked: 'content_policy_blocked',
    image_generation_user_error: 'invalid_parameter_value',
    invalid_request_error: 'invalid_parameter_value',
    rate_limit_exceeded: 'rate_limited',
    insufficient_quota: 'quota_exceeded',
    invalid_api_key: 'auth_failed',
  },
  retryableCodes: ['rate_limit_exceeded', 'server_error'],
}

const commonImageProperties = {
  quality: {
    type: 'string',
    title: '质量',
    enum: ['auto', 'low', 'medium', 'high'],
    default: 'auto',
  },
  moderation: {
    type: 'string',
    title: '审核强度',
    enum: ['auto', 'low'],
    default: 'auto',
  },
  n: { type: 'integer', title: '数量', minimum: 1, maximum: 10, default: 1 },
  outputFormat: {
    type: 'string',
    title: '输出格式',
    enum: ['png', 'jpeg', 'webp'],
    default: 'png',
  },
  outputCompression: {
    type: 'integer',
    title: '输出压缩率',
    minimum: 0,
    maximum: 100,
    default: 100,
  },
  user: { type: 'string', title: '终端用户标识' },
}

function openAiImageSchema(modelId: string, editing: boolean): Record<string, unknown> {
  const isGptImage2 = modelId === 'gpt-image-2' || modelId.startsWith('gpt-image-2-')
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...commonImageProperties,
      size: isGptImage2
        ? {
            type: 'string',
            title: '尺寸',
            examples: ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x1024'],
            default: 'auto',
          }
        : {
            type: 'string',
            title: '尺寸',
            enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
            default: 'auto',
          },
      background: {
        type: 'string',
        title: '背景',
        enum: isGptImage2 ? ['auto', 'opaque'] : ['auto', 'opaque', 'transparent'],
        default: 'auto',
      },
      ...(editing
        ? {
            mask: { type: 'string', title: '遮罩图' },
            ...(!isGptImage2
              ? {
                  inputFidelity: {
                    type: 'string',
                    title: '输入保真度',
                    enum: ['low', 'high'],
                    default: 'low',
                  },
                }
              : {}),
          }
        : {}),
    },
  }
}

const imageParamPolicy = {
  strict: true,
  passthrough: { enabled: false },
}

function openAiModelDocsUrl(modelId: string): string {
  if (modelId === 'gpt-image-2' || modelId.startsWith('gpt-image-2-')) {
    return 'https://developers.openai.com/api/docs/models/gpt-image-2'
  }
  if (modelId === 'gpt-image-1.5' || modelId.startsWith('gpt-image-1.5-')) {
    return 'https://developers.openai.com/api/docs/models/gpt-image-1.5'
  }
  if (modelId === 'gpt-image-1') {
    return 'https://developers.openai.com/api/docs/models/gpt-image-1'
  }
  if (modelId === 'gpt-image-1-mini') {
    return 'https://developers.openai.com/api/docs/models/gpt-image-1-mini'
  }
  if (modelId === 'chatgpt-image-latest') {
    return 'https://developers.openai.com/api/docs/models/chatgpt-image-latest'
  }
  if (modelId === 'sora-2' || modelId.startsWith('sora-2-2025-')) {
    return 'https://developers.openai.com/api/docs/models/sora-2'
  }
  return 'https://developers.openai.com/api/docs/models/sora-2-pro'
}

const imageModels = [
  ['gpt-image-2', 'OpenAI GPT Image 2'],
  ['gpt-image-2-2026-04-21', 'OpenAI GPT Image 2 (2026-04-21)'],
  ['gpt-image-1.5', 'OpenAI GPT Image 1.5'],
  ['gpt-image-1.5-2025-12-16', 'OpenAI GPT Image 1.5 (2025-12-16)'],
  ['gpt-image-1', 'OpenAI GPT Image 1'],
  ['gpt-image-1-mini', 'OpenAI GPT Image 1 Mini'],
  ['chatgpt-image-latest', 'OpenAI ChatGPT Image Latest'],
] as const

const imageManifests = imageModels.map(
  ([modelId, displayName]): MediaModelManifest => ({
    id: `openai-images:${modelId}`,
    providerKind: 'openai-images',
    modelId,
    displayName,
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
        paramSchema: openAiImageSchema(modelId, false),
        defaults: {
          size: 'auto',
          quality: 'auto',
          n: 1,
          outputFormat: 'png',
        },
        aliases: {
          outputFormat: 'output_format',
          outputCompression: 'output_compression',
        },
        paramPolicy: imageParamPolicy,
      },
      {
        id: 'image.edit',
        label: '图生图 / 多图编辑',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 16,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        rolePolicy: {
          imageRoles: ['reference_image'],
          defaultRoleAssignment: 'all_reference',
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: openAiImageSchema(modelId, true),
        defaults: {
          size: 'auto',
          quality: 'auto',
          n: 1,
          outputFormat: 'png',
        },
        aliases: {
          outputFormat: 'output_format',
          outputCompression: 'output_compression',
          inputFidelity: 'input_fidelity',
        },
        paramPolicy: imageParamPolicy,
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
    docs: {
      sourceUrls: [
        'https://developers.openai.com/api/docs/guides/image-generation',
        'https://developers.openai.com/api/reference/resources/images',
        openAiModelDocsUrl(modelId),
      ],
      lastCheckedAt: LAST_CHECKED_AT,
    },
    safety: {
      maxPromptLength: 32000,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'reject',
      allowLocalFiles: true,
      maxInputBytes: 50 * 1024 * 1024,
    },
    error: openAiErrorContract,
  }),
)

const soraSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seconds: {
      type: 'string',
      title: '时长',
      enum: ['4', '8', '12', '16', '20'],
      default: '4',
    },
    size: {
      type: 'string',
      title: '尺寸',
      enum: ['720x1280', '1280x720', '1024x1792', '1792x1024', '1920x1080', '1080x1920'],
      default: '720x1280',
    },
  },
}

const soraModels = [
  ['sora-2', 'OpenAI Sora 2'],
  ['sora-2-2025-10-06', 'OpenAI Sora 2 (2025-10-06)'],
  ['sora-2-2025-12-08', 'OpenAI Sora 2 (2025-12-08)'],
  ['sora-2-pro', 'OpenAI Sora 2 Pro'],
  ['sora-2-pro-2025-10-06', 'OpenAI Sora 2 Pro (2025-10-06)'],
] as const

const soraManifests = soraModels.map(
  ([modelId, displayName]): MediaModelManifest => ({
    id: `openai-images:${modelId}`,
    providerKind: 'openai-images',
    modelId,
    displayName,
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] },
        output: { types: ['video'], mimeTypes: ['video/mp4'] },
        paramSchema: soraSchema,
        defaults: { seconds: '4', size: '720x1280' },
        paramPolicy: { strict: true, passthrough: { enabled: false } },
      },
      {
        id: 'video.image_to_video',
        label: '参考图生视频',
        input: {
          required: ['prompt', 'image'],
          maxImages: 1,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        rolePolicy: {
          imageRoles: ['first_frame', 'reference_image'],
          defaultRoleAssignment: 'first_then_last_then_reference',
        },
        output: { types: ['video'], mimeTypes: ['video/mp4'] },
        paramSchema: soraSchema,
        defaults: { seconds: '4', size: '720x1280' },
        paramPolicy: { strict: true, passthrough: { enabled: false } },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/videos',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        prompt: '{{prompt}}',
        seconds: '{{seconds}}',
        size: '{{size}}',
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id'],
        statusEndpoint: '/videos/{{taskId}}',
        resultPaths: ['content_url'],
      },
      polling: {
        intervalMs: 10000,
        timeoutMs: DEFAULT_VIDEO_POLL_TIMEOUT_MS,
        statusMap: {
          queued: 'queued',
          in_progress: 'running',
          completed: 'succeeded',
          failed: 'failed',
        },
      },
    },
    docs: {
      sourceUrls: [
        'https://developers.openai.com/api/docs/guides/video-generation',
        'https://developers.openai.com/api/reference/resources/videos/methods/create',
        openAiModelDocsUrl(modelId),
      ],
      lastCheckedAt: LAST_CHECKED_AT,
    },
    safety: {
      maxPromptLength: 32000,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'reject',
      allowLocalFiles: true,
    },
    error: openAiErrorContract,
  }),
)

export const OPENAI_MEDIA_MODEL_MANIFESTS: readonly MediaModelManifest[] = [
  ...imageManifests,
  ...soraManifests,
]
