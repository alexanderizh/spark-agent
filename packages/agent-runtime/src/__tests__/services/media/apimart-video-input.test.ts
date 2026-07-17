import { describe, expect, it } from 'vitest'
import {
  apimartNativeModelId,
  buildApimartVideoInputFields,
} from '../../../services/media/adapters/apimart-video-input.js'

const references = {
  firstFrame: undefined,
  lastFrame: undefined,
  inputVideo: undefined,
  referenceImages: ['https://cdn/image-1.png', 'https://cdn/image-2.png'],
  referenceVideos: ['https://cdn/video.mp4'],
  referenceAudios: [],
}

describe('APIMart video input serialization', () => {
  it('keeps legacy preset ids but maps the Seedance 2.0 native ids', () => {
    expect(apimartNativeModelId('doubao-seedance-2-0-fast')).toBe('doubao-seedance-2.0-fast')
    expect(apimartNativeModelId('doubao-seedance-2-0-mini')).toBe('doubao-seedance-2.0-mini')
    expect(apimartNativeModelId('doubao-seedance-2.0')).toBe('doubao-seedance-2.0')
  })

  it('uses structured ref_images for SkyReels references', () => {
    expect(
      buildApimartVideoInputFields({
        modelId: 'skyreels-v4-fast',
        capability: 'video.reference_to_video',
        ...references,
      }),
    ).toEqual({
      ref_images: [
        {
          tag: '@image1',
          type: 'image',
          image_urls: ['https://cdn/image-1.png', 'https://cdn/image-2.png'],
        },
      ],
      ref_videos: [
        { tag: '@video1', type: 'reference', video_url: 'https://cdn/video.mp4' },
      ],
    })
  })

  it('uses img_references for PixVerse references', () => {
    expect(
      buildApimartVideoInputFields({
        modelId: 'pixverse-v6',
        capability: 'video.reference_to_video',
        ...references,
        referenceVideos: [],
      }),
    ).toEqual({ img_references: references.referenceImages })
  })

  it('uses image_with_roles for Wan reference-to-video images', () => {
    expect(
      buildApimartVideoInputFields({
        modelId: 'wan2.7-r2v',
        capability: 'video.reference_to_video',
        ...references,
      }),
    ).toEqual({
      image_with_roles: [
        { url: 'https://cdn/image-1.png', role: 'reference_image' },
        { url: 'https://cdn/image-2.png', role: 'reference_image' },
      ],
      video_urls: ['https://cdn/video.mp4'],
    })
  })

  it.each(['kling-v3-omni', 'kling-video-o1'])(
    'uses video_list for %s reference videos',
    (modelId) => {
      expect(
        buildApimartVideoInputFields({
          modelId,
          capability: 'video.reference_to_video',
          ...references,
        }),
      ).toEqual({
        image_urls: references.referenceImages,
        video_list: [{ video_url: 'https://cdn/video.mp4' }],
      })
    },
  )

  it('uses image_with_roles for Seedance 1.5 first and last frames', () => {
    expect(
      buildApimartVideoInputFields({
        modelId: 'doubao-seedance-1-5-pro',
        capability: 'video.image_to_video',
        ...references,
        firstFrame: 'https://cdn/first.png',
        lastFrame: 'https://cdn/last.png',
      }),
    ).toEqual({
      image_with_roles: [
        { url: 'https://cdn/first.png', role: 'first_frame' },
        { url: 'https://cdn/last.png', role: 'last_frame' },
      ],
    })
  })

  it.each([
    'sora-2',
    'sora-2-pro',
    'veo3.1-fast',
    'veo3.1-quality',
    'wan2.5-preview',
    'wan2.6',
    'wan2.7',
    'kling-v2-6',
    'kling-v3',
    'viduq3-pro',
    'viduq3-turbo',
    'Omni-Flash-Ext',
  ])('uses image_urls instead of duplicate generic fields for %s', (modelId) => {
    expect(
      buildApimartVideoInputFields({
        modelId,
        capability: 'video.image_to_video',
        ...references,
        firstFrame: 'https://cdn/first.png',
        lastFrame: 'https://cdn/last.png',
        referenceImages: [],
        referenceVideos: [],
      }),
    ).toEqual({ image_urls: ['https://cdn/first.png', 'https://cdn/last.png'] })
  })

  it.each(['doubao-seedance-1-0-pro-fast', 'doubao-seedance-1-0-pro-quality'])(
    'uses role-based frame input for %s',
    (modelId) => {
      expect(
        buildApimartVideoInputFields({
          modelId,
          capability: 'video.image_to_video',
          ...references,
          firstFrame: 'https://cdn/first.png',
          lastFrame: 'https://cdn/last.png',
          referenceImages: [],
          referenceVideos: [],
        }),
      ).toEqual({
        image_with_roles: [
          { url: 'https://cdn/first.png', role: 'first_frame' },
          { url: 'https://cdn/last.png', role: 'last_frame' },
        ],
      })
    },
  )

  it('uses role-based frame input for Seedance 2.0', () => {
    expect(
      buildApimartVideoInputFields({
        modelId: 'doubao-seedance-2.0',
        capability: 'video.image_to_video',
        ...references,
        firstFrame: 'https://cdn/first.png',
        lastFrame: 'https://cdn/last.png',
        referenceImages: [],
        referenceVideos: [],
      }),
    ).toEqual({
      image_with_roles: [
        { url: 'https://cdn/first.png', role: 'first_frame' },
        { url: 'https://cdn/last.png', role: 'last_frame' },
      ],
    })
  })

  it.each(['MiniMax-Hailuo-2.3', 'happyhorse-1.0', 'happyhorse-1.1', 'kling-3.0-turbo'])(
    'uses only first_frame_image for %s',
    (modelId) => {
      expect(
        buildApimartVideoInputFields({
          modelId,
          capability: 'video.image_to_video',
          ...references,
          firstFrame: 'https://cdn/first.png',
          lastFrame: undefined,
          referenceImages: [],
          referenceVideos: [],
        }),
      ).toEqual({ first_frame_image: 'https://cdn/first.png' })
    },
  )

  it('uses first/end frame field names for SkyReels', () => {
    expect(
      buildApimartVideoInputFields({
        modelId: 'skyreels-v4-fast',
        capability: 'video.image_to_video',
        ...references,
        firstFrame: 'https://cdn/first.png',
        lastFrame: 'https://cdn/last.png',
        referenceImages: [],
        referenceVideos: [],
      }),
    ).toEqual({
      first_frame_image: 'https://cdn/first.png',
      end_frame_image: 'https://cdn/last.png',
    })
  })

  it('uses PixVerse transition fields without a duplicate image field', () => {
    expect(
      buildApimartVideoInputFields({
        modelId: 'pixverse-v6',
        capability: 'video.image_to_video',
        ...references,
        firstFrame: 'https://cdn/first.png',
        lastFrame: 'https://cdn/last.png',
        referenceImages: [],
        referenceVideos: [],
      }),
    ).toEqual({
      first_frame_image: 'https://cdn/first.png',
      last_frame_image: 'https://cdn/last.png',
    })
  })

  it('uses model-specific video edit fields', () => {
    expect(
      buildApimartVideoInputFields({
        modelId: 'happyhorse-1.0',
        capability: 'video.edit',
        ...references,
        inputVideo: 'https://cdn/video.mp4',
      }),
    ).toEqual({
      video_url: 'https://cdn/video.mp4',
      image_urls: references.referenceImages,
    })
    expect(
      buildApimartVideoInputFields({
        modelId: 'wan2.7-videoedit',
        capability: 'video.edit',
        ...references,
        inputVideo: 'https://cdn/video.mp4',
      }),
    ).toEqual({
      video_urls: ['https://cdn/video.mp4'],
      image_urls: references.referenceImages,
    })
    expect(
      buildApimartVideoInputFields({
        modelId: 'gemini-omni-flash-preview',
        capability: 'video.edit',
        ...references,
        inputVideo: 'https://cdn/video.mp4',
      }),
    ).toEqual({
      video_urls: ['https://cdn/video.mp4'],
      image_urls: references.referenceImages,
    })
  })
})
