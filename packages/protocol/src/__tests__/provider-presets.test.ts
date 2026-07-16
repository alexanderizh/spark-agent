import { describe, expect, it } from 'vitest'
import { getProviderPresetById } from '../provider-presets.js'

describe('provider presets', () => {
  it('allows APIMart video tasks to run for up to 30 minutes', () => {
    for (const id of [
      'apimart-video-veo3',
      'apimart-video-sora2',
      'apimart-video-collection',
    ]) {
      expect(getProviderPresetById(id)?.mediaDefaults?.polling?.timeoutMs).toBe(1_800_000)
    }
  })

  it('uses the Coding Plan OpenAI-compatible endpoint for Volcengine Ark', () => {
    expect(getProviderPresetById('volcengine-ark-openai')).toMatchObject({
      apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      codexApiKind: 'responses',
      defaultModel: 'glm-5.2',
      modelIds: expect.arrayContaining(['glm-5.2']),
    })
    expect(getProviderPresetById('volcengine-ark-anthropic')).toMatchObject({
      defaultModel: 'glm-5.2',
      modelIds: expect.arrayContaining(['glm-5.2']),
    })
    expect(getProviderPresetById('volcengine-ark-seed21')).toMatchObject({
      apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
      codexApiKind: 'chat',
      sourceUrls: expect.arrayContaining([
        'https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1569618?lang=zh',
      ]),
    })
  })

  it('exposes Agnes as a unified multimodal preset with media manifests', () => {
    expect(getProviderPresetById('agnes-ai')).toMatchObject({
      apiEndpoint: 'https://apihub.agnes-ai.com/v1',
      defaultModel: 'agnes-2.0-flash',
      modelType: 'multimodal',
      mediaProvider: 'agnes',
      mediaCapabilities: expect.arrayContaining([
        'image.generate',
        'image.edit',
        'video.generate',
      ]),
      mediaModelRefs: expect.arrayContaining([
        expect.objectContaining({ manifestId: 'agnes:agnes-image-2.0-flash' }),
        expect.objectContaining({ manifestId: 'agnes:agnes-video-v2.0' }),
      ]),
    })
  })
})
