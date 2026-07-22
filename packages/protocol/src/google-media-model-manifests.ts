import type {
  MediaDomain,
  MediaManifestInputKind,
  MediaModelCapabilityManifest,
  MediaModelManifest,
} from './media-model-manifest.js'
import { googleGenerativeAiErrorContract } from './media-model-shared-manifest-parts.js'

const LAST_CHECKED_AT = '2026-07-22'
const googleStrictPolicy = { strict: true, passthrough: { enabled: false } } as const
const imageMimeTypes = ['image/png', 'image/jpeg']

const standardAspectRatios = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
]
const flashAspectRatios = [
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '21:9',
]

function geminiImageSchema(
  aspectRatios: readonly string[],
  imageSizes: readonly string[],
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      aspectRatio: {
        type: 'string',
        title: '画幅',
        enum: aspectRatios,
        default: '1:1',
      },
      imageSize: {
        type: 'string',
        title: '分辨率',
        enum: imageSizes,
        default: imageSizes.includes('1K') ? '1K' : imageSizes[0],
      },
      outputFormat: {
        type: 'string',
        title: '输出格式',
        enum: ['png', 'jpeg'],
        default: 'png',
      },
      delivery: {
        type: 'string',
        title: '交付方式',
        enum: ['base64', 'uri'],
        default: 'base64',
      },
      google_search: { type: 'boolean', title: 'Google 搜索', default: false },
      google_image_search: { type: 'boolean', title: 'Google 图片搜索', default: false },
    },
  }
}

const geminiImageModels = [
  {
    modelId: 'gemini-3.1-flash-image',
    displayName: 'Google Gemini 3.1 Flash Image',
    maxImages: 10,
    aspectRatios: flashAspectRatios,
    imageSizes: ['512px', '1K', '2K', '4K'],
  },
  {
    modelId: 'gemini-3.1-flash-lite-image',
    displayName: 'Google Gemini 3.1 Flash Lite Image',
    maxImages: 14,
    aspectRatios: standardAspectRatios,
    imageSizes: ['1K'],
  },
  {
    modelId: 'gemini-3-pro-image',
    displayName: 'Google Gemini 3 Pro Image',
    maxImages: 6,
    aspectRatios: standardAspectRatios,
    imageSizes: ['1K', '2K', '4K'],
  },
  {
    modelId: 'gemini-2.5-flash-image',
    displayName: 'Google Gemini 2.5 Flash Image',
    maxImages: 3,
    aspectRatios: standardAspectRatios,
    imageSizes: ['1K'],
  },
] as const

const geminiImageManifests = geminiImageModels.map((entry): MediaModelManifest => {
  const schema = geminiImageSchema(entry.aspectRatios, entry.imageSizes)
  const defaults = { aspectRatio: '1:1', imageSize: '1K', outputFormat: 'png', delivery: 'base64' }
  const capability = (id: 'image.generate' | 'image.edit'): MediaModelCapabilityManifest => ({
    id,
    label: id === 'image.generate' ? '文生图' : '图生图 / 多图编辑',
    input:
      id === 'image.generate'
        ? { required: ['prompt'] }
        : {
            required: ['prompt', 'image'],
            maxImages: entry.maxImages,
            acceptedMimeTypes: imageMimeTypes,
          },
    ...(id === 'image.edit'
      ? {
          rolePolicy: {
            imageRoles: ['reference_image'] as const,
            defaultRoleAssignment: 'all_reference' as const,
          },
        }
      : {}),
    output: { types: ['image'], mimeTypes: imageMimeTypes },
    paramSchema: schema,
    defaults,
    aliases: {
      aspectRatio: 'aspect_ratio',
      imageSize: 'image_size',
      outputFormat: 'mime_type',
    },
    paramPolicy: googleStrictPolicy,
  })
  return {
    id: `google-generative-ai:${entry.modelId}`,
    providerKind: 'google-generative-ai',
    modelId: entry.modelId,
    displayName: entry.displayName,
    domains: ['image'] as MediaDomain[],
    capabilities: [capability('image.generate'), capability('image.edit')],
    invocation: {
      mode: 'sync',
      endpoint: '/interactions',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', input: '{{content}}' },
      response: {
        kind: 'inline_base64',
        jsonPaths: ['output_image.data', 'outputImage.data', 'steps[].content[].data'],
      },
    },
    docs: {
      sourceUrls: [
        'https://ai.google.dev/gemini-api/docs/image-generation',
        'https://ai.google.dev/gemini-api/docs/interactions-overview',
      ],
      lastCheckedAt: LAST_CHECKED_AT,
    },
    safety: { allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
    error: googleGenerativeAiErrorContract,
  }
})

const imagenSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    numberOfImages: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 4 },
    imageSize: { type: 'string', title: '分辨率', enum: ['1K', '2K'], default: '1K' },
    aspectRatio: {
      type: 'string',
      title: '画幅',
      enum: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      default: '1:1',
    },
    personGeneration: {
      type: 'string',
      title: '人物生成',
      enum: ['dont_allow', 'allow_adult', 'allow_all'],
      default: 'allow_adult',
    },
  },
}

const imagenModels = [
  ['imagen-4.0-generate-001', 'Google Imagen 4'],
  ['imagen-4.0-ultra-generate-001', 'Google Imagen 4 Ultra'],
  ['imagen-4.0-fast-generate-001', 'Google Imagen 4 Fast'],
] as const

const imagenManifests = imagenModels.map(
  ([modelId, displayName]): MediaModelManifest => ({
    id: `google-generative-ai:${modelId}`,
    providerKind: 'google-generative-ai',
    modelId,
    displayName,
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] },
        output: { types: ['image'], mimeTypes: imageMimeTypes },
        paramSchema: modelId.includes('-fast-')
          ? {
              ...imagenSchema,
              properties: {
                ...imagenSchema.properties,
                imageSize: { type: 'string', title: '分辨率', enum: ['1K'], default: '1K' },
              },
            }
          : imagenSchema,
        defaults: {
          numberOfImages: 4,
          imageSize: '1K',
          aspectRatio: '1:1',
          personGeneration: 'allow_adult',
        },
        paramPolicy: googleStrictPolicy,
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/models/{{modelId}}:predict',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { instances: [{ prompt: '{{prompt}}' }] },
      response: {
        kind: 'inline_base64',
        jsonPaths: ['generatedImages[].image.imageBytes', 'predictions[].bytesBase64Encoded'],
      },
    },
    docs: {
      sourceUrls: [
        'https://ai.google.dev/gemini-api/docs/imagen',
        'https://ai.google.dev/gemini-api/docs/deprecations',
      ],
      lastCheckedAt: LAST_CHECKED_AT,
    },
    safety: {
      maxPromptLength: 480,
      promptLengthUnit: 'tokens',
      promptOverflowBehavior: 'reject',
      allowLocalFiles: false,
    },
    error: googleGenerativeAiErrorContract,
  }),
)

const veoSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    aspectRatio: { type: 'string', title: '画幅', enum: ['16:9', '9:16'], default: '16:9' },
    durationSeconds: { type: 'integer', title: '时长', enum: [4, 6, 8], default: 8 },
    resolution: { type: 'string', title: '分辨率', enum: ['720p', '1080p', '4k'], default: '720p' },
    personGeneration: {
      type: 'string',
      title: '人物生成',
      enum: ['dont_allow', 'allow_adult', 'allow_all'],
      default: 'allow_adult',
    },
  },
}

const veoModels = [
  ['veo-3.1-generate-preview', 'Google Veo 3.1'],
  ['veo-3.1-fast-generate-preview', 'Google Veo 3.1 Fast'],
  ['veo-3.1-lite-generate-preview', 'Google Veo 3.1 Lite'],
] as const

function veoCapability(
  id: 'video.generate' | 'video.image_to_video' | 'video.reference_to_video' | 'video.extend',
): MediaModelCapabilityManifest {
  const imageInput = id === 'video.image_to_video' || id === 'video.reference_to_video'
  return {
    id,
    label: {
      'video.generate': '文生视频',
      'video.image_to_video': '首尾帧生视频',
      'video.reference_to_video': '参考图生视频',
      'video.extend': '视频扩展',
    }[id],
    input:
      id === 'video.generate'
        ? { required: ['prompt'] }
        : id === 'video.extend'
          ? { required: ['prompt', 'video'], maxVideos: 1, acceptedMimeTypes: ['video/mp4'] }
          : {
              required: ['prompt', imageInput ? 'image' : 'images'] as MediaManifestInputKind[],
              maxImages: 3,
              acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
            },
    ...(id === 'video.image_to_video'
      ? {
          rolePolicy: {
            imageRoles: ['first_frame', 'last_frame'] as const,
            defaultRoleAssignment: 'first_then_last_then_reference' as const,
          },
        }
      : id === 'video.reference_to_video'
        ? {
            rolePolicy: {
              imageRoles: ['reference_image'] as const,
              defaultRoleAssignment: 'all_reference' as const,
            },
          }
        : id === 'video.extend'
          ? {
              rolePolicy: {
                videoRoles: ['input_video'] as const,
                defaultRoleAssignment: 'none' as const,
              },
            }
          : {}),
    output: { types: ['video'], mimeTypes: ['video/mp4'] },
    paramSchema: veoSchema,
    defaults: {
      aspectRatio: '16:9',
      durationSeconds: 8,
      resolution: '720p',
      personGeneration: 'allow_adult',
    },
    paramPolicy: googleStrictPolicy,
  }
}

const veoManifests = veoModels.map(
  ([modelId, displayName]): MediaModelManifest => ({
    id: `google-generative-ai:${modelId}`,
    providerKind: 'google-generative-ai',
    modelId,
    displayName,
    domains: ['video'],
    capabilities: [
      veoCapability('video.generate'),
      veoCapability('video.image_to_video'),
      veoCapability('video.reference_to_video'),
      veoCapability('video.extend'),
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
        resultPaths: ['response.generateVideoResponse.generatedSamples[].video.uri'],
      },
      polling: {
        intervalMs: 10000,
        timeoutMs: 1800000,
        statusMap: { pending: 'queued', running: 'running', done: 'succeeded', failed: 'failed' },
      },
    },
    docs: {
      sourceUrls: ['https://ai.google.dev/gemini-api/docs/veo'],
      lastCheckedAt: LAST_CHECKED_AT,
    },
    safety: {
      maxPromptLength: 1024,
      promptLengthUnit: 'tokens',
      promptOverflowBehavior: 'reject',
      allowLocalFiles: true,
      maxInputBytes: 50 * 1024 * 1024,
    },
    error: googleGenerativeAiErrorContract,
  }),
)

const omniSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    aspectRatio: { type: 'string', title: '画幅', enum: ['9:16', '16:9'], default: '16:9' },
    durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 10, default: 6 },
    delivery: { type: 'string', title: '交付方式', enum: ['base64', 'uri'], default: 'base64' },
  },
}

const omniCapabilities: MediaModelCapabilityManifest[] = [
  {
    id: 'video.generate',
    label: '文生视频',
    input: { required: ['prompt'] },
    output: { types: ['video'], mimeTypes: ['video/mp4'] },
    paramSchema: omniSchema,
    defaults: { aspectRatio: '16:9', durationSeconds: 6, delivery: 'base64' },
    paramPolicy: googleStrictPolicy,
  },
  {
    id: 'video.image_to_video',
    label: '图生视频',
    input: { required: ['prompt', 'image'], maxImages: 3, acceptedMimeTypes: imageMimeTypes },
    rolePolicy: {
      imageRoles: ['first_frame', 'reference_image'],
      defaultRoleAssignment: 'first_then_last_then_reference',
    },
    output: { types: ['video'], mimeTypes: ['video/mp4'] },
    paramSchema: omniSchema,
    defaults: { aspectRatio: '16:9', durationSeconds: 6, delivery: 'base64' },
    paramPolicy: googleStrictPolicy,
  },
  {
    id: 'video.reference_to_video',
    label: '参考图生视频',
    input: { required: ['prompt', 'images'], maxImages: 3, acceptedMimeTypes: imageMimeTypes },
    rolePolicy: { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' },
    output: { types: ['video'], mimeTypes: ['video/mp4'] },
    paramSchema: omniSchema,
    defaults: { aspectRatio: '16:9', durationSeconds: 6, delivery: 'base64' },
    paramPolicy: googleStrictPolicy,
  },
  {
    id: 'video.edit',
    label: '视频编辑',
    input: {
      required: ['prompt', 'video'],
      maxVideos: 1,
      acceptedMimeTypes: ['video/mp4', 'video/webm'],
    },
    rolePolicy: { videoRoles: ['input_video'], defaultRoleAssignment: 'none' },
    output: { types: ['video'], mimeTypes: ['video/mp4'] },
    paramSchema: omniSchema,
    defaults: { aspectRatio: '16:9', durationSeconds: 6, delivery: 'base64' },
    paramPolicy: googleStrictPolicy,
  },
]

const omniManifest: MediaModelManifest = {
  id: 'google-generative-ai:gemini-omni-flash-preview',
  providerKind: 'google-generative-ai',
  modelId: 'gemini-omni-flash-preview',
  displayName: 'Google Gemini Omni Flash Preview',
  domains: ['video'],
  capabilities: omniCapabilities,
  invocation: {
    mode: 'async_polling',
    endpoint: '/interactions',
    method: 'POST',
    contentType: 'json',
    requestTemplate: { model: '{{modelId}}', input: '{{content}}' },
    response: {
      kind: 'task_poll',
      taskIdPaths: ['id'],
      statusEndpoint: '/interactions/{{taskId}}',
      resultPaths: [
        'output_video.data',
        'output_video.uri',
        'steps[].content[].data',
        'steps[].content[].uri',
      ],
    },
    polling: {
      intervalMs: 5000,
      timeoutMs: 1800000,
      statusMap: {
        in_progress: 'running',
        completed: 'succeeded',
        failed: 'failed',
        cancelled: 'cancelled',
      },
    },
  },
  docs: {
    sourceUrls: [
      'https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash',
      'https://ai.google.dev/gemini-api/docs/omni',
      'https://ai.google.dev/gemini-api/docs/interactions-overview',
    ],
    lastCheckedAt: LAST_CHECKED_AT,
  },
  safety: { allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  error: googleGenerativeAiErrorContract,
}

const lyriaModels = [
  ['lyria-3-clip-preview', 'Google Lyria 3 Clip', '30 秒音乐片段'],
  ['lyria-3-pro-preview', 'Google Lyria 3 Pro', '完整歌曲'],
] as const

const lyriaManifests = lyriaModels.map(
  ([modelId, displayName, label]): MediaModelManifest => ({
    id: `google-generative-ai:${modelId}`,
    providerKind: 'google-generative-ai',
    modelId,
    displayName,
    domains: ['audio'],
    capabilities: [
      {
        id: 'audio.music',
        label,
        input: {
          required: ['prompt'],
          maxImages: 10,
          acceptedMimeTypes: imageMimeTypes,
        },
        rolePolicy: { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' },
        output: {
          types: ['audio'],
          mimeTypes: modelId.includes('-pro-') ? ['audio/mpeg', 'audio/wav'] : ['audio/mpeg'],
        },
        paramSchema: { type: 'object', additionalProperties: false, properties: {} },
        defaults: {},
        paramPolicy: googleStrictPolicy,
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/interactions',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        input: '{{content}}',
        response_format: { type: 'audio' },
      },
      response: {
        kind: 'inline_base64',
        jsonPaths: ['output_audio.data', 'outputAudio.data', 'steps[].content[].data'],
      },
    },
    docs: {
      sourceUrls: [
        'https://ai.google.dev/gemini-api/docs/music-generation',
        'https://ai.google.dev/gemini-api/docs/interactions-overview',
      ],
      lastCheckedAt: LAST_CHECKED_AT,
    },
    safety: { allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
    error: googleGenerativeAiErrorContract,
  }),
)

export const GOOGLE_MEDIA_MODEL_MANIFESTS: readonly MediaModelManifest[] = [
  ...geminiImageManifests,
  ...imagenManifests,
  ...veoManifests,
  omniManifest,
  ...lyriaManifests,
]
