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
})
