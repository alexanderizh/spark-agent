import type { SettingsRepository } from '@spark/storage'

export interface SessionWorkflowFeatureFlags {
  writeEnabled: boolean
  /** Requested by trusted settings; exposed separately for rollback diagnostics. */
  runtimeRequested: boolean
  runtimeEnabled: boolean
}

const CATEGORY = 'sessionWorkflowBinding'

export function readSessionWorkflowFeatureFlags(
  settings: Pick<SettingsRepository, 'get'>,
): SessionWorkflowFeatureFlags {
  const runtimeRequested = settings.get(CATEGORY, 'runtimeEnabled') === true
  return {
    writeEnabled: settings.get(CATEGORY, 'writeEnabled') === true,
    runtimeRequested,
    runtimeEnabled: runtimeRequested,
  }
}
