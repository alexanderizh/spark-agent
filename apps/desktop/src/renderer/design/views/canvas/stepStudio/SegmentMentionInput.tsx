/**
 * 分段剧本 @ 提及输入（二期 R2-3）：
 * 在剧本 textarea 内键入 '@' 弹出资产候选（角色/场景/道具），
 * 选中后把查询区间替换为「@名称 」并上抛 onMention —— 由分段卡片
 * 把资产写入对应引用字段（生成时自动注入出镜设定）。
 *
 * 键盘交互：↑↓ 高亮、Enter/Tab 确认、Esc 关闭。
 * IME 约定（prj_43f90082）：macOS 中文输入法会把无组合 Enter 误标
 * isComposing —— 因此确认只看「用户已用方向键显式高亮」这一信号，
 * 不再看 isComposing；未高亮时 Enter/Tab 不拦截（正常换行/焦点移动）。
 */

import { useEffect, useRef, useState } from 'react'
import { Input } from 'antd'
import type { SegmentMentionDetect } from './stepStoryboardModel'
import { applyMention, detectMentionQuery, filterMentionOptions } from './stepStoryboardModel'

export interface SegmentMentionOption {
  value: string
  label: string
  kind: 'character' | 'scene' | 'prop'
}

export type SegmentMentionInputProps = Readonly<{
  value: string
  options: SegmentMentionOption[]
  className?: string
  placeholder?: string
  onChange: (script: string) => void
  onMention: (option: SegmentMentionOption) => void
}>

const KIND_LABEL: Record<SegmentMentionOption['kind'], string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
}

interface MentionSession {
  detect: SegmentMentionDetect
  /** 检测时文本快照：value 被外部改动（草稿合并等）时面板作废 */
  text: string
  caret: number
}

export function SegmentMentionInput({
  value,
  options,
  className,
  placeholder,
  onChange,
  onMention,
}: SegmentMentionInputProps) {
  const [session, setSession] = useState<MentionSession | null>(null)
  const [highlight, setHighlight] = useState(-1)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const pendingCaretRef = useRef<number | null>(null)

  const active = session !== null && session.text === value ? session : null
  const filtered = active ? filterMentionOptions(options, active.detect.query) : []

  // 确认提及后受控 value 经父层回流，渲染后把光标落到插入串之后
  useEffect(() => {
    if (pendingCaretRef.current == null) return
    const caret = pendingCaretRef.current
    pendingCaretRef.current = null
    const textarea = rootRef.current?.querySelector('textarea')
    if (textarea) {
      textarea.focus()
      textarea.setSelectionRange(caret, caret)
    }
  })

  const syncSession = (text: string, caret: number): void => {
    setHighlight(-1)
    const detect = detectMentionQuery(text, caret)
    setSession(detect === null ? null : { detect, text, caret })
  }

  const dismiss = (): void => {
    setSession(null)
    setHighlight(-1)
  }

  const confirmMention = (option: SegmentMentionOption): void => {
    if (!active) return
    const result = applyMention(value, active.detect.startIndex, active.caret, option.label)
    pendingCaretRef.current = result.caret
    dismiss()
    onChange(result.text)
    onMention(option)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!active) return
    if (event.key === 'Escape') {
      event.preventDefault()
      dismiss()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (filtered.length === 0) return
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setHighlight((prev) => {
        if (prev < 0) return delta > 0 ? 0 : filtered.length - 1
        return (prev + delta + filtered.length) % filtered.length
      })
      return
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && highlight >= 0) {
      const option = filtered[highlight]
      if (option) {
        event.preventDefault()
        confirmMention(option)
      }
    }
  }

  return (
    <div className="segment-mention-field" ref={rootRef}>
      <Input.TextArea
        {...(className ? { className } : {})}
        value={value}
        autoSize={{ minRows: 2, maxRows: 6 }}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value
          onChange(next)
          syncSession(next, event.target.selectionStart ?? next.length)
        }}
        onSelect={(event) => {
          const target = event.target as HTMLTextAreaElement
          syncSession(value, target.selectionStart ?? value.length)
        }}
        onKeyDown={handleKeyDown}
        onBlur={dismiss}
      />
      {active ? (
        <div className="segment-mention-panel" role="listbox" aria-label="提及资产选择">
          {filtered.length === 0 ? (
            <div className="segment-mention-empty">没有匹配的资产</div>
          ) : (
            filtered.map((option, index) => (
              <button
                key={`${option.kind}:${option.value}`}
                type="button"
                role="option"
                aria-selected={index === highlight}
                className={`segment-mention-option${index === highlight ? ' is-active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => confirmMention(option)}
              >
                <span className={`segment-mention-dot kind-${option.kind}`} />
                <span className="segment-mention-label">{option.label}</span>
                <span className="segment-mention-kind">{KIND_LABEL[option.kind]}</span>
              </button>
            ))
          )}
          <div className="segment-mention-hint">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
        </div>
      ) : null}
    </div>
  )
}
