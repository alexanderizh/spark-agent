import { isBuiltInLocalCliProvider } from '@spark/protocol'
import type { ProviderProfileRow } from '@spark/storage'

export interface ComputerDecisionModelConfig {
  providerProfileId: string
  providerType: string
  apiKind?: 'chat' | 'responses'
  apiKey: string
  apiEndpoint?: string
  model: string
  maxTokens?: number
  /** Ordered runtime fallbacks. Kept in-memory only; credentials are never persisted in tasks. */
  fallbackModels?: ComputerDecisionModelConfig[]
}

export function buildComputerDecisionModelConfig(input: {
  provider: ProviderProfileRow
  model: string
  apiKey: string
}): ComputerDecisionModelConfig {
  if (input.provider.enabled !== 1) throw new Error('Computer decision provider is disabled')
  if (isBuiltInLocalCliProvider(input.provider)) {
    throw new Error('Local CLI providers cannot run the governed vision decision loop')
  }
  const model = input.model.trim()
  if (model.length === 0) throw new Error('Computer decision model is not configured')
  const apiKey = input.apiKey.trim()
  if (apiKey.length === 0) throw new Error('Computer decision provider API key is unavailable')

  const config = parseProviderConfig(input.provider.config_json)
  return {
    providerProfileId: input.provider.id,
    providerType: input.provider.provider_type,
    ...(config.codexApiKind === 'chat' || config.codexApiKind === 'responses'
      ? { apiKind: config.codexApiKind }
      : {}),
    apiKey,
    ...(typeof config.apiEndpoint === 'string' && config.apiEndpoint.trim().length > 0
      ? { apiEndpoint: config.apiEndpoint.trim() }
      : {}),
    model,
    ...(Number.isSafeInteger(config.maxTokens) && (config.maxTokens as number) > 0
      ? { maxTokens: config.maxTokens as number }
      : {}),
  }
}

function parseProviderConfig(value: string): {
  apiEndpoint?: unknown
  codexApiKind?: unknown
  maxTokens?: unknown
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error('Computer decision provider configuration is invalid')
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Computer decision provider configuration is invalid')
  }
  return parsed as Record<string, unknown>
}
