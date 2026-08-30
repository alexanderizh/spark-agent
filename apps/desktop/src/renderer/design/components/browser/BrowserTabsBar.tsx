/**
 * BrowserTabsBar — 浏览器 tab 条：tab 列表 + 新建 + 溢出下拉。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement, MouseEvent as ReactMouseEvent } from 'react'
import { Icons } from '../../Icons'
import { tabDisplayLabel } from './browserChromeShared'
import type { BrowserTabItem } from './browserTabsStore'

export interface BrowserTabsBarProps {
  tabs: BrowserTabItem[]
  activeId: string | null
  maxTabs: number
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  /** 新建被拒（达到上限）时由外层 toast 提示 */
  onLimitReached?: () => void
}

export function BrowserTabsBar({
  tabs,
  activeId,
  maxTabs,
  onSelect,
  onClose,
  onNew,
  onLimitReached,
}: BrowserTabsBarProps): ReactElement {
  const [listOpen, setListOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!listOpen) return
    const onDocMouseDown = (event: MouseEvent): void => {
      if (rootRef.current != null && !rootRef.current.contains(event.target as Node)) {
        setListOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [listOpen])

  const handleNew = (): void => {
    if (tabs.length >= maxTabs) {
      onLimitReached?.()
      return
    }
    onNew()
  }

  const stop = (e: ReactMouseEvent): void => e.stopPropagation()

  return (
    <div className="browser-tabsbar" ref={rootRef}>
      <div className="browser-tabsbar-scroll" role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            className={`browser-tab${tab.id === activeId ? ' is-active' : ''}`}
            title={tab.url ?? ''}
            onClick={() => onSelect(tab.id)}
          >
            <span className="browser-tab-icon">
              {tab.favicon != null ? (
                <img
                  src={tab.favicon}
                  alt=""
                  className="browser-tab-favicon"
                  onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                <Icons.Globe size={12} />
              )}
            </span>
            <span className="browser-tab-label">{tabDisplayLabel(tab)}</span>
            <button
              type="button"
              className="browser-tab-close"
              title="关闭标签页"
              aria-label="关闭标签页"
              onClick={(e) => {
                stop(e)
                onClose(tab.id)
              }}
            >
              <Icons.X size={10} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="browser-tabsbar-new"
        title="新建标签页"
        aria-label="新建标签页"
        onClick={handleNew}
      >
        <Icons.Plus size={13} />
      </button>
      <div className="browser-tabsbar-overflow">
        <button
          type="button"
          className="browser-tabsbar-list-btn"
          title="标签页列表"
          aria-label="标签页列表"
          onClick={() => setListOpen((v) => !v)}
        >
          <Icons.ChevronDown size={12} />
        </button>
        {listOpen && (
          <div className="browser-tabs-list" role="menu">
            {tabs.map((tab, index) => (
              <button
                key={tab.id}
                type="button"
                role="menuitem"
                className={`browser-tabs-list-item${tab.id === activeId ? ' is-active' : ''}`}
                onClick={() => {
                  onSelect(tab.id)
                  setListOpen(false)
                }}
              >
                <span className="browser-tabs-list-index">{index + 1}</span>
                <span className="browser-tabs-list-label">{tabDisplayLabel(tab)}</span>
                <span className="browser-tabs-list-url">{tab.url}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
