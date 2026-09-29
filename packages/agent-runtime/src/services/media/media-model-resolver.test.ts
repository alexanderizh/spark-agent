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
