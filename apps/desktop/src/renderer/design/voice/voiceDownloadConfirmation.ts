import type { ConfirmOptions } from '../AppContext'
import type { UseVoiceIntegrityResult } from './useVoiceIntegrity'

export const VOICE_DOWNLOAD_CONFIRM_OPTIONS = {
  title: '下载语音包？',
  description:
    '语音输入首次使用需要一次性下载约 230 MB 的语音包。下载完成后可离线使用，后续无需重复下载。',
  confirmText: '下载语音包',
  cancelText: '暂不下载',
} satisfies ConfirmOptions

export async function confirmVoicePackDownload(
  requestConfirm: (options: ConfirmOptions) => Promise<boolean>,
  install: UseVoiceIntegrityResult['install'],
): Promise<boolean> {
  const confirmed = await requestConfirm(VOICE_DOWNLOAD_CONFIRM_OPTIONS)
  if (!confirmed) return false
  void install(false).catch(() => undefined)
  return true
}
