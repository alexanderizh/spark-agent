import React, { useCallback, useState } from 'react'
import { readAppearance } from '../../hooks/useAppearance'
import { Icons } from '../../Icons'

function formatMsgTime(timestamp?: string): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const abs = `${hh}:${mm}`
  const now = new Date()
  // 非当天消息按日历差逐级补充日期：同月补「日」、同年补「月」、跨年补「年」
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (!sameDay) {
    const sameYear = d.getFullYear() === now.getFullYear()
    const sameMonth = sameYear && d.getMonth() === now.getMonth()
    let datePart: string
    if (!sameYear) {
      datePart = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
    } else if (!sameMonth) {
      datePart = `${d.getMonth() + 1}月${d.getDate()}日`
    } else {
      datePart = `${d.getDate()}日`
    }
    return `${datePart} ${abs}`
  }
  const fmt = readAppearance().timestampFormat
  if (fmt === 'abs') return abs
  const diffMs = now.getTime() - d.getTime()
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`
  return `${Math.floor(diffMs / 3_600_000)} 小时前`
}

/** 消息悬浮操作栏：时间、复制、重发、语音播报、分叉和删除，放在气泡底部。 */
export function MessageHoverBar({
  timestamp,
  textContent,
  position,
  onDelete,
  onResend,
  onEdit,
  onFork,
  onSpeechToggle,
  speechStatus = 'off',
}: {
  timestamp?: string | undefined
  textContent: string
  position: 'left' | 'right'
  onDelete?: () => void
  /** 仅用户消息：把这条消息的文本+附件重新塞回输入区 */
  onResend?: () => void
  /** 仅当前会话最后一轮已结束用户消息：行内编辑并替换该轮。 */
  onEdit?: () => void
  /** 仅已完成的助手消息：从该轮创建分支 */
  onFork?: () => void
  /** 仅配置了 TTS 模型的助手消息：切换语音播报（off→播报，loading/playing→停止） */
  onSpeechToggle?: () => void
  /** 播报状态：loading=合成中 playing=播报中（图标切换与 title 依据） */
  speechStatus?: 'off' | 'loading' | 'playing'
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(textContent)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }, [textContent])

  const time = formatMsgTime(timestamp)

  return (
    <div className={`msg-hover-bar msg-hover-${position}`}>
      {time && <span className="msg-hover-time">{time}</span>}
      {onResend && (
        <button type="button" className="msg-hover-resend" title="重发" onClick={onResend}>
          <Icons.RotateCw size={12} />
        </button>
      )}
      {textContent && (
        <button type="button" className="msg-hover-copy" title="复制" onClick={handleCopy}>
          {copied ? <Icons.Check size={12} /> : <Icons.Copy size={12} />}
        </button>
      )}
      {onSpeechToggle && textContent && (
        <button
          type="button"
          className={`msg-hover-speech${speechStatus === 'playing' ? ' is-playing' : ''}`}
          title={speechStatus === 'off' ? '语音播报' : '停止播报'}
          aria-label={speechStatus === 'off' ? '语音播报' : '停止播报'}
          onClick={onSpeechToggle}
        >
          {speechStatus === 'loading' ? (
            <Icons.Spinner size={12} className="spin" />
          ) : speechStatus === 'playing' ? (
            <Icons.VolumeX size={12} />
          ) : (
            <Icons.Volume2 size={12} />
          )}
        </button>
      )}
      {onEdit && (
        <button
          type="button"
          className="msg-hover-edit"
          title="编辑消息"
          aria-label="编辑消息"
          onClick={onEdit}
        >
          <Icons.Pencil size={12} />
        </button>
      )}
      {onFork && (
        <button
          type="button"
          className="msg-hover-fork"
          title="从此处分支"
          aria-label="从此处分支"
          onClick={onFork}
        >
          <Icons.GitBranch size={12} />
        </button>
      )}
      {onDelete && (
        <button type="button" className="msg-hover-delete" title="删除" onClick={onDelete}>
          <Icons.Trash size={12} />
        </button>
      )}
    </div>
  )
}
