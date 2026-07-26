import { describe, expect, it } from 'vitest'
import { limitProviderCardModelIds, resolveProviderCardModelIds } from './provider-card-models'

describe('provider card model presentation', () => {
  it('shows media and text models together for a managed mixed provider', () => {
    expect(
      resolveProviderCardModelIds({
        textModelIds: ['MiniMax-M3', 'glm-5.2', 'MiniMax-M3'],
        mediaModelRefs: [
          {
            manifestId: 'platform:seedream',
            modelId: 'doubao-seedream-4-5-251128',
            enabled: true,
          },
        ],
        includeTextModels: true,
      }),
    ).toEqual(['doubao-seedream-4-5-251128', 'MiniMax-M3', 'glm-5.2'])
  })

  it('keeps ordinary media providers limited to their media refs', () => {
    expect(
      resolveProviderCardModelIds({
        textModelIds: ['legacy-template-model'],
        mediaModelRefs: [
          { manifestId: 'custom:image-model', modelId: 'image-model', enabled: true },
        ],
        includeTextModels: false,
      }),
    ).toEqual(['image-model'])
  })

  it('returns overflow models separately for an ellipsis indicator', () => {
    expect(limitProviderCardModelIds(['image', 'text-a', 'text-b', 'text-c'])).toEqual({
      visibleModelIds: ['image', 'text-a', 'text-b'],
      hiddenModelIds: ['text-c'],
    })
  })
})
