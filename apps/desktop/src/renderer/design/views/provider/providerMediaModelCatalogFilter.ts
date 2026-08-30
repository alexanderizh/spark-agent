import type { CanvasMediaModelSummary } from '@spark/protocol'

export function filterProviderMediaModels(
  models: readonly CanvasMediaModelSummary[],
  rawQuery: string,
): CanvasMediaModelSummary[] {
  const terms = rawQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...models]

  return models.filter((model) => {
    const searchableText = [
      model.displayName,
      model.modelId,
      model.effectiveModelId,
      model.manifestId,
      model.providerKind,
      model.invocationMode,
      ...model.domains,
      ...model.capabilities.flatMap((capability) => [capability.id, capability.label]),
    ].join(' ').toLocaleLowerCase()
    return terms.every((term) => searchableText.includes(term))
  })
}
