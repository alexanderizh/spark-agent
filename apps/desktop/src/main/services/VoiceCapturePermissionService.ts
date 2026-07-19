import { systemPreferences } from 'electron'
import type {
  VoiceMicrophonePermissionResponse,
  VoiceMicrophonePermissionStatus,
} from '@spark/protocol'

type MediaAccessPreferences = Pick<
  typeof systemPreferences,
  'getMediaAccessStatus' | 'askForMediaAccess'
>

function deniedMessage(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return '未获得麦克风权限。请前往“系统设置 → 隐私与安全性 → 麦克风”，允许 SparkWork（开发模式下显示为 Electron），然后重启应用。'
  }
  if (platform === 'win32') {
    return '系统已禁止麦克风访问。请前往“设置 → 隐私和安全性 → 麦克风”允许桌面应用访问麦克风。'
  }
  return '系统已禁止麦克风访问，请在系统隐私设置中允许 SparkWork 使用麦克风。'
}

function restrictedMessage(): string {
  return '麦克风访问受到系统策略限制，请联系设备管理员或检查家长控制设置。'
}

/**
 * 在渲染进程调用 getUserMedia 前检查操作系统级麦克风权限。
 * macOS 首次使用时由主进程触发原生授权弹窗；Linux 交由 Chromium 完成权限判断。
 */
export async function requestVoiceMicrophonePermission(
  platform: NodeJS.Platform = process.platform,
  preferences: MediaAccessPreferences = systemPreferences,
): Promise<VoiceMicrophonePermissionResponse> {
  if (platform !== 'darwin' && platform !== 'win32') {
    return { granted: true, status: 'unknown', message: null }
  }

  try {
    let status = preferences.getMediaAccessStatus('microphone') as VoiceMicrophonePermissionStatus

    if (platform === 'darwin' && status === 'not-determined') {
      const granted = await preferences.askForMediaAccess('microphone')
      status = preferences.getMediaAccessStatus('microphone') as VoiceMicrophonePermissionStatus
      if (granted) return { granted: true, status: 'granted', message: null }
    }

    if (status === 'granted') return { granted: true, status, message: null }
    if (status === 'denied') {
      return { granted: false, status, message: deniedMessage(platform) }
    }
    if (status === 'restricted') {
      return { granted: false, status, message: restrictedMessage() }
    }

    // Windows 的 not-determined 与部分平台的 unknown 继续交给 Chromium/getUserMedia。
    return { granted: true, status, message: null }
  } catch {
    return {
      granted: false,
      status: 'unknown',
      message: '无法请求系统麦克风权限，请检查应用安装信息或系统隐私设置后重试。',
    }
  }
}
