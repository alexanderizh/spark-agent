import type { MediaCapabilityId } from '@spark/protocol'

export interface ApimartVideoInputFieldsInput {
  modelId: string
  capability: MediaCapabilityId
  firstFrame?: string | undefined
  lastFrame?: string | undefined
  inputVideo?: string | undefined
  referenceImages: string[]
  referenceVideos: string[]
  referenceAudios: string[]
}

const SKYREELS_MODELS = new Set(['skyreels-v4-fast', 'skyreels-v4-std'])
const KLING_MULTIMODAL_MODELS = new Set(['kling-v3-omni', 'kling-video-o1'])
const IMAGE_URL_FRAME_MODELS = new Set([
  'sora-2',
  'sora-2-pro',
  'doubao-seedance-2.0',
  'doubao-seedance-2-0-fast',
  'doubao-seedance-2-0-mini',
  'doubao-seedance-2.0-fast',
  'doubao-seedance-2.0-mini',
  'doubao-seedance-1-0-pro-fast',
  'doubao-seedance-1-0-pro-quality',
  'veo3',
  'veo3.1-fast',
  'veo3.1-quality',
  'wan2.5-preview',
  'wan2.6',
  'wan2.7',
  'kling-v2-6',
  'kling-v3',
  'kling-v3-omni',
  'kling-video-o1',
  'viduq3-pro',
  'viduq3-turbo',
  'Omni-Flash-Ext',
])
const FIRST_FRAME_ONLY_MODELS = new Set([
  'MiniMax-Hailuo-2.3',
  'happyhorse-1.0',
  'happyhorse-1.1',
  'kling-3.0-turbo',
])
const ROLE_FRAME_MODELS = new Set([
  'doubao-seedance-1-5-pro',
  'doubao-seedance-2.0',
  'doubao-seedance-2-0-fast',
  'doubao-seedance-2-0-mini',
  'doubao-seedance-2.0-fast',
  'doubao-seedance-2.0-mini',
  'doubao-seedance-1-0-pro-fast',
  'doubao-seedance-1-0-pro-quality',
])

/** APIMart 视频模型的素材字段并不统一，必须按官方模型请求契约独立序列化。 */
export function buildApimartVideoInputFields(
  input: ApimartVideoInputFieldsInput,
): Record<string, unknown> {
  if (input.capability === 'video.image_to_video') return frameInputFields(input)
  if (input.capability === 'video.reference_to_video') return referenceInputFields(input)
  if (input.capability === 'video.edit' || input.capability === 'video.extend') {
    if (input.modelId === 'wan2.7-videoedit' || input.modelId === 'gemini-omni-flash-preview') {
      return compact({
        video_urls: nonEmpty(input.inputVideo ? [input.inputVideo] : []),
        image_urls: nonEmpty(input.referenceImages),
      })
    }
    return compact({
      video_url: input.inputVideo,
      image_urls: nonEmpty(input.referenceImages),
    })
  }
  return {}
}

/** Keep legacy preset ids while sending the current APIMart native model ids. */
export function apimartNativeModelId(modelId: string): string {
  if (modelId === 'doubao-seedance-2-0-fast') return 'doubao-seedance-2.0-fast'
  if (modelId === 'doubao-seedance-2-0-mini') return 'doubao-seedance-2.0-mini'
  return modelId
}

function frameInputFields(input: ApimartVideoInputFieldsInput): Record<string, unknown> {
  if (ROLE_FRAME_MODELS.has(input.modelId)) {
    return compact({
      image_with_roles: nonEmpty([
        ...(input.firstFrame ? [{ url: input.firstFrame, role: 'first_frame' }] : []),
        ...(input.lastFrame ? [{ url: input.lastFrame, role: 'last_frame' }] : []),
      ]),
    })
  }
  if (input.modelId === 'MiniMax-Hailuo-02') {
    return compact({
      first_frame_image: input.firstFrame,
      last_frame_image: input.lastFrame,
    })
  }
  if (SKYREELS_MODELS.has(input.modelId)) {
    return compact({
      first_frame_image: input.firstFrame,
      end_frame_image: input.lastFrame,
    })
  }
  if (input.modelId === 'pixverse-v6') {
    return input.lastFrame
      ? compact({
          first_frame_image: input.firstFrame,
          last_frame_image: input.lastFrame,
        })
      : compact({ image_urls: nonEmpty([input.firstFrame]) })
  }
  if (FIRST_FRAME_ONLY_MODELS.has(input.modelId)) {
    return compact({ first_frame_image: input.firstFrame })
  }
  if (IMAGE_URL_FRAME_MODELS.has(input.modelId)) {
    return compact({
      image_urls: nonEmpty([
        ...(input.firstFrame ? [input.firstFrame] : []),
        ...(input.lastFrame ? [input.lastFrame] : []),
        ...input.referenceImages,
      ]),
    })
  }
  return compact({
    image_urls: nonEmpty([
      ...(input.firstFrame ? [input.firstFrame] : []),
      ...(input.lastFrame ? [input.lastFrame] : []),
      ...input.referenceImages,
    ]),
  })
}

function referenceInputFields(input: ApimartVideoInputFieldsInput): Record<string, unknown> {
  if (SKYREELS_MODELS.has(input.modelId)) {
    return compact({
      ref_images: nonEmpty(
        chunk(input.referenceImages, 5).map((image_urls, index) => ({
          tag: `@image${index + 1}`,
          type: 'image',
          image_urls,
        })),
      ),
      ref_videos: nonEmpty(
        input.referenceVideos.map((video_url, index) => ({
          tag: `@video${index + 1}`,
          type: 'reference',
          video_url,
        })),
      ),
    })
  }
  if (input.modelId === 'pixverse-v6') {
    return compact({ img_references: nonEmpty(input.referenceImages) })
  }
  if (input.modelId === 'wan2.7-r2v') {
    return compact({
      image_with_roles: nonEmpty(
        input.referenceImages.map((url) => ({ url, role: 'reference_image' })),
      ),
      video_urls: nonEmpty(input.referenceVideos),
    })
  }
  if (KLING_MULTIMODAL_MODELS.has(input.modelId)) {
    return compact({
      image_urls: nonEmpty(input.referenceImages),
      video_list: nonEmpty(input.referenceVideos.map((video_url) => ({ video_url }))),
    })
  }
  return compact({
    image_urls: nonEmpty(input.referenceImages),
    video_urls: nonEmpty(input.referenceVideos),
    audio_urls: nonEmpty(input.referenceAudios),
  })
}

function nonEmpty<T>(values: T[]): T[] | undefined {
  return values.length > 0 ? values : undefined
}

function compact(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}
