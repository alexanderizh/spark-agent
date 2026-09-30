import type {
  MediaDomain,
  MediaModelCapabilityManifest,
  MediaModelManifest,
} from './media-model-manifest.js'
import { DEFAULT_VIDEO_POLL_TIMEOUT_MS } from './media-config.js'

export interface BasicCustomMediaManifestInput {
  modelId: string
  /**
   * 媒体域。`'audio'` 是 `'voice'` 的等价别名：调用方（如 Agent 渠道配置器）内部
   * 统一用 image/video/audio 三个域表示，这里接受别名避免每次调用都要做一次映射。
   */
  modelType: 'image' | 'video' | 'voice' | 'audio'
  mode: 'sync' | 'async_polling'
  /** Persisted id for editing legacy manifests. Omit when creating a new manifest. */
  manifestId?: string
  /**
   * 语音渠道勾选的 audio.* 能力（如 ['audio.speech', 'audio.music']）。
   *
   * 一个 manifest 只有一份 invocation，而 `/audio/speech`（二进制音频流）、
   * `/audio/transcriptions`（multipart 上传）与音乐生成的 JSON 合同三者的
   * 请求/响应形态互不相同，无法在同一个 manifest 里并存；因此这里按
   * `AUDIO_MANIFEST_CAPABILITY_PRIORITY` 取「主能力」生成对应契约，
   * 缺省 `audio.speech`（历史行为，保证旧调用不变）。
   */
  audioCapabilities?: readonly string[] | undefined
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
  if (input.modelType === 'voice' || input.modelType === 'audio')
    return basicCustomVoiceManifest(modelId, id, input.audioCapabilities)
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
/**
 * 自定义语音（TTS）渠道的基础 manifest：OpenAI 兼容 POST /audio/speech。
 * 响应是二进制音频裸流（非 JSON），因此用 binary_response 直接落盘。
 *
 * 语音域三个能力的默认契约差异见 `AUDIO_MANIFEST_CAPABILITY_PRIORITY` 注释与
 * 各 `customAudio*Capability()` 构造器；识别契约必须携带 V2 `request`（multipart
 * 里要有 file 段），否则 legacy multipart 迁移只会产出纯文本 parts、音频传不上去。
 */
function basicCustomVoiceManifest(
  modelId: string,
  id: string,
  requestedCapabilities?: readonly string[],
): MediaModelManifest {
  const capabilityId = primaryCustomAudioCapability(requestedCapabilities)
  const base = {
    id,
    // 音乐生成没有 OpenAI 兼容端点，按「完全自定义」记录基底来源。
    baseTemplate: (capabilityId === 'audio.music' ? 'custom' : 'openai-compatible') as
      | 'custom'
      | 'openai-compatible',
    providerKind: 'custom',
    modelId,
    displayName: modelId,
    domains: ['audio'] as MediaDomain[],
  }

  if (capabilityId === 'audio.transcription') {
    const template = { model: '{{modelId}}', prompt: '{{prompt}}' }
    return {
      ...base,
      capabilities: [customAudioTranscriptionCapability()],
      invocation: {
        mode: 'sync',
        endpoint: '/audio/transcriptions',
        method: 'POST',
        // legacy 镜像字段：真实请求由下方 request 编译（必须含 file 段）。
        contentType: 'multipart',
        requestTemplate: template,
        request: {
          method: 'POST',
          endpoint: '/audio/transcriptions',
          auth: { kind: 'bearer', credentialRef: 'apiKey' },
          body: {
            kind: 'multipart',
            parts: [
              { name: 'file', kind: 'file', value: '{{audio}}' },
              { name: 'model', kind: 'text', value: '{{modelId}}' },
              { name: 'language', kind: 'text', value: '{{params.language}}' },
              { name: 'response_format', kind: 'text', value: '{{params.responseFormat}}' },
            ],
          },
        },
        response: { kind: 'url', jsonPaths: ['text'], download: false },
      },
      docs: { sourceUrls: [] },
    }
  }

  if (capabilityId === 'audio.music') {
    // 音乐生成各厂商协议差异大（MiniMax 走 /v1/music_generation + URL 响应、
    // 火山走 /api/v3/tts/create、Google 走 interactions），没有通用端点。
    // 这里以仓库内唯一已核对的「自定义渠道可直接调通」形态（内置 minimax:music-2.6）
    // 作为起点，用户可在「编辑协议」里按所属厂商文档改写 endpoint / 字段。
    return {
      ...base,
      capabilities: [customAudioMusicCapability()],
      invocation: {
        mode: 'sync',
        endpoint: '/v1/music_generation',
        method: 'POST',
        contentType: 'json',
        requestTemplate: {
          model: '{{modelId}}',
          prompt: '{{prompt}}',
          lyrics: '{{params.lyrics}}',
          output_format: '{{params.outputFormat}}',
          is_instrumental: '{{params.is_instrumental}}',
        },
        response: {
          kind: 'url',
          jsonPaths: ['data.audio', 'data.url', 'output.url', 'url'],
          download: true,
        },
      },
      docs: { sourceUrls: [] },
    }
  }

  return {
    ...base,
    capabilities: [customAudioSpeechCapability()],
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

/** 自定义语音模型的候选能力优先级，取第一个被勾选的能力生成 manifest 契约。 */
export const AUDIO_MANIFEST_CAPABILITY_PRIORITY = [
  'audio.speech',
  'audio.music',
  'audio.transcription',
] as const

export type CustomAudioCapabilityId = (typeof AUDIO_MANIFEST_CAPABILITY_PRIORITY)[number]

/**
 * 由「渠道勾选的能力」决定自定义语音模型使用哪份契约；未勾选任何语音能力时
 * 回退 `audio.speech`（历史默认），保证旧配置与旧调用行为不变。
 */
export function primaryCustomAudioCapability(
  requested?: readonly string[] | undefined,
): CustomAudioCapabilityId {
  const wanted = new Set(
    (requested ?? []).map((item) => (typeof item === 'string' ? item.trim() : '')),
  )
  return (
    AUDIO_MANIFEST_CAPABILITY_PRIORITY.find((capability) => wanted.has(capability)) ??
    'audio.speech'
  )
}

function customAudioSpeechCapability(): MediaModelCapabilityManifest {
  return {
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
  }
}

function customAudioMusicCapability(): MediaModelCapabilityManifest {
  return {
    id: 'audio.music',
    label: '文生音乐',
    input: { required: ['prompt'] },
    output: { types: ['audio'], mimeTypes: ['audio/mpeg', 'audio/wav'] },
    paramSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        lyrics: { type: 'string', title: '歌词（留空则按提示词生成）' },
        // 键名必须用 canonical `outputFormat`：编译器在裁剪前会把 provider 原生名
        // `output_format` 无条件归一成 canonical（CANONICAL_ALIASES_FALLBACK），
        // 用原生名声明会与归一后的参数对不上，`{{params.outputFormat}}` 也就渲染不出
        // 用户选择。回写 provider 原生字段由 aliases 负责（与内置 manifest 同一约定）。
        outputFormat: {
          type: 'string',
          title: '返回形式',
          enum: ['url', 'hex'],
          default: 'url',
        },
        is_instrumental: { type: 'boolean', title: '纯音乐', default: false },
      },
    },
    aliases: { outputFormat: 'output_format' },
  }
}

function customAudioTranscriptionCapability(): MediaModelCapabilityManifest {
  return {
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
        // 画布识别节点的通用兜底字段会提供 response_format；键名按内置 manifest 约定写
        // canonical `responseFormat`（编译器先把 `response_format` 归一成 canonical 再裁剪，
        // 用原生名声明会被 strict 判为未声明字段而丢弃）。multipart 段名由 request 显式给出，
        // 回写 provider 原生字段由 aliases 负责。留空时编译器自动跳过该段。
        responseFormat: {
          type: 'string',
          title: '返回格式',
          enum: ['json', 'verbose_json', 'srt', 'vtt'],
          description: 'OpenAI 兼容取值；留空用服务端默认。是否为渠道支持以厂商文档为准',
        },
      },
    },
    aliases: { responseFormat: 'response_format' },
    defaults: {},
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
