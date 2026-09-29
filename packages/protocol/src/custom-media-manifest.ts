import type { MediaModelCapabilityManifest, MediaModelManifest } from './media-model-manifest.js'
import { DEFAULT_VIDEO_POLL_TIMEOUT_MS } from './media-config.js'

export interface BasicCustomMediaManifestInput {
  modelId: string
  modelType: 'image' | 'video' | 'voice'
  mode: 'sync' | 'async_polling'
  /** Persisted id for editing legacy manifests. Omit when creating a new manifest. */
  manifestId?: string
}

export function createCustomMediaManifestId(
  modelId: string,
  instanceId = createManifestInstanceId(),
): string {
  const readableModelId = slugifyModelId(modelId.trim()) || 'model'
  const safeInstanceId = instanceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
  if (!safeInstanceId) throw new Error('Custom media manifest instance id cannot be empty')
  return `custom:${readableModelId}:${safeInstanceId}`
}

export function createBasicCustomMediaManifest(
  input: BasicCustomMediaManifestInput,
): MediaModelManifest {
  const modelId = input.modelId.trim()
  const id = input.manifestId?.trim() || createCustomMediaManifestId(modelId)
  // 语音（TTS）基础合同走 OpenAI 兼容 /audio/speech：响应是二进制音频裸流，
  // 与 image/video 的 JSON→URL 提取完全不同，单独走一个构造分支。
  if (input.modelType === 'voice') return basicCustomVoiceManifest(modelId, id)
  const capabilities = customCapabilitiesForType(input.modelType)
  const endpoint = input.modelType === 'image' ? '/images/generations' : '/videos/generations'
  const requestTemplate = { model: '{{modelId}}', prompt: '{{prompt}}' }

  if (input.mode === 'async_polling') {
    return {
      id,
      baseTemplate: 'custom',
      providerKind: 'custom',
      modelId,
      displayName: modelId,
      domains: [input.modelType],
      capabilities,
      invocation: {
        mode: 'async_polling',
        endpoint,
        method: 'POST',
        contentType: 'json',
        requestTemplate,
        response: {
          kind: 'task_poll',
          taskIdPaths: ['task_id', 'id'],
          statusEndpoint: '/tasks/{{taskId}}',
          resultPaths:
            input.modelType === 'video'
              ? ['data.result.videos[].url[]', 'data[].url', 'output.url', 'url']
              : ['data[].url', 'output.url', 'url'],
        },
        polling: {
          intervalMs: 5_000,
          timeoutMs: input.modelType === 'video' ? DEFAULT_VIDEO_POLL_TIMEOUT_MS : 600_000,
          statusMap: {
            queued: 'queued',
            pending: 'queued',
            running: 'running',
            processing: 'running',
            succeeded: 'succeeded',
            success: 'succeeded',
            completed: 'succeeded',
            failed: 'failed',
            error: 'failed',
            cancelled: 'cancelled',
          },
        },
      },
      docs: { sourceUrls: [] },
    }
  }

  return {
    id,
    baseTemplate: 'custom',
    providerKind: 'custom',
    modelId,
    displayName: modelId,
    domains: [input.modelType],
    capabilities,
    invocation: {
      mode: 'sync',
      endpoint,
      method: 'POST',
      contentType: 'json',
      requestTemplate,
      response: {
        kind: 'url',
        jsonPaths: ['data[].url', 'output.url', 'url'],
        download: true,
      },
    },
    docs: { sourceUrls: [] },
  }
}

function createManifestInstanceId(): string {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.randomUUID) {
    throw new Error('Secure randomUUID support is required to create a custom media manifest')
  }
  return cryptoApi.randomUUID()
}

function customCapabilitiesForType(modelType: 'image' | 'video'): MediaModelCapabilityManifest[] {
  if (modelType === 'image') return [imageGenerateCapability(), imageEditCapability()]
  return [
    videoGenerateCapability(),
    videoImageToVideoCapability(),
    videoReferenceToVideoCapability(),
    videoEditCapability(),
    videoExtendCapability(),
  ]
}

/**
 * 自定义语音（TTS）渠道的基础 manifest：OpenAI 兼容 POST /audio/speech。
 * 响应是二进制音频裸流（非 JSON），因此用 binary_response 直接落盘。
 * 语音识别（audio.transcription）端点不同（/audio/transcriptions），不在
 * 基础 manifest 里混入——需要时由契约编辑器基底模板生成（见 providerManifestBaseTemplates）。
 */
function basicCustomVoiceManifest(modelId: string, id: string): MediaModelManifest {
  return {
    id,
    baseTemplate: 'openai-compatible',
    providerKind: 'custom',
    modelId,
    displayName: modelId,
    domains: ['audio'],
    capabilities: [
      {
        id: 'audio.speech',
        label: '文本转语音',
        input: { required: ['prompt'] },
        output: { types: ['audio'], mimeTypes: ['audio/mpeg', 'audio/wav'] },
        paramSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            voice: { type: 'string', title: '音色' },
            speed: { type: 'number', title: '语速', minimum: 0.25, maximum: 4, default: 1 },
          },
        },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/audio/speech',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        input: '{{prompt}}',
        voice: '{{params.voice}}',
        speed: '{{params.speed}}',
      },
      response: { kind: 'binary_response' },
    },
    docs: { sourceUrls: [] },
  }
}

function imageGenerateCapability(): MediaModelCapabilityManifest {
  return {
    id: 'image.generate',
    label: '文生图',
    input: { required: ['prompt'] },
    output: { types: ['image'], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
    paramSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: { type: 'string', title: '尺寸' },
        aspectRatio: { type: 'string', title: '比例' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 16, default: 1 },
        quality: { type: 'string', title: '质量' },
        seed: { type: 'integer', title: '随机种子' },
      },
    },
    defaults: { n: 1 },
  }
}

function imageEditCapability(): MediaModelCapabilityManifest {
  return {
    ...imageGenerateCapability(),
    id: 'image.edit',
    label: '图生图 / 图片编辑',
    input: { required: ['prompt', 'image'], maxImages: 16 },
    rolePolicy: { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' },
  }
}

function videoGenerateCapability(): MediaModelCapabilityManifest {
  return {
    id: 'video.generate',
    label: '文生视频',
    input: { required: ['prompt'] },
    output: { types: ['video'], mimeTypes: ['video/mp4'] },
    paramSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: { type: 'string', title: '比例' },
        duration: { type: 'integer', title: '时长（秒）', minimum: 1, maximum: 300 },
        resolution: { type: 'string', title: '分辨率' },
        quality: { type: 'string', title: '质量' },
        seed: { type: 'integer', title: '随机种子' },
      },
    },
  }
}

function videoImageToVideoCapability(): MediaModelCapabilityManifest {
  return {
    ...videoGenerateCapability(),
    id: 'video.image_to_video',
    label: '图生视频',
    input: { required: ['prompt', 'image'], maxImages: 2 },
    rolePolicy: {
      imageRoles: ['first_frame', 'last_frame'],
      defaultRoleAssignment: 'first_then_last_then_reference',
    },
  }
}

function videoReferenceToVideoCapability(): MediaModelCapabilityManifest {
  return {
    ...videoGenerateCapability(),
    id: 'video.reference_to_video',
    label: '参考图生视频',
    input: { required: ['prompt', 'image'], maxImages: 16 },
    rolePolicy: { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' },
  }
}

function videoEditCapability(): MediaModelCapabilityManifest {
  return {
    ...videoGenerateCapability(),
    id: 'video.edit',
    label: '视频编辑',
    input: { required: ['prompt', 'video'] },
    rolePolicy: { videoRoles: ['input_video'], defaultRoleAssignment: 'none' },
  }
}

function videoExtendCapability(): MediaModelCapabilityManifest {
  return {
    ...videoGenerateCapability(),
    id: 'video.extend',
    label: '视频扩展',
    input: { required: ['prompt', 'video'] },
    rolePolicy: { videoRoles: ['input_video'], defaultRoleAssignment: 'none' },
  }
}

function slugifyModelId(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
