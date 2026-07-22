import type { MediaCapabilityId, MediaProviderKind, ProviderModelType } from '@spark/protocol'

export const MEDIA_PROVIDER_LABELS: Record<MediaProviderKind, string> = {
  apimart: 'APIMart',
  agnes: 'Agnes AI',
  xai: 'xAI',
  bailian: '阿里百炼',
  'openai-compatible': 'OpenAI Compatible',
  'openai-images': 'OpenAI 多媒体',
  'google-generative-ai': 'Google Gemini / Veo / Lyria',
  'volcengine-ark': '火山方舟 / Seedance',
  kling: 'Kling',
  pixverse: 'PixVerse',
  'minimax-hailuo': 'MiniMax Hailuo',
  wan: 'Wan',
  happyhorse: 'HappyHorse',
  omni: 'Omni',
  midjourney: 'Midjourney 网关',
  'tencent-tokenhub': '腾讯云 TokenHub',
  custom: '自定义',
}

const USABLE_MEDIA_PROVIDER_KINDS: readonly MediaProviderKind[] = [
  'apimart',
  'agnes',
  'xai',
  'bailian',
  'openai-compatible',
  'openai-images',
  'google-generative-ai',
  'omni',
  'midjourney',
  'volcengine-ark',
  'kling',
  'minimax-hailuo',
  'tencent-tokenhub',
  'custom',
]

export const SUPPORTED_IMAGE_VIDEO_MEDIA_PROVIDERS: readonly MediaProviderKind[] = [
  'apimart',
  'xai',
  'volcengine-ark',
  'bailian',
  'openai-images',
  'google-generative-ai',
  'tencent-tokenhub',
  'custom',
]

export const MEDIA_CAPABILITY_LABELS: Record<MediaCapabilityId, string> = {
  'image.generate': '生图',
  'image.edit': '图生图 / 图片编辑',
  'image.variations': '图片变体',
  'audio.speech': '语音合成',
  'audio.music': '音乐生成',
  'audio.transcription': '语音转写',
  'video.generate': '文生视频',
  'video.image_to_video': '图生视频',
  'video.reference_to_video': '参考图生视频',
  'video.edit': '视频编辑',
  'video.extend': '视频扩展',
}

export function mediaProviderOptionsForModelType(
  modelType: ProviderModelType,
): readonly MediaProviderKind[] {
  return modelType === 'image' || modelType === 'video'
    ? SUPPORTED_IMAGE_VIDEO_MEDIA_PROVIDERS
    : USABLE_MEDIA_PROVIDER_KINDS
}

export function capabilitiesForModelType(modelType: ProviderModelType): MediaCapabilityId[] {
  if (modelType === 'image') return ['image.generate', 'image.edit']
  if (modelType === 'voice') return ['audio.music', 'audio.speech', 'audio.transcription']
  if (modelType === 'video') {
    return [
      'video.generate',
      'video.image_to_video',
      'video.reference_to_video',
      'video.edit',
      'video.extend',
    ]
  }
  return []
}

export type MediaRequestPreviewForm = {
  modelType: ProviderModelType
  defaultModel: string
  mediaCapabilities: MediaCapabilityId[]
}

export function getMediaRequestPreviewUrl(
  baseUrl: string,
  form: MediaRequestPreviewForm,
  mediaProvider: MediaProviderKind,
): string {
  if (form.modelType === 'image') {
    if (mediaProvider === 'google-generative-ai' || mediaProvider === 'omni') {
      const model = form.defaultModel.trim()
      return model.startsWith('imagen-')
        ? `${baseUrl}/models/${encodeURIComponent(model)}:predict`
        : `${baseUrl}/interactions`
    }
    if (mediaProvider === 'midjourney') return `${baseUrl}/imagine`
    if (mediaProvider === 'bailian') return `${baseUrl}/multimodal-generation/generation`
    if (mediaProvider === 'tencent-tokenhub') {
      return form.defaultModel === 'hy-image-lite'
        ? `${baseUrl}/v1/api/image/lite`
        : `${baseUrl}/v1/api/image/submit`
    }
    return `${baseUrl}/images/generations`
  }

  if (form.modelType === 'voice') {
    const capabilities = new Set(form.mediaCapabilities)
    if (mediaProvider === 'google-generative-ai' && capabilities.has('audio.music')) {
      return `${baseUrl}/interactions`
    }
    if (capabilities.has('audio.transcription') && !capabilities.has('audio.speech')) {
      return `${baseUrl}/audio/transcriptions`
    }
    return `${baseUrl}/audio/speech`
  }

  if (form.modelType === 'video') {
    if (mediaProvider === 'agnes' || mediaProvider === 'openai-images') return `${baseUrl}/videos`
    if (mediaProvider === 'google-generative-ai' || mediaProvider === 'omni') {
      const model = form.defaultModel.trim() || '{model}'
      return model.startsWith('gemini-omni-')
        ? `${baseUrl}/interactions`
        : `${baseUrl}/models/${encodeURIComponent(model)}:predictLongRunning`
    }
    if (mediaProvider === 'volcengine-ark') return `${baseUrl}/contents/generations/tasks`
    if (mediaProvider === 'bailian') return `${baseUrl}/video-generation/video-synthesis`
    if (mediaProvider === 'tencent-tokenhub') return `${baseUrl}/v1/api/video/submit`
    return `${baseUrl}/videos/generations`
  }

  return baseUrl
}
