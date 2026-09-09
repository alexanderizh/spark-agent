import type { ConfiguredModelCatalog } from '../config/model-config.js'

/**
 * Human-facing model label: the catalog's bare model name when the route is
 * known, otherwise the model portion of a SparkWork route id. Model names may
 * themselves contain colons, so an unrecognised model value must stay intact.
 * Full route ids stay machine-only (/status, errors) per the 017 design.
 */
export function displayModelName(
  model: string | undefined,
  catalog: ConfiguredModelCatalog | undefined,
): string | undefined {
  if (model === undefined) return undefined
  const entry = catalog?.entries.find((candidate) => candidate.id === model)
  if (entry !== undefined && entry.model.trim() !== '') return entry.model
  if (!model.startsWith('sparkwork:')) return model.trim() || model

  const routeSegments = model.split(':')
  return routeSegments.slice(2).join(':').trim() || model
}
