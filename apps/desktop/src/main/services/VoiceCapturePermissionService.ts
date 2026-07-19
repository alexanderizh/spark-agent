import { shell, systemPreferences } from 'electron'
import type {
  VoiceMicrophonePermissionResponse,
  VoiceMicrophonePermissionStatus,
} from '@spark/protocol'

type MediaAccessPreferences = Pick<
  typeof systemPreferences,
  'getMediaAccessStatus' | 'askForMediaAccess'
>
type OpenExternal = typeof shell.openExternal

function microphoneSettingsUrl(platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') {
    return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
  }
  if (platform === 'win32') return 'ms-settings:privacy-microphone'
  return null
}

function deniedMessage(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return '未获得麦克风权限。请前往“系统设置 → 隐私与安全性 → 麦克风”，允许 SparkWork（开发模式下显示为 Electron），然后重启应用。'
  }
  if (platform === 'win32') {
    return '系统已禁止麦克风访问。请前往“设置 → 隐私和安全性 → 麦克风”允许桌面应用访问麦克风。'
  }
  return '系统已禁止麦克风访问，请在系统隐私设置中允许 SparkWork 使用麦克风。'
}

function openedSettingsMessage(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return '未获得麦克风权限。已为你打开“系统设置 → 隐私与安全性 → 麦克风”，请允许 SparkWork（开发模式下显示为 Electron），然后重启应用。'
  }
  if (platform === 'win32') {
    return '系统已禁止麦克风访问。已为你打开麦克风隐私设置，请允许桌面应用访问麦克风后重试。'
  }
  return deniedMessage(platform)
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
  openExternal: OpenExternal = shell.openExternal,
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
      // askForMediaAccess 已明确返回 false 时绝不能继续打开麦克风；少数开发态环境
      // 可能仍报告 not-determined，这里按拒绝处理并提供系统设置入口。
      if (status !== 'restricted') status = 'denied'
    }

    if (status === 'granted') return { granted: true, status, message: null }
    if (status === 'denied') {
      const settingsUrl = microphoneSettingsUrl(platform)
      let openedSettings = false
      if (settingsUrl) {
        try {
          await openExternal(settingsUrl)
          openedSettings = true
        } catch {
          // 深链打开失败时仍返回原有的手动操作指引。
        }
      }
      const message = openedSettings ? openedSettingsMessage(platform) : deniedMessage(platform)
      return { granted: false, status, message }
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
