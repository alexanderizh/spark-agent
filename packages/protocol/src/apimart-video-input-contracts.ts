import type { MediaInputRolePolicy } from './media-config.js'

type ApimartManifestInputKind =
  | 'prompt'
  | 'image'
  | 'images'
  | 'video'
  | 'audio'
  | 'mask'
  | 'text'
  | 'file'

type ApimartVideoCapabilityId =
  | 'video.generate'
  | 'video.image_to_video'
  | 'video.reference_to_video'
  | 'video.edit'

export interface ApimartVideoInputContract {
  id: ApimartVideoCapabilityId
  label: string
  input: {
    required: ApimartManifestInputKind[]
    maxImages?: number
    maxVideos?: number
    maxAudios?: number
    acceptedMimeTypes?: string[]
  }
  rolePolicy?: MediaInputRolePolicy
}

interface ReferenceInputProfile {
  acceptsImages?: boolean
  maxImages?: number
  maxVideos?: number
  maxAudios?: number
  promptOptional?: boolean
}

interface EditInputProfile {
  maxImages?: number
  maxVideos: number
  promptOptional?: boolean
}

interface ApimartVideoInputProfile {
  frameImages?: 1 | 2
  framePromptOptional?: boolean
  reference?: ReferenceInputProfile
  edit?: EditInputProfile
}

const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp']
const VIDEO_MIME = ['video/mp4', 'video/quicktime']
const AUDIO_MIME = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4']

/**
 * APIMart 官方视频文档中的素材数量与输入模式快照。
 *
 * 这里刻意不使用“所有模型统一 1 图 / 2 图”的兜底：只有文档明确给出数量时才声明上限，
 * 避免通用画布校验把供应商实际支持的多参考图请求提前拦截。
 * 文档索引：https://docs.apimart.ai/llms.txt（最后核对：2026-07-17）。
 */
const APIMART_VIDEO_INPUT_PROFILES: Readonly<Record<string, ApimartVideoInputProfile>> = {
  'sora-2': { frameImages: 1 },
  'sora-2-pro': { frameImages: 1 },
  'doubao-seedance-2.0': {
    frameImages: 2,
    framePromptOptional: true,
    reference: { maxImages: 9, maxVideos: 3, maxAudios: 3, promptOptional: true },
  },
  'doubao-seedance-2-0-fast': {
    frameImages: 2,
    framePromptOptional: true,
    reference: { maxImages: 9, maxVideos: 3, maxAudios: 3, promptOptional: true },
  },
  'doubao-seedance-2-0-mini': {
    frameImages: 2,
    framePromptOptional: true,
    reference: { maxImages: 9, maxVideos: 3, maxAudios: 3, promptOptional: true },
  },
  'veo3.1-fast': { frameImages: 2, reference: { maxImages: 3 } },
  'veo3.1-quality': { frameImages: 2 },
  'veo3.1-lite': {},
  veo3: { frameImages: 2, reference: { maxImages: 3 } },
  'doubao-seedance-1-5-pro': { frameImages: 2 },
  'doubao-seedance-1-0-pro-fast': { frameImages: 1 },
  'doubao-seedance-1-0-pro-quality': { frameImages: 2 },
  'MiniMax-Hailuo-2.3': { frameImages: 1 },
  'MiniMax-Hailuo-02': { frameImages: 2 },
  'skyreels-v4-fast': {
    frameImages: 2,
    reference: { maxImages: 15, maxVideos: 1 },
  },
  'skyreels-v4-std': {
    frameImages: 2,
    reference: { maxImages: 15, maxVideos: 1 },
  },
  'happyhorse-1.0': {
    frameImages: 1,
    framePromptOptional: true,
    reference: { maxImages: 9 },
    edit: { maxImages: 5, maxVideos: 1 },
  },
  'happyhorse-1.1': { frameImages: 1, framePromptOptional: true, reference: { maxImages: 9 } },
  'wan2.5-preview': { frameImages: 1, framePromptOptional: true },
  'wan2.6': { frameImages: 1 },
  'wan2.7': { frameImages: 2, framePromptOptional: true },
  'wan2.7-r2v': { reference: { maxImages: 5, maxVideos: 5 } },
  'wan2.7-videoedit': { edit: { maxImages: 4, maxVideos: 1, promptOptional: true } },
  'kling-v2-6': { frameImages: 2 },
  'kling-v3': { frameImages: 2 },
  'kling-v3-omni': {
    frameImages: 2,
    reference: { acceptsImages: true, maxVideos: 1 },
  },
  'kling-3.0-turbo': { frameImages: 1, framePromptOptional: true },
  'kling-video-o1': {
    frameImages: 2,
    reference: { acceptsImages: true, maxVideos: 1 },
  },
  'viduq3-pro': { frameImages: 2, framePromptOptional: true },
  'viduq3-turbo': { frameImages: 2, framePromptOptional: true },
  viduq3: { reference: { maxImages: 7 } },
  'viduq3-mix': { reference: { maxImages: 7 } },
  'grok-imagine-1.5-video-apimart': { reference: { maxImages: 7 } },
  'pixverse-v6': { frameImages: 2, reference: { maxImages: 7 } },
  'gemini-omni-flash-preview': {
    reference: { maxImages: 16, maxVideos: 1, promptOptional: true },
    edit: { maxImages: 16, maxVideos: 1, promptOptional: true },
  },
  'Omni-Flash-Ext': {
    frameImages: 1,
    reference: { maxImages: 3, maxVideos: 1 },
  },
}

export function apimartVideoInputContracts(modelId: string): ApimartVideoInputContract[] {
  // Unknown/custom APIMart models must not inherit a guessed one-image limit.
  // They still expose text-to-video; a provider-specific profile can add the
  // correct media capability once its official contract is known.
  const profile = APIMART_VIDEO_INPUT_PROFILES[modelId] ?? {}
  const contracts: ApimartVideoInputContract[] = [
    {
      id: 'video.generate',
      label: '文生视频',
      input: { required: ['prompt'] },
    },
  ]

  if (profile.frameImages) {
    contracts.push(
      frameContract(profile.frameImages, profile.framePromptOptional === true),
    )
  } else if (profile.reference?.maxImages) {
    contracts.push(referenceImageToVideoContract(profile.reference))
  }
  if (profile.reference) contracts.push(referenceContract(profile.reference))
  if (profile.edit) contracts.push(editContract(profile.edit))
  return contracts
}

export function apimartVideoCapabilityDefaults(
  modelId: string,
  capabilityId: ApimartVideoCapabilityId,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...defaults }
  if (modelId === 'Omni-Flash-Ext' && capabilityId === 'video.reference_to_video') {
    delete next.durationSeconds
    delete next.duration
  }
  if (modelId === 'happyhorse-1.0' && capabilityId !== 'video.edit') {
    delete next.audio_setting
  }
  return next
}

function frameContract(
  maxFrameImages: 1 | 2,
  promptOptional = false,
): ApimartVideoInputContract {
  return {
    id: 'video.image_to_video',
    label: maxFrameImages === 2 ? '首帧 / 首尾帧生视频' : '首帧生视频',
    input: {
      required: [...(promptOptional ? [] : ['prompt'] as const), 'image'],
      // Reference-image limits belong to video.reference_to_video. Keeping
      // this value frame-specific prevents a model with (for example) 15
      // reference images from advertising 15 first/last-frame inputs.
      maxImages: maxFrameImages,
      acceptedMimeTypes: IMAGE_MIME,
    },
    rolePolicy: {
      imageRoles: [
        'first_frame',
        ...(maxFrameImages === 2 ? (['last_frame'] as const) : []),
      ],
      defaultRoleAssignment: 'first_then_last_then_reference',
    },
  }
}

function referenceImageToVideoContract(
  profile: ReferenceInputProfile,
): ApimartVideoInputContract {
  return {
    id: 'video.image_to_video',
    label: '参考图生视频',
    input: {
      required: ['prompt', 'image'],
      ...(profile.maxImages != null ? { maxImages: profile.maxImages } : {}),
      acceptedMimeTypes: IMAGE_MIME,
    },
    rolePolicy: {
      imageRoles: ['reference_image'],
      defaultRoleAssignment: 'all_reference',
    },
  }
}

function referenceContract(profile: ReferenceInputProfile): ApimartVideoInputContract {
  const acceptsImages = profile.acceptsImages === true || profile.maxImages != null
  return {
    id: 'video.reference_to_video',
    label: '多模态参考生视频',
    input: {
      required: profile.promptOptional ? [] : ['prompt'],
      ...(profile.maxImages != null ? { maxImages: profile.maxImages } : {}),
      ...(profile.maxVideos != null ? { maxVideos: profile.maxVideos } : {}),
      ...(profile.maxAudios != null ? { maxAudios: profile.maxAudios } : {}),
      acceptedMimeTypes: [
        ...(acceptsImages ? IMAGE_MIME : []),
        ...(profile.maxVideos != null ? VIDEO_MIME : []),
        ...(profile.maxAudios != null ? AUDIO_MIME : []),
      ],
    },
    rolePolicy: {
      ...(acceptsImages ? { imageRoles: ['reference_image'] as const } : {}),
      ...(profile.maxVideos != null ? { videoRoles: ['reference_video'] as const } : {}),
      ...(profile.maxAudios != null ? { audioRoles: ['reference_audio'] as const } : {}),
      defaultRoleAssignment: 'all_reference',
    },
  }
}

function editContract(profile: EditInputProfile): ApimartVideoInputContract {
  return {
    id: 'video.edit',
    label: '视频编辑',
    input: {
      required: [...(profile.promptOptional ? [] : ['prompt'] as const), 'video'],
      maxVideos: profile.maxVideos,
      ...(profile.maxImages != null ? { maxImages: profile.maxImages } : {}),
      acceptedMimeTypes: [...VIDEO_MIME, ...(profile.maxImages != null ? IMAGE_MIME : [])],
    },
    rolePolicy: {
      ...(profile.maxImages != null ? { imageRoles: ['reference_image'] as const } : {}),
      videoRoles: ['input_video'],
      defaultRoleAssignment: profile.maxImages != null ? 'all_reference' : 'none',
    },
  }
}
