import type { ConfiguredModelCatalog } from '../config/model-config.js'

/**
 * Human-facing model label: the catalog's bare model name when the route is
 * known, otherwise the last segment of a `source:provider:model` route id.
 * Full route ids stay machine-only (/status, errors) per the 017 design.
 */
export function displayModelName(
  model: string | undefined,
  catalog: ConfiguredModelCatalog | undefined,
): string | undefined {
  if (model === undefined) return undefined
  const entry = catalog?.entries.find((candidate) => candidate.id === model)
  if (entry !== undefined && entry.model.trim() !== '') return entry.model
  const segments = model.split(':')
  return (segments.at(-1) ?? model).trim() || model
}
