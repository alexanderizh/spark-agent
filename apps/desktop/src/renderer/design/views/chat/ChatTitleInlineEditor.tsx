import { useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'

export interface ChatTitleInlineEditorProps {
  /** 当前标题（受控展示值）；编辑中以用户输入为准，不受外部刷新打断 */
  value: string
  /** 保存回调：由调用方负责落库与失败提示。返回 Promise 时编辑器等其 settle 再退出编辑态 */
  onCommit: (title: string) => void | Promise<void>
  /** 空标题时的占位文案 */
  placeholder?: string
  /** 原生 title 提示；缺省用 value，超长标题靠它看全量 */
  title?: string
  /** 附加 className：调用方用它把编辑器挂进原有的标题槽位样式 */
  className?: string
  /** 无障碍名称；缺省用 value */
  ariaLabel?: string
}

/**
 * 会话标题原地编辑器：点一下标题即切为输入框并全选，回车或失焦保存，Esc 取消。
 *
 * 与侧边栏悬浮卡改名共用同一套交互约定（回车/失焦提交、Esc 放弃、空值不落库），
 * 区别只在触发器——这里标题槽位本身就是触发器，不需要外层 Popover。
 *
 * 结算守卫 settledRef 与悬浮卡一致：Enter 触发提交后输入框随即卸载，onBlur 会再跑
 * 一次，没有守卫就会二次提交。
 *
 * 展示态固定带 truncate（标题槽位本来就靠省略号收边），编辑态不带——省略号会让正在
 * 改的文本看不全，交给 input 自身横向滚动。
 */
export function ChatTitleInlineEditor({
  value,
  onCommit,
  placeholder,
  title,
  className,
  ariaLabel,
}: ChatTitleInlineEditorProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const settledRef = useRef(false)

  const startEdit = () => {
    if (editing) return
    settledRef.current = false
    // 进入编辑时以最新外部值为准：LLM 首轮异步改名落地后再点开，拿到的是新标题
    setDraft(value)
    setEditing(true)
  }

  const finish = async (mode: 'commit' | 'cancel') => {
    if (settledRef.current) return
    settledRef.current = true
    if (mode === 'commit') {
      const trimmed = draft.trim()
      // 空标题不发请求：不能因为一次误清空就把会话名抹掉；未变更也不落库
      if (trimmed !== '' && trimmed !== value) {
        try {
          await onCommit(trimmed)
        } catch {
          // 落库失败由调用方统一提示；这里只负责退出编辑态，不把界面卡在输入框
        }
      }
    }
    setEditing(false)
  }

  // 标题槽位在 .chat-tabbar 的拖拽区里，双击会被外层拿来最大化窗口；
  // 编辑前后的双击都属于文本操作，必须就地拦掉不再冒泡。
  const stopWindowDrag = (event: ReactMouseEvent) => {
    event.stopPropagation()
  }

  const handleSpanKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      startEdit()
    }
  }

  const extra = className?.trim()
  const withSlot = (base: string) => (extra == null || extra === '' ? base : `${base} ${extra}`)

  if (editing) {
    // 编辑态不套 truncate：省略号会让正在改的文本看不全，交给 input 自身横向滚动
    return (
      <input
        className={withSlot('chat-title-input')}
        value={draft}
        autoFocus
        aria-label={ariaLabel ?? placeholder ?? value}
        // 全选：一键键入即整体替换，和侧边栏悬浮卡改名一致
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          void finish('commit')
        }}
        onClick={stopWindowDrag}
        onDoubleClick={stopWindowDrag}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void finish('commit')
          } else if (event.key === 'Escape') {
            event.preventDefault()
            void finish('cancel')
          }
        }}
        placeholder={placeholder}
      />
    )
  }

  return (
    <span
      className={withSlot('chat-title-text truncate')}
      role="button"
      tabIndex={0}
      title={title ?? value}
      aria-label={ariaLabel ?? value}
      onClick={startEdit}
      onDoubleClick={stopWindowDrag}
      onKeyDown={handleSpanKeyDown}
    >
      {value}
    </span>
  )
}
