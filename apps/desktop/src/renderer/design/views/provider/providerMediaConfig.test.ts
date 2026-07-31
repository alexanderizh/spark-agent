import { describe, expect, it } from 'vitest'

import {
  MEDIA_CAPABILITY_LABELS,
  capabilitiesForModelType,
  getMediaRequestPreviewUrl,
  mediaInterfaceTimeoutFormValue,
  mediaInterfaceTimeoutUpdate,
  mediaProviderOptionsForModelType,
} from './providerMediaConfig'

const BASE_URL = 'https://media.example/v1beta'

describe('provider media configuration', () => {
  it('reads and writes the provider-wide interface timeout with legacy fallback', () => {
    expect(
      mediaInterfaceTimeoutFormValue({
        timeoutMs: 6_000_000,
        polling: { timeoutMs: 600_000 },
      }),
    ).toBe('6000000')
    expect(mediaInterfaceTimeoutFormValue({ polling: { timeoutMs: 600_000 } })).toBe('600000')
    expect(mediaInterfaceTimeoutUpdate('6000000', '5000')).toEqual({
      timeoutMs: 6_000_000,
      polling: { intervalMs: 5_000 },
    })
  })

  it('exposes OpenAI and Google official adapters for image and video profiles', () => {
    for (const modelType of ['image', 'video'] as const) {
      expect(mediaProviderOptionsForModelType(modelType)).toEqual(
        expect.arrayContaining(['openai-images', 'google-generative-ai']),
      )
    }
  })

  it('exposes MiniMax Hailuo for image and video profiles', () => {
    // 守护 SUPPORTED_IMAGE_VIDEO_MEDIA_PROVIDERS 白名单含 minimax-hailuo：
    // 缺失会导致 ProvidersView 模板下拉不显示 + mediaProvider 被强制重置。
    for (const modelType of ['image', 'video'] as const) {
      expect(mediaProviderOptionsForModelType(modelType)).toContain('minimax-hailuo')
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
