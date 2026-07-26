import { describe, expect, it } from 'vitest'
import { mapPlatformModelCatalog } from '../platform-media-model-mapping.js'

describe('mapPlatformModelCatalog', () => {
  it('keeps text models separate from tag-mapped platform image models', () => {
    const result = mapPlatformModelCatalog([
      { modelId: 'glm-5', tags: [] },
      { modelId: 'spark-img', tags: ['model:image', 'openai:gpt-image-2'] },
    ])

    expect(result.textModelIds).toEqual(['glm-5'])
    expect(result.mediaModelRefs).toEqual([
      expect.objectContaining({
        modelId: 'spark-img',
        templateManifestId: 'openai-images:gpt-image-2',
        displayName: 'spark-img',
      }),
    ])
    expect(result.issues).toEqual([])
  })

  it('rejects image entries that cannot resolve one existing adapter template', () => {
    const result = mapPlatformModelCatalog([
      { modelId: 'missing-tag', tags: ['model:image'] },
      { modelId: 'unknown-template', tags: ['model:image', 'openai:not-a-real-model'] },
      {
        modelId: 'ambiguous',
        tags: ['model:image', 'openai:gpt-image-2', 'volcengine:doubao-seedream-4-5-251128'],
      },
    ])

    expect(result.textModelIds).toEqual([])
    expect(result.mediaModelRefs).toEqual([])
    expect(result.issues.map((issue) => issue.reason)).toEqual([
      'missing_adapter_tag',
      'manifest_not_found',
      'multiple_adapter_tags',
    ])
  })
})
