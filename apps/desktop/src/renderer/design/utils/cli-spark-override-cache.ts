import type { CliSparkOverride } from '@spark/protocol'

export const CLI_SPARK_OVERRIDE_CACHE_KEY = 'spark-agent:cli-spark-override-cache'

export type CliSparkOverrideCache = Record<string, CliSparkOverride>

export function readCliSparkOverrideCache(): CliSparkOverrideCache {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CLI_SPARK_OVERRIDE_CACHE_KEY)
    if (raw == null) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed == null || typeof parsed !== 'object') return {}
    const cache: CliSparkOverrideCache = {}
    for (const [primaryProviderId, value] of Object.entries(parsed)) {
      if (value == null || typeof value !== 'object') continue
      const candidate = value as Partial<CliSparkOverride>
      if (
        typeof candidate.providerProfileId !== 'string' ||
        candidate.providerProfileId.trim().length === 0 ||
        typeof candidate.modelId !== 'string' ||
        candidate.modelId.trim().length === 0
      ) {
        continue
      }
      cache[primaryProviderId] = {
        providerProfileId: candidate.providerProfileId.trim(),
        modelId: candidate.modelId.trim(),
      }
    }
    return cache
  } catch {
    return {}
  }
}

export function rememberCliSparkOverride(
  primaryProviderId: string,
  override: CliSparkOverride,
): void {
  if (typeof window === 'undefined') return
  try {
    const cache = readCliSparkOverrideCache()
    cache[primaryProviderId] = override
    window.localStorage.setItem(CLI_SPARK_OVERRIDE_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Local cache is best effort and must not block model selection.
  }
}
