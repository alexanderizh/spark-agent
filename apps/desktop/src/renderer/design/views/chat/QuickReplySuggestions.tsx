import React from 'react'
import './QuickReplySuggestions.less'

export function QuickReplySuggestions({
  replies,
  disabled = false,
  onSelect,
}: {
  replies: string[]
  disabled?: boolean
  onSelect: (reply: string) => void
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
    </div>
  )
}
