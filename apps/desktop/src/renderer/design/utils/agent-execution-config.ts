import type { ProviderProfile, SessionAgentAdapter } from '@spark/protocol'
import { isBuiltInLocalCliProvider } from '@spark/protocol'
import { getProviderAdapterKind } from './provider-adapter'

export function getLockedAgentAdapterForProvider(
  provider: ProviderProfile | null | undefined,
): SessionAgentAdapter | null {
  return provider ? getProviderAdapterKind(provider) : null
}

export function shouldAllowAgentModelOverride(
  provider: ProviderProfile | null | undefined,
): boolean {
  return provider != null && !isBuiltInLocalCliProvider(provider)
}

export function getProviderModelOptions(provider: ProviderProfile | null | undefined): string[] {
  if (provider == null) return []
  const models = provider.modelIds.length > 0 ? provider.modelIds : [provider.defaultModel]
  return Array.from(new Set(models.filter((model) => model.trim().length > 0)))
}

export function getDefaultAgentModelForProvider(
  provider: ProviderProfile | null | undefined,
): string {
  if (provider == null || !shouldAllowAgentModelOverride(provider)) return ''
  return provider.defaultModel || provider.modelIds[0] || ''
}

export function normalizeAgentModelForProvider(
  provider: ProviderProfile | null | undefined,
  modelId: string,
): string {
  if (provider == null) return modelId
  if (!shouldAllowAgentModelOverride(provider)) return ''
  if (!modelId) return ''
  return modelId
}
