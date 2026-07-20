/** Alibaba Cloud Bailian built-in multimedia model manifests. */

import type {
  MediaManifestInputKind,
  MediaManifestOutputKind,
  MediaModelManifest,
} from './media-model-manifest.js'
import {
  audioSpeechSchema,
  bailianImageSchema,
  bailianQwenImageSchema,
} from './media-model-shared-manifest-parts.js'

const bailianCommonStatusMap = {
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
  ...bailianCommonStatusMap,
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
    duration: {
      type: 'integer',
      title: '时长（秒，0 表示跟随输入视频）',
      minimum: 0,
      maximum: 10,
      default: 0,
    },
    audio_setting: { type: 'string', title: '声音设置', enum: ['auto', 'origin'], default: 'auto' },
    prompt_extend: { type: 'boolean', title: '提示词智能改写', default: true },
    watermark: { type: 'boolean', title: '水印', default: false },
    seed: { type: 'integer', title: '随机种子', minimum: 0, maximum: 2147483647 },
  },
}

export const BAILIAN_MEDIA_MODEL_MANIFESTS: readonly MediaModelManifest[] = [
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
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: bailianImageSchema,
        defaults: { size: '2K', n: 1, thinking_mode: true, watermark: false },
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 9,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: bailianImageSchema,
        defaults: { size: '2K', n: 1, watermark: false },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/multimodal-generation/generation',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        input: {
          messages: [
            {
              role: 'user',
              content: '{{content}}',
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
        kind: 'url',
        jsonPaths: ['output.choices[].message.content[].image'],
        download: true,
      },
    },
    docs: {
      sourceUrls: [
        'https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference',
      ],
      lastCheckedAt: '2026-07-17',
    },
    safety: {
      maxPromptLength: 5000,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'truncate',
      allowLocalFiles: true,
      maxInputBytes: 50 * 1024 * 1024,
    },
  },
  {
    id: 'bailian:wan2.7-image',
    providerKind: 'bailian',
    modelId: 'wan2.7-image',
    displayName: 'Wan 2.7 Image',
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
        paramSchema: {
          ...bailianImageSchema,
          properties: {
            ...bailianImageSchema.properties,
            size: { type: 'string', title: '图像规格', enum: ['1K', '2K'], default: '2K' },
            color_palette: { type: 'array', readOnly: true, title: '仅 Pro 版支持自定义颜色主题' },
          },
        },
        defaults: { size: '2K', n: 1, thinking_mode: true, watermark: false },
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 9,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: {
          ...bailianImageSchema,
          properties: {
            ...bailianImageSchema.properties,
            size: { type: 'string', title: '图像规格', enum: ['1K', '2K'], default: '2K' },
            color_palette: { type: 'array', readOnly: true, title: '仅 Pro 版支持自定义颜色主题' },
          },
        },
        defaults: { size: '2K', n: 1, watermark: false },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/multimodal-generation/generation',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        input: {
          messages: [
            {
              role: 'user',
              content: '{{content}}',
            },
          ],
        },
        parameters: {
          size: '{{size}}',
          n: '{{n}}',
          seed: '{{seed}}',
          thinking_mode: '{{thinking_mode}}',
          enable_sequential: '{{enable_sequential}}',
          bbox_list: '{{bbox_list}}',
          watermark: '{{watermark}}',
        },
      },
      response: {
        kind: 'url',
        jsonPaths: ['output.choices[].message.content[].image'],
        download: true,
      },
    },
    docs: {
      sourceUrls: [
        'https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference',
      ],
      lastCheckedAt: '2026-07-17',
    },
    safety: {
      maxPromptLength: 5000,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'truncate',
      allowLocalFiles: true,
      maxInputBytes: 50 * 1024 * 1024,
    },
  },
  {
    id: 'bailian:qwen-image-2.0-pro',
    providerKind: 'bailian',
    modelId: 'qwen-image-2.0-pro',
    displayName: 'Qwen Image 2.0 Pro',
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
        paramSchema: bailianQwenImageSchema,
        defaults: { size: '2048*2048', n: 1, prompt_extend: true, watermark: false },
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 3,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: bailianQwenImageSchema,
        defaults: { size: '2048*2048', n: 1, prompt_extend: true, watermark: false },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/multimodal-generation/generation',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        input: {
          messages: [
            {
              role: 'user',
              content: '{{content}}',
            },
          ],
        },
        parameters: {
          size: '{{size}}',
          n: '{{n}}',
          negative_prompt: '{{negative_prompt}}',
          prompt_extend: '{{prompt_extend}}',
          watermark: '{{watermark}}',
          seed: '{{seed}}',
        },
      },
      response: {
        kind: 'url',
        jsonPaths: ['output.choices[].message.content[].image'],
        download: true,
      },
    },
    docs: {
      sourceUrls: [
        'https://help.aliyun.com/zh/model-studio/qwen-image-api',
        'https://help.aliyun.com/zh/model-studio/qwen-image-edit-api',
      ],
      lastCheckedAt: '2026-07-19',
    },
    safety: {
      maxPromptLength: 1300,
      promptLengthUnit: 'tokens',
      promptOverflowBehavior: 'truncate',
      allowLocalFiles: true,
      maxInputBytes: 50 * 1024 * 1024,
    },
  },
  {
    id: 'bailian:qwen-image-2.0',
    providerKind: 'bailian',
    modelId: 'qwen-image-2.0',
    displayName: 'Qwen Image 2.0',
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
        paramSchema: bailianQwenImageSchema,
        defaults: { size: '2048*2048', n: 1, prompt_extend: true, watermark: false },
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 3,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        paramSchema: bailianQwenImageSchema,
        defaults: { size: '2048*2048', n: 1, prompt_extend: true, watermark: false },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/multimodal-generation/generation',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        input: {
          messages: [
            {
              role: 'user',
              content: '{{content}}',
            },
          ],
        },
        parameters: {
          size: '{{size}}',
          n: '{{n}}',
          negative_prompt: '{{negative_prompt}}',
          prompt_extend: '{{prompt_extend}}',
          watermark: '{{watermark}}',
          seed: '{{seed}}',
        },
      },
      response: {
        kind: 'url',
        jsonPaths: ['output.choices[].message.content[].image'],
        download: true,
      },
    },
    docs: {
      sourceUrls: [
        'https://help.aliyun.com/zh/model-studio/qwen-image-api',
        'https://help.aliyun.com/zh/model-studio/qwen-image-edit-api',
      ],
      lastCheckedAt: '2026-07-19',
    },
    safety: {
      maxPromptLength: 1300,
      promptLengthUnit: 'tokens',
      promptOverflowBehavior: 'truncate',
      allowLocalFiles: true,
      maxInputBytes: 50 * 1024 * 1024,
    },
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
        input: {
          required: ['image'] as MediaManifestInputKind[],
          maxImages: 2,
          maxVideos: 1,
          maxAudios: 1,
          acceptedMimeTypes: [
            'image/png',
            'image/jpeg',
            'image/jpg',
            'image/webp',
            'image/bmp',
            'video/mp4',
            'video/quicktime',
            'audio/wav',
            'audio/mpeg',
          ],
        },
        rolePolicy: {
          imageRoles: ['first_frame', 'last_frame'],
          videoRoles: ['input_video'],
          audioRoles: ['reference_audio'],
          defaultRoleAssignment: 'first_then_last_then_reference',
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: wanVideoSchema,
        aliases: {
          aspectRatio: 'ratio',
          durationSeconds: 'duration',
          promptExtend: 'prompt_extend',
        },
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
        resultPaths: [
          'output.video_url',
          'data[].video_url',
          'data[].url',
          'data.video_url',
          'output.url',
          'video_url',
          'url',
        ],
      },
      polling: { intervalMs: 15000, timeoutMs: 1800000, statusMap: bailianVideoStatusMap },
    },
    docs: {
      sourceUrls: ['https://help.aliyun.com/zh/model-studio/image-to-video-general-api-reference'],
      lastCheckedAt: '2026-07-17',
    },
    safety: {
      maxPromptLength: 5000,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'truncate',
      allowLocalFiles: true,
      maxInputBytes: 100 * 1024 * 1024,
    },
  },
  {
    id: 'bailian:wan2.7-t2v',
    providerKind: 'bailian',
    modelId: 'wan2.7-t2v-2026-06-12',
    displayName: 'Wan 2.7 Text-to-Video',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: wanTextToVideoSchema,
        aliases: {
          aspectRatio: 'ratio',
          durationSeconds: 'duration',
          promptExtend: 'prompt_extend',
        },
        defaults: {
          resolution: '1080P',
          ratio: '16:9',
          duration: 5,
          prompt_extend: true,
          watermark: false,
        },
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
        resultPaths: [
          'output.video_url',
          'data[].video_url',
          'data[].url',
          'data.video_url',
          'output.url',
          'video_url',
          'url',
        ],
      },
      polling: { intervalMs: 15000, timeoutMs: 1800000, statusMap: bailianVideoStatusMap },
    },
    docs: { sourceUrls: ['https://help.aliyun.com/zh/model-studio/text-to-video-guide'] },
    safety: {
      maxPromptLength: 5000,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'truncate',
      allowLocalFiles: true,
      maxInputBytes: 100 * 1024 * 1024,
    },
  },
  {
    id: 'bailian:wan2.7-r2v',
    providerKind: 'bailian',
    modelId: 'wan2.7-r2v-2026-06-12',
    displayName: 'Wan 2.7 Reference-to-Video',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.reference_to_video',
        label: '参考生视频',
        input: {
          required: ['prompt'] as MediaManifestInputKind[],
          maxImages: 5,
          maxVideos: 5,
          maxAudios: 1,
          acceptedMimeTypes: [
            'image/png',
            'image/jpeg',
            'image/jpg',
            'image/webp',
            'image/bmp',
            'video/mp4',
            'video/quicktime',
            'audio/wav',
            'audio/mpeg',
          ],
        },
        rolePolicy: {
          imageRoles: ['first_frame', 'reference_image'],
          videoRoles: ['reference_video'],
          audioRoles: ['reference_audio'],
          defaultRoleAssignment: 'all_reference',
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: wanTextToVideoSchema,
        aliases: {
          aspectRatio: 'ratio',
          durationSeconds: 'duration',
          promptExtend: 'prompt_extend',
        },
        defaults: {
          resolution: '1080P',
          ratio: '16:9',
          duration: 5,
          prompt_extend: true,
          watermark: false,
        },
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
        resultPaths: [
          'output.video_url',
          'data[].video_url',
          'data[].url',
          'data.video_url',
          'output.url',
          'video_url',
          'url',
        ],
      },
      polling: { intervalMs: 15000, timeoutMs: 1800000, statusMap: bailianVideoStatusMap },
    },
    docs: {
      sourceUrls: ['https://help.aliyun.com/zh/model-studio/wan-reference-to-video-api-reference'],
      lastCheckedAt: '2026-07-17',
    },
    safety: {
      maxPromptLength: 5000,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'truncate',
      allowLocalFiles: true,
      maxInputBytes: 100 * 1024 * 1024,
    },
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
        input: {
          required: ['video'] as MediaManifestInputKind[],
          maxImages: 4,
          maxVideos: 1,
          acceptedMimeTypes: [
            'video/mp4',
            'video/quicktime',
            'image/png',
            'image/jpeg',
            'image/jpg',
            'image/webp',
            'image/bmp',
          ],
        },
        rolePolicy: {
          imageRoles: ['reference_image'],
          videoRoles: ['input_video'],
          defaultRoleAssignment: 'all_reference',
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: wanVideoEditSchema,
        aliases: {
          aspectRatio: 'ratio',
          durationSeconds: 'duration',
          promptExtend: 'prompt_extend',
          audioSetting: 'audio_setting',
        },
        defaults: {
          resolution: '1080P',
          duration: 0,
          audio_setting: 'auto',
          prompt_extend: true,
          watermark: false,
        },
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
        resultPaths: [
          'output.video_url',
          'data[].video_url',
          'data[].url',
          'data.video_url',
          'output.url',
          'video_url',
          'url',
        ],
      },
      polling: { intervalMs: 15000, timeoutMs: 1800000, statusMap: bailianVideoStatusMap },
    },
    docs: {
      sourceUrls: ['https://help.aliyun.com/zh/model-studio/wan-video-editing-api-reference'],
      lastCheckedAt: '2026-07-17',
    },
    safety: {
      maxPromptLength: 5000,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'truncate',
      allowLocalFiles: true,
      maxInputBytes: 100 * 1024 * 1024,
    },
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
        resultPaths: [
          'output.video_url',
          'data[].video_url',
          'data[].url',
          'data.video_url',
          'output.url',
          'video_url',
          'url',
        ],
      },
      polling: { intervalMs: 15000, timeoutMs: 1800000, statusMap: bailianVideoStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://help.aliyun.com/zh/model-studio/happyhorse-text-to-video-api-reference',
      ],
    },
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
        resultPaths: [
          'output.video_url',
          'data[].video_url',
          'data[].url',
          'data.video_url',
          'output.url',
          'video_url',
          'url',
        ],
      },
      polling: { intervalMs: 15000, timeoutMs: 1800000, statusMap: bailianVideoStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://help.aliyun.com/zh/model-studio/happyhorse-text-to-video-api-reference',
      ],
    },
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
        input: {
          required: ['image'] as MediaManifestInputKind[],
          maxImages: 1,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
        },
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
        resultPaths: [
          'output.video_url',
          'data[].video_url',
          'data[].url',
          'data.video_url',
          'output.url',
          'video_url',
          'url',
        ],
      },
      polling: { intervalMs: 15000, timeoutMs: 1800000, statusMap: bailianVideoStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://help.aliyun.com/zh/model-studio/happyhorse-image-to-video-api-reference',
      ],
    },
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
        input: {
          required: ['image'] as MediaManifestInputKind[],
          maxImages: 1,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
        },
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
        resultPaths: [
          'output.video_url',
          'data[].video_url',
          'data[].url',
          'data.video_url',
          'output.url',
          'video_url',
          'url',
        ],
      },
      polling: { intervalMs: 15000, timeoutMs: 1800000, statusMap: bailianVideoStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://help.aliyun.com/zh/model-studio/happyhorse-image-to-video-api-reference',
      ],
    },
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
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 9,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
        },
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
        resultPaths: [
          'output.video_url',
          'data[].video_url',
          'data[].url',
          'data.video_url',
          'output.url',
          'video_url',
          'url',
        ],
      },
      polling: { intervalMs: 15000, timeoutMs: 1800000, statusMap: bailianVideoStatusMap },
    },
    docs: {
      sourceUrls: [
        'https://help.aliyun.com/zh/model-studio/happyhorse-reference-to-video-api-reference',
      ],
    },
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
        input: {
          required: ['prompt', 'video'] as MediaManifestInputKind[],
          maxImages: 2,
          acceptedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
        },
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
        resultPaths: [
          'output.video_url',
          'data[].video_url',
          'data[].url',
          'data.video_url',
          'output.url',
          'video_url',
          'url',
        ],
      },
      polling: { intervalMs: 15000, timeoutMs: 1800000, statusMap: bailianVideoStatusMap },
    },
    docs: {
      sourceUrls: ['https://help.aliyun.com/zh/model-studio/happyhorse-video-edit-api-reference'],
    },
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
        output: {
          types: ['audio'] as MediaManifestOutputKind[],
          mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg'],
        },
        paramSchema: audioSpeechSchema,
        defaults: { format: 'mp3', voice: 'default', speed: 1 },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/audio/speech',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        input: '{{text}}',
        voice: '{{voice}}',
        format: '{{format}}',
        speed: '{{speed}}',
      },
      response: { kind: 'binary_response' },
    },
    docs: {
      sourceUrls: ['https://bailian.console.aliyun.com/cn-beijing/?tab=model#/model-market'],
    },
  },
]
