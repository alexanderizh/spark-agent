/**
 * 语音输入组合 hook（ASR）：把完整性检测、下载确认、识别管线和麦克风按钮
 * 组装成一次调用，供任意输入区（ChatPanel 等非 ComposerV2 宿主）接入语音输入。
 *
 * 抽取来源：ComposerV2 的语音接法（onFinal 追加 / onRefined 精修替换 / 安装引导）。
 * 本 hook 不接管快捷键（useVoiceInputShortcut）——避免多个宿主实例同时注册全局
 * 快捷键互相冲突；宿主如需快捷键请自行接入。
 *
 * 用法：
 *   const { micButton, installToast, voiceInputActive } = useComposerVoice({
 *     setValue: (updater) => applyInput(updater(inputRef.current)),
 *     disabled: sending,
 *   })
 *   // JSX: {micButton} 放在发送钮旁；{installToast} 挂在根部
 */
import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { useVoiceIntegrity } from './useVoiceIntegrity'
import { useVoiceInput, type VoiceRefinedPayload } from './useVoiceInput'
import { VoiceMicButton } from './VoiceMicButton'
import { VoiceInstallToast } from './VoiceInstallToast'
import { useVoiceDownloadConfirmation } from './useVoiceDownloadConfirmation'
import { useToast } from '../components/Toast'

export interface UseComposerVoiceOptions {
  /** 输入框 setState（updater 形式，保证回调不持有过期闭包） */
  setValue: (updater: (prev: string) => string) => void
  /** 禁用（发送中/输入区不可用时） */
  disabled?: boolean
}

export interface UseComposerVoiceResult {
  /** 直接渲染的麦克风按钮（已接好全部状态与点击逻辑） */
  micButton: ReactNode
  /** 直接渲染的语音包安装进度提示 */
  installToast: ReactNode
  /** 录音/识别进行中（宿主可用它做输入区高亮等） */
  voiceInputActive: boolean
}

/** 与 useVoiceInput 注释要求一致的句段拼接（精修替换依赖此前缀精确匹配） */
function appendSegment(prev: string, text: string): string {
  if (!text) return prev
  const needSpace = prev.length > 0 && !/\s$/.test(prev)
  return prev + (needSpace ? ' ' : '') + text
}

export function useComposerVoice(options: UseComposerVoiceOptions): UseComposerVoiceResult {
  const { setValue, disabled = false } = options
  const { toast } = useToast()

  const voiceIntegrity = useVoiceIntegrity()
  const requestVoicePackInstall = useVoiceDownloadConfirmation(voiceIntegrity.install)
  const voice = useVoiceInput({
    onFinal: (text) => {
      setValue((prev) => appendSegment(prev, text))
    },
    onRefined: ({ previous, text }: VoiceRefinedPayload) => {
      setValue((prev) => {
        if (previous && prev.endsWith(previous)) {
          // 流式文本仍是草稿后缀：安全地整体替换为精修结果
          return prev.slice(0, prev.length - previous.length) + text
        }
        return prev
      })
    },
  })

  const handleVoiceToggle = useCallback(async () => {
    if (voice.status === 'recording' || voice.status === 'starting') {
      await voice.stop()
      return
    }
    if (voice.status === 'stopping' || voice.status === 'refining') return
    const st = voiceIntegrity.status
    if (!st.supported) {
      toast.warning(st.unsupportedReason ?? '当前平台不支持语音输入')
      return
    }
    if (!st.ready) {
      await requestVoicePackInstall()
      return
    }
    await voice.start()
  }, [voice, voiceIntegrity, requestVoicePackInstall, toast])

  const micButton = (
    <VoiceMicButton
      status={voice.status}
      audioLevelStore={voice.audioLevelStore}
      ready={voiceIntegrity.status.ready}
      checking={voiceIntegrity.checking}
      downloading={voiceIntegrity.status.downloading}
      unsupported={!voiceIntegrity.status.supported}
      disabled={disabled}
      // 本 hook 不接快捷键（见文件头注释），关闭快捷键气泡避免被 overflow 宿主裁剪；
      // VoiceMicButton 在 shortcutHint=false 时会用原生 title 兜底提示。
      shortcutHint={false}
      onClick={() => void handleVoiceToggle()}
    />
  )

  const installToast = (
    <VoiceInstallToast
      progress={voiceIntegrity.progress}
      status={voiceIntegrity.status}
      onRetry={() => void voiceIntegrity.install()}
    />
  )

  const voiceInputActive =
    voice.status === 'starting' || voice.status === 'recording' || voice.status === 'stopping'

  return { micButton, installToast, voiceInputActive }
}
