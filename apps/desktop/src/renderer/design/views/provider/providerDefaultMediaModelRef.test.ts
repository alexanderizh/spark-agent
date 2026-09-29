import { describe, expect, it } from 'vitest'
import type { CanvasMediaModelSummary, ProviderMediaModelRef } from '@spark/protocol'

import { ensureMediaDefaultModelRef } from './providerDefaultMediaModelRef'

function catalogModel(overrides: Partial<CanvasMediaModelSummary>): CanvasMediaModelSummary {
  return {
    manifestId: 'minimax:speech-2.8-hd',
    providerKind: 'minimax-hailuo',
    modelId: 'speech-2.8-hd',
    effectiveModelId: 'speech-2.8-hd',
    displayName: 'MiniMax Speech 2.8 HD',
    domains: ['audio'],
    invocationMode: 'sync',
    capabilities: [
      {
        id: 'audio.speech',
        label: '语音合成',
        input: { required: ['prompt'] },
        output: { types: ['audio'] },
        paramSchema: { type: 'object', properties: {} },
      },
    ],
    sourceUrls: [],
    enabled: true,
    ...overrides,
  }
}

const voiceContext = {
  mediaApiType: 'sync' as const,
  mediaProvider: 'custom' as const,
  modelType: 'voice' as const,
  mediaCapabilities: ['audio.speech'],
}

describe('ensureMediaDefaultModelRef', () => {
  it('adds a catalog-backed ref when the typed default matches a catalog model', () => {
    const existing: ProviderMediaModelRef[] = []
    const result = ensureMediaDefaultModelRef(existing, 'speech-2.8-hd', voiceContext, [
      catalogModel({}),
    ])

    expect(result.added).toBe(true)
    expect(result.refs).toHaveLength(1)
    expect(result.refs[0]).toMatchObject({
      manifestId: 'minimax:speech-2.8-hd',
      modelId: 'speech-2.8-hd',
      enabled: true,
    })
    // 目录命中的模型沿用内置 manifest，不额外写 inline manifest。
    expect(result.refs[0]?.manifest).toBeUndefined()
  })

  it('adds an inline custom manifest for a custom channel model missing from the catalog', () => {
    const result = ensureMediaDefaultModelRef([], 'my-custom-tts', voiceContext, [])

    expect(result.added).toBe(true)
    expect(result.refs[0]?.manifest).toMatchObject({
      modelId: 'my-custom-tts',
      providerKind: 'custom',
      domains: ['audio'],
    })
    expect(result.refs[0]?.manifest?.capabilities.map((capability) => capability.id)).toEqual([
      'audio.speech',
    ])
  })

  it('honours the channel audio capability selection for the generated voice contract', () => {
    const result = ensureMediaDefaultModelRef(
      [],
      'my-custom-asr',
      { ...voiceContext, mediaCapabilities: ['audio.transcription'] },
      [],
    )

    expect(result.refs[0]?.manifest?.capabilities.map((capability) => capability.id)).toEqual([
      'audio.transcription',
    ])
    expect(result.refs[0]?.manifest?.invocation.endpoint).toBe('/audio/transcriptions')
  })

  it('is idempotent when a ref already carries the typed model id', () => {
    const existing: ProviderMediaModelRef[] = [
      { manifestId: 'custom:my-custom-tts:abc', modelId: 'my-custom-tts', enabled: true },
    ]
    const result = ensureMediaDefaultModelRef(existing, ' my-custom-tts ', voiceContext, [])

    expect(result.added).toBe(false)
    expect(result.refs).toEqual(existing)
  })

  it('does nothing for an empty model id', () => {
    const result = ensureMediaDefaultModelRef([], '   ', voiceContext, [])
    expect(result.added).toBe(false)
    expect(result.refs).toEqual([])
  })
})
