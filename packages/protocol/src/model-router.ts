export type RoutingAdapter = 'claude' | 'codex'

export type RoutingComplexity = 'simple' | 'default' | 'complex' | 'longContext'

export interface RoutingCandidateRef {
  providerProfileId: string
  modelId: string
}

export type RoutingCandidateSlot = RoutingCandidateRef | RoutingCandidateRef[]
export type RoutingCandidates = Partial<Record<RoutingComplexity, RoutingCandidateSlot>>
export type NormalizedRoutingCandidates = Partial<Record<RoutingComplexity, RoutingCandidateRef[]>>

export interface RoutingModelConfig {
  kind: 'router'
  adapter: RoutingAdapter
  candidates: RoutingCandidates
  allowCrossProvider?: boolean
}

type ProviderForRouting = {
  id: string
  provider: string
  modelType?: 'image' | 'text' | 'multimodal' | 'voice' | 'video'
  mediaProvider?: string | null
  mediaCapabilities?: readonly string[]
}

const ROUTING_COMPLEXITIES: RoutingComplexity[] = ['simple', 'default', 'complex', 'longContext']
const CODEX_TEXT_PROVIDER_TYPES = new Set(['openai', 'openai-compatible', 'deepseek', 'ollama'])
const NON_TEXT_MODEL_TYPES = new Set(['image', 'voice', 'video'])

export function isRoutingModelConfig(value: unknown): value is RoutingModelConfig {
  if (value == null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.kind !== 'router') return false
  if (record.adapter !== 'claude' && record.adapter !== 'codex') return false
  return record.candidates != null && typeof record.candidates === 'object'
}

export function normalizeRoutingCandidates(value: unknown): NormalizedRoutingCandidates {
  if (value == null || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const normalized: NormalizedRoutingCandidates = {}
  for (const key of ROUTING_COMPLEXITIES) {
    const candidates = normalizeCandidateList(record[key])
    if (candidates.length > 0) normalized[key] = candidates
  }
  return normalized
}

function normalizeCandidateList(value: unknown): RoutingCandidateRef[] {
  const rawCandidates = Array.isArray(value) ? value : value == null ? [] : [value]
  const normalized: RoutingCandidateRef[] = []
  const seen = new Set<string>()
  for (const candidate of rawCandidates) {
    if (candidate == null || typeof candidate !== 'object') continue
    const candidateRecord = candidate as Record<string, unknown>
    const providerProfileId = stringOrEmpty(candidateRecord.providerProfileId)
    const modelId = stringOrEmpty(candidateRecord.modelId)
    if (!providerProfileId || !modelId) continue
    const key = `${providerProfileId}\u0000${modelId}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({ providerProfileId, modelId })
  }
  return normalized
}

export function isProviderAllowedForRouterAdapter(
  adapter: RoutingAdapter,
  provider: ProviderForRouting,
): boolean {
  if (isMediaOrMultimodalProvider(provider)) return false
  if (adapter === 'claude') return provider.provider === 'anthropic'
  return CODEX_TEXT_PROVIDER_TYPES.has(provider.provider)
}

function isMediaOrMultimodalProvider(provider: ProviderForRouting): boolean {
  if (provider.modelType != null && NON_TEXT_MODEL_TYPES.has(provider.modelType)) return true
  if (provider.mediaProvider != null) return true
  return (provider.mediaCapabilities ?? []).length > 0
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
