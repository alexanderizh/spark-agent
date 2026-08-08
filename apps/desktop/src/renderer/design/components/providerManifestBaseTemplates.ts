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
  const capability = basicCapabilityForDomain(manifest.domains[0] ?? 'image')
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
  if (domain === 'audio') return openAiAudioBase(manifest)
  return openAiImageBase(manifest)
}

function openAiImageBase(manifest: MediaModelManifest): MediaModelManifest {
  const editing = manifest.capabilities[0]?.id === 'image.edit'
  const properties = {
    size: {
      type: 'string',
      title: '画面尺寸',
      enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
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
        intervalMs: 10_000,
        timeoutMs: 1_800_000,
        maxAttempts: 180,
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
