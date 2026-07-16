import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import {
  getProviderPickerLogoSize,
  prioritizeManagedProviderGroups,
  resolveAvailableProviderModel,
  resolveManagedPlatformVendor,
} from './provider-model-picker-utils'

function provider(overrides: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: 'provider',
    name: 'Provider',
    provider: 'openai',
    defaultModel: 'model',
    modelIds: ['model'],
    supportsMillionContext: false,
    modelType: 'multimodal',
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
    ...overrides,
  }
}

describe('provider model picker utilities', () => {
  it('uses the Spark brand for an official managed provider regardless of wire protocol', () => {
    const official = provider({
      id: 'spark-platform-newapi',
      name: 'Spark 平台模型',
      provider: 'anthropic',
      managed: true,
      managedType: 'newapi',
    })

    expect(resolveManagedPlatformVendor(official)).toMatchObject({
      id: 'spark-platform',
      logoPath: 'providers/spark-platform.png',
    })
  })

  it('puts available official groups first while preserving all other group order', () => {
    const openai = { provider: provider({ id: 'openai' }), models: ['gpt-5'] }
    const official = {
      provider: provider({ id: 'spark-platform-newapi', managed: true, managedType: 'newapi' }),
      models: ['glm-5'],
    }
    const anthropic = {
      provider: provider({ id: 'anthropic', provider: 'anthropic' }),
      models: ['claude-sonnet'],
    }

    expect(prioritizeManagedProviderGroups([openai, official, anthropic])).toEqual([
      official,
      openai,
      anthropic,
    ])
  })

  it('visually compensates the official PNG logo without enlarging other providers', () => {
    expect(getProviderPickerLogoSize(provider({ managed: true, managedType: 'newapi' }))).toBe(18)
    expect(getProviderPickerLogoSize(provider({ id: 'openai' }))).toBe(14)
  })

  it('drops a model cached from a provider that is no longer available', () => {
    const thirdParty = provider({
      id: 'third-party',
      defaultModel: 'claude-sonnet',
      modelIds: ['claude-sonnet'],
    })

    expect(resolveAvailableProviderModel('qwen3.6-plus', thirdParty)).toBe('')
    expect(resolveAvailableProviderModel('claude-sonnet', thirdParty)).toBe('claude-sonnet')
  })
})
