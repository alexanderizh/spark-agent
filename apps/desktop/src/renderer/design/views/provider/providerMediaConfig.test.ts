import { describe, expect, it } from 'vitest'

import {
  MEDIA_CAPABILITY_LABELS,
  capabilitiesForModelType,
  getMediaRequestPreviewUrl,
  mediaProviderOptionsForModelType,
} from './providerMediaConfig'

const BASE_URL = 'https://media.example/v1beta'

describe('provider media configuration', () => {
  it('exposes OpenAI and Google official adapters for image and video profiles', () => {
    for (const modelType of ['image', 'video'] as const) {
      expect(mediaProviderOptionsForModelType(modelType)).toEqual(
        expect.arrayContaining(['openai-images', 'google-generative-ai']),
      )
    }
  })

  it('exposes Lyria music capability in voice profiles', () => {
    expect(capabilitiesForModelType('voice')).toContain('audio.music')
    expect(MEDIA_CAPABILITY_LABELS['audio.music']).toBe('音乐生成')
  })

  it('shows protocol-accurate official request previews', () => {
    expect(
      getMediaRequestPreviewUrl(
        BASE_URL,
        { modelType: 'video', defaultModel: 'sora-2', mediaCapabilities: ['video.generate'] },
        'openai-images',
      ),
    ).toBe(`${BASE_URL}/videos`)
    expect(
      getMediaRequestPreviewUrl(
        BASE_URL,
        {
          modelType: 'video',
          defaultModel: 'gemini-omni-flash-preview',
          mediaCapabilities: ['video.generate'],
        },
        'google-generative-ai',
      ),
    ).toBe(`${BASE_URL}/interactions`)
    expect(
      getMediaRequestPreviewUrl(
        BASE_URL,
        {
          modelType: 'image',
          defaultModel: 'imagen-4.0-generate-001',
          mediaCapabilities: ['image.generate'],
        },
        'google-generative-ai',
      ),
    ).toBe(`${BASE_URL}/models/imagen-4.0-generate-001:predict`)
    expect(
      getMediaRequestPreviewUrl(
        BASE_URL,
        {
          modelType: 'voice',
          defaultModel: 'lyria-3-pro-preview',
          mediaCapabilities: ['audio.music'],
        },
        'google-generative-ai',
      ),
    ).toBe(`${BASE_URL}/interactions`)
  })
})
