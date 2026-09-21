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
  return [model.providerProfileId ?? 'catalog', model.manifestId, model.effectiveModelId].join('::')
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

// 置顶模型排到所在分组最前，含置顶模型的渠道排到渠道列表最前；sort 稳定，保持原有相对顺序。
export function sortCanvasModelProviderGroups(
  groups: readonly CanvasModelProviderGroup[],
  pinnedKeys: ReadonlySet<string>,
): CanvasModelProviderGroup[] {
  const hasPinnedModel = (group: CanvasModelProviderGroup) =>
    group.models.some((model) => pinnedKeys.has(mediaModelKey(model)))
  return groups
    .map((group) => ({
      ...group,
      models: [...group.models].sort(
        (a, b) =>
          Number(pinnedKeys.has(mediaModelKey(b))) - Number(pinnedKeys.has(mediaModelKey(a))),
      ),
    }))
    .sort((a, b) => Number(hasPinnedModel(b)) - Number(hasPinnedModel(a)))
}

export function filterCanvasModelProviderGroups(
  groups: readonly CanvasModelProviderGroup[],
  query: string,
): CanvasModelProviderGroup[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return groups.map((group) => ({ ...group, models: [...group.models] }))
  return groups.flatMap((group) => {
    const providerMatches = `${group.label} ${group.providerKind}`.toLowerCase().includes(keyword)
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
