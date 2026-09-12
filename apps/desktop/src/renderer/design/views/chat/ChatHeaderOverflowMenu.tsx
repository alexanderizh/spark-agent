import { useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { MoreHorizontal } from 'lucide-react'
import { TabbarIcon, TabbarTooltipButton } from './ChatToolbar'
import './ChatHeaderOverflowMenu.less'

export type ChatHeaderOverflowItem = {
  id: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  active?: boolean
  disabled?: boolean
  danger?: boolean
  indicator?: boolean
}

export function ChatHeaderOverflowMenu({ items }: { items: ChatHeaderOverflowItem[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div className="chat-header-overflow" ref={rootRef}>
      <TabbarTooltipButton
        title="更多操作"
        ariaLabel="更多操作"
        className={`icon-btn chat-header-overflow-trigger${open ? ' active' : ''}`}
        onClick={() => setOpen((current) => !current)}
      >
        <TabbarIcon icon={MoreHorizontal} />
      </TabbarTooltipButton>
      {open && (
        <div className="chat-header-overflow-menu" role="menu" aria-label="更多操作">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={`chat-header-overflow-item${item.active ? ' active' : ''}${item.danger ? ' danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                <span className="chat-header-overflow-item-icon">
                  <Icon size={14} strokeWidth={1.6} />
                  {item.indicator && (
                    <span className="chat-header-overflow-indicator" aria-hidden="true" />
                  )}
                </span>
                <span>{item.label}</span>
                {item.active && (
                  <span className="chat-header-overflow-active-dot" aria-hidden="true" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
