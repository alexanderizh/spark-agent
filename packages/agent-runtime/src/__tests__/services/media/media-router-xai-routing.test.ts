import { describe, expect, it } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '@spark/protocol'
import { MediaRouterService, type MediaProviderProfile } from '../../../services/media/media-router.service.js'

function xaiProfile(): MediaProviderProfile {
  return {
    id: 'xai-profile',
    name: 'xAI',
    apiKey: 'key',
    apiEndpoint: 'https://api.x.ai/v1',
    defaultModel: 'grok-imagine-video',
    modelIds: ['grok-imagine-video', 'grok-imagine-video-1.5'],
    mediaProvider: 'xai',
    mediaApiType: 'async',
    mediaModelManifests: BUILTIN_MEDIA_MODEL_MANIFESTS.filter((manifest) => manifest.providerKind === 'xai'),
  }
}

describe('MediaRouterService xAI input-aware routing', () => {
  const router = new MediaRouterService()

  it('routes text-to-video with reference images to reference-to-video', () => {
    expect(router.resolveCapabilityForInput(
      {
        operation: 'text_to_video',
        prompt: 'Use references',
        outputDir: '/tmp',
        inputFiles: [{ type: 'image', role: 'reference', url: 'https://example.com/ref.png' }],
      },
      { providers: [xaiProfile()], providerProfileId: 'xai-profile', modelId: 'grok-imagine-video' },
    )).toBe('video.reference_to_video')
  })

  it('routes image-to-video with multiple reference images to reference-to-video', () => {
    expect(router.resolveCapabilityForInput(
      {
        operation: 'image_to_video',
        prompt: 'Use both references',
        outputDir: '/tmp',
        inputFiles: [
          { type: 'image', role: 'reference', url: 'https://example.com/ref-1.png' },
          { type: 'image', role: 'reference', url: 'https://example.com/ref-2.png' },
        ],
      },
      { providers: [xaiProfile()], providerProfileId: 'xai-profile', modelId: 'grok-imagine-video' },
    )).toBe('video.reference_to_video')
  })

  it('routes legacy role-less multi-image input to reference-to-video', () => {
    expect(router.resolveCapabilityForInput(
      {
        operation: 'image_to_video',
        prompt: 'Use both images',
        outputDir: '/tmp',
        inputFiles: [
          { type: 'image', url: 'https://example.com/first.png' },
          { type: 'image', url: 'https://example.com/second.png' },
        ],
      },
      { providers: [xaiProfile()], providerProfileId: 'xai-profile', modelId: 'grok-imagine-video' },
    )).toBe('video.reference_to_video')
  })

  it('does not route Grok Imagine Video 1.5 to unsupported reference-to-video', () => {
    expect(router.resolveCapabilityForInput(
      {
        operation: 'text_to_video',
        prompt: 'Use references',
        outputDir: '/tmp',
        inputFiles: [{ type: 'image', role: 'reference', url: 'https://example.com/ref.png' }],
      },
      { providers: [xaiProfile()], providerProfileId: 'xai-profile', modelId: 'grok-imagine-video-1.5' },
    )).toBe('video.generate')
  })

  it('does not borrow reference capability from an unrelated provider for an explicit model', () => {
    const unrelatedProvider: MediaProviderProfile = {
      id: 'agnes-profile',
      name: 'Agnes',
      apiKey: 'key',
      defaultModel: 'agnes-video-v2.0',
      modelIds: ['agnes-video-v2.0'],
      mediaProvider: 'agnes',
      mediaCapabilities: ['video.reference_to_video'],
    }

    expect(router.resolveCapabilityForInput(
      {
        operation: 'text_to_video',
        prompt: 'Use references',
        outputDir: '/tmp',
        inputFiles: [{ type: 'image', role: 'reference', url: 'https://example.com/ref.png' }],
      },
      { providers: [xaiProfile(), unrelatedProvider], modelId: 'grok-imagine-video-1.5' },
    )).toBe('video.generate')
  })

  it('does not borrow reference capability from another manifest on the same provider', () => {
    const provider = xaiProfile()
    provider.defaultModel = 'legacy-video-model'
    provider.modelIds = ['legacy-video-model', 'grok-imagine-video']
    provider.mediaModelManifests = BUILTIN_MEDIA_MODEL_MANIFESTS.filter(
      (manifest) => manifest.id === 'xai:grok-imagine-video',
    )

    expect(router.resolveCapabilityForInput(
      {
        operation: 'text_to_video',
        prompt: 'Use references',
        outputDir: '/tmp',
        inputFiles: [{ type: 'image', role: 'reference', url: 'https://example.com/ref.png' }],
      },
      { providers: [provider], modelId: 'legacy-video-model' },
    )).toBe('video.generate')
  })
})
