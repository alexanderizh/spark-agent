import type { CanvasMediaModelSummary, ProviderIconConfig } from '@spark/protocol'

export type CanvasModelProviderGroup = {
  key: string
  label: string
  providerKind: string
  providerProfileId?: string
  providerIcon?: ProviderIconConfig
  models: CanvasMediaModelSummary[]
}

export function mediaModelKey(model: CanvasMediaModelSummary): string {
  return [
    model.providerProfileId ?? 'catalog',
    model.manifestId,
    model.effectiveModelId,
  ].join('::')
}

export function buildCanvasModelProviderGroups(
  models: readonly CanvasMediaModelSummary[],
): CanvasModelProviderGroup[] {
  const groups = new Map<string, CanvasModelProviderGroup>()
  for (const model of models) {
    const key = model.providerProfileId ?? `catalog:${model.providerKind}`
    const existing = groups.get(key)
    if (existing) {
      existing.models.push(model)
      continue
    }
    groups.set(key, {
      key,
      label: model.providerName?.trim() || model.providerKind,
      providerKind: model.providerKind,
      ...(model.providerProfileId ? { providerProfileId: model.providerProfileId } : {}),
      ...(model.providerIcon ? { providerIcon: model.providerIcon } : {}),
      models: [model],
    })
  }
  return Array.from(groups.values())
}

export function filterCanvasModelProviderGroups(
  groups: readonly CanvasModelProviderGroup[],
  query: string,
): CanvasModelProviderGroup[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return groups.map((group) => ({ ...group, models: [...group.models] }))
  return groups.flatMap((group) => {
    const providerMatches = `${group.label} ${group.providerKind}`
      .toLowerCase()
      .includes(keyword)
    const models = providerMatches
      ? [...group.models]
      : group.models.filter((model) =>
          [model.displayName, model.manifestId, model.effectiveModelId, model.modelId]
            .join(' ')
            .toLowerCase()
            .includes(keyword),
        )
    return models.length > 0 ? [{ ...group, models }] : []
  })
}

export function resolveSelectedCanvasModel(
  models: readonly CanvasMediaModelSummary[],
  selectedKey: string,
): CanvasMediaModelSummary | undefined {
  return models.find((model) => mediaModelKey(model) === selectedKey)
}
