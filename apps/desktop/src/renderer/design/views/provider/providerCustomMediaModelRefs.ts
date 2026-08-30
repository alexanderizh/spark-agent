import { createBasicCustomMediaManifest, createCustomMediaManifestId } from '@spark/protocol'
import type {
  MediaApiType,
  MediaProviderKind,
  ProviderMediaModelRef,
  ProviderModelType,
} from '@spark/protocol'

interface AppendCustomMediaModelRefInput {
  mediaApiType: MediaApiType
  mediaProvider: MediaProviderKind | ''
  modelId: string
  modelType: ProviderModelType
}

/**
 * Add a user-entered media model without rewriting any persisted manifest identities.
 * The random instance segment prevents different non-ASCII model IDs from sharing a slug.
 */
export function appendCustomMediaModelRef(
  refs: ProviderMediaModelRef[],
  input: AppendCustomMediaModelRefInput,
): ProviderMediaModelRef[] {
  const modelId = input.modelId.trim()
  const existing = new Map(refs.map((ref) => [ref.manifestId, ref]))

  // A provider cannot contain the same upstream model twice, even under different manifests.
  if (!modelId || refs.some((ref) => ref.modelId?.trim() === modelId)) {
    return [...existing.values()]
  }

  const mode =
    input.mediaApiType === 'async' || (input.mediaApiType === 'auto' && input.modelType === 'video')
      ? 'async_polling'
      : 'sync'
  const manifest =
    input.mediaProvider === 'custom' && (input.modelType === 'image' || input.modelType === 'video')
      ? createBasicCustomMediaManifest({ modelId, modelType: input.modelType, mode })
      : undefined
  const manifestId = manifest?.id ?? createCustomMediaManifestId(modelId)

  existing.set(manifestId, {
    manifestId,
    modelId,
    enabled: true,
    ...(manifest ? { manifest } : {}),
  })
  return [...existing.values()]
}
