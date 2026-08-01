import React from 'react'
import { Icons } from '../../Icons'
import './QuickReplySuggestions.less'

export function QuickReplySuggestions({
  replies,
  disabled = false,
  onSelect,
  onDismiss,
}: {
  replies: string[]
  disabled?: boolean
  onSelect: (reply: string) => void
  onDismiss: () => void
}) {
  if (replies.length === 0) return null

  return (
    <div className="composer-quick-replies" aria-label="快捷回复建议">
      {replies.map((reply) => (
        <button
          key={reply}
          type="button"
          className="composer-quick-reply-chip"
          disabled={disabled}
          title={`发送：${reply}`}
          onClick={() => onSelect(reply)}
        >
          {reply}
        </button>
      ))}
      <button
        type="button"
        className="composer-quick-replies-dismiss"
        disabled={disabled}
        aria-label="关闭快捷回复建议"
        title="关闭快捷回复建议"
        onClick={onDismiss}
      >
        <Icons.X size={13} />
      </button>
    </div>
  )
}
