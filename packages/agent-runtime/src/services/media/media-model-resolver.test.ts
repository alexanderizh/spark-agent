import { describe, expect, it } from 'vitest'
import type { ProviderMediaModelRef } from '@spark/protocol'

import type { MediaModelCatalogService } from './media-model-catalog.service.js'
import { resolveProfileMediaModels, synthesizeMediaManifestForRef } from './media-model-resolver.js'

/**
 * 空目录：目录里没有任何 providerKind='custom' 的 manifest，
 * 复现自定义语音渠道裸 custom: ref 的真实解析环境。
 */
function emptyCatalog(): MediaModelCatalogService {
  return {
    list: () => [],
    describe: () => null,
  } as unknown as MediaModelCatalogService
}

const voiceProfile = {
  modelType: 'voice',
  mediaProvider: 'custom',
  mediaCapabilities: ['audio.speech'],
}

const bareVoiceRef: ProviderMediaModelRef = {
  // voice 支持 inline manifest 之前保存的存量 ref：只有裸 manifestId，没有 manifest。
  manifestId: 'custom:my-tts-model:a1b2c3d4-1111-2222-3333-444455556666',
  modelId: 'my-tts-model',
  enabled: true,
}

describe('media-model-resolver 语音渠道存量兜底', () => {
  it('synthesizes a basic TTS manifest for a bare custom: voice ref with no catalog bases', () => {
    const manifest = synthesizeMediaManifestForRef(voiceProfile, bareVoiceRef, emptyCatalog())

    expect(manifest).not.toBeNull()
    // manifestId 沿用 ref 原值，身份稳定，用户无需重新配置。
    expect(manifest?.id).toBe(bareVoiceRef.manifestId)
    expect(manifest?.modelId).toBe('my-tts-model')
    expect(manifest?.domains).toEqual(['audio'])
    expect(manifest?.capabilities.map((capability) => capability.id)).toEqual(['audio.speech'])
    expect(manifest?.invocation).toMatchObject({
      endpoint: '/audio/speech',
      response: { kind: 'binary_response' },
    })
  })

  it('resolves bare custom: voice refs so they stay visible in quick create', () => {
    const resolved = resolveProfileMediaModels(
      { ...voiceProfile, mediaModelRefs: [bareVoiceRef] },
      emptyCatalog(),
    )

    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.synthesized).toBe(true)
    expect(resolved[0]?.effectiveModelId).toBe('my-tts-model')
  })

  it('still drops bare custom: refs for non-audio domains without catalog bases', () => {
    // image/video 的自定义模型一直携带 inline manifest，这里确认兜底不越界：
    // 非 audio 域 + 空目录的裸 ref 仍按原行为丢弃。
    const manifest = synthesizeMediaManifestForRef(
      { modelType: 'image', mediaProvider: 'custom', mediaCapabilities: ['image.generate'] },
      { ...bareVoiceRef, modelId: 'legacy-image-model' },
      emptyCatalog(),
    )
    expect(manifest).toBeNull()
  })
})

describe('media-model-resolver 空 refs 的 defaultModel 兜底', () => {
  it('synthesizes the declared default model for a custom voice channel without refs', () => {
    const resolved = resolveProfileMediaModels(
      {
        modelType: 'voice',
        mediaProvider: 'custom',
        mediaCapabilities: ['audio.speech'],
        defaultModel: 'my-custom-tts',
        modelIds: ['my-custom-tts'],
      },
      emptyCatalog(),
    )

    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.synthesized).toBe(true)
    expect(resolved[0]?.effectiveModelId).toBe('my-custom-tts')
    expect(resolved[0]?.manifest.capabilities.map((capability) => capability.id)).toEqual([
      'audio.speech',
    ])
  })

  it('honours the channel audio capability selection for the synthesized contract', () => {
    const resolved = resolveProfileMediaModels(
      {
        modelType: 'voice',
        mediaProvider: 'custom',
        mediaCapabilities: ['audio.music'],
        defaultModel: 'my-custom-music',
      },
      emptyCatalog(),
    )

    expect(resolved[0]?.manifest.capabilities.map((capability) => capability.id)).toEqual([
      'audio.music',
    ])
  })

  it('keeps the synthesized model invisible when the filter asks for an undeclared capability', () => {
    const resolved = resolveProfileMediaModels(
      {
        modelType: 'voice',
        mediaProvider: 'custom',
        mediaCapabilities: ['audio.speech'],
        defaultModel: 'my-custom-tts',
      },
      emptyCatalog(),
      { capability: 'audio.transcription' },
    )

    expect(resolved).toEqual([])
  })

  it('does not synthesize for non-custom providers with no catalog match', () => {
    const resolved = resolveProfileMediaModels(
      {
        modelType: 'voice',
        mediaProvider: 'zhipu',
        mediaCapabilities: ['audio.speech'],
        defaultModel: 'glm-tts',
      },
      emptyCatalog(),
    )

    expect(resolved).toEqual([])
  })

  it('still treats configured refs as the single source of truth', () => {
    // refs 存在但解析不出（非 audio 裸 ref + 空目录）：不得因为 defaultModel 又冒出模型来。
    const resolved = resolveProfileMediaModels(
      {
        modelType: 'image',
        mediaProvider: 'custom',
        mediaCapabilities: ['image.generate'],
        defaultModel: 'legacy-image-model',
        mediaModelRefs: [
          { manifestId: 'custom:legacy-image-model', modelId: 'legacy-image-model' },
        ],
      },
      emptyCatalog(),
    )

    expect(resolved).toEqual([])
  })
})
