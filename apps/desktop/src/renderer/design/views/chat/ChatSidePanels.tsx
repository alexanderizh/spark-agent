import React, { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../../Icons'

export type UnifiedSidePanelKind = 'config' | 'terminal' | 'side-chat' | 'review' | 'plan'

const UNIFIED_SIDE_PANEL_QUICK_ITEMS: UnifiedSidePanelKind[] = [
  'config',
  'terminal',
  'side-chat',
  'review',
  'plan',
]

const getUnifiedSidePanelMeta = (
  kind: UnifiedSidePanelKind,
): { label: string; title: string; icon: ReactNode; shortcutLabel: string } => {
  if (kind === 'config')
    return {
      label: '配置',
      title: '配置面板',
      shortcutLabel: '打开配置面板',
      icon: <Icons.More size={14} />,
    }
  if (kind === 'review')
    return {
      label: '审查',
      title: '代码审查',
      shortcutLabel: '打开代码审查面板',
      icon: <Icons.GitBranch size={14} />,
    }
  if (kind === 'plan')
    return {
      label: '计划',
      title: '计划面板',
      shortcutLabel: '打开计划面板',
      icon: <Icons.Check size={14} />,
    }
  if (kind === 'terminal')
    return {
      label: '终端',
      title: '终端',
      shortcutLabel: '打开终端面板',
      icon: <Icons.Terminal size={14} />,
    }
  return {
    label: '侧边聊天',
    title: '侧边聊天',
    shortcutLabel: '打开侧边聊天面板',
    icon: <Icons.Chat size={14} />,
  }
}

function clampPanelWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// 统一侧边面板宽度边界
const MIN_SIDE_CHAT_WIDTH = 360
const MAX_SIDE_CHAT_WIDTH = 1200

// 视口保护：面板最宽不超过 72vw，避免挤占主聊天区
export function maxSideChatWidthForViewport(): number {
  if (typeof window === 'undefined') return MAX_SIDE_CHAT_WIDTH
  return Math.min(MAX_SIDE_CHAT_WIDTH, Math.floor(window.innerWidth * 0.72))
}

// 默认宽度按窗口宽度分档：大屏更宽，小屏保底 500。
// 仅作为 lazy initial state 在挂载时取一次，用户手动拖过后保留，不会被 resize 冲掉。
export function defaultUnifiedSidePanelWidth(): number {
  if (typeof window === 'undefined') return 560
  const vw = window.innerWidth
  if (vw >= 1700) return 600
  if (vw >= 1280) return 560
  return 500
}

export function UnifiedSessionSidePanel({
  tabs,
  activeTab,
  width,
  onWidthChange,
  onSelect,
  onOpen,
  onCloseTab,
  children,
}: {
  tabs: UnifiedSidePanelKind[]
  activeTab: UnifiedSidePanelKind | null
  width: number
  onWidthChange: (width: number) => void
  onSelect: (kind: UnifiedSidePanelKind) => void
  onOpen: (kind: UnifiedSidePanelKind) => void
  onCloseTab: (kind: UnifiedSidePanelKind) => void
  children: ReactNode
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('side-chat-resizing')
  }
  const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current == null) return
    const delta = dragRef.current.startX - event.clientX
    onWidthChange(
      clampPanelWidth(
        dragRef.current.startWidth + delta,
        MIN_SIDE_CHAT_WIDTH,
        maxSideChatWidthForViewport(),
      ),
    )
  }
  const handleResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.classList.remove('side-chat-resizing')
  }
  const openKind = (kind: UnifiedSidePanelKind) => {
    onOpen(kind)
    setPickerOpen(false)
  }
  return (
    <aside
      className="unified-side-panel"
      aria-label="会话侧边面板"
      style={{ '--side-chat-width': `${width}px` } as React.CSSProperties}
    >
      <div
        className="side-chat-resize-handle"
        title="拖拽调整侧边栏宽度"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      />
      <div className="unified-side-panel-tabbar">
        <div className="unified-side-panel-active-tab">
          {activeTab != null &&
            (() => {
              const meta = getUnifiedSidePanelMeta(activeTab)
              return (
                <button type="button" className="unified-side-panel-tab active" title={meta.title}>
                  {meta.icon}
                  <span>{meta.label}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="unified-side-panel-tab-close"
                    aria-label={`关闭${meta.label}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseTab(activeTab)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        onCloseTab(activeTab)
                      }
                    }}
                  >
                    <Icons.X size={10} />
                  </span>
                </button>
              )
            })()}
        </div>
        <div className="unified-side-panel-shortcuts" aria-label="侧边面板快捷入口">
          {UNIFIED_SIDE_PANEL_QUICK_ITEMS.map((kind) => {
            const meta = getUnifiedSidePanelMeta(kind)
            const opened = tabs.includes(kind)
            const active = kind === activeTab
            return (
              <button
                key={kind}
                type="button"
                className={`unified-side-panel-shortcut ${active ? 'active' : ''} ${opened ? 'opened' : ''}`}
                aria-label={meta.shortcutLabel}
                title={meta.shortcutLabel}
                onClick={() => (opened ? onSelect(kind) : openKind(kind))}
              >
                {meta.icon}
              </button>
            )
          })}
        </div>
        <div className="unified-side-panel-add-wrap">
          <button
            type="button"
            className="unified-side-panel-add"
            aria-label="新建侧边面板"
            title="新建侧边面板"
            onClick={() => setPickerOpen((open) => !open)}
          >
            <Icons.Plus size={14} />
          </button>
          {pickerOpen && <UnifiedSidePanelMenu onOpen={openKind} compact />}
        </div>
      </div>
      <div className="unified-side-panel-content">
        {activeTab == null ? (
          <div className="unified-side-panel-empty" role="status" aria-live="polite">
            <div className="unified-side-panel-empty-title">快捷打开</div>
            <div className="unified-side-panel-empty-cards">
              {UNIFIED_SIDE_PANEL_QUICK_ITEMS.map((kind) => {
                const meta = getUnifiedSidePanelMeta(kind)
                const opened = tabs.includes(kind)
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`unified-side-panel-empty-card ${opened ? 'opened' : ''}`}
                    aria-label={meta.shortcutLabel}
                    title={meta.shortcutLabel}
                    onClick={() => openKind(kind)}
                  >
                    <span className="unified-side-panel-empty-card-icon">{meta.icon}</span>
                    <span className="unified-side-panel-empty-card-text">
                      <span className="unified-side-panel-empty-card-label">{meta.label}</span>
                      <span className="unified-side-panel-empty-card-desc">{meta.title}</span>
                    </span>
                    <span className="unified-side-panel-empty-card-action">
                      {opened ? '切换' : '打开'}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="unified-side-panel-empty-hint">
              也可以点击右上 <Icons.Plus size={11} /> 添加面板
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </aside>
  )
}

export function UnifiedSidePanelPicker({
  onOpen,
}: {
  onOpen: (kind: UnifiedSidePanelKind) => void
}) {
  return (
    <div className="unified-side-panel-picker">
      <UnifiedSidePanelMenu onOpen={onOpen} />
    </div>
  )
}

function UnifiedSidePanelMenu({
  onOpen,
  compact = false,
}: {
  onOpen: (kind: UnifiedSidePanelKind) => void
  compact?: boolean
}) {
  const items = UNIFIED_SIDE_PANEL_QUICK_ITEMS
  return (
    <div className={`unified-side-panel-menu ${compact ? 'compact' : ''}`}>
      {items.map((kind) => {
        const meta = getUnifiedSidePanelMeta(kind)
        return (
          <button
            key={kind}
            type="button"
            className="unified-side-panel-menu-item"
            onClick={() => onOpen(kind)}
          >
            {meta.icon}
            <span>{meta.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function SideChatPanel({
  agentStatus,
  creating,
  width,
  onWidthChange,
  onClose,
  onNew,
  children,
  embedded = false,
}: {
  workspaceName?: string
  agentStatus: string
  creating: boolean
  width: number
  onWidthChange: (width: number) => void
  onClose: () => void
  onNew: () => void
  children: ReactNode
  embedded?: boolean
}) {
  // 侧边聊天面板宽度可拖拽伸缩，逻辑与 inspector-resize-handle 完全一致（左侧把手、向左拖增宽）。
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('side-chat-resizing')
  }

  const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current == null) return
    const delta = dragRef.current.startX - event.clientX
    onWidthChange(clampPanelWidth(dragRef.current.startWidth + delta, 360, 760))
  }

  const handleResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.classList.remove('side-chat-resizing')
  }

  return (
    <aside
      className={embedded ? 'side-chat-panel embedded' : 'side-chat-panel'}
      aria-label="侧边聊天"
      style={{ '--side-chat-width': `${width}px` } as React.CSSProperties}
    >
      <div
        className="side-chat-resize-handle"
        title="拖拽调整侧边栏宽度"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      />
      <div className="side-chat-panel-header">
        <div>
          <div className="side-chat-panel-title">侧边聊天</div>
        </div>
        <div className="side-chat-panel-header-actions">
          {creating && <span className="side-chat-panel-status">创建中…</span>}
          {!creating && agentStatus && (
            <span className="side-chat-panel-status">{agentStatus}</span>
          )}
          <button className="btn ghost sm" onClick={onNew} disabled={creating}>
            新建侧边会话
          </button>
          <button className="icon-btn" aria-label="关闭侧边聊天" title="关闭" onClick={onClose}>
            <Icons.X size={14} />
          </button>
        </div>
      </div>
      <div className="side-chat-panel-content">{children}</div>
    </aside>
  )
}
