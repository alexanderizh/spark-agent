import type { OptionalCapabilitySnapshot } from '@spark/protocol'

export const OPTIONAL_CAPABILITY_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000

export interface OptionalCapabilityPromptPreference {
  manifestUpdatedAt: string | null
  dismissedAt: number
  disabled?: boolean
}

export function shouldShowCapabilityPrompt(
  snapshot: OptionalCapabilitySnapshot,
  preference: OptionalCapabilityPromptPreference | null,
  now = Date.now(),
): boolean {
  if (!snapshot.remoteAvailable || !snapshot.manifestUpdatedAt || preference?.disabled) return false
  const hasInstallableMissingCapability = snapshot.capabilities.some(
    (capability) =>
      (capability.state === 'missing' || capability.state === 'damaged') &&
      capability.targetVersion != null &&
      capability.downloadSize > 0,
  )
  if (!hasInstallableMissingCapability) return false
  if (preference?.manifestUpdatedAt !== snapshot.manifestUpdatedAt) return true
  return now - preference.dismissedAt >= OPTIONAL_CAPABILITY_PROMPT_COOLDOWN_MS
}
