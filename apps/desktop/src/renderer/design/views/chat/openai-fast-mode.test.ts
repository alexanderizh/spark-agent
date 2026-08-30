import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import {
  resolveComposerFastMode,
  resolveOpenAIFastModeProvider,
  supportsOpenAIFastModeProvider,
} from './openai-fast-mode'

function provider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'provider-1',
    name: 'Provider',
    provider: 'openai-compatible',
    defaultModel: 'gpt-test',
    modelIds: ['gpt-test'],
    keystoreRef: 'keychain:test',
    isDefault: false,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  }
}

describe('supportsOpenAIFastModeProvider', () => {
  it('shows Fast mode for Chat Completions and Responses protocol providers', () => {
    expect(supportsOpenAIFastModeProvider(provider({ codexApiKind: 'chat' }))).toBe(true)
    expect(supportsOpenAIFastModeProvider(provider({ codexApiKind: 'responses' }))).toBe(true)
    expect(supportsOpenAIFastModeProvider(provider())).toBe(true)
  })

  it('supports local Codex CLI but hides Fast mode for incompatible transports', () => {
    expect(supportsOpenAIFastModeProvider(provider({ id: 'local-codex-cli' }))).toBe(true)
    expect(supportsOpenAIFastModeProvider(provider({ provider: 'anthropic' }))).toBe(false)
    expect(supportsOpenAIFastModeProvider(provider({ codexApiKind: 'embedding' }))).toBe(false)
    expect(supportsOpenAIFastModeProvider(provider({ id: 'local-cli' }))).toBe(false)
    expect(supportsOpenAIFastModeProvider(provider({ id: 'codex-auto-router' }))).toBe(false)
  })
})

describe('resolveOpenAIFastModeProvider', () => {
  it('uses native Codex CLI without an override and the override when present', () => {
    const localCodex = provider({ id: 'local-codex-cli' })
    const override = provider({ id: 'openai-override' })

    expect(resolveOpenAIFastModeProvider(localCodex, undefined)).toBe(localCodex)
    expect(resolveOpenAIFastModeProvider(localCodex, override)).toBe(override)
  })

  it('requires an OpenAI override for local Claude CLI', () => {
    const localClaude = provider({ id: 'local-cli', provider: 'anthropic' })
    const override = provider({ id: 'openai-override' })

    expect(
      supportsOpenAIFastModeProvider(resolveOpenAIFastModeProvider(localClaude, undefined)),
    ).toBe(false)
    expect(
      supportsOpenAIFastModeProvider(resolveOpenAIFastModeProvider(localClaude, override)),
    ).toBe(true)
  })

  it('leaves non-CLI providers unchanged', () => {
    const openAI = provider()
    expect(resolveOpenAIFastModeProvider(openAI, undefined)).toBe(openAI)
  })
})

describe('resolveComposerFastMode', () => {
  it('uses the draft only before a session exists', () => {
    expect(resolveComposerFastMode(null, true)).toBe(true)
    expect(resolveComposerFastMode(undefined, false)).toBe(false)
  })

  it('treats an omitted legacy session preference as disabled', () => {
    expect(resolveComposerFastMode({}, true)).toBe(false)
    expect(resolveComposerFastMode({ fastMode: false }, true)).toBe(false)
    expect(resolveComposerFastMode({ fastMode: true }, false)).toBe(true)
  })
})
