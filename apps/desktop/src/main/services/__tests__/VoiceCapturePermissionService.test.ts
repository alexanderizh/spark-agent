import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
  },
  systemPreferences: {
    getMediaAccessStatus: vi.fn(),
    askForMediaAccess: vi.fn(),
  },
}))

import { requestVoiceMicrophonePermission } from '../VoiceCapturePermissionService.js'

type Preferences = NonNullable<Parameters<typeof requestVoiceMicrophonePermission>[1]>

const getMediaAccessStatus = vi.fn()
const askForMediaAccess = vi.fn()
const openExternal = vi.fn()
const preferences = { getMediaAccessStatus, askForMediaAccess } as unknown as Preferences

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requestVoiceMicrophonePermission', () => {
  it('requests the native macOS permission on first use', async () => {
    getMediaAccessStatus.mockReturnValueOnce('not-determined').mockReturnValueOnce('granted')
    askForMediaAccess.mockResolvedValue(true)

    await expect(
      requestVoiceMicrophonePermission('darwin', preferences, openExternal),
    ).resolves.toEqual({
      granted: true,
      status: 'granted',
      message: null,
    })
    expect(askForMediaAccess).toHaveBeenCalledWith('microphone')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens system settings when macOS permission was denied', async () => {
    getMediaAccessStatus.mockReturnValue('denied')
    openExternal.mockResolvedValue(undefined)

    const result = await requestVoiceMicrophonePermission('darwin', preferences, openExternal)

    expect(result.granted).toBe(false)
    expect(result.status).toBe('denied')
    expect(result.message).toContain('系统设置 → 隐私与安全性 → 麦克风')
    expect(result.message).toContain('已为你打开')
    expect(askForMediaAccess).not.toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    )
  })

  it('opens system settings after the native macOS prompt is declined', async () => {
    getMediaAccessStatus.mockReturnValue('not-determined')
    askForMediaAccess.mockResolvedValue(false)
    openExternal.mockResolvedValue(undefined)

    const result = await requestVoiceMicrophonePermission('darwin', preferences, openExternal)

    expect(result).toMatchObject({ granted: false, status: 'denied' })
    expect(askForMediaAccess).toHaveBeenCalledWith('microphone')
    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  it('defers permission handling to Chromium on Linux', async () => {
    await expect(
      requestVoiceMicrophonePermission('linux', preferences, openExternal),
    ).resolves.toEqual({
      granted: true,
      status: 'unknown',
      message: null,
    })
    expect(getMediaAccessStatus).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })
})
