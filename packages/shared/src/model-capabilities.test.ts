import { describe, expect, it } from 'vitest'
import { ModelCapabilityRegistry } from './model-capabilities.js'

describe('ModelCapabilityRegistry', () => {
  it('resolves provider-prefixed and family model ids', () => {
    expect(ModelCapabilityRegistry.getCapabilities('anthropic/claude-sonnet-4.5')?.contextWindow).toBe(200_000)
    expect(ModelCapabilityRegistry.getCapabilities('openai/gpt-5-codex')?.contextWindow).toBe(400_000)
    expect(ModelCapabilityRegistry.getCapabilities('google/gemini-2.5-pro-preview')?.contextWindow).toBe(1_048_576)
  })
})
