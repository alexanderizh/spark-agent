import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import {
  getProviderAdapterKind,
  getPreferredProviderForAdapter,
  getPreferredProviderWithAdapterFallback,
  isProviderCompatibleWithAdapter,
} from '../design/utils/provider-adapter'

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
  const codexAutoRouter = profile({
    id: 'codex-auto-router',
    name: 'Codex Auto Router',
    provider: 'openai',
  })
  const anthropicCompatible = profile({
    id: 'deepseek-anthropic',
    name: 'DeepSeek API',
    provider: 'anthropic',
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

  it('falls back to a Codex provider when a fresh install has no Claude provider', () => {
    const importedCodexProvider = profile({
      id: 'imported-codex',
      name: 'Imported Codex',
      provider: 'openai',
      defaultModel: 'gpt-5.6-luna',
      modelIds: ['gpt-5.6-luna'],
    })

    expect(
      getPreferredProviderWithAdapterFallback(
        [codexAutoRouter, importedCodexProvider],
        undefined,
        'claude-sdk',
      )?.id,
    ).toBe(importedCodexProvider.id)
  })

  it('keeps the preferred adapter when it still has a compatible provider', () => {
    expect(
      getPreferredProviderWithAdapterFallback(
        [anthropicCompatible, localCodex],
        localCodex.id,
        'claude-sdk',
      )?.id,
    ).toBe(anthropicCompatible.id)
  })

  it('routes the official Spark managed provider to Claude SDK', () => {
    expect(isProviderCompatibleWithAdapter(sparkManagedProvider, 'claude-sdk')).toBe(true)
    expect(isProviderCompatibleWithAdapter(sparkManagedProvider, 'codex')).toBe(false)
    expect(getProviderAdapterKind(sparkManagedProvider)).toBe('claude-sdk')
  })
})

describe('spark adapter compatibility', () => {
  const anthropicRemote = profile({
    id: 'remote-anthropic',
    name: 'Remote Anthropic',
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-5',
    modelIds: ['claude-sonnet-5'],
  })
  const localCliClaude = profile({
    id: 'local-cli',
    name: '本地 Claude CLI',
    provider: 'anthropic',
    defaultModel: 'claude cli',
    modelIds: ['claude cli'],
  })
  const localCliCodex = profile({
    id: 'local-codex-cli',
    name: '本地 Codex CLI',
    provider: 'openai',
    defaultModel: 'codex cli',
    modelIds: ['codex cli'],
  })

  it('anthropic 渠道与 openai+responses 渠道可与 spark 适配器配对', () => {
    expect(isProviderCompatibleWithAdapter(anthropicRemote, 'spark')).toBe(true)
    expect(
      isProviderCompatibleWithAdapter(
        profile({
          id: 'openai-responses',
          name: 'OpenAI',
          provider: 'openai',
          codexApiKind: 'responses',
        }),
        'spark',
      ),
    ).toBe(true)
  })

  it('openai 渠道未写 codexApiKind 时按 responses 口径可与 spark 配对', () => {
    expect(
      isProviderCompatibleWithAdapter(
        profile({ id: 'openai-legacy', name: 'Legacy OpenAI', provider: 'openai' }),
        'spark',
      ),
    ).toBe(true)
  })

  it('仅 chat/completions 的 openai 渠道不可与 spark 适配器配对', () => {
    expect(
      isProviderCompatibleWithAdapter(
        profile({
          id: 'openai-chat',
          name: 'Chat Only',
          provider: 'openai',
          codexApiKind: 'chat',
        }),
        'spark',
      ),
    ).toBe(false)
  })

  it('本地 CLI 渠道不参与 spark 适配器', () => {
    expect(isProviderCompatibleWithAdapter(localCliClaude, 'spark')).toBe(false)
    expect(isProviderCompatibleWithAdapter(localCliCodex, 'spark')).toBe(false)
  })

  it('媒体类渠道不参与 spark 适配器', () => {
    expect(
      isProviderCompatibleWithAdapter(
        profile({ id: 'img', name: 'Image', provider: 'openai', modelType: 'image' }),
        'spark',
      ),
    ).toBe(false)
  })

  it('spark 适配器无可用渠道时回退到 Claude 渠道', () => {
    // 仅本地 CLI（spark 不接管）时，回退链落到 claude-sdk 的本地 CLI 渠道
    expect(
      getPreferredProviderWithAdapterFallback([localCliClaude, localCliCodex], undefined, 'spark')
        ?.id,
    ).toBe(localCliClaude.id)
  })
})
