import type { ProviderProfile, SessionAgentAdapter } from '@spark/protocol'
import {
  AUTO_ROUTER_PROVIDER_TYPE,
  isBuiltInLocalCliProvider,
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
  // AutoRouter 行按其声明的引擎（autoRouterConfig.adapter）判定会话兼容性：
  // claude 会话认 claude router，codex 会话认 codex router（防跨引擎无效组合）。
  if (provider.providerType === AUTO_ROUTER_PROVIDER_TYPE) {
    const routerAdapter = provider.autoRouterConfig?.adapter
    if (routerAdapter == null) return false
    return isClaudeAdapter(adapter) ? routerAdapter === 'claude' : routerAdapter === 'codex'
  }
  if (isSparkAdapter(adapter)) {
    // spark 引擎不接管本地 CLI 内置渠道与 AutoRouter 元渠道；远程对话渠道按协议可映射性判定
    if (provider.providerType === AUTO_ROUTER_PROVIDER_TYPE) return false
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
  // AutoRouter 行是按强度分流到多个执行器渠道的元渠道，自身没有可用协议推断引擎
  // （provider 字段为 'auto-router'，既不等于 'anthropic'）。若不显式分支，claude
  // router 会被判成 codex：会话侧"选中 provider 即校准引擎"的协调逻辑会把 claude
  // 会话的 agentAdapter 改成 codex，运行时随即判 adapterMismatch，claude 档位执行器
  // 全部失配（回退 codex 执行器或直接报没有可用执行模型）。
  if (provider.providerType === AUTO_ROUTER_PROVIDER_TYPE) {
    return provider.autoRouterConfig?.adapter === 'codex' ? 'codex' : 'claude-sdk'
  }
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
      provider.providerType !== AUTO_ROUTER_PROVIDER_TYPE &&
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
  const concreteCompatible = compatible.filter(
    (provider) => provider.providerType !== AUTO_ROUTER_PROVIDER_TYPE,
  )
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
