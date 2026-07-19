import { useCallback } from 'react'
import { useApp } from '../AppContext'
import type { UseVoiceIntegrityResult } from './useVoiceIntegrity'
import { confirmVoicePackDownload } from './voiceDownloadConfirmation'

/** 首次使用语音输入时，先征得用户确认，再在后台下载安装包。 */
export function useVoiceDownloadConfirmation(
  install: UseVoiceIntegrityResult['install'],
): () => Promise<boolean> {
  const { requestConfirm } = useApp()

  return useCallback(
    () => confirmVoicePackDownload(requestConfirm, install),
    [install, requestConfirm],
  )
}
