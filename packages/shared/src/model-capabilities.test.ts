import { describe, expect, it } from 'vitest'
import { ModelCapabilityRegistry, resolveModelContextWindow, resolveProviderContextWindow, resolveSoftContextLimit, resolveSoftContextLimitForWindow } from './model-capabilities.js'

describe('ModelCapabilityRegistry', () => {
  it('resolves provider-prefixed and family model ids', () => {
    expect(ModelCapabilityRegistry.getCapabilities('anthropic/claude-sonnet-4.5')?.contextWindow).toBe(200_000)
    expect(ModelCapabilityRegistry.getCapabilities('openai/gpt-5-codex')?.contextWindow).toBe(400_000)
    expect(ModelCapabilityRegistry.getCapabilities('google/gemini-2.5-pro-preview')?.contextWindow).toBe(1_048_576)
    expect(ModelCapabilityRegistry.getCapabilities('deepseek-v4-flash')?.maxOutputTokens).toBe(384_000)
    expect(ModelCapabilityRegistry.getCapabilities('glm-5.2')?.maxOutputTokens).toBe(131_072)
  })

  it('provides stable context window fallbacks for runtime and UI', () => {
    expect(resolveModelContextWindow('anthropic/claude-unknown-future-model')).toBe(200_000)
    expect(resolveModelContextWindow('openai/gpt-5-codex-latest')).toBe(400_000)
    expect(resolveModelContextWindow('google/gemini-2.5-pro-preview')).toBe(1_048_576)
    expect(resolveModelContextWindow('deepseek-v4-flash')).toBe(1_000_000)
    expect(resolveModelContextWindow('glm-5.2')).toBe(1_000_000)
    expect(resolveModelContextWindow('')).toBe(0)
    expect(resolveSoftContextLimit('claude-sonnet-4-5-20250929')).toBe(140_000)
  })

  it('provides provider-level context window defaults', () => {
    expect(resolveProviderContextWindow(true)).toBe(1_000_000)
    expect(resolveProviderContextWindow(false)).toBe(200_000)
    expect(resolveProviderContextWindow()).toBe(200_000)
    expect(resolveProviderContextWindow(false, 256_000)).toBe(256_000)
    expect(resolveProviderContextWindow(true, 50_000)).toBe(50_000)
    expect(resolveProviderContextWindow(false, 0)).toBe(200_000)
    expect(resolveProviderContextWindow(false, -1)).toBe(200_000)
    expect(resolveSoftContextLimitForWindow(1_000_000)).toBe(700_000)
  })
})
