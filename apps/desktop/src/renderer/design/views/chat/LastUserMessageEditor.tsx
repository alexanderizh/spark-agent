import React, { useEffect, useRef, useState } from 'react'
import './LastUserMessageEditor.less'

export function LastUserMessageEditor({
  initialValue,
  allowEmpty = false,
  disabled = false,
  onCancel,
  onSubmit,
}: {
  initialValue: string
  allowEmpty?: boolean
  disabled?: boolean
  onCancel: () => void
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState(initialValue)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const canSubmit = !disabled && (allowEmpty || value.trim().length > 0)

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea == null) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [])

  const submit = () => {
    if (!canSubmit) return
    onSubmit(value.trim())
  }

  return (
    <div className="last-user-message-editor">
      <textarea
        ref={textareaRef}
        className="last-user-message-editor-input"
        value={value}
        disabled={disabled}
        aria-label="编辑最后一条消息"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <div className="last-user-message-editor-actions">
        <button type="button" disabled={disabled} onClick={onCancel}>
          取消
        </button>
        <button type="button" className="is-primary" disabled={!canSubmit} onClick={submit}>
          {disabled ? '发送中…' : '发送'}
        </button>
      </div>
    </div>
  )
}
