import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '@spark/protocol'
import type {
  MediaGenerateInput,
  MediaProviderAdapter,
  MediaProviderContext,
} from '../../../services/media/media-adapter.types.js'
import {
  MediaRouterService,
  profileSupportsMediaCapability,
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

/**
 * 渠道级误声明与共享判定助手 profileSupportsMediaCapability：
 * 语音助手自动选路、画布自动路由共用 supports() 的「模型级 manifest 优先」语义，
 * 这里锁定误声明 ASR 渠道被拒、旧渠道/内置渠道回退不受影响。
 */
const asrManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
  (manifest) => manifest.id === 'minimax:asr-1.0',
)
const speechManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
  (manifest) => manifest.id === 'minimax:speech-2.8-hd',
)

/** 渠道级误声明 audio.speech、模型只有 audio.transcription 的 ASR 渠道（回归现场）。 */
function misdeclaredAsrProfile(): MediaProviderProfile {
  return {
    id: 'asr-provider',
    name: 'ASR 渠道',
    apiKey: 'key',
    apiEndpoint: 'https://asr.test',
    defaultModel: 'asr-1.0',
    modelIds: ['asr-1.0'],
    mediaProvider: 'minimax-hailuo',
    mediaCapabilities: ['audio.speech', 'audio.transcription'],
    mediaModelManifests: asrManifest != null ? [asrManifest] : [],
  }
}

describe('profileSupportsMediaCapability 声明层判定', () => {
  it('有 manifest 的渠道以模型级声明为准：误声明 audio.speech 的 ASR 渠道判为 unsupported', () => {
    expect(profileSupportsMediaCapability(misdeclaredAsrProfile(), 'audio.speech')).toBe(
      'unsupported',
    )
  })

  it('模型声明了该能力时判为 model（渠道级未声明也照样放行）', () => {
    const profile = minimaxProfile()
    delete profile.mediaCapabilities
    expect(profileSupportsMediaCapability(profile, 'audio.speech')).toBe('model')
  })

  it('无 manifest 旧渠道回退渠道级声明：命中判为 provider', () => {
    const legacy: MediaProviderProfile = {
      id: 'legacy',
      name: '旧渠道',
      apiKey: 'key',
      defaultModel: 'tts-1',
      mediaCapabilities: ['audio.speech'],
    }
    expect(profileSupportsMediaCapability(legacy, 'audio.speech')).toBe('provider')
  })

  it('无 manifest 旧渠道未声明该能力判为 unsupported', () => {
    const legacy: MediaProviderProfile = {
      id: 'legacy',
      name: '旧渠道',
      apiKey: 'key',
      defaultModel: 'img-1',
      mediaCapabilities: ['image.generate'],
    }
    expect(profileSupportsMediaCapability(legacy, 'audio.speech')).toBe('unsupported')
  })

  it('完全没有声明数据判为 none（调用方信任 adapter）', () => {
    const bare: MediaProviderProfile = {
      id: 'bare',
      name: '内置渠道',
      apiKey: 'key',
      defaultModel: 'tts-1',
    }
    expect(profileSupportsMediaCapability(bare, 'audio.speech')).toBe('none')
  })
})

describe('supports() 渠道选择语义', () => {
  it('误声明 audio.speech 的 ASR 渠道不被 supports 放行（即便原生 adapter 声称支持）', () => {
    const router = new MediaRouterService()
    expect(router.supports(misdeclaredAsrProfile(), 'audio.speech')).toBe(false)
  })

  it('无 manifest 旧渠道：渠道级声明 + adapter 支持仍放行（兼容回退不变）', () => {
    const invoke = vi.fn(async () => ({
      provider: 'minimax-hailuo',
      model: 'tts-1',
      mode: 'sync' as const,
      assets: [],
    }))
    const adapter: MediaProviderAdapter = { id: 'minimax-hailuo', supports: () => true, invoke }
    const router = new MediaRouterService()
    router.register(adapter)
    const legacy: MediaProviderProfile = {
      id: 'legacy',
      name: '旧渠道',
      apiKey: 'key',
      defaultModel: 'tts-1',
      mediaProvider: 'minimax-hailuo',
      mediaCapabilities: ['audio.speech'],
    }
    expect(router.supports(legacy, 'audio.speech')).toBe(true)
  })

  it('无任何声明的渠道信任 adapter（内置渠道路径不变）', () => {
    const invoke = vi.fn(async () => ({
      provider: 'minimax-hailuo',
      model: 'tts-1',
      mode: 'sync' as const,
      assets: [],
    }))
    const adapter: MediaProviderAdapter = { id: 'minimax-hailuo', supports: () => true, invoke }
    const router = new MediaRouterService()
    router.register(adapter)
    const bare: MediaProviderProfile = {
      id: 'bare',
      name: '内置渠道',
      apiKey: 'key',
      defaultModel: 'tts-1',
      mediaProvider: 'minimax-hailuo',
    }
    expect(router.supports(bare, 'audio.speech')).toBe(true)
  })
})

describe('invoke 未指定 modelId 时的模型解析', () => {
  it('默认模型未声明 audio.speech 而渠道内其他模型声明时，优先选声明该能力的模型', async () => {
    const manifests = [asrManifest, speechManifest].filter(
      (manifest): manifest is NonNullable<typeof manifest> => manifest != null,
    )
    expect(manifests.length).toBe(2)
    const invoke = vi.fn(async (_input: MediaGenerateInput, context: MediaProviderContext) => ({
      provider: 'minimax-hailuo',
      model: context.adapterModelId ?? context.defaultModel,
      mode: 'sync' as const,
      assets: [],
    }))
    const adapter: MediaProviderAdapter = {
      id: 'minimax-hailuo',
      supports: () => true,
      invoke,
    }
    const router = new MediaRouterService()
    router.register(adapter)
    // asr-1.0 排在最前且是 defaultModel，但只有它声明 audio.transcription；
    // speech-2.8-hd 声明 audio.speech —— 未钉死模型时必须落到后者。
    const profile: MediaProviderProfile = {
      id: 'mixed',
      name: '语音混合渠道',
      apiKey: 'key',
      apiEndpoint: 'https://api.minimax.test',
      defaultModel: 'asr-1.0',
      modelIds: ['asr-1.0', 'speech-2.8-hd'],
      mediaProvider: 'minimax-hailuo',
      mediaModelManifests: manifests,
    }

    const result = await router.invoke(
      { operation: 'text_to_audio', prompt: '早安', outputDir: '/tmp' },
      { providers: [profile], skipValidation: true },
    )

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0]?.[0]?.capability).toBe('audio.speech')
    expect(invoke.mock.calls[0]?.[1]?.adapterModelId).toBe('speech-2.8-hd')
    expect(result.providerProfileId).toBe('mixed')
  })

  it('无 manifest 渠道未指定 modelId 时保持 defaultModel（既有行为）', async () => {
    const invoke = vi.fn(async (_input: MediaGenerateInput, context: MediaProviderContext) => ({
      provider: 'volcengine-speech',
      model: context.adapterModelId ?? context.defaultModel,
      mode: 'sync' as const,
      assets: [],
    }))
    const adapter: MediaProviderAdapter = {
      id: 'volcengine-speech',
      supports: () => true,
      invoke,
    }
    const router = new MediaRouterService()
    router.register(adapter)
    const legacy: MediaProviderProfile = {
      id: 'legacy-tts',
      name: '旧 TTS 渠道',
      apiKey: 'key',
      defaultModel: 'legacy-tts-model',
      mediaProvider: 'volcengine-speech',
      mediaCapabilities: ['audio.speech'],
    }

    await router.invoke(
      { operation: 'text_to_audio', prompt: '早安', outputDir: '/tmp' },
      { providers: [legacy], skipValidation: true },
    )

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0]?.[1]?.adapterModelId).toBe('legacy-tts-model')
  })
})
