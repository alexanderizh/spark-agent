import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  systemPreferences: {
    getMediaAccessStatus: vi.fn(),
    askForMediaAccess: vi.fn(),
  },
}))

import { requestVoiceMicrophonePermission } from '../VoiceCapturePermissionService.js'

type Preferences = NonNullable<Parameters<typeof requestVoiceMicrophonePermission>[1]>

const getMediaAccessStatus = vi.fn()
const askForMediaAccess = vi.fn()
const preferences = { getMediaAccessStatus, askForMediaAccess } as unknown as Preferences

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requestVoiceMicrophonePermission', () => {
  it('requests the native macOS permission on first use', async () => {
    getMediaAccessStatus.mockReturnValueOnce('not-determined').mockReturnValueOnce('granted')
    askForMediaAccess.mockResolvedValue(true)

    await expect(requestVoiceMicrophonePermission('darwin', preferences)).resolves.toEqual({
      granted: true,
      status: 'granted',
      message: null,
    })
    expect(askForMediaAccess).toHaveBeenCalledWith('microphone')
  })

  it('returns system settings guidance when macOS permission was denied', async () => {
    getMediaAccessStatus.mockReturnValue('denied')

    const result = await requestVoiceMicrophonePermission('darwin', preferences)

    expect(result.granted).toBe(false)
    expect(result.status).toBe('denied')
    expect(result.message).toContain('系统设置 → 隐私与安全性 → 麦克风')
    expect(askForMediaAccess).not.toHaveBeenCalled()
  })

  it('defers permission handling to Chromium on Linux', async () => {
    await expect(requestVoiceMicrophonePermission('linux', preferences)).resolves.toEqual({
      granted: true,
      status: 'unknown',
      message: null,
    })
    expect(getMediaAccessStatus).not.toHaveBeenCalled()
  })
})
