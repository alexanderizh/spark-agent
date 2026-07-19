import { Icons } from '../Icons'
import type { VoiceInputStatus } from './useVoiceInput'
import './voice.less'

export interface VoiceMicButtonProps {
  status: VoiceInputStatus
  /** 语音包是否就绪（native + model） */
  ready: boolean
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
 *   - 未就绪：带下载小角标，提示需先下载语音包
 *   - 下载中 / 平台不支持：禁用
 *
 * 业务编排（完整性检测、按需下载、开/关麦）由父组件 onClick 处理。
 */
export function VoiceMicButton({
  status,
  ready,
  downloading,
  unsupported,
  disabled,
  onClick,
}: VoiceMicButtonProps) {
  const recording = status === 'recording' || status === 'starting'
  const title = unsupported
    ? '当前平台不支持语音输入'
    : recording
      ? '停止语音输入'
      : downloading
        ? '语音包下载中…'
        : ready
          ? '语音输入'
          : '点击下载语音包后即可使用语音输入'

  const isDisabled = Boolean(disabled) || unsupported || downloading || status === 'stopping'
  const showBadge = !ready && !unsupported && !downloading

  return (
    <button
      type="button"
      className={[
        'composer-voice-btn',
        recording ? 'is-recording' : '',
        downloading ? 'is-downloading' : '',
        !ready && !unsupported ? 'is-pending' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={title}
      aria-label={title}
      disabled={isDisabled}
      onClick={onClick}
    >
      {recording ? <span className="composer-voice-pulse" aria-hidden="true" /> : null}
      <Icons.Mic size={15} />
      {showBadge ? (
        <span className="composer-voice-badge" aria-hidden="true">
          <Icons.Download size={9} />
        </span>
      ) : null}
      {downloading ? <Icons.Spinner size={11} className="composer-voice-spinner" /> : null}
    </button>
  )
}
