import { shell } from 'electron'

export type ComputerUseSystemPermission = 'screen' | 'accessibility'

type OpenExternal = typeof shell.openExternal

/** Returns only fixed operating-system deep links; no caller-controlled URL is accepted. */
export function computerUseSystemSettingsUrl(
  permission: ComputerUseSystemPermission,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== 'darwin') return null
  const pane = permission === 'screen' ? 'Privacy_ScreenCapture' : 'Privacy_Accessibility'
  return `x-apple.systempreferences:com.apple.preference.security?${pane}`
}

export async function openComputerUseSystemSettings(
  permission: ComputerUseSystemPermission,
  platform: NodeJS.Platform = process.platform,
  openExternal: OpenExternal = shell.openExternal,
): Promise<{ opened: boolean }> {
  const url = computerUseSystemSettingsUrl(permission, platform)
  if (url == null) return { opened: false }
  try {
    await openExternal(url)
    return { opened: true }
  } catch {
    return { opened: false }
  }
}
