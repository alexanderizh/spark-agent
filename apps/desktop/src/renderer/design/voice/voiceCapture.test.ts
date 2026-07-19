// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireVoiceMediaStream,
  detectAudioInputDevices,
  VoiceCaptureError,
} from './voiceCapture'

const enumerateDevices = vi.fn()
const getUserMedia = vi.fn()

function input(deviceId: string): MediaDeviceInfo {
  return {
    kind: 'audioinput',
    deviceId,
    groupId: `${deviceId}-group`,
    label: deviceId,
    toJSON: () => ({}),
  } as MediaDeviceInfo
}

function stream(id: string): MediaStream {
  const track = {
    id,
    readyState: 'live',
    stop: vi.fn(),
  } as unknown as MediaStreamTrack
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices, getUserMedia },
  })
})

describe('voice capture device preparation', () => {
  it('rejects before getUserMedia when no audio input device is present', async () => {
    enumerateDevices.mockResolvedValue([])

    await expect(detectAudioInputDevices()).rejects.toMatchObject({
      code: 'no-device',
    } satisfies Partial<VoiceCaptureError>)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('falls back to another input device when the default device aborts', async () => {
    const fallbackStream = stream('usb-mic')
    getUserMedia
      .mockRejectedValueOnce(new DOMException('The user aborted a request.', 'AbortError'))
      .mockResolvedValueOnce(fallbackStream)

    await expect(
      acquireVoiceMediaStream([input('default'), input('usb-mic')]),
    ).resolves.toBe(fallbackStream)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia.mock.calls[1]?.[0]).toMatchObject({
      audio: { deviceId: { exact: 'usb-mic' } },
    })
  })

  it('converts AbortError into an actionable Chinese message', async () => {
    getUserMedia.mockRejectedValue(
      new DOMException('The user aborted a request.', 'AbortError'),
    )

    await expect(acquireVoiceMediaStream([input('default')])).rejects.toMatchObject({
      code: 'capture-aborted',
      message: '麦克风启动被系统中止。请确认设备已连接且未被其他应用占用后重试。',
    })
  })

  it('does not retry other devices after permission is denied', async () => {
    getUserMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))

    await expect(
      acquireVoiceMediaStream([input('default'), input('usb-mic')]),
    ).rejects.toMatchObject({ code: 'permission-denied' })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
})
