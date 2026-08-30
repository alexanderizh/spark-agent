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
})
