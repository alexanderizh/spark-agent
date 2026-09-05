import type { ProviderProfile, SessionAgentAdapter } from '@spark/protocol'
import {
  isBuiltInLocalCliProvider,
  isAutoRouterProvider,
  isLocalClaudeCliProvider,
  isLocalCodexCliProvider,
} from '@spark/protocol'
import { sparkExecutorAvailability } from './sparkExecutorAvailability'

export function isClaudeAdapter(adapter: SessionAgentAdapter): boolean {
  return adapter === 'claude' || adapter === 'claude-sdk'
}

export function isSparkAdapter(adapter: SessionAgentAdapter): boolean {
  return adapter === 'spark'
}

export function isProviderCompatibleWithAdapter(
  provider: ProviderProfile,
  adapter: SessionAgentAdapter,
): boolean {
  if (isLocalCodexCliProvider(provider)) return adapter === 'codex'
  if (isBuiltInLocalCliProvider(provider)) return isClaudeAdapter(adapter)
  if (isSparkAdapter(adapter)) {
    // spark 引擎不接管本地 CLI 内置渠道与自动路由元渠道；远程对话渠道按协议可映射性判定
    if (isAutoRouterProvider(provider)) return false
    if (
      provider.modelType === 'image' ||
      provider.modelType === 'voice' ||
      provider.modelType === 'video'
    ) {
      return false
    }
    return sparkExecutorAvailability(
      provider.provider === 'anthropic' ? 'anthropic' : 'openai',
      provider.codexApiKind ?? null,
    ).available
  }
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

/**
 * Resolve an initial provider without leaving a fresh install stuck on the default adapter.
 * The requested adapter still wins; only when it has no provider do we cross to the other engine.
 */
export function getPreferredProviderWithAdapterFallback(
  providers: ProviderProfile[],
  preferredProviderId: string | undefined,
  adapter: SessionAgentAdapter,
): ProviderProfile | undefined {
  return (
    getPreferredProviderForAdapter(providers, preferredProviderId, adapter) ??
    getPreferredProviderForAdapter(
      providers,
      preferredProviderId,
      isClaudeAdapter(adapter) ? 'codex' : 'claude-sdk',
    )
  )
}
