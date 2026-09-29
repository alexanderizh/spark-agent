import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '@spark/protocol'
import type {
  MediaGenerateInput,
  MediaProviderAdapter,
  MediaProviderContext,
} from '../../../services/media/media-adapter.types.js'
import {
  MediaRouterService,
  type MediaProviderProfile,
} from '../../../services/media/media-router.service.js'

/**
 * text_to_audio 的候选能力是 [audio.music, audio.speech]，只按全局候选顺序推导会选中
 * audio.music；而语音合成的模型（如 MiniMax speech-2.8-hd）只声明 audio.speech，
 * router 随后直接抛 capability_not_supported。这里锁定「钉死模型时以模型声明为准」。
 */

const minimaxManifests = BUILTIN_MEDIA_MODEL_MANIFESTS.filter(
  (manifest) => manifest.providerKind === 'minimax-hailuo',
)

function minimaxProfile(): MediaProviderProfile {
  return {
    id: 'minimax',
    name: 'MiniMax',
    apiKey: 'key',
    apiEndpoint: 'https://api.minimax.test',
    defaultModel: 'speech-2.8-hd',
    modelIds: ['speech-2.8-hd', 'speech-2.8-turbo', 'music-2.6', 'asr-1.0'],
    mediaProvider: 'minimax-hailuo',
    mediaModelManifests: minimaxManifests,
  }
}

describe('MediaRouterService 钉死模型的能力推导', () => {
  const router = new MediaRouterService()
  const input: MediaGenerateInput = {
    operation: 'text_to_audio',
    prompt: '早安，主人',
    outputDir: '/tmp',
  }

  it('TTS 模型（只声明 audio.speech）推导为 audio.speech', () => {
    expect(
      router.resolveCapabilityForInput(input, {
        providers: [minimaxProfile()],
        providerProfileId: 'minimax',
        modelId: 'speech-2.8-hd',
        manifestId: 'minimax:speech-2.8-hd',
      }),
    ).toBe('audio.speech')
  })

  it('音乐模型（只声明 audio.music）仍然推导为 audio.music', () => {
    expect(
      router.resolveCapabilityForInput(input, {
        providers: [minimaxProfile()],
        providerProfileId: 'minimax',
        modelId: 'music-2.6',
        manifestId: 'minimax:music-2.6',
      }),
    ).toBe('audio.music')
  })

  it('未钉死模型时维持既有全局候选推导（audio.music 优先）', () => {
    expect(
      router.resolveCapabilityForInput(input, {
        providers: [minimaxProfile()],
        providerProfileId: 'minimax',
      }),
    ).toBe('audio.music')
  })

  it('未钉死模型且没有任何 provider 支持候选时回落到候选首项', () => {
    expect(router.resolveCapabilityForInput(input, { providers: [] })).toBe('audio.music')
  })

  it('钉死 TTS 模型后 invoke 用 audio.speech 调适配器，不再抛 capability_not_supported', async () => {
    const invoke = vi.fn(async (_input: MediaGenerateInput, context: MediaProviderContext) => ({
      provider: 'minimax-hailuo',
      model: context.adapterModelId ?? context.defaultModel,
      mode: 'sync' as const,
      assets: [],
      mediaManifestCapability: context.mediaManifestCapability?.id,
    }))
    const adapter: MediaProviderAdapter = {
      id: 'minimax-hailuo',
      supports: () => true,
      invoke,
    }
    const scoped = new MediaRouterService()
    scoped.register(adapter)

    const result = await scoped.invoke(input, {
      providers: [minimaxProfile()],
      providerProfileId: 'minimax',
      modelId: 'speech-2.8-hd',
      manifestId: 'minimax:speech-2.8-hd',
      skipValidation: true,
    })

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0]?.[0]?.capability).toBe('audio.speech')
    expect(result.providerProfileId).toBe('minimax')
  })
})
