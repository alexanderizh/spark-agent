import { describe, expect, it } from 'vitest'
import { getProviderPresetById } from '../provider-presets.js'

describe('provider presets', () => {
  it('uses the Coding Plan OpenAI-compatible endpoint for Volcengine Ark', () => {
    expect(getProviderPresetById('volcengine-ark-openai')?.apiEndpoint)
      .toBe('https://ark.cn-beijing.volces.com/api/coding/v3')
  })
})
