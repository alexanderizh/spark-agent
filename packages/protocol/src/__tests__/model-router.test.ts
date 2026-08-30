import { describe, expect, it } from 'vitest'
import {
  isProviderAllowedForRouterAdapter,
  isRoutingModelConfig,
  normalizeRoutingCandidates,
  type RoutingModelConfig,
} from '../model-router.js'

const anthropicProvider = {
  id: 'anthropic-1',
  provider: 'anthropic',
  modelType: 'text' as const,
}

const openAiProvider = {
  id: 'openai-1',
  provider: 'openai',
  modelType: 'text' as const,
}

const compatibleProvider = {
  id: 'compatible-1',
  provider: 'openai-compatible',
  modelType: 'text' as const,
}

describe('model router protocol helpers', () => {
  it('identifies routing model configs', () => {
    const config: RoutingModelConfig = {
      kind: 'router',
      adapter: 'codex',
      candidates: {
        default: { providerProfileId: 'openai-1', modelId: 'gpt-5-codex' },
      },
    }

    expect(isRoutingModelConfig(config)).toBe(true)
    expect(isRoutingModelConfig({ kind: 'concrete' })).toBe(false)
    expect(isRoutingModelConfig(null)).toBe(false)
  })

  it('normalizes non-empty routing candidates only', () => {
    const candidates = normalizeRoutingCandidates({
      simple: { providerProfileId: 'cheap', modelId: 'small' },
      default: { providerProfileId: 'main', modelId: 'sonnet' },
      complex: { providerProfileId: '', modelId: 'opus' },
      longContext: { providerProfileId: 'long', modelId: '   ' },
    })

    expect(candidates).toEqual({
      simple: [{ providerProfileId: 'cheap', modelId: 'small' }],
      default: [{ providerProfileId: 'main', modelId: 'sonnet' }],
    })
  })

  it('normalizes multiple routing candidates per slot', () => {
    const candidates = normalizeRoutingCandidates({
      default: [
        { providerProfileId: 'fast', modelId: 'small' },
        { providerProfileId: 'fast', modelId: 'small' },
        { providerProfileId: 'main', modelId: 'large' },
      ],
    })

    expect(candidates.default).toEqual([
      { providerProfileId: 'fast', modelId: 'small' },
      { providerProfileId: 'main', modelId: 'large' },
    ])
  })

  it('allows Anthropic providers for Claude routers', () => {
    expect(isProviderAllowedForRouterAdapter('claude', anthropicProvider)).toBe(true)
    expect(isProviderAllowedForRouterAdapter('claude', openAiProvider)).toBe(false)
  })

  it('allows OpenAI and OpenAI-compatible text providers for Codex routers', () => {
    expect(isProviderAllowedForRouterAdapter('codex', openAiProvider)).toBe(true)
    expect(isProviderAllowedForRouterAdapter('codex', compatibleProvider)).toBe(true)
    expect(isProviderAllowedForRouterAdapter('codex', anthropicProvider)).toBe(false)
  })

  it('excludes multimedia providers from text routing', () => {
    expect(
      isProviderAllowedForRouterAdapter('codex', {
        id: 'image-1',
        provider: 'openai-compatible',
        modelType: 'image',
      }),
    ).toBe(false)
    expect(
      isProviderAllowedForRouterAdapter('codex', {
        id: 'multimodal-chat-1',
        provider: 'openai-compatible',
        modelType: 'multimodal',
      }),
    ).toBe(true)
    expect(
      isProviderAllowedForRouterAdapter('codex', {
        id: 'multimodal-media-1',
        provider: 'openai-compatible',
        modelType: 'multimodal',
        mediaCapabilities: ['image.generate'],
      }),
    ).toBe(false)
    expect(
      isProviderAllowedForRouterAdapter('codex', {
        id: 'media-1',
        provider: 'openai-compatible',
        modelType: 'text',
        mediaProvider: 'openai',
      }),
    ).toBe(false)
  })
})
