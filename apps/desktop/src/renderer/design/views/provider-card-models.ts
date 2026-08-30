import type { ProviderMediaModelRef } from '@spark/protocol'

export const PROVIDER_CARD_MODEL_LIMIT = 3

export function resolveProviderCardModelIds(params: {
  textModelIds: readonly string[]
  mediaModelRefs: readonly ProviderMediaModelRef[]
  includeTextModels: boolean
}): string[] {
  const textModelIds = params.textModelIds.map((modelId) => modelId.trim()).filter(Boolean)
  const mediaModelIds = params.mediaModelRefs
    .filter((ref) => ref.enabled !== false)
    .map((ref) => (ref.modelId ?? '').trim() || ref.manifestId.replace(/^custom:/, ''))
    .filter(Boolean)

  if (mediaModelIds.length === 0) return uniqueModelIds(textModelIds)
  return uniqueModelIds(
    params.includeTextModels ? [...mediaModelIds, ...textModelIds] : mediaModelIds,
  )
}

export function limitProviderCardModelIds(
  modelIds: readonly string[],
  limit = PROVIDER_CARD_MODEL_LIMIT,
): { visibleModelIds: string[]; hiddenModelIds: string[] } {
  const normalized = uniqueModelIds(modelIds)
  const safeLimit = Math.max(0, Math.floor(limit))
  return {
    visibleModelIds: normalized.slice(0, safeLimit),
    hiddenModelIds: normalized.slice(safeLimit),
  }
}

function uniqueModelIds(modelIds: readonly string[]): string[] {
  return [...new Set(modelIds.map((modelId) => modelId.trim()).filter(Boolean))]
}
