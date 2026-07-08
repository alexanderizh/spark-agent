import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import {
  getPreferredProviderForAdapter,
  isProviderCompatibleWithAdapter,
} from '../design/utils/provider-adapter'

function profile(partial: Partial<ProviderProfile> & Pick<ProviderProfile, 'id' | 'provider' | 'name'>): ProviderProfile {
  return {
    defaultModel: '',
    modelIds: [],
    supportsMillionContext: false,
    modelType: 'multimodal',
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
    ...partial,
  }
}

describe('provider adapter selection', () => {
  const localClaude = profile({
    id: 'local-cli',
    name: '本地 Claude CLI',
    provider: 'anthropic',
    defaultModel: 'claude cli',
    modelIds: ['claude cli'],
  })
  const localCodex = profile({
    id: 'local-codex-cli',
    name: '本地 Codex CLI',
    provider: 'openai',
    defaultModel: 'codex cli',
    modelIds: ['codex cli'],
  })
  const anthropicCompatible = profile({
    id: 'deepseek-anthropic',
    name: 'DeepSeek API',
    provider: 'anthropic',
  })

  it('keeps local Claude and local Codex on their own adapters', () => {
    expect(isProviderCompatibleWithAdapter(localClaude, 'claude-sdk')).toBe(true)
    expect(isProviderCompatibleWithAdapter(localClaude, 'codex')).toBe(false)
    expect(isProviderCompatibleWithAdapter(localCodex, 'codex')).toBe(true)
    expect(isProviderCompatibleWithAdapter(localCodex, 'claude-sdk')).toBe(false)
  })

  it('prefers local Codex CLI when selecting a Codex provider', () => {
    const selected = getPreferredProviderForAdapter(
      [anthropicCompatible, localClaude, localCodex],
      undefined,
      'codex',
    )
    expect(selected?.id).toBe('local-codex-cli')
    expect(selected?.defaultModel).toBe('codex cli')
  })
})
