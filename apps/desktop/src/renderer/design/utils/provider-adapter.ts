import type { ProviderProfile, SessionAgentAdapter } from '@spark/protocol'
import {
  isBuiltInLocalCliProvider,
  isAutoRouterProvider,
  isLocalClaudeCliProvider,
  isLocalCodexCliProvider,
} from '@spark/protocol'

export function isClaudeAdapter(adapter: SessionAgentAdapter): boolean {
  return adapter === 'claude' || adapter === 'claude-sdk'
}

export function isProviderCompatibleWithAdapter(
  provider: ProviderProfile,
  adapter: SessionAgentAdapter,
): boolean {
  if (isLocalCodexCliProvider(provider)) return adapter === 'codex'
  if (isBuiltInLocalCliProvider(provider)) return isClaudeAdapter(adapter)
  return isClaudeAdapter(adapter)
    ? provider.provider === 'anthropic'
    : provider.provider !== 'anthropic'
}

export function getProviderAdapterKind(provider: ProviderProfile): SessionAgentAdapter {
  if (isLocalCodexCliProvider(provider)) return 'codex'
  return provider.provider === 'anthropic' ? 'claude-sdk' : 'codex'
}

export function getCliSparkOverrideProviders(
  providers: ProviderProfile[],
  cliProvider: ProviderProfile | null | undefined,
): ProviderProfile[] {
  if (cliProvider == null || !isBuiltInLocalCliProvider(cliProvider)) return []
  const adapter = getProviderAdapterKind(cliProvider)
  return providers.filter(
    (provider) =>
      !isBuiltInLocalCliProvider(provider) &&
      !isAutoRouterProvider(provider) &&
      isProviderCompatibleWithAdapter(provider, adapter) &&
      (provider.modelIds.length > 0 || provider.defaultModel.trim().length > 0),
  )
}

export function isCliSparkConversationProvider(provider: ProviderProfile): boolean {
  return (
    provider.modelType !== 'image' &&
    provider.modelType !== 'voice' &&
    provider.modelType !== 'video'
  )
}

export function getPreferredProviderForAdapter(
  providers: ProviderProfile[],
  preferredProviderId: string | undefined,
  adapter: SessionAgentAdapter,
): ProviderProfile | undefined {
  const compatible = providers.filter((provider) =>
    isProviderCompatibleWithAdapter(provider, adapter),
  )
  const concreteCompatible = compatible.filter((provider) => !isAutoRouterProvider(provider))
  return (
    concreteCompatible.find((provider) => provider.id === preferredProviderId) ??
    concreteCompatible.find((provider) => provider.isDefault) ??
    concreteCompatible.find((provider) =>
      adapter === 'codex' ? isLocalCodexCliProvider(provider) : isLocalClaudeCliProvider(provider),
    ) ??
    concreteCompatible[0] ??
    compatible.find((provider) => provider.id === preferredProviderId) ??
    compatible[0]
  )
}
