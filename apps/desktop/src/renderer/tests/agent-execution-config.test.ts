import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import {
  getDefaultAgentModelForProvider,
  getLockedAgentAdapterForProvider,
  normalizeAgentModelForProvider,
  shouldAllowAgentModelOverride,
} from '../design/utils/agent-execution-config'

function profile(
  partial: Partial<ProviderProfile> & Pick<ProviderProfile, 'id' | 'provider' | 'name'>,
): ProviderProfile {
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

describe('agent execution config', () => {
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
  const openaiProvider = profile({
    id: 'openai-prod',
    name: 'OpenAI',
    provider: 'openai',
    defaultModel: 'gpt-5',
    modelIds: ['gpt-5', 'gpt-5-mini'],
  })
  const sparkManagedProvider = profile({
    id: 'spark-platform-newapi',
    name: 'Spark 平台模型',
    provider: 'anthropic',
    defaultModel: 'glm-4.5',
    modelIds: ['glm-4.5', 'deepseek-v4'],
    managed: true,
    managedType: 'newapi',
    managedOwnerUserId: '42',
  })

  it('locks adapter from provider kind', () => {
    expect(getLockedAgentAdapterForProvider(localClaude)).toBe('claude-sdk')
    expect(getLockedAgentAdapterForProvider(localCodex)).toBe('codex')
    expect(getLockedAgentAdapterForProvider(openaiProvider)).toBe('codex')
    expect(getLockedAgentAdapterForProvider(sparkManagedProvider)).toBe('claude-sdk')
  })

  it('keeps built-in local cli providers on host model config', () => {
    expect(shouldAllowAgentModelOverride(localClaude)).toBe(false)
    expect(shouldAllowAgentModelOverride(localCodex)).toBe(false)
    expect(getDefaultAgentModelForProvider(localCodex)).toBe('')
    expect(normalizeAgentModelForProvider(localCodex, 'codex cli')).toBe('')
    expect(normalizeAgentModelForProvider(localCodex, 'model-profile-id')).toBe('')
  })

  it('keeps remote model overrides including model card ids', () => {
    expect(shouldAllowAgentModelOverride(openaiProvider)).toBe(true)
    expect(getDefaultAgentModelForProvider(openaiProvider)).toBe('gpt-5')
    expect(normalizeAgentModelForProvider(openaiProvider, 'gpt-5-mini')).toBe('gpt-5-mini')
    expect(normalizeAgentModelForProvider(openaiProvider, 'model-profile-id')).toBe('model-profile-id')
    expect(normalizeAgentModelForProvider(openaiProvider, '')).toBe('')
  })
})
