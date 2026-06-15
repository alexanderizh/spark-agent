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

const videoSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    aspectRatio: { type: 'string', title: '比例', examples: ['16:9', '9:16', '1:1'] },
    durationSeconds: { type: 'integer', title: '时长', minimum: 1, maximum: 60 },
    resolution: { type: 'string', title: '分辨率', examples: ['720p', '1080p'] },
    fps: { type: 'integer', title: '帧率', minimum: 1, maximum: 120 },
    seed: { type: 'integer', title: '随机种子' },
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
        paramSchema: imageSizeSchema,
        defaults: { n: 1, size: '1024x1024' },
        aliases: { aspectRatio: 'aspect_ratio', outputFormat: 'output_format' },
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 8, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: imageSizeSchema,
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
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: videoSchema,
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/videos/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: { kind: 'task_poll', taskIdPaths: ['task_id', 'request_id', 'id'], statusEndpoint: '/videos/generations/{{taskId}}', resultPaths: ['video_url', 'data[].url', 'output.url'] },
      polling: { intervalMs: 5000, timeoutMs: 1200000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://docs.apimart.ai/cn'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  },
  ...[
    { id: 'apimart:gpt-image-1', modelId: 'gpt-image-1', displayName: 'APIMart GPT Image 1' },
    { id: 'apimart:gemini-2-5-flash-image', modelId: 'gemini-2.5-flash-image-preview', displayName: 'APIMart Gemini 2.5 Flash Image (nano-banana)' },
    { id: 'apimart:flux-kontext-pro', modelId: 'flux-kontext-pro', displayName: 'APIMart Flux Kontext Pro' },
    { id: 'apimart:doubao-seedream', modelId: 'doubao-seedream-4-0-250828', displayName: 'APIMart Doubao Seedream 4.0' },
    { id: 'apimart:imagen', modelId: 'imagen-4.0-generate-001', displayName: 'APIMart Google Imagen 4' },
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
        paramSchema: imageSizeSchema,
        defaults: { n: 1, size: '1024x1024' },
        aliases: { aspectRatio: 'aspect_ratio', outputFormat: 'output_format' },
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 8, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: imageSizeSchema,
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
        paramSchema: videoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 5 },
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: videoSchema,
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration' },
      },
    ],
    invocation: {
      mode: 'async_polling' as MediaInvocationMode,
      endpoint: '/videos/generations',
      method: 'POST' as const,
      contentType: 'json' as const,
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: { kind: 'task_poll' as const, taskIdPaths: ['task_id', 'request_id', 'id'], statusEndpoint: '/videos/generations/{{taskId}}', resultPaths: ['video_url', 'data[].url', 'output.url'] },
      polling: { intervalMs: 5000, timeoutMs: 1200000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://docs.apimart.ai/cn'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 100 * 1024 * 1024 },
  })),
  {
    id: 'xai:grok-imagine-image',
    providerKind: 'xai',
    modelId: 'grok-imagine-image',
    displayName: 'xAI Grok Imagine Image',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: imageSizeSchema,
        defaults: { n: 1 },
      },
      {
        id: 'image.edit',
        label: '图生图 / 图片编辑',
        input: { required: ['prompt', 'image'], maxImages: 10, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['image'] as MediaManifestOutputKind[], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        paramSchema: imageSizeSchema,
        defaults: { n: 1 },
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
        paramSchema: videoSchema,
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: videoSchema,
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/videos/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: { kind: 'task_poll', taskIdPaths: ['request_id', 'id'], statusEndpoint: '/videos/generations/{{taskId}}', resultPaths: ['video_url', 'data[].url'] },
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
    id: 'volcengine:seedance',
    providerKind: 'volcengine-ark',
    modelId: 'seedance',
    displayName: 'Volcengine Seedance',
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
      endpoint: '/contents/generations/tasks',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      response: { kind: 'task_poll', taskIdPaths: ['id', 'task_id'], statusEndpoint: '/contents/generations/tasks/{{taskId}}', resultPaths: ['content.video_url', 'data.video_url', 'url'] },
      polling: { intervalMs: 5000, timeoutMs: 1200000, statusMap: commonStatusMap },
    },
    docs: { sourceUrls: ['https://seed.bytedance.com/zh/seedance2_0'] },
    safety: { maxPromptLength: 8000, allowLocalFiles: true },
  },
  ...[
    { id: 'kling:kling-video', providerKind: 'kling', modelId: 'kling-video', displayName: 'Kling Video' },
    { id: 'pixverse:video', providerKind: 'pixverse', modelId: 'pixverse-video', displayName: 'PixVerse Video' },
    { id: 'minimax:hailuo-video', providerKind: 'minimax-hailuo', modelId: 'hailuo-video', displayName: 'MiniMax Hailuo Video' },
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
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频',
        input: { required: ['prompt', 'image'] as MediaManifestInputKind[], maxImages: 1, acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: videoSchema,
        aliases: { aspectRatio: 'aspect_ratio', durationSeconds: 'duration' },
      },
    ],
    invocation: {
      mode: 'async_polling' as MediaInvocationMode,
      endpoint: '/tasks',
      method: 'POST' as const,
      contentType: 'json' as const,
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
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
