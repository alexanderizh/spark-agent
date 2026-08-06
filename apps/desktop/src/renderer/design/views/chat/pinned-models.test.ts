import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import {
  isPinnedModelRef,
  mergePinnedModelRefs,
  parsePinnedModelRefs,
  resolvePinnedModelEntries,
  togglePinnedModelRef,
} from './pinned-models'

function provider(overrides: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: 'provider',
    name: 'Provider',
    provider: 'openai',
    defaultModel: 'model',
    modelIds: ['model'],
    supportsMillionContext: false,
    modelType: 'multimodal',
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
    ...overrides,
  }
}

describe('pinned model refs', () => {
  it('pins to the head so the newest pin leads the 常用 group', () => {
    const first = togglePinnedModelRef([], 'spark', 'glm-5')
    const second = togglePinnedModelRef(first, 'ollama', 'gemma4:latest')

    expect(second).toEqual([
      { providerId: 'ollama', modelId: 'gemma4:latest' },
      { providerId: 'spark', modelId: 'glm-5' },
    ])
  })

  it('unpins only the matching provider+model pair', () => {
    const pinned = [
      { providerId: 'spark', modelId: 'glm-5' },
      { providerId: 'third-party', modelId: 'glm-5' },
    ]

    expect(togglePinnedModelRef(pinned, 'spark', 'glm-5')).toEqual([
      { providerId: 'third-party', modelId: 'glm-5' },
    ])
  })

  it('keeps a same-named model from another provider independently pinnable', () => {
    const pinned = togglePinnedModelRef([], 'spark', 'glm-5')

    expect(isPinnedModelRef(pinned, 'spark', 'glm-5')).toBe(true)
    expect(isPinnedModelRef(pinned, 'third-party', 'glm-5')).toBe(false)
  })

  it('drops malformed entries without losing the valid ones', () => {
    const raw = JSON.stringify([
      { providerId: 'spark', modelId: 'glm-5' },
      { providerId: 'spark' },
      { modelId: 'orphan' },
      { providerId: '', modelId: 'blank' },
      null,
      'garbage',
      { providerId: 'spark', modelId: 'glm-5' },
    ])

    expect(parsePinnedModelRefs(raw)).toEqual([{ providerId: 'spark', modelId: 'glm-5' }])
  })

  it('returns an empty list for unusable stored values', () => {
    expect(parsePinnedModelRefs(undefined)).toEqual([])
    expect(parsePinnedModelRefs('not json')).toEqual([])
    expect(parsePinnedModelRefs('{"providerId":"spark"}')).toEqual([])
  })
})

describe('mergePinnedModelRefs', () => {
  it('uses the loaded history when the user has not acted yet', () => {
    expect(mergePinnedModelRefs([], [{ providerId: 'spark', modelId: 'glm-5' }])).toEqual([
      { providerId: 'spark', modelId: 'glm-5' },
    ])
  })

  it('keeps the user actions at the head and appends the rest of the history', () => {
    const current = [{ providerId: 'ollama', modelId: 'gemma4:latest' }]
    const loaded = [
      { providerId: 'spark', modelId: 'glm-5' },
      { providerId: 'ollama', modelId: 'gemma4:latest' },
    ]

    expect(mergePinnedModelRefs(current, loaded)).toEqual([
      { providerId: 'ollama', modelId: 'gemma4:latest' },
      { providerId: 'spark', modelId: 'glm-5' },
    ])
  })

  it('never duplicates a ref that is already present', () => {
    const current = [{ providerId: 'spark', modelId: 'glm-5' }]
    const loaded = [
      { providerId: 'spark', modelId: 'glm-5' },
      { providerId: 'spark', modelId: 'glm-5' },
      { providerId: 'spark', modelId: 'glm-5.1' },
    ]

    expect(mergePinnedModelRefs(current, loaded)).toEqual([
      { providerId: 'spark', modelId: 'glm-5' },
      { providerId: 'spark', modelId: 'glm-5.1' },
    ])
  })

  it('is a no-op when the history is fully contained in the current state', () => {
    const current = [
      { providerId: 'spark', modelId: 'glm-5' },
      { providerId: 'ollama', modelId: 'gemma4:latest' },
    ]

    expect(mergePinnedModelRefs(current, current)).toEqual(current)
  })
})

describe('resolvePinnedModelEntries', () => {
  const spark = provider({ id: 'spark', name: 'Spark 平台模型', managed: true })
  const ollama = provider({ id: 'ollama', name: 'ollama' })
  const groups = [
    { provider: spark, models: ['glm-5', 'glm-5.1'] },
    { provider: ollama, models: ['gemma4:latest'] },
  ]

  it('emits entries in pin order rather than group order', () => {
    const pinned = [
      { providerId: 'ollama', modelId: 'gemma4:latest' },
      { providerId: 'spark', modelId: 'glm-5' },
    ]

    expect(resolvePinnedModelEntries(pinned, groups)).toEqual([
      { provider: ollama, modelId: 'gemma4:latest' },
      { provider: spark, modelId: 'glm-5' },
    ])
  })

  it('skips refs whose provider or model is gone without dropping the rest', () => {
    const pinned = [
      { providerId: 'removed-provider', modelId: 'glm-5' },
      { providerId: 'spark', modelId: 'retired-model' },
      { providerId: 'spark', modelId: 'glm-5.1' },
    ]

    expect(resolvePinnedModelEntries(pinned, groups)).toEqual([
      { provider: spark, modelId: 'glm-5.1' },
    ])
  })

  it('narrows with the search-filtered groups it is given', () => {
    const pinned = [
      { providerId: 'spark', modelId: 'glm-5' },
      { providerId: 'ollama', modelId: 'gemma4:latest' },
    ]
    const searchFiltered = [{ provider: ollama, models: ['gemma4:latest'] }]

    expect(resolvePinnedModelEntries(pinned, searchFiltered)).toEqual([
      { provider: ollama, modelId: 'gemma4:latest' },
    ])
  })
})
