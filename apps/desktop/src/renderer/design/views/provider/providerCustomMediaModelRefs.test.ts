import { describe, expect, it } from 'vitest'
import type { ProviderMediaModelRef } from '@spark/protocol'

import { appendCustomMediaModelRef } from './providerCustomMediaModelRefs'

const imageProviderInput = {
  mediaApiType: 'sync' as const,
  mediaProvider: 'openai-images' as const,
  modelType: 'image' as const,
}

describe('appendCustomMediaModelRef', () => {
  it('keeps different Chinese model IDs even when their readable slugs collide', () => {
    const first = appendCustomMediaModelRef([], {
      ...imageProviderInput,
      modelId: 'Krea2-姿势控制-文生图',
    })
    const second = appendCustomMediaModelRef(first, {
      ...imageProviderInput,
      modelId: 'Krea2-指令编辑-图生图',
    })

    expect(second).toHaveLength(2)
    expect(second.map((ref) => ref.modelId)).toEqual([
      'Krea2-姿势控制-文生图',
      'Krea2-指令编辑-图生图',
    ])
    expect(second[0]?.manifestId).toBe(first[0]?.manifestId)
    expect(second[1]?.manifestId).not.toBe(second[0]?.manifestId)
    expect(second.every((ref) => /^custom:krea2:[a-f0-9-]{36}$/.test(ref.manifestId))).toBe(true)
  })

  it('does not add the same provider model ID twice', () => {
    const existing: ProviderMediaModelRef[] = [
      {
        manifestId: 'custom:legacy-model',
        modelId: 'legacy-model',
        enabled: true,
      },
    ]

    expect(
      appendCustomMediaModelRef(existing, {
        ...imageProviderInput,
        modelId: ' legacy-model ',
      }),
    ).toEqual(existing)
  })

  it('keeps generating an inline manifest for fully custom image providers', () => {
    const [ref] = appendCustomMediaModelRef([], {
      mediaApiType: 'auto',
      mediaProvider: 'custom',
      modelId: 'custom-image-model',
      modelType: 'image',
    })
    if (!ref) throw new Error('Expected the custom media model reference to be created')

    expect(ref.manifest).toMatchObject({
      id: ref.manifestId,
      modelId: 'custom-image-model',
      providerKind: 'custom',
    })
  })

  it('generates an inline TTS manifest for fully custom voice providers', () => {
    // 回归：语音渠道此前只存裸 custom: id（无 manifest），主进程解析时被丢弃，
    // 表现为快速创作里看不到自定义语音模型。
    const [ref] = appendCustomMediaModelRef([], {
      mediaApiType: 'sync',
      mediaProvider: 'custom',
      modelId: 'my-custom-tts',
      modelType: 'voice',
    })
    if (!ref) throw new Error('Expected the custom voice model reference to be created')

    expect(ref.manifest).toMatchObject({
      id: ref.manifestId,
      modelId: 'my-custom-tts',
      providerKind: 'custom',
      domains: ['audio'],
    })
    expect(ref.manifest?.capabilities.map((capability) => capability.id)).toEqual(['audio.speech'])
    expect(ref.manifest?.invocation).toMatchObject({
      endpoint: '/audio/speech',
      response: { kind: 'binary_response' },
    })
  })

  it('generates the capability-specific contract for custom voice models', () => {
    const [speech] = appendCustomMediaModelRef([], {
      mediaApiType: 'sync',
      mediaProvider: 'custom',
      modelId: 'my-custom-tts-2',
      modelType: 'voice',
      audioCapabilities: ['audio.speech'],
    })
    const [music] = appendCustomMediaModelRef([], {
      mediaApiType: 'sync',
      mediaProvider: 'custom',
      modelId: 'my-custom-music',
      modelType: 'voice',
      audioCapabilities: ['audio.music'],
    })
    const [asr] = appendCustomMediaModelRef([], {
      mediaApiType: 'sync',
      mediaProvider: 'custom',
      modelId: 'my-custom-asr',
      modelType: 'voice',
      audioCapabilities: ['audio.transcription'],
    })

    expect(speech?.manifest?.capabilities.map((capability) => capability.id)).toEqual([
      'audio.speech',
    ])
    expect(music?.manifest?.capabilities.map((capability) => capability.id)).toEqual([
      'audio.music',
    ])
    expect(asr?.manifest?.capabilities.map((capability) => capability.id)).toEqual([
      'audio.transcription',
    ])
  })
})
