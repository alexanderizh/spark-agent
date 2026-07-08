import type { ProviderProfile } from './ipc/index.js'
import type { RoutingAdapter } from './model-router.js'

export const CLAUDE_AUTO_ROUTER_PROVIDER_ID = 'claude-auto-router'
export const CODEX_AUTO_ROUTER_PROVIDER_ID = 'codex-auto-router'

export const CLAUDE_AUTO_ROUTER_PROVIDER_NAME = 'Claude Auto Router'
export const CODEX_AUTO_ROUTER_PROVIDER_NAME = 'Codex Auto Router'

export function isClaudeAutoRouterProvider(
  profile: Pick<ProviderProfile, 'id'> | { id: string } | string | null | undefined,
): boolean {
  const id = typeof profile === 'string' ? profile : profile?.id
  return id === CLAUDE_AUTO_ROUTER_PROVIDER_ID
}

export function isCodexAutoRouterProvider(
  profile: Pick<ProviderProfile, 'id'> | { id: string } | string | null | undefined,
): boolean {
  const id = typeof profile === 'string' ? profile : profile?.id
  return id === CODEX_AUTO_ROUTER_PROVIDER_ID
}

export function isAutoRouterProvider(
  profile: Pick<ProviderProfile, 'id'> | { id: string } | string | null | undefined,
): boolean {
  return isClaudeAutoRouterProvider(profile) || isCodexAutoRouterProvider(profile)
}

export function getAutoRouterAdapterForProviderId(providerId: string): RoutingAdapter | null {
  if (providerId === CLAUDE_AUTO_ROUTER_PROVIDER_ID) return 'claude'
  if (providerId === CODEX_AUTO_ROUTER_PROVIDER_ID) return 'codex'
  return null
}

