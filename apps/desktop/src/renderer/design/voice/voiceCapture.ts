export type VoiceCaptureErrorCode =
  | 'unsupported'
  | 'device-enumeration-failed'
  | 'no-device'
  | 'permission-denied'
  | 'device-unavailable'
  | 'capture-aborted'
  | 'constraints-unavailable'
  | 'unknown'

export class VoiceCaptureError extends Error {
  readonly code: VoiceCaptureErrorCode

  constructor(code: VoiceCaptureErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VoiceCaptureError'
    this.code = code
  }
}

const PREFERRED_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
  channelCount: { ideal: 1 },
}

function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return ''
}

function toVoiceCaptureError(error: unknown): VoiceCaptureError {
  if (error instanceof VoiceCaptureError) return error
  const name = errorName(error)
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new VoiceCaptureError(
      'no-device',
      '未检测到可用的麦克风，请连接或启用语音采集设备后重试。',
      { cause: error },
    )
  }
  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError'
  ) {
    return new VoiceCaptureError(
      'permission-denied',
      '麦克风访问被拒绝，请在系统隐私设置中允许 SparkWork 使用麦克风后重试。',
      { cause: error },
    )
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return new VoiceCaptureError(
      'device-unavailable',
      '无法读取麦克风。设备可能已断开或被其他应用独占，请检查后重试。',
      { cause: error },
    )
  }
  if (name === 'AbortError') {
    return new VoiceCaptureError(
      'capture-aborted',
      '麦克风启动被系统中止。请确认设备已连接且未被其他应用占用后重试。',
      { cause: error },
    )
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return new VoiceCaptureError(
      'constraints-unavailable',
      '麦克风不支持所需的采集配置，请切换其他输入设备后重试。',
      { cause: error },
    )
  }
  return new VoiceCaptureError('unknown', '无法启动麦克风，请检查设备和系统权限后重试。', {
    cause: error,
  })
}

/** 防止 Web Audio / MediaDevices 的 DOMException 原始英文直接出现在产品界面。 */
export function voiceCaptureErrorMessage(error: unknown): string {
  return toVoiceCaptureError(error).message
}

function getMediaDevices(): MediaDevices {
  const mediaDevices = navigator.mediaDevices
  if (
    !mediaDevices ||
    typeof mediaDevices.enumerateDevices !== 'function' ||
    typeof mediaDevices.getUserMedia !== 'function'
  ) {
    throw new VoiceCaptureError('unsupported', '当前环境不支持麦克风采集。')
  }
  return mediaDevices
}

/** 点击语音按钮时先枚举一次，避免在没有输入设备时启动识别引擎。 */
export async function detectAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  const mediaDevices = getMediaDevices()
  let devices: MediaDeviceInfo[]
  try {
    devices = await mediaDevices.enumerateDevices()
  } catch (error) {
    throw new VoiceCaptureError(
      'device-enumeration-failed',
      '无法检测语音采集设备，请检查系统权限后重试。',
      { cause: error },
    )
  }
  const inputs = devices.filter((device) => device.kind === 'audioinput')
  if (inputs.length === 0) {
    throw new VoiceCaptureError(
      'no-device',
      '未检测到可用的麦克风，请连接或启用语音采集设备后重试。',
    )
  }
  return inputs
}

function hasLiveAudioTrack(stream: MediaStream): boolean {
  return stream.getAudioTracks().some((track) => track.readyState !== 'ended')
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

function deviceConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: {
      ...PREFERRED_AUDIO_CONSTRAINTS,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  }
}

/**
 * 获取真实可读的音频流。先使用系统默认设备；若底层驱动以 AbortError/NotReadableError
 * 拒绝默认设备，再逐个尝试枚举到的其他输入设备（常见于蓝牙设备切换过程中）。
 */
export async function acquireVoiceMediaStream(
  devices: MediaDeviceInfo[],
): Promise<MediaStream> {
  const mediaDevices = getMediaDevices()
  const alternateDeviceIds = Array.from(
    new Set(
      devices
        .map((device) => device.deviceId)
        .filter((deviceId) => deviceId.length > 0 && deviceId !== 'default'),
    ),
  )
  const candidates: Array<string | undefined> = [undefined, ...alternateDeviceIds]
  let lastError: unknown = null

  for (const deviceId of candidates) {
    try {
      const stream = await mediaDevices.getUserMedia(deviceConstraints(deviceId))
      if (hasLiveAudioTrack(stream)) return stream
      stopStream(stream)
      lastError = new VoiceCaptureError(
        'device-unavailable',
        '麦克风没有提供可用的音频轨道，请切换输入设备后重试。',
      )
    } catch (error) {
      lastError = error
      const name = errorName(error)
      // 权限拒绝无法通过切换设备恢复，不重复触发系统请求。
      if (
        name === 'NotAllowedError' ||
        name === 'PermissionDeniedError' ||
        name === 'SecurityError'
      ) {
        break
      }
    }
  }

  throw toVoiceCaptureError(lastError)
}
