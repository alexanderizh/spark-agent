import type { SdkIntegrityItem } from '@spark/protocol'

/** Whether the integrity page has an actionable SDK/runtime install operation. */
export function needsSdkInstallAction(sdk: SdkIntegrityItem): boolean {
  const runtimeNeedsInstall =
    sdk.runtime != null &&
    (sdk.runtime.installed !== true || sdk.runtime.updateAvailable === true)

  return !sdk.installed || sdk.updateAvailable || runtimeNeedsInstall
}
