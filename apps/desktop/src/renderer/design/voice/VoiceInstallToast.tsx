import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { VoiceInstallProgress, VoiceIntegrityStatus } from '@spark/protocol'
import { Icons } from '../Icons'

export interface VoiceInstallToastProps {
  progress: VoiceInstallProgress | null
  status: VoiceIntegrityStatus
  /** 重试下载 */
  onRetry?: () => void
}

const STATE_LABEL: Record<VoiceInstallProgress['state'], string> = {
  preparing: '准备下载',
  downloading: '下载中',
  verifying: '校验完整性',
  activating: '解压安装',
  done: '已完成',
  error: '安装失败',
}

/**
 * 语音包按需下载进度卡片（右上角，非阻塞）。
 *
 * 通过 createPortal 挂到 document.body，避免被任何 transformed 祖先容器影响 fixed 定位。
 * 可见性：下载/安装进行中持续展示；成功后 3.5s 自动收起；失败后常驻直至用户操作。
 */
export function VoiceInstallToast({ progress, status, onRetry }: VoiceInstallToastProps) {
  const [doneHidden, setDoneHidden] = useState(false)
  const [userDismissed, setUserDismissed] = useState(false)
  const prevState = useRef<string>('')

  // 进入新一轮下载（done/error → preparing/downloading）时重置隐藏/ dismissed 标记
  useEffect(() => {
    if (!progress) return
    const cur = progress.state
    if (
      (cur === 'preparing' || cur === 'downloading') &&
      (prevState.current === 'done' || prevState.current === 'error' || userDismissed)
    ) {
      setDoneHidden(false)
      setUserDismissed(false)
    }
    prevState.current = cur
  }, [progress, userDismissed])

  // 成功后延时收起
  useEffect(() => {
    if (progress?.state !== 'done') return
    const timer = setTimeout(() => setDoneHidden(true), 3500)
    return () => clearTimeout(timer)
  }, [progress])

  if (typeof document === 'undefined') return null
  if (!progress) return null
  if (userDismissed) return null
  if (progress.state === 'done' && doneHidden) return null

  const isError = progress.state === 'error'
  const isDone = progress.state === 'done'
  const percent = Math.max(0, Math.min(100, progress.percent ?? 0))
  const componentName = progress.component === 'native' ? '推理引擎' : '识别模型'

  return createPortal(
    <div
      className={`voice-install-toast ${isError ? 'is-error' : ''} ${isDone ? 'is-done' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="voice-install-toast-head">
        <span className="voice-install-toast-title">
          {isError
            ? '语音包安装失败'
            : isDone
              ? '语音包已就绪'
              : `正在安装语音包 · ${componentName}`}
        </span>
        {!isError && !isDone ? (
          <Icons.Spinner size={14} className="voice-install-toast-spinner" />
        ) : (
          <button
            type="button"
            className="voice-install-toast-close"
            title="关闭"
            onClick={() => setUserDismissed(true)}
          >
            <Icons.X size={13} />
          </button>
        )}
      </div>

      {!isError ? (
        <div className="voice-install-toast-bar" aria-hidden="true">
          <div className="voice-install-toast-bar-fill" style={{ width: `${percent}%` }} />
        </div>
      ) : null}

      <div className="voice-install-toast-meta">
        {isError ? (
          <span className="voice-install-toast-error">
            {progress.message || status.lastError || '请稍后重试'}
          </span>
        ) : isDone ? (
          <span>现在可以使用语音输入了</span>
        ) : (
          <span>
            {STATE_LABEL[progress.state]} · {Math.round(percent)}%
          </span>
        )}
      </div>

      {isError && onRetry ? (
        <div className="voice-install-toast-actions">
          <button type="button" onClick={onRetry}>
            重试
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
