import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import {
  buildCanvasAgentModelOptions,
  resolveCanvasAgentModelSelection,
} from './canvas-agent-model-options'

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

describe('canvas agent model options', () => {
  const claudeProvider = profile({
    id: 'anthropic-provider',
    provider: 'anthropic',
    name: 'Claude SDK',
    defaultModel: 'claude-sonnet-4-5',
    modelIds: ['claude-sonnet-4-5'],
  })
  const codexProvider = profile({
    id: 'openai-provider',
    provider: 'openai',
    name: 'OpenAI',
    defaultModel: 'gpt-5',
    modelIds: ['gpt-5', 'gpt-5-mini'],
  })
  const imageProvider = profile({
    id: 'image-provider',
    provider: 'openai-compatible',
    name: 'Image Provider',
    defaultModel: 'image-1',
    modelIds: ['image-1'],
    modelType: 'image',
  })
  const voiceProvider = profile({
    id: 'voice-provider',
    provider: 'openai-compatible',
    name: 'Voice Provider',
    defaultModel: 'voice-1',
    modelIds: ['voice-1'],
    modelType: 'voice',
  })
  const videoProvider = profile({
    id: 'video-provider',
    provider: 'openai-compatible',
    name: 'Video Provider',
    defaultModel: 'video-1',
    modelIds: ['video-1'],
    modelType: 'video',
  })

  it('builds one provider/model list that carries the hidden adapter per option', () => {
    const groups = buildCanvasAgentModelOptions([claudeProvider, codexProvider])

    expect(groups).toEqual([
      {
        provider: claudeProvider,
        adapter: 'claude-sdk',
        models: [{ modelId: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' }],
      },
      {
        provider: codexProvider,
        adapter: 'codex',
        models: [
          { modelId: 'gpt-5', label: 'gpt-5' },
          { modelId: 'gpt-5-mini', label: 'gpt-5-mini' },
        ],
      },
    ])
  })

  it('only exposes conversation providers in the canvas agent model selector', () => {
    const groups = buildCanvasAgentModelOptions([
      claudeProvider,
      imageProvider,
      voiceProvider,
      videoProvider,
      codexProvider,
    ])

    expect(groups.map((group) => group.provider.id)).toEqual([
      'anthropic-provider',
      'openai-provider',
    ])
  })

  it('resolves provider, model, and adapter from a single model selection', () => {
    const selection = resolveCanvasAgentModelSelection({
      providers: [claudeProvider, codexProvider],
      providerId: 'openai-provider',
      modelId: 'gpt-5-mini',
      fallbackAdapter: 'claude-sdk',
    })

    expect(selection).toEqual({
      provider: codexProvider,
      providerId: 'openai-provider',
      modelId: 'gpt-5-mini',
      adapter: 'codex',
    })
  })
})
