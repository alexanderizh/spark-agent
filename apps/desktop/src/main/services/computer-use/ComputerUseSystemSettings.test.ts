import { describe, expect, it, vi } from 'vitest'
import {
  computerUseSystemSettingsUrl,
  openComputerUseSystemSettings,
} from './ComputerUseSystemSettings.js'

describe('ComputerUseSystemSettings', () => {
  it('opens only the fixed macOS privacy pane for each permission', async () => {
    const openExternal = vi.fn(async () => undefined)

    await expect(openComputerUseSystemSettings('screen', 'darwin', openExternal)).resolves.toEqual({
      opened: true,
    })
    await expect(
      openComputerUseSystemSettings('accessibility', 'darwin', openExternal),
    ).resolves.toEqual({ opened: true })
    expect(openExternal.mock.calls).toEqual([
      ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'],
      ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'],
    ])
  })

  it('returns a safe unsupported result on platforms without a dedicated pane', async () => {
    const openExternal = vi.fn(async () => undefined)

    expect(computerUseSystemSettingsUrl('screen', 'linux')).toBeNull()
    await expect(openComputerUseSystemSettings('screen', 'linux', openExternal)).resolves.toEqual({
      opened: false,
    })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('does not throw when the operating-system deep link cannot be opened', async () => {
    await expect(
      openComputerUseSystemSettings(
        'screen',
        'darwin',
        vi.fn(async () => {
          throw new Error('unavailable')
        }),
      ),
    ).resolves.toEqual({ opened: false })
  })
})
