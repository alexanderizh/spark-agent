import { useEffect, useState, useSyncExternalStore } from 'react'
import { Icons } from '../Icons'
import type { VoiceInputStatus } from './useVoiceInput'
import {
  EMPTY_VOICE_WAVEFORM,
  type VoiceAudioLevelStore,
} from './voiceAudioLevel'
import {
  VOICE_INPUT_ARIA_SHORTCUT,
  VOICE_INPUT_SHORTCUT_LABEL,
} from './useVoiceInputShortcut'
import './voice.less'

export interface VoiceMicButtonProps {
  status: VoiceInputStatus
  /** AudioWorklet 驱动的真实音量历史；缺省时展示静音轨。 */
  audioLevelStore?: VoiceAudioLevelStore
  /** 语音包是否就绪（native + model） */
  ready: boolean
  /** 是否正在检测语音包完整性 */
  checking: boolean
  /** 是否正在下载安装 */
  downloading: boolean
  /** 当前平台是否不支持 */
  unsupported: boolean
  /** 父级禁用（如发送中） */
  disabled?: boolean
  onClick: () => void
}

/**
 * 输入框麦克风按钮（纯展示）：
 *   - 就绪空闲：麦克风图标
 *   - 录音中/启动中：红色脉冲
 *   - 未就绪：保持麦克风图标，点击后由确认弹窗说明下载要求
 *   - 下载中 / 平台不支持：禁用
 *
 * 业务编排（完整性检测、按需下载、开/关麦）由父组件 onClick 处理。
 */
export function VoiceMicButton({
  status,
  audioLevelStore,
  ready,
  checking,
  downloading,
  unsupported,
  disabled,
  onClick,
}: VoiceMicButtonProps) {
  const starting = status === 'starting'
  const recording = status === 'recording'
  const stopping = status === 'stopping'
  const title = unsupported
    ? '当前平台不支持语音输入'
    : starting || recording
      ? '停止语音输入'
      : stopping
        ? '正在停止语音输入…'
        : status === 'error'
          ? '语音输入启动失败，点击重试'
      : checking
        ? '正在检查语音包…'
        : downloading
          ? '语音包下载中…'
          : ready
            ? '语音输入'
            : '首次使用需下载语音包'

  const busy = checking || downloading
  const isDisabled = Boolean(disabled) || unsupported || busy || status === 'stopping'

  return (
    <span className="composer-voice-control">
      <button
      type="button"
      className={[
        'composer-voice-btn',
        starting ? 'is-starting' : '',
        recording ? 'is-recording' : '',
        stopping ? 'is-stopping' : '',
        status === 'error' ? 'is-error' : '',
        downloading ? 'is-downloading' : '',
        !ready && !unsupported ? 'is-pending' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={title}
      aria-keyshortcuts={VOICE_INPUT_ARIA_SHORTCUT}
      aria-describedby="composer-voice-shortcut-hint"
      disabled={isDisabled}
      onClick={onClick}
      >
      {starting ? (
        <>
          <Icons.Spinner size={13} className="composer-voice-state-spinner" />
          <span className="composer-voice-state-label">启动中</span>
        </>
      ) : recording ? (
        <VoiceRecordingState audioLevelStore={audioLevelStore} />
      ) : stopping ? (
        <>
          <Icons.Spinner size={13} className="composer-voice-state-spinner" />
          <span className="composer-voice-state-label">结束中</span>
        </>
      ) : (
        <>
          <Icons.Mic size={16} />
          {busy ? <Icons.Spinner size={10} className="composer-voice-spinner" /> : null}
        </>
      )}
      </button>
      <span
        id="composer-voice-shortcut-hint"
        className="composer-voice-shortcut-hint"
        role="tooltip"
      >
        快捷键 <kbd>{VOICE_INPUT_SHORTCUT_LABEL}</kbd>
      </span>
    </span>
  )
}

function emptyVoiceLevelSubscribe(): () => void {
  return () => {}
}

function getEmptyVoiceWaveform(): readonly number[] {
  return EMPTY_VOICE_WAVEFORM
}

function VoiceRecordingState({
  audioLevelStore,
}: {
  audioLevelStore?: VoiceAudioLevelStore | undefined
}) {
  const waveform = useSyncExternalStore(
    audioLevelStore?.subscribe ?? emptyVoiceLevelSubscribe,
    audioLevelStore?.getSnapshot ?? getEmptyVoiceWaveform,
    getEmptyVoiceWaveform,
  )
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const startedAt = Date.now()
    const update = (): void => setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    const timer = window.setInterval(update, 500)
    return () => window.clearInterval(timer)
  }, [])

  const formattedElapsed = formatElapsed(elapsed)
  return (
    <>
      <span className="composer-voice-track" aria-hidden="true">
        {waveform.map((level, index) => (
          <i key={index} style={{ height: `${voiceBarHeight(level, index)}px` }} />
        ))}
      </span>
      <span className="composer-voice-timer" aria-label={`已录入 ${formattedElapsed}`}>
        {formattedElapsed}
      </span>
      <span className="composer-voice-stop" aria-hidden="true">
        <i />
      </span>
      <span className="composer-voice-visually-hidden" aria-live="polite">录入中</span>
    </>
  )
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

function voiceBarHeight(level: number, index: number): number {
  // 对底噪做视觉 noise gate，避免安静时一排 2px 采样看起来像“多余虚线”。
  if (level < 0.055) return 0
  const profile = [0.42, 0.7, 0.5, 0.9, 0.62, 1, 0.75, 0.48, 0.86, 0.58, 0.95, 0.66]
  const weight = profile[index % profile.length] ?? 0.7
  return 2 + Math.round(Math.min(1, level * 1.35) * weight * 14)
}
