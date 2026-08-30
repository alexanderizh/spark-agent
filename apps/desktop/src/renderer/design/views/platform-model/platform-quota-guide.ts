import type { AgentEvent, ProviderProfile } from '@spark/protocol'

export type PlatformQuotaGuideReason = 'quota-exhausted' | 'low-balance' | 'onboarding'

export const PLATFORM_QUOTA_GUIDE_EVENT = 'spark:platform-quota-guide'

export function showPlatformQuotaGuide(reason: PlatformQuotaGuideReason): void {
  window.dispatchEvent(new CustomEvent(PLATFORM_QUOTA_GUIDE_EVENT, { detail: { reason } }))
}

export function isManagedPlatformQuotaError(
  event: AgentEvent,
  providerProfileId: string | null | undefined,
  providers: ProviderProfile[],
): boolean {
  if (event.type !== 'agent_error' || !providerProfileId) return false
  const provider = providers.find((item) => item.id === providerProfileId)
  if (provider?.managed !== true) return false
  if (event.code === 'CLAUDE_BILLING_ERROR') return true
  const text = [event.code, event.title, event.message, event.actionHint, event.rawError]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
  return /(?:insufficient[_ -]?quota|quota exhausted|balance insufficient|余额不足|额度不足|status.?402|http.?402)/i.test(
    text,
  )
}
