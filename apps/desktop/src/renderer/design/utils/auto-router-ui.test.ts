import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'

import { filterProvidersForVisibleUi } from './auto-router-ui'

function provider(id: string): ProviderProfile {
  return {
    id,
    name: id,
    provider: 'anthropic',
    defaultModel: 'model',
    modelIds: ['model'],
    supportsMillionContext: false,
    modelType: 'multimodal',
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
  }
}

describe('Auto Router UI visibility', () => {
  it('hides both built-in auto router providers while keeping concrete providers', () => {
    const visible = filterProvidersForVisibleUi([
      provider('claude-auto-router'),
      provider('anthropic-provider'),
      provider('codex-auto-router'),
      provider('openai-provider'),
    ])

    expect(visible.map((item) => item.id)).toEqual(['anthropic-provider', 'openai-provider'])
  })
})
