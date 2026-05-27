import { describe, expect, it } from 'vitest'
import { ModelCapabilityRegistry, resolveModelContextWindow, resolveSoftContextLimit } from './model-capabilities.js'

describe('ModelCapabilityRegistry', () => {
  it('resolves provider-prefixed and family model ids', () => {
    expect(ModelCapabilityRegistry.getCapabilities('anthropic/claude-sonnet-4.5')?.contextWindow).toBe(200_000)
    expect(ModelCapabilityRegistry.getCapabilities('openai/gpt-5-codex')?.contextWindow).toBe(400_000)
    expect(ModelCapabilityRegistry.getCapabilities('google/gemini-2.5-pro-preview')?.contextWindow).toBe(1_048_576)
  })

  it('provides stable context window fallbacks for runtime and UI', () => {
    expect(resolveModelContextWindow('anthropic/claude-unknown-future-model')).toBe(200_000)
    expect(resolveModelContextWindow('openai/gpt-5-codex-latest')).toBe(400_000)
    expect(resolveModelContextWindow('google/gemini-2.5-pro-preview')).toBe(1_048_576)
    expect(resolveModelContextWindow('')).toBe(0)
    expect(resolveSoftContextLimit('claude-sonnet-4-5-20250929')).toBe(140_000)
  })
})
