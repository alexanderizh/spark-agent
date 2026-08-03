import React, { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Dropdown } from 'antd'
import { Icons } from '../../Icons'

// 侧边聊天头部下拉用的最小会话投影：解耦 SideChatPanel 与完整 Session 类型，
// 由 ChatView 把 sessions 投影成该结构后注入。id 用 string 而非 SessionId brand，
// 既避免这里反向依赖 @spark/protocol，也保持 onSelect 回传值可被 ChatView 安全 cast 回 SessionId。
export type SideChatSessionOption = {
  id: string
  title: string
  status?: string | null
  messageCount?: number
  pinned?: boolean
}

export type UnifiedSidePanelKind = 'config' | 'terminal' | 'side-chat' | 'review' | 'plan'

// 配置入口已上移到会话头部按钮组；统一面板只保留终端/侧聊/审查/计划 4 个 tab。
const UNIFIED_SIDE_PANEL_QUICK_ITEMS: UnifiedSidePanelKind[] = [
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
  const openedTabs = Array.from(new Set(tabs))
  const selectedTab =
    activeTab != null && openedTabs.includes(activeTab) ? activeTab : (openedTabs[0] ?? null)
  const openKind = (kind: UnifiedSidePanelKind) => {
    if (openedTabs.includes(kind)) onSelect(kind)
    else onOpen(kind)
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
      <div
        className="unified-side-panel-tabbar"
        onDoubleClick={(event) => {
          // 点击落在任意按钮或关闭叉号上时不触发最大化，避免误触；
          // 仅 tabbar 空白与无 onClick 的激活标签条充当标题栏。
          if (
            event.target instanceof Element &&
            event.target.closest('button, .unified-side-panel-tab-close')
          ) {
            return
          }
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }}
      >
        <div
          className="unified-side-panel-active-tab"
          role="tablist"
          aria-label="unified side panel tabs"
        >
          {openedTabs.map((kind) => {
            const meta = getUnifiedSidePanelMeta(kind)
            const active = kind === selectedTab
            return (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={active}
                data-tab-kind={kind}
                className={`unified-side-panel-tab${active ? ' active' : ''}`}
                title={meta.title}
                onClick={() => onSelect(kind)}
              >
                {meta.icon}
                <span>{meta.label}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className="unified-side-panel-tab-close"
                  aria-label={`关闭${meta.label}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onCloseTab(kind)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      onCloseTab(kind)
                    }
                  }}
                >
                  <Icons.X size={10} />
                </span>
              </button>
            )
          })}
        </div>
        <div className="unified-side-panel-shortcuts" aria-label="侧边面板快捷入口">
          {UNIFIED_SIDE_PANEL_QUICK_ITEMS.map((kind) => {
            const meta = getUnifiedSidePanelMeta(kind)
            const opened = openedTabs.includes(kind)
            const active = kind === selectedTab
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
          {pickerOpen && (
            <UnifiedSidePanelMenu
              onOpen={openKind}
              onSelect={onSelect}
              openedTabs={openedTabs}
              compact
            />
          )}
        </div>
      </div>
      <div className="unified-side-panel-content">
        {selectedTab == null ? (
          <div className="unified-side-panel-empty" role="status" aria-live="polite">
            <div className="unified-side-panel-empty-title">快捷打开</div>
            <div className="unified-side-panel-empty-cards">
              {UNIFIED_SIDE_PANEL_QUICK_ITEMS.map((kind) => {
                const meta = getUnifiedSidePanelMeta(kind)
                const opened = openedTabs.includes(kind)
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`unified-side-panel-empty-card ${opened ? 'opened' : ''}`}
                    aria-label={meta.shortcutLabel}
                    title={meta.shortcutLabel}
                    onClick={() => (opened ? onSelect(kind) : openKind(kind))}
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
  onSelect,
  openedTabs = [],
  compact = false,
}: {
  onOpen: (kind: UnifiedSidePanelKind) => void
  onSelect?: (kind: UnifiedSidePanelKind) => void
  openedTabs?: UnifiedSidePanelKind[]
  compact?: boolean
}) {
  const items = UNIFIED_SIDE_PANEL_QUICK_ITEMS
  return (
    <div className={`unified-side-panel-menu ${compact ? 'compact' : ''}`}>
      {items.map((kind) => {
        const meta = getUnifiedSidePanelMeta(kind)
        const opened = openedTabs.includes(kind)
        return (
          <button
            key={kind}
            type="button"
            className="unified-side-panel-menu-item"
            onClick={() => {
              if (opened) onSelect?.(kind)
              else onOpen(kind)
            }}
          >
            {meta.icon}
            <span>{meta.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// 侧边聊天头部「会话切换 + 新建」下拉。
// 样式复用 canvas 头部 SessionPickerInline 的 composer-menu / composer-session-menu，
// 仅渲染逻辑按侧边聊天的「单会话模型」裁剪：触发器始终显示当前会话标题，
// 顶部"新建会话"项走 onCreate（replace 新建），列表项走 onSelect（纯切换）。
function SideChatSessionDropdown({
  sessions,
  currentSessionId,
  disabledSessionId,
  creating,
  onSelect,
  onCreate,
}: {
  sessions: SideChatSessionOption[]
  currentSessionId: string | null
  disabledSessionId?: string | null
  creating: boolean
  onSelect: (id: string) => void
  onCreate: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const current = sessions.find((session) => session.id === currentSessionId) ?? null
  // 按标题做大小写不敏感的子串过滤；空查询直接返回全量，跳过额外开销。
  const trimmedQuery = query.trim().toLowerCase()
  // 过滤后置顶项排在前面：搜索时也保持置顶优先，避免用户翻找。
  const visibleSessions = (trimmedQuery
    ? sessions.filter((session) => (session.title || '未命名会话').toLowerCase().includes(trimmedQuery))
    : sessions
  )
    .slice()
    .sort((a, b) => {
      const ap = a.pinned ? 1 : 0
      const bp = b.pinned ? 1 : 0
      return bp - ap
    })
  const triggerLabel = creating
    ? '创建中…'
    : current != null
      ? current.title || '未命名会话'
      : '侧边聊天'
  return (
    <Dropdown
      menu={{ items: [] }}
      open={open}
      trigger={['click']}
      placement="bottomLeft"
      onOpenChange={(nextOpen) => {
        // 创建中不允许展开下拉，避免在还没有 current session 时切换。
        setOpen(creating ? false : nextOpen)
        if (!nextOpen) setQuery('')
      }}
      popupRender={() => (
        <div className="composer-menu composer-session-menu side-chat-session-menu">
          <div className="side-chat-session-menu-search">
            <Icons.Search size={14} />
            <input
              autoFocus
              value={query}
              placeholder="搜索会话"
              aria-label="搜索会话"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
            {query && (
              <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
                <Icons.X size={13} />
              </button>
            )}
          </div>
          <div className="side-chat-session-menu-list">
            <button
              type="button"
              className="composer-menu-item canvas-session-new"
              onClick={() => {
                setOpen(false)
                setQuery('')
                onCreate()
              }}
            >
              <span className="composer-menu-item-copy">
                <span className="composer-menu-item-label">
                  <Icons.MessageSquarePlus size={13} />
                  <span>新建会话</span>
                </span>
              </span>
            </button>
            <div className="composer-menu-divider" />
            {visibleSessions.length === 0 ? (
              <div className="composer-menu-empty">
                {sessions.length === 0 ? '当前项目暂无其他会话' : '没有匹配的会话'}
              </div>
            ) : (
              visibleSessions.map((session) => {
                const active = session.id === currentSessionId
                const disabled = session.id === disabledSessionId
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`composer-menu-item side-chat-session-menu-item ${active ? 'active' : ''} ${disabled ? 'is-disabled' : ''}`}
                    disabled={disabled}
                    title={disabled ? '主区正在显示该会话' : undefined}
                    onClick={() => {
                      if (disabled) return
                      setOpen(false)
                      setQuery('')
                      onSelect(session.id)
                    }}
                  >
                    <span className="composer-menu-item-copy">
                      <span className="composer-menu-item-label">
                        <Icons.MessageSquare size={13} />
                        <span>{session.title || '未命名会话'}</span>
                        {session.status === 'running' && <span className="composer-menu-item-tag">运行中</span>}
                        {disabled && <span className="composer-menu-item-tag muted">主区当前</span>}
                      </span>
                    </span>
                    {active && <Icons.Check size={14} className="composer-menu-check" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    >
      <button
        type="button"
        className="side-chat-panel-session-trigger"
        title="切换会话 / 新建会话"
        disabled={creating}
      >
        <Icons.MessageSquare size={14} />
        <span className="side-chat-panel-session-label">{triggerLabel}</span>
        <Icons.ChevronDown size={12} />
      </button>
    </Dropdown>
  )
}

export function SideChatPanel({
  agentStatus,
  creating,
  width,
  onWidthChange,
  onClose,
  onNew,
  sessions,
  currentSessionId,
  disabledSessionId,
  onSelectSession,
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
  sessions: SideChatSessionOption[]
  currentSessionId: string | null
  disabledSessionId?: string | null
  onSelectSession: (id: string) => void
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
        <SideChatSessionDropdown
          sessions={sessions}
          currentSessionId={currentSessionId}
          disabledSessionId={disabledSessionId ?? null}
          creating={creating}
          onSelect={onSelectSession}
          onCreate={onNew}
        />
        <div className="side-chat-panel-header-actions">
          <button className="icon-btn" aria-label="关闭侧边聊天" title="关闭" onClick={onClose}>
            <Icons.X size={14} />
          </button>
        </div>
      </div>
      <div className="side-chat-panel-content">{children}</div>
    </aside>
  )
}
