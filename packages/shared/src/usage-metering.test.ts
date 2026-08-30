import { describe, expect, it } from 'vitest'
import { providerPromptWindowTokens } from './usage-metering.js'

describe('providerPromptWindowTokens', () => {
  it('adds claude cache tokens back to the uncached remainder', () => {
    // Anthropic 实况：inputTokens 是未命中余量，大头在 cache_read 里
    expect(
      providerPromptWindowTokens({
        provider: 'claude',
        inputTokens: 8_985,
        cacheHitTokens: 184_320,
        cacheWriteTokens: 500,
      }),
    ).toBe(193_805)
  })

  it('uses prompt_tokens directly for openai-compatible providers (cached is a subset)', () => {
    expect(
      providerPromptWindowTokens({
        provider: 'codex',
        inputTokens: 42_000,
        cacheHitTokens: 30_000,
      }),
    ).toBe(42_000)
    expect(providerPromptWindowTokens({ provider: 'openai', inputTokens: 1_500 })).toBe(1_500)
  })

  it('clamps negative inputs to zero', () => {
    expect(providerPromptWindowTokens({ provider: 'claude', inputTokens: -5 })).toBe(0)
    expect(providerPromptWindowTokens({ provider: undefined, inputTokens: 100 })).toBe(100)
  })
})
