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
  const fmt = readAppearance().timestampFormat
  if (fmt === 'abs') return abs
  const now = Date.now()
  const diffMs = now - d.getTime()
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`
  return abs
}

/** 消息悬浮操作栏：时间、复制、重发、分叉和删除，放在气泡底部。 */
export function MessageHoverBar({
  timestamp,
  textContent,
  position,
  onDelete,
  onResend,
  onFork,
}: {
  timestamp?: string | undefined
  textContent: string
  position: 'left' | 'right'
  onDelete?: () => void
  /** 仅用户消息：把这条消息的文本+附件重新塞回输入区 */
  onResend?: () => void
  /** 仅已完成的助手消息：从该轮创建分支 */
  onFork?: () => void
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
