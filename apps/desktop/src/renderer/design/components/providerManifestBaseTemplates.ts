import {
  CUSTOM_IMAGE_MODEL_SIZE_EXAMPLES,
  CUSTOM_IMAGE_MODEL_SIZE_PATTERN,
  DEFAULT_VIDEO_POLL_TIMEOUT_MS,
} from '@spark/protocol'
import type {
  MediaManifestBaseTemplate,
  MediaModelCapabilityManifest,
  MediaModelManifest,
} from '@spark/protocol'

export const ADAPTER_BASE_TEMPLATE_OPTIONS: Array<{
  label: string
  value: MediaManifestBaseTemplate
}> = [
  { label: '完全自定义（从通用 JSON 合同开始）', value: 'custom' },
  { label: 'OpenAI 接口协议基底（按媒体类型生成）', value: 'openai-compatible' },
  { label: '通用异步 JSON 任务（GET 轮询）', value: 'async-json' },
  { label: 'ToApis 图片全能力异步轮询（含上传）', value: 'toapis-image' },
]

export function resolveAdapterBaseTemplate(
  manifest: MediaModelManifest,
): MediaManifestBaseTemplate {
  if (manifest.baseTemplate) return manifest.baseTemplate
  const endpoint = (
    manifest.invocation.request?.endpoint || manifest.invocation.endpoint
  ).toLowerCase()
  const sources = manifest.docs?.sourceUrls?.join(' ').toLowerCase() ?? ''
  if (
    sources.includes('toapis.com') ||
    (endpoint.includes('images/generations') && manifest.invocation.uploads?.length)
  ) {
    return 'toapis-image'
  }
  if (
    endpoint.includes('/images/') ||
    endpoint.endsWith('/videos') ||
    endpoint.includes('/audio/')
  ) {
    return 'openai-compatible'
  }
  if (manifest.invocation.mode === 'async_polling') return 'async-json'
  return 'custom'
}

export function applyAdapterBaseTemplate(
  manifest: MediaModelManifest,
  template: MediaManifestBaseTemplate,
): MediaModelManifest {
  if (template === 'openai-compatible') return openAiCompatibleBase(manifest)
  if (template === 'toapis-image') return toApisImageBase(manifest)
  if (template === 'async-json') return asyncJsonBase(manifest)
  return customBase(manifest)
}

function customBase(manifest: MediaModelManifest): MediaModelManifest {
  const domain = manifest.domains[0] ?? 'image'
  // 与 asyncJsonBase 同一口径：manifest 已经声明了同域能力（例如用户手写的
  // audio.music 音乐合同）时保留它，否则套用「完全自定义」基底会把能力悄悄改回
  // 该域的默认能力（audio 会被改回 audio.speech），音乐模型因此从候选里消失。
  const existingCapability = manifest.capabilities[0]
  const capability =
    existingCapability?.id.startsWith(`${domain}.`) === true
      ? existingCapability
      : basicCapabilityForDomain(domain)
  return {
    ...manifest,
    baseTemplate: 'custom',
    contractVersion: 2,
    adapterMode: 'template',
    providerKind: 'custom',
    capabilities: [capability],
    invocation: {
      mode: 'sync',
      endpoint: '/generate',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      request: {
        method: 'POST',
        endpoint: '/generate',
        auth: { kind: 'bearer', credentialRef: 'apiKey' },
        body: { kind: 'json', template: { model: '{{modelId}}', prompt: '{{prompt}}' } },
      },
      response: { kind: 'url', jsonPaths: ['data[].url', 'output.url', 'url'], download: true },
    },
    error: { codePaths: ['error.code'], messagePaths: ['error.message'] },
  }
}

function openAiCompatibleBase(manifest: MediaModelManifest): MediaModelManifest {
  const domain = manifest.domains[0] ?? 'image'
  if (domain === 'video') return openAiVideoBase(manifest)
  if (domain === 'audio') {
    // 语音域按当前能力分化：识别模型生成 transcriptions 合同，语音合成生成 TTS 合同。
    // 与 openAiImageBase 按 image.edit 分化的模式一致。
    // 音乐生成没有 OpenAI 兼容端点（各厂商协议差异大），套用 OpenAI 基底会把音乐模型
    // 悄悄变成 TTS 合同，这里退回「完全自定义」基底并保留 audio.music 能力声明。
    const capabilityId = manifest.capabilities[0]?.id
    if (capabilityId === 'audio.transcription') return openAiAudioTranscriptionBase(manifest)
    if (capabilityId === 'audio.music') return customBase(manifest)
    return openAiAudioBase(manifest)
  }
  return openAiImageBase(manifest)
}

function openAiImageBase(manifest: MediaModelManifest): MediaModelManifest {
  const editing = manifest.capabilities[0]?.id === 'image.edit'
  const properties = {
    size: {
      type: 'string',
      title: '画面尺寸',
      examples: [...CUSTOM_IMAGE_MODEL_SIZE_EXAMPLES],
      'x-allow-custom': true,
      pattern: CUSTOM_IMAGE_MODEL_SIZE_PATTERN,
      default: 'auto',
    },
    quality: {
      type: 'string',
      title: '生成质量',
      enum: ['auto', 'low', 'medium', 'high'],
      default: 'auto',
    },
    n: { type: 'integer', title: '生成数量', minimum: 1, maximum: 10, default: 1 },
    background: {
      type: 'string',
      title: '背景',
      enum: ['auto', 'opaque', 'transparent'],
      default: 'auto',
    },
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
    user: {
      type: 'string',
      title: '终端用户标识',
    },
  }
  const capability: MediaModelCapabilityManifest = {
    id: editing ? 'image.edit' : 'image.generate',
    label: editing ? '图生图 / 图片编辑' : '文生图',
    input: editing
      ? {
          required: ['prompt', 'image'],
          maxImages: 16,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        }
      : { required: ['prompt'] },
    rolePolicy: editing
      ? { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' }
      : undefined,
    output: { types: ['image'], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
    paramSchema: { type: 'object', additionalProperties: false, properties },
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
    paramPolicy: { strict: true, passthrough: { enabled: false } },
  }
  const commonParts = [
    { name: 'model', kind: 'text' as const, value: '{{modelId}}' },
    { name: 'prompt', kind: 'text' as const, value: '{{prompt}}' },
    { name: 'size', kind: 'text' as const, value: '{{params.size}}' },
    { name: 'quality', kind: 'text' as const, value: '{{params.quality}}' },
    { name: 'n', kind: 'text' as const, value: '{{params.n}}' },
    { name: 'background', kind: 'text' as const, value: '{{params.background}}' },
    { name: 'output_format', kind: 'text' as const, value: '{{params.outputFormat}}' },
    { name: 'output_compression', kind: 'text' as const, value: '{{params.outputCompression}}' },
    { name: 'user', kind: 'text' as const, value: '{{params.user}}' },
  ]
  const request = editing
    ? {
        method: 'POST' as const,
        endpoint: '/images/edits',
        auth: { kind: 'bearer' as const, credentialRef: 'apiKey' },
        body: {
          kind: 'multipart' as const,
          parts: [
            ...commonParts,
            { name: 'image[]', kind: 'file' as const, value: '{{images}}' },
            { name: 'mask', kind: 'file' as const, value: '{{mask}}' },
          ],
        },
      }
    : {
        method: 'POST' as const,
        endpoint: '/images/generations',
        auth: { kind: 'bearer' as const, credentialRef: 'apiKey' },
        body: {
          kind: 'json' as const,
          template: {
            model: '{{modelId}}',
            prompt: '{{prompt}}',
            size: '{{params.size}}',
            quality: '{{params.quality}}',
            n: '{{params.n}}',
            background: '{{params.background}}',
            output_format: '{{params.outputFormat}}',
            output_compression: '{{params.outputCompression}}',
            user: '{{params.user}}',
          },
        },
      }
  return {
    ...manifest,
    baseTemplate: 'openai-compatible',
    contractVersion: 2,
    adapterMode: 'template',
    providerKind: 'custom',
    domains: ['image'],
    capabilities: [capability],
    invocation: {
      mode: 'sync',
      endpoint: request.endpoint,
      method: 'POST',
      contentType: editing ? 'multipart' : 'json',
      requestTemplate:
        request.body.kind === 'json'
          ? request.body.template
          : Object.fromEntries(request.body.parts.map((part) => [part.name, part.value])),
      request,
      response: {
        kind: 'inline_base64',
        jsonPaths: ['data[].b64_json', 'data[].url', 'output[].b64_json', 'output[].url'],
      },
    },
    error: openAiErrorContract(),
    docs: {
      sourceUrls: [
        'https://developers.openai.com/api/reference/resources/images',
        'https://developers.openai.com/api/docs/guides/image-generation',
      ],
      lastCheckedAt: '2026-08-08',
    },
    safety: { ...manifest.safety, allowLocalFiles: true },
  }
}

function openAiVideoBase(manifest: MediaModelManifest): MediaModelManifest {
  const referenceImage = manifest.capabilities[0]?.id === 'video.image_to_video'
  const capability: MediaModelCapabilityManifest = {
    id: referenceImage ? 'video.image_to_video' : 'video.generate',
    label: referenceImage ? '参考图生视频' : '文生视频',
    input: referenceImage
      ? {
          required: ['prompt', 'image'],
          maxImages: 1,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        }
      : { required: ['prompt'] },
    rolePolicy: referenceImage
      ? {
          imageRoles: ['first_frame', 'reference_image'],
          defaultRoleAssignment: 'first_then_last_then_reference',
        }
      : undefined,
    output: { types: ['video'], mimeTypes: ['video/mp4'] },
    paramSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        seconds: { type: 'string', title: '时长（秒）', enum: ['4', '8', '12'], default: '4' },
        size: {
          type: 'string',
          title: '画面尺寸',
          enum: ['720x1280', '1280x720', '1024x1792', '1792x1024'],
          default: '720x1280',
        },
      },
    },
    defaults: { seconds: '4', size: '720x1280' },
    paramPolicy: { strict: true, passthrough: { enabled: false } },
  }
  const fields = {
    model: '{{modelId}}',
    prompt: '{{prompt}}',
    seconds: '{{params.seconds}}',
    size: '{{params.size}}',
  }
  const request = referenceImage
    ? {
        method: 'POST' as const,
        endpoint: '/videos',
        auth: { kind: 'bearer' as const, credentialRef: 'apiKey' },
        body: {
          kind: 'multipart' as const,
          parts: [
            ...Object.entries(fields).map(([name, value]) => ({
              name,
              kind: 'text' as const,
              value,
            })),
            {
              name: 'input_reference',
              kind: 'file' as const,
              value: '{{firstFrame}}',
            },
          ],
        },
      }
    : {
        method: 'POST' as const,
        endpoint: '/videos',
        auth: { kind: 'bearer' as const, credentialRef: 'apiKey' },
        body: { kind: 'json' as const, template: fields },
      }
  return {
    ...manifest,
    baseTemplate: 'openai-compatible',
    contractVersion: 2,
    adapterMode: 'template',
    providerKind: 'custom',
    domains: ['video'],
    capabilities: [capability],
    invocation: {
      mode: 'async_polling',
      endpoint: request.endpoint,
      method: 'POST',
      contentType: referenceImage ? 'multipart' : 'json',
      requestTemplate:
        request.body.kind === 'json'
          ? request.body.template
          : Object.fromEntries(request.body.parts.map((part) => [part.name, part.value])),
      request,
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id'],
        taskId: { location: 'path', name: 'taskId' },
        poll: {
          method: 'GET',
          endpoint: '/videos/{taskId}',
          auth: { kind: 'inherit' },
          body: { kind: 'none' },
        },
        statusPaths: ['status'],
        resultPaths: ['content_url', 'data.url', 'output.url'],
        artifact: {
          request: {
            method: 'GET',
            endpoint: '/videos/{{taskId}}/content',
            auth: { kind: 'inherit' },
            body: { kind: 'none' },
          },
          response: { kind: 'binary_response' },
        },
      },
      polling: {
        // 20s × 8640 = 48h 覆盖默认轮询窗口；maxAttempts 上限 10_000（10s 间隔需 17_280 次，会被 Schema 拒绝）。
        intervalMs: 20_000,
        maxAttempts: 8_640,
        timeoutMs: DEFAULT_VIDEO_POLL_TIMEOUT_MS,
        unknownStatus: 'fail',
        statusMap: {
          queued: 'queued',
          in_progress: 'running',
          completed: 'succeeded',
          failed: 'failed',
          cancelled: 'cancelled',
        },
      },
    },
    error: openAiErrorContract(),
    docs: {
      sourceUrls: [
        'https://developers.openai.com/api/reference/resources/videos/methods/create',
        'https://developers.openai.com/api/reference/resources/videos/methods/download_content',
      ],
      lastCheckedAt: '2026-08-08',
    },
    safety: { ...manifest.safety, allowLocalFiles: true },
  }
}

/**
 * OpenAI 兼容语音识别（/audio/transcriptions）基底：multipart 文件上传，响应 JSON { text }。
 * 必须用 Contract V2 request.body 声明 kind:'file' 段——legacy contentType:'multipart'
 * 分支只产出 text parts，不会上传文件（见 media-invocation-compiler.ts）。
 * 先例：zhipu:glm-asr-2512 与 minimax:asr-1.0。
 */
function openAiAudioTranscriptionBase(manifest: MediaModelManifest): MediaModelManifest {
  const capability: MediaModelCapabilityManifest = {
    id: 'audio.transcription',
    label: '语音转文本',
    input: { required: ['audio'], maxAudios: 1 },
    output: { types: ['text'], mimeTypes: ['text/plain'] },
    paramSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        language: {
          type: 'string',
          title: '音频语言',
          description: 'ISO-639-1 语言代码（如 zh、en）；留空由服务端自动检测',
        },
        // 画布识别节点的通用兜底字段一直提供 response_format，但基底合同里没有对应
        // multipart 段，用户选中后会被静默丢弃；此处补上声明与投放，留空时编译器跳过该段。
        response_format: {
          type: 'string',
          title: '返回格式',
          enum: ['json', 'verbose_json', 'srt', 'vtt'],
          description: 'OpenAI 兼容取值；留空用服务端默认。是否为渠道支持以厂商文档为准',
        },
      },
    },
    defaults: {},
  }
  return {
    ...manifest,
    baseTemplate: 'openai-compatible',
    contractVersion: 2,
    adapterMode: 'template',
    providerKind: 'custom',
    domains: ['audio'],
    capabilities: [capability],
    invocation: {
      mode: 'sync',
      endpoint: '/audio/transcriptions',
      method: 'POST',
      // legacy 镜像字段：承载契约展示；真实请求由下方 request 编译（必须含 file 段）。
      contentType: 'multipart',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      request: {
        method: 'POST',
        endpoint: '/audio/transcriptions',
        auth: { kind: 'bearer', credentialRef: 'apiKey' },
        body: {
          kind: 'multipart',
          parts: [
            { name: 'file', kind: 'file', value: '{{audio}}' },
            { name: 'model', kind: 'text', value: '{{modelId}}' },
            // STT 的 prompt 官方语义即「专有名词纠正提示」，与快速创作识别模式的补充说明对应；
            // 留空时编译器自动跳过该段。
            { name: 'prompt', kind: 'text', value: '{{prompt}}' },
            { name: 'language', kind: 'text', value: '{{params.language}}' },
            { name: 'response_format', kind: 'text', value: '{{params.response_format}}' },
          ],
        },
      },
      response: { kind: 'url', jsonPaths: ['text'], download: false },
    },
    error: openAiErrorContract(),
    docs: {
      sourceUrls: ['https://developers.openai.com/api/docs/models/whisper-1'],
      lastCheckedAt: '2026-09-30',
    },
    safety: { ...manifest.safety, allowLocalFiles: true },
  }
}

function openAiAudioBase(manifest: MediaModelManifest): MediaModelManifest {
  const capability: MediaModelCapabilityManifest = {
    id: 'audio.speech',
    label: '文本转语音',
    input: { required: ['prompt'] },
    output: { types: ['audio'], mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg'] },
    paramSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        voice: { type: 'string', title: '音色', default: 'alloy' },
        format: {
          type: 'string',
          title: '音频格式',
          enum: ['mp3', 'wav', 'opus', 'aac', 'flac'],
          default: 'mp3',
        },
        speed: { type: 'number', title: '语速', minimum: 0.25, maximum: 4, default: 1 },
      },
    },
    defaults: { voice: 'alloy', format: 'mp3', speed: 1 },
    aliases: { format: 'response_format' },
    paramPolicy: { strict: true, passthrough: { enabled: false } },
  }
  const template = {
    model: '{{modelId}}',
    input: '{{text}}',
    voice: '{{params.voice}}',
    response_format: '{{params.format}}',
    speed: '{{params.speed}}',
  }
  return {
    ...manifest,
    baseTemplate: 'openai-compatible',
    contractVersion: 2,
    adapterMode: 'template',
    providerKind: 'custom',
    domains: ['audio'],
    capabilities: [capability],
    invocation: {
      mode: 'sync',
      endpoint: '/audio/speech',
      method: 'POST',
      contentType: 'json',
      requestTemplate: template,
      request: {
        method: 'POST',
        endpoint: '/audio/speech',
        auth: { kind: 'bearer', credentialRef: 'apiKey' },
        body: { kind: 'json', template },
      },
      response: { kind: 'binary_response' },
    },
    error: openAiErrorContract(),
    docs: {
      sourceUrls: ['https://developers.openai.com/api/docs/models/gpt-4o-mini-tts'],
      lastCheckedAt: '2026-08-08',
    },
  }
}

function asyncJsonBase(manifest: MediaModelManifest): MediaModelManifest {
  const domain = manifest.domains[0] ?? 'image'
  const existingCapability = manifest.capabilities[0]
  const capability =
    existingCapability?.id.startsWith(`${domain}.`) === true
      ? existingCapability
      : basicCapabilityForDomain(domain)
  const template = { model: '{{modelId}}', prompt: '{{prompt}}', ...capability.defaults }
  return {
    ...manifest,
    baseTemplate: 'async-json',
    contractVersion: 2,
    adapterMode: 'template',
    providerKind: 'custom',
    capabilities: [capability],
    invocation: {
      mode: 'async_polling',
      endpoint: '/generate',
      method: 'POST',
      contentType: 'json',
      requestTemplate: template,
      request: {
        method: 'POST',
        endpoint: '/generate',
        auth: { kind: 'bearer', credentialRef: 'apiKey' },
        body: { kind: 'json', template },
      },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id', 'task_id', 'data.id'],
        taskId: { location: 'path', name: 'taskId' },
        poll: {
          method: 'GET',
          endpoint: '/tasks/{taskId}',
          auth: { kind: 'inherit' },
          body: { kind: 'none' },
        },
        statusPaths: ['status', 'data.status'],
        resultPaths: ['result.data[].url', 'data[].url', 'output.url', 'url'],
      },
      polling: {
        intervalMs: 5000,
        timeoutMs: 600_000,
        maxAttempts: 120,
        unknownStatus: 'fail',
        statusMap: {
          queued: 'queued',
          pending: 'queued',
          in_progress: 'running',
          running: 'running',
          completed: 'succeeded',
          succeeded: 'succeeded',
          failed: 'failed',
          error: 'failed',
        },
      },
    },
    error: { codePaths: ['error.code'], messagePaths: ['error.message', 'message'] },
  }
}

function toApisImageBase(manifest: MediaModelManifest): MediaModelManifest {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      size: {
        type: 'string',
        title: '宽高比',
        enum: [
          '1:1',
          '16:9',
          '9:16',
          '2:1',
          '1:2',
          '21:9',
          '9:21',
          '3:2',
          '2:3',
          '4:3',
          '3:4',
          '5:4',
          '4:5',
        ],
        default: '1:1',
      },
      resolution: { type: 'string', enum: ['1k', '2k', '4k'], default: '1k' },
      quality: { type: 'string', enum: ['low', 'medium', 'high'], default: 'high' },
      n: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
      outputFormat: { type: 'string', enum: ['png', 'jpeg'], default: 'png' },
      outputCompression: { type: 'integer', minimum: 0, maximum: 100, default: 100 },
      maskUrl: { type: 'string' },
    },
  }
  const defaults = { size: '1:1', resolution: '1k', quality: 'high', n: 1 }
  const capability = (
    id: 'image.generate' | 'image.edit',
    label: string,
  ): MediaModelCapabilityManifest => ({
    id,
    label,
    input: {
      required: id === 'image.edit' ? ['prompt', 'image'] : ['prompt'],
      maxImages: 16,
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    },
    rolePolicy:
      id === 'image.edit'
        ? { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' }
        : undefined,
    output: { types: ['image'], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
    paramSchema: schema,
    defaults,
    aliases: {
      aspectRatio: 'size',
      outputFormat: 'output_format',
      outputCompression: 'output_compression',
      maskUrl: 'mask_url',
    },
    paramPolicy: { strict: true, passthrough: { enabled: false } },
  })
  const requestTemplate = {
    model: '{{modelId}}',
    prompt: '{{prompt}}',
    size: '{{params.size}}',
    resolution: '{{params.resolution}}',
    quality: '{{params.quality}}',
    n: '{{params.n}}',
    image_urls: '{{uploads.referenceImages.urls}}',
    mask_url: '{{params.maskUrl}}',
    output_format: '{{params.outputFormat}}',
    output_compression: '{{params.outputCompression}}',
  }
  return {
    ...manifest,
    baseTemplate: 'toapis-image',
    contractVersion: 2,
    adapterMode: 'template',
    providerKind: 'custom',
    domains: ['image'],
    capabilities: [
      capability('image.generate', '文生图'),
      capability('image.edit', '图生图 / 图片编辑'),
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/v1/images/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate,
      request: {
        method: 'POST',
        endpoint: '/v1/images/generations',
        auth: { kind: 'bearer', credentialRef: 'apiKey' },
        body: { kind: 'json', template: requestTemplate },
      },
      uploads: [
        {
          name: 'referenceImages',
          input: { variable: 'referenceImages', mode: 'each' },
          constraints: {
            maxCount: 16,
            maxBytes: 10 * 1024 * 1024,
            allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
          },
          request: {
            method: 'POST',
            endpoint: '/v1/uploads/images',
            auth: { kind: 'bearer', credentialRef: 'apiKey' },
            body: {
              kind: 'multipart',
              parts: [{ name: 'file', kind: 'file', value: '{{upload.item}}' }],
            },
          },
          result: { urlPaths: ['data.url'], multiple: true },
        },
      ],
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id'],
        taskId: { location: 'path', name: 'taskId' },
        poll: {
          method: 'GET',
          endpoint: '/v1/images/generations/{taskId}',
          auth: { kind: 'bearer', credentialRef: 'apiKey' },
        },
        resultPaths: ['result.data[].url', 'url'],
      },
      polling: {
        intervalMs: 5000,
        timeoutMs: 120000,
        maxAttempts: 24,
        unknownStatus: 'fail',
        statusMap: {
          queued: 'queued',
          in_progress: 'running',
          completed: 'succeeded',
          failed: 'failed',
        },
      },
    },
    error: { codePaths: ['error.code'], messagePaths: ['error.message'] },
    docs: {
      sourceUrls: [
        'https://docs.toapis.com/docs/en/api-reference/images/gpt-image-2/generation',
        'https://docs.toapis.com/docs/en/api-reference/tasks/image-status',
        'https://docs.toapis.com/docs/en/api-reference/uploads/images',
      ],
      lastCheckedAt: '2026-08-08',
    },
  }
}

function imageGenerateCapability(): MediaModelCapabilityManifest {
  return {
    id: 'image.generate',
    label: '文生图',
    input: { required: ['prompt'] },
    output: { types: ['image'], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
    paramSchema: { type: 'object', additionalProperties: true, properties: {} },
    paramPolicy: { strict: false, passthrough: { enabled: true, allowScalarsOnly: true } },
  }
}

function basicCapabilityForDomain(
  domain: MediaModelManifest['domains'][number],
): MediaModelCapabilityManifest {
  if (domain === 'video') {
    return {
      id: 'video.generate',
      label: '文生视频',
      input: { required: ['prompt'] },
      output: { types: ['video'], mimeTypes: ['video/mp4'] },
      paramSchema: { type: 'object', additionalProperties: true, properties: {} },
      paramPolicy: { strict: false, passthrough: { enabled: true, allowScalarsOnly: true } },
    }
  }
  if (domain === 'audio') {
    return {
      id: 'audio.speech',
      label: '文本转语音',
      input: { required: ['prompt'] },
      output: { types: ['audio'], mimeTypes: ['audio/mpeg'] },
      paramSchema: { type: 'object', additionalProperties: true, properties: {} },
      paramPolicy: { strict: false, passthrough: { enabled: true, allowScalarsOnly: true } },
    }
  }
  return imageGenerateCapability()
}

function openAiErrorContract() {
  return {
    codePaths: ['error.code', 'error.type'],
    messagePaths: ['error.message'],
    requestIdPaths: ['request_id', 'error.request_id'],
    mappings: {
      invalid_request_error: 'invalid_parameter_value' as const,
      rate_limit_exceeded: 'rate_limited' as const,
      insufficient_quota: 'quota_exceeded' as const,
      invalid_api_key: 'auth_failed' as const,
    },
    retryableCodes: ['rate_limit_exceeded', 'server_error'],
  }
}
