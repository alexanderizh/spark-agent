import { describe, expect, it } from 'vitest'
import { getProviderPresetById } from '../provider-presets.js'

describe('provider presets', () => {
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
