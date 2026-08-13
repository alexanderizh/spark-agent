/**
 * 内联重命名 / 新建输入框。
 *
 * - autofocus + 自动选区：重命名文件时只选文件名（不含扩展名），其余情况全选
 * - Enter 提交 / Esc 取消 / 失焦提交；非法名（空、含 /）按取消处理
 * - 阻止 click 冒泡，避免触发行选中或目录展开
 */

import { useEffect, useRef, useState } from 'react'

export interface InlineRenameInputProps {
  initialValue: string
  /** true = 仅选中文件名部分（不含扩展名）；false = 全选 */
  selectNameOnly: boolean
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function InlineRenameInput({
  initialValue,
  selectNameOnly,
  onConfirm,
  onCancel,
}: InlineRenameInputProps): React.ReactNode {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (el == null) return
    el.focus()
    if (selectNameOnly) {
      const dot = initialValue.lastIndexOf('.')
      // 仅当扩展名存在且不是首字符（隐藏文件 .xxx 不算）
      el.setSelectionRange(0, dot > 0 ? dot : initialValue.length)
    } else {
      el.select()
    }
  }, [initialValue, selectNameOnly])

  const finish = (commit: boolean): void => {
    const trimmed = value.trim()
    const valid = trimmed !== '' && !trimmed.includes('/')
    if (commit && valid) onConfirm(trimmed)
    else onCancel()
  }

  return (
    <input
      ref={inputRef}
      className="fe-rename-input"
      value={value}
      spellCheck={false}
      placeholder="名称"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
