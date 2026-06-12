import type { ProviderProfile, SessionAgentAdapter } from '@spark/protocol'
import {
  isBuiltInLocalCliProvider,
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

export function getPreferredProviderForAdapter(
  providers: ProviderProfile[],
  preferredProviderId: string | undefined,
  adapter: SessionAgentAdapter,
): ProviderProfile | undefined {
  const compatible = providers.filter((provider) =>
    isProviderCompatibleWithAdapter(provider, adapter),
  )
  return (
    compatible.find((provider) => provider.id === preferredProviderId) ??
    compatible.find((provider) => provider.isDefault) ??
    compatible.find((provider) =>
      adapter === 'codex'
        ? isLocalCodexCliProvider(provider)
        : isLocalClaudeCliProvider(provider),
    ) ??
    compatible[0]
  )
}
