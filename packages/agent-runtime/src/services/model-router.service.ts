import {
  isBuiltInLocalCliProvider,
  isProviderAllowedForRouterAdapter,
  isRoutingModelConfig,
  normalizeRoutingCandidates,
  type RoutingAdapter,
  type RoutingComplexity,
  type RoutingModelConfig,
} from '@spark/protocol'

export interface ModelRouterProvider {
  id: string
  provider: string
  defaultModel?: string
  modelIds?: readonly string[]
  modelType?: 'image' | 'text' | 'multimodal' | 'voice' | 'video'
  mediaProvider?: string | null
  mediaCapabilities?: readonly string[]
}

export interface ModelRouterResolveInput {
  config: RoutingModelConfig
  providers: readonly ModelRouterProvider[]
  message: string
  estimatedTokens?: number
}

export interface ModelRouterModelProfile {
  id: string
  config_json: string
  enabled: number
  provider_id?: string
  name?: string
  created_at?: string
  updated_at?: string
}

export interface ModelRouterSelectionInput {
  selectedModelId: string | null | undefined
  modelProfiles: readonly ModelRouterModelProfile[]
  providers: readonly ModelRouterProvider[]
  message: string
  estimatedTokens?: number
}

export interface ModelRouterResolveResult {
  providerProfileId: string
  modelId: string
  adapter: RoutingAdapter
  matchedComplexity: RoutingComplexity
  fallbackUsed: boolean
  reasonCode: 'simple_task' | 'default_task' | 'complex_task' | 'long_context'
}

export interface ModelRouterSelectionResult extends ModelRouterResolveResult {
  routingModelProfileId: string
}

const LONG_CONTEXT_TOKEN_THRESHOLD = 128_000

const COMPLEX_PATTERNS = [
  /实现/,
  /开发/,
  /重构/,
  /架构/,
  /代码审查/,
  /review/i,
  /debug/i,
  /修复/,
  /多个文件/,
  /补测试/,
  /测试/,
  /多步/,
  /方案/,
]

const SIMPLE_PATTERNS = [
  /错别字/,
  /润色/,
  /翻译/,
  /解释/,
  /总结/,
  /普通问题/,
  /简单/,
]

export class ModelRouterService {
  resolveModelSelection(input: ModelRouterSelectionInput): ModelRouterSelectionResult | null {
    const selectedModelId = input.selectedModelId?.trim()
    if (!selectedModelId) return null
    const profile = input.modelProfiles.find((item) => item.id === selectedModelId && item.enabled === 1)
    if (profile == null) return null
    const config = parseRoutingModelConfig(profile.config_json)
    if (config == null) return null
    return {
      routingModelProfileId: profile.id,
      ...this.resolve({
        config,
        providers: input.providers,
        message: input.message,
        ...(input.estimatedTokens !== undefined ? { estimatedTokens: input.estimatedTokens } : {}),
      }),
    }
  }

  resolve(input: ModelRouterResolveInput): ModelRouterResolveResult {
    const classified = classifyTurn(input.message, input.estimatedTokens)
    const configuredCandidates = normalizeRoutingCandidates(input.config.candidates)
    const candidates = hasAnyRoutingCandidate(configuredCandidates)
      ? configuredCandidates
      : buildDefaultRoutingCandidates(input.config.adapter, input.providers)
    const selected =
      this.resolveCandidate(input.config.adapter, classified.complexity, candidates, input.providers) ??
      this.resolveAnyCandidate(input.config.adapter, candidates, input.providers)

    if (selected == null) {
      throw new Error(`No valid ${input.config.adapter} routing candidate configured`)
    }

    return {
      providerProfileId: selected.providerProfileId,
      modelId: selected.modelId,
      adapter: input.config.adapter,
      matchedComplexity: classified.complexity,
      fallbackUsed: selected.slot !== classified.complexity,
      reasonCode: classified.reasonCode,
    }
  }

  private resolveCandidate(
    adapter: RoutingAdapter,
    slot: RoutingComplexity,
    candidates: ReturnType<typeof normalizeRoutingCandidates>,
    providers: readonly ModelRouterProvider[],
  ): (ModelRouterCandidate & { slot: RoutingComplexity }) | null {
    const preferred = candidates[slot] ?? []
    for (const candidate of preferred) {
      if (isValidCandidate(adapter, candidate, providers)) {
        return { ...candidate, slot }
      }
    }
    const fallback = candidates.default ?? []
    for (const candidate of fallback) {
      if (isValidCandidate(adapter, candidate, providers)) {
        return { ...candidate, slot: 'default' }
      }
    }
    return null
  }

  private resolveAnyCandidate(
    adapter: RoutingAdapter,
    candidates: ReturnType<typeof normalizeRoutingCandidates>,
    providers: readonly ModelRouterProvider[],
  ): (ModelRouterCandidate & { slot: RoutingComplexity }) | null {
    for (const slot of ['simple', 'complex', 'longContext'] satisfies RoutingComplexity[]) {
      for (const candidate of candidates[slot] ?? []) {
        if (isValidCandidate(adapter, candidate, providers)) {
          return { ...candidate, slot }
        }
      }
    }
    return null
  }
}

function hasAnyRoutingCandidate(candidates: ReturnType<typeof normalizeRoutingCandidates>): boolean {
  return Object.values(candidates).some((items) => (items ?? []).length > 0)
}

function buildDefaultRoutingCandidates(
  adapter: RoutingAdapter,
  providers: readonly ModelRouterProvider[],
): ReturnType<typeof normalizeRoutingCandidates> {
  const candidates = providers
    .filter(
      (provider) =>
        !isBuiltInLocalCliProvider(provider) &&
        isProviderAllowedForRouterAdapter(adapter, provider),
    )
    .flatMap((provider) =>
      providerModelIds(provider).map((modelId) => ({
        providerProfileId: provider.id,
        modelId,
      })),
    )
  return candidates.length > 0 ? { default: candidates } : {}
}

function providerModelIds(provider: ModelRouterProvider): string[] {
  const ids = provider.modelIds != null && provider.modelIds.length > 0
    ? provider.modelIds
    : [provider.defaultModel ?? '']
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))]
}

function parseRoutingModelConfig(configJson: string): RoutingModelConfig | null {
  try {
    const parsed = JSON.parse(configJson) as unknown
    return isRoutingModelConfig(parsed) ? parsed : null
  } catch {
    return null
  }
}

type ModelRouterCandidate = {
  providerProfileId: string
  modelId: string
}

function classifyTurn(
  message: string,
  estimatedTokens?: number,
): { complexity: RoutingComplexity; reasonCode: ModelRouterResolveResult['reasonCode'] } {
  if ((estimatedTokens ?? 0) >= LONG_CONTEXT_TOKEN_THRESHOLD) {
    return { complexity: 'longContext', reasonCode: 'long_context' }
  }
  if (COMPLEX_PATTERNS.some((pattern) => pattern.test(message))) {
    return { complexity: 'complex', reasonCode: 'complex_task' }
  }
  if (message.trim().length <= 80 || SIMPLE_PATTERNS.some((pattern) => pattern.test(message))) {
    return { complexity: 'simple', reasonCode: 'simple_task' }
  }
  return { complexity: 'default', reasonCode: 'default_task' }
}

function isValidCandidate(
  adapter: RoutingAdapter,
  candidate: ModelRouterCandidate,
  providers: readonly ModelRouterProvider[],
): boolean {
  const provider = providers.find((item) => item.id === candidate.providerProfileId)
  if (provider == null) return false
  if (!isProviderAllowedForRouterAdapter(adapter, provider)) return false
  const models = new Set([provider.defaultModel, ...(provider.modelIds ?? [])].filter(Boolean))
  return models.size === 0 || models.has(candidate.modelId)
}
