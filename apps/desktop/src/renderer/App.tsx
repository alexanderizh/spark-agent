import React, { useEffect, useCallback, useRef, useState } from 'react'
import {
  AppProvider,
  useApp,
  PRIMARIES,
  FLOATING_SIDEBAR_WIDTH_MIN,
  FLOATING_SIDEBAR_WIDTH_MAX,
} from './design/AppContext'
import { SessionSidebarProvider, useSessionSidebar } from './design/SessionSidebarContext'
import { ToastProvider, ToastContainer, useToast } from './design/components/Toast'
import { ErrorBoundary } from './design/components/ErrorBoundary'
import { AvatarImage } from './design/components/AvatarImage'
import { getUserAvatarConfig, resolveAvatarSrc } from './design/avatar'
import type { PermissionApprovalRequest, SessionId, UserQuestionPrompt } from '@spark/protocol'
import { useGlobalShortcuts } from './design/hooks/useKeyboard'
import { useAppearanceEffects } from './design/hooks/useAppearance'

import { ChatView } from './design/views/ChatView'
import { ProjectView } from './design/views/ProjectView'
import { WorkflowView } from './design/views/WorkflowView'
import { AgentsView } from './design/views/AgentsView'
import { BoardView } from './design/views/BoardView'
import { ScheduledTasksView } from './design/views/ScheduledTasksView'
import { McpView } from './design/views/McpView'
import { SkillStoreView } from './design/views/SkillStoreView'
import { SettingsView, ProfileEditModal } from './design/views/SettingsView'
import ProvidersView from './design/views/ProvidersView'
import { BrowserPanelView } from './design/views/BrowserPanelView'
import { CommandPalette, PermissionModal } from './design/views/overlays'
import { SidebarExpandButton } from './design/SidebarExpandButton'
import { SidebarSessionList } from './design/SidebarSessionList'
import { Icons } from './design/Icons'
import './FloatingSidebar.less'
import sparkLogo from './assets/spark-logo.png'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@spark/ui-kit'

const sparkPlatform = typeof window !== 'undefined' ? window.spark?.platform : undefined
const isPlatformDarwin = sparkPlatform === 'darwin'
const isPlatformWin32 = sparkPlatform === 'win32'
const SETTINGS_GENERAL_KEY = 'spark-settings-general'
const SETTINGS_UPDATED_EVENT = 'spark-settings-updated'

type UserQuestionRequest = {
  questionId: string
  sessionId: string
  questions: UserQuestionPrompt[]
}

function SparkLogoMark() {
  return (
    <img
      src={sparkLogo}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  )
}

function useSidebarUserAvatarSrc(): string {
  const readLocal = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_GENERAL_KEY)
      if (raw == null) return resolveAvatarSrc(getUserAvatarConfig(null))
      return resolveAvatarSrc(getUserAvatarConfig((JSON.parse(raw) as Record<string, unknown>).userAvatar))
    } catch {
      return resolveAvatarSrc(getUserAvatarConfig(null))
    }
  }, [])
  const [src, setSrc] = useState(readLocal)

  useEffect(() => {
    let cancelled = false
    window.spark
      ?.invoke('settings:get', { category: 'general', key: 'data' })
      .then((res) => {
        if (cancelled) return
        const value = res.value != null && typeof res.value === 'object'
          ? (res.value as Record<string, unknown>).userAvatar
          : null
        setSrc(resolveAvatarSrc(getUserAvatarConfig(value)))
      })
      .catch(() => {})

    const refresh = () => setSrc(readLocal())
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SETTINGS_GENERAL_KEY) refresh()
    }
    const handleSettingsUpdated = (event: Event) => {
      const { detail } = event as CustomEvent<{ key?: string }>
      if (detail?.key === SETTINGS_GENERAL_KEY) refresh()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(SETTINGS_UPDATED_EVENT, handleSettingsUpdated)
    return () => {
      cancelled = true
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(SETTINGS_UPDATED_EVENT, handleSettingsUpdated)
    }
  }, [readLocal])

  return src
}

function useSidebarUserName(): string {
  const readLocal = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_GENERAL_KEY)
      if (raw == null) return 'User'
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return typeof parsed.userName === 'string' && parsed.userName.trim() ? parsed.userName : 'User'
    } catch {
      return 'User'
    }
  }, [])
  const [name, setName] = useState(readLocal)

  useEffect(() => {
    let cancelled = false
    window.spark
      ?.invoke('settings:get', { category: 'general', key: 'data' })
      .then((res) => {
        if (cancelled) return
        if (res.value != null && typeof res.value === 'object') {
          const userName = (res.value as Record<string, unknown>).userName
          if (typeof userName === 'string' && userName.trim()) {
            setName(userName)
          }
        }
      })
      .catch(() => {})

    const refresh = () => setName(readLocal())
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SETTINGS_GENERAL_KEY) refresh()
    }
    const handleSettingsUpdated = (event: Event) => {
      const { detail } = event as CustomEvent<{ key?: string }>
      if (detail?.key === SETTINGS_GENERAL_KEY) refresh()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(SETTINGS_UPDATED_EVENT, handleSettingsUpdated)
    return () => {
      cancelled = true
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(SETTINGS_UPDATED_EVENT, handleSettingsUpdated)
    }
  }, [readLocal])

  return name
}

/* ---------- WindowControls — custom title bar buttons (Windows/Linux only) ---------- */
function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const api = window.spark
        if (!api?.invoke) return
        const res = await api.invoke('window:is-maximized', {})
        if (res?.maximized != null) setIsMaximized(res.maximized)
      } catch {
        // ignore window chrome state errors in test and preview environments
      }
    })()
  }, [])

  const handleMinimize = useCallback(() => {
    window.spark?.invoke?.('window:minimize', {}).catch(() => {})
  }, [])

  const handleMaximize = useCallback(async () => {
    try {
      const res = await window.spark?.invoke?.('window:maximize', {})
      if (res?.maximized != null) setIsMaximized(res.maximized)
    } catch { /* ignore */ }
  }, [])

  const handleClose = useCallback(() => {
    window.spark?.invoke?.('window:close', {}).catch(() => {})
  }, [])

  return (
    <div className="window-controls">
      <button className="win-ctrl-btn minimize" onClick={handleMinimize} title="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button className="win-ctrl-btn maximize" onClick={handleMaximize} title={isMaximized ? 'Restore' : 'Maximize'}>
        {isMaximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="0" y="2" width="8" height="8" fill="var(--panel-elev)" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button className="win-ctrl-btn close" onClick={handleClose} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  )
}

const NAV_ITEMS: Array<{ id: string; label: string; icon: React.FC<{ size?: number }> }> = [
  { id: 'agents', label: 'Agents', icon: Icons.Bot },
  { id: 'board', label: 'Board', icon: Icons.Board },
  { id: 'providers', label: 'Providers', icon: Icons.Server },
  { id: 'skill-store', label: 'Skills', icon: Icons.Skills },
  { id: 'workflows', label: 'Workflows', icon: Icons.Workflow },
  { id: 'scheduled-tasks', label: 'Tasks', icon: Icons.Clock },
]

/* ---------- FloatingSidebar — navigation menu + full session list ---------- */
function FloatingSidebar({ onNewTask }: { onNewTask: () => void }) {
  const { t, setTweak } = useApp()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [navExpanded, setNavExpanded] = useState(false)
  const userAvatarSrc = useSidebarUserAvatarSrc()
  const userName = useSidebarUserName()
  const isResizing = useRef(false)

  const navItem = (viewId: string, title: string, Icon: React.FC<{ size?: number }>) => {
    const isActive = t.view === viewId
    return (
      <button
        className={`nav-item ${isActive ? 'active' : ''}`}
        onClick={() => setTweak('view', viewId as typeof t.view)}
        title={title}
      >
        <span className="nav-icon"><Icon /></span>
        <span className="nav-label">{title}</span>
      </button>
    )
  }

  const VISIBLE_COUNT = 3 // nav items visible before fold (excludes "新建任务")
  const visibleItems = NAV_ITEMS.slice(0, VISIBLE_COUNT)
  const collapsedItems = NAV_ITEMS.slice(VISIBLE_COUNT)
  const hasCollapsed = collapsedItems.length > 0

  // Resize handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isResizing.current = true
      const startX = e.clientX
      const startWidth = t.floatingSidebarWidth
      document.body.classList.add('floating-sidebar-resizing')

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current) return
        const delta = ev.clientX - startX
        const next = Math.min(
          FLOATING_SIDEBAR_WIDTH_MAX,
          Math.max(FLOATING_SIDEBAR_WIDTH_MIN, startWidth + delta),
        )
        setTweak('floatingSidebarWidth', next)
      }

      const handleMouseUp = () => {
        isResizing.current = false
        document.body.classList.remove('floating-sidebar-resizing')
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [t.floatingSidebarWidth, setTweak],
  )

  const handleHideSidebar = useCallback(() => {
    setTweak('sidebarHidden', true)
  }, [setTweak])

  if (t.sidebarHidden) return null

  return (
    <div
      className="floating-sidebar"
      style={{ '--sidebar-w': `${t.floatingSidebarWidth}px` } as React.CSSProperties}
    >
      {/* Drag region */}
      <div className="floating-sidebar-drag" />

      {/* Panel header: logo + hide button, right-aligned */}
      <div className="floating-sidebar-header">
        <div className="floating-sidebar-brand" />
        {/* <div className="sidebar-logo"><SparkLogoMark /></div> */}
        <button
          className="icon-btn sidebar-hide-btn"
          onClick={handleHideSidebar}
          title="隐藏菜单栏"
        >
          <Icons.SidebarHide size={15} />
        </button>
      </div>

      {/* New Task button — replaces the previous search/command bar.
          Clicking it clears the active session/workspace and enters chat in fresh
          "new conversation" state. Styled as a regular nav item to stay
          consistent with Workflows/Agents/Skills/Providers. */}
      <div className="sidebar-nav-section">
        <button
          className="nav-item"
          onClick={onNewTask}
          title="新建任务"
        >
          <span className="nav-icon"><Icons.Plus /></span>
          <span className="nav-label">新建任务</span>
        </button>
      </div>

      {/* ── Navigation items (no Chat, no dividers between) ── */}
      <div className="sidebar-nav-section">
        {visibleItems.map((item) => navItem(item.id, item.label, item.icon))}
        {hasCollapsed && (
          <div className={`nav-collapsed${navExpanded ? ' nav-collapsed-expanded' : ''}`}>
            <div className="nav-collapsed-inner">
              {collapsedItems.map((item) => navItem(item.id, item.label, item.icon))}
            </div>
          </div>
        )}
        {hasCollapsed && (
          <button
            className="nav-expand-toggle"
            onClick={() => setNavExpanded((v) => !v)}
            title={navExpanded ? '收起' : '展开更多'}
          >
            <span className={`nav-expand-icon${navExpanded ? ' nav-expand-icon-up' : ''}`}>
              <Icons.ChevronDown size={12} />
            </span>
            <span className="nav-label">{navExpanded ? '收起' : '展开更多'}</span>
          </button>
        )}
      </div>

      {/* ── Divider between nav and session list ── */}
      <div className="sidebar-session-divider" />

      {/* ── Full session list (exact same functionality as original ChatView sidebar) ── */}
      <div className="sidebar-session-list">
        <SidebarSessionList />
      </div>

      {/* Bottom area: user + window controls */}
      <div className="sidebar-bottom">
        <DropdownMenu open={userMenuOpen} onOpenChange={setUserMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button className="sidebar-user" style={{ cursor: 'pointer' }}>
              <div className="avatar sidebar-user-avatar">
                <AvatarImage
                  src={userAvatarSrc}
                  seed="spark-user"
                  name="User"
                  alt="用户头像"
                  className="sidebar-user-avatar-image"
                />
              </div>
              <div className="sidebar-user-info">
                <div className="name">{userName}</div>
                <div className="meta">Local · Desktop</div>
              </div>
              <Icons.ChevronDown size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="user-menu user-menu-portal">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="user-menu-theme-trigger">
                <Icons.Sun size={14} /> Theme
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="user-menu user-menu-theme-sub flex">
                <DropdownMenuRadioGroup
                  value={t.theme}
                  onValueChange={(v) => {
                    setTweak('theme', v as typeof t.theme)
                  }}
                >
                  <DropdownMenuRadioItem value="light">
                    <Icons.Sun size={14} /> Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <Icons.Moon size={14} /> Dark
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <Icons.Monitor size={14} /> System
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => { setTweak('view', 'settings'); setUserMenuOpen(false) }}>
              <Icons.Settings size={14} /> Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Linux: custom HTML controls in sidebar. Windows/macOS use their own title bars. */}
        {!isPlatformDarwin && !isPlatformWin32 && <WindowControls />}
      </div>

      {/* Resize handle on the right edge */}
      <div
        className="floating-sidebar-resize-handle"
        onMouseDown={handleResizeStart}
      />
    </div>
  )
}

function Shell() {
  const { t, setTweak } = useApp()
  const { toast } = useToast()
  const scaleRef = useRef<HTMLDivElement>(null)
  useAppearanceEffects()
  const [approvalRequests, setApprovalRequests] = useState<Record<string, PermissionApprovalRequest>>({})
  const [userQuestions, setUserQuestions] = useState<Record<string, UserQuestionRequest>>({})

  // Shared "start a brand new conversation" handler.
  // - Clears any active session/workspace so the chat view renders in fresh
  //   "new conversation" state.
  // - Used by both the sidebar "新建任务" button and the Cmd+N keyboard
  //   shortcut so they stay in lockstep.
  const sessionCtx = useSessionSidebar()
  const activeSessionRef = useRef(sessionCtx.activeSessionId)
  const viewRef = useRef(t.view)
  const chatModeRef = useRef(t.chatMode)

  useEffect(() => {
    activeSessionRef.current = sessionCtx.activeSessionId
  }, [sessionCtx.activeSessionId])

  useEffect(() => {
    viewRef.current = t.view
    chatModeRef.current = t.chatMode
  }, [t.chatMode, t.view])

  const handleNewBlankSession = useCallback(() => {
    sessionCtx.setActiveSession(null)
    sessionCtx.setActiveWorkspace(null)
    setTweak('view', 'chat')
  }, [sessionCtx, setTweak])

  const navigateToSession = useCallback((sessionId: string) => {
    const targetSession = sessionCtx.sessions.find((session) => session.id === sessionId) ?? null
    sessionCtx.setActiveSession(sessionId as SessionId)
    if (targetSession?.workspaceIds?.[0] != null) {
      sessionCtx.setActiveWorkspace(targetSession.workspaceIds[0])
    }
    setTweak('view', 'chat')
  }, [sessionCtx, setTweak])

  const dismissApprovalRequest = useCallback((sessionId: string, requestId?: string) => {
    setApprovalRequests((current) => {
      const existing = current[sessionId]
      if (existing == null) return current
      if (requestId != null && existing.requestId !== requestId) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }, [])

  const dismissUserQuestion = useCallback((sessionId: string, questionId?: string) => {
    setUserQuestions((current) => {
      const existing = current[sessionId]
      if (existing == null) return current
      if (questionId != null && existing.questionId !== questionId) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }, [])

  // Global error handlers
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error
        ? event.reason.message
        : String(event.reason)
      toast.error(`未捕获的异步错误: ${message}`, {
        duration: 8000,
        actions: [{ label: '查看详情', onClick: () => console.error('Unhandled rejection:', event.reason) }],
      })
      event.preventDefault()
    }

    const handleWindowError = (event: ErrorEvent) => {
      if (event.message?.includes('ResizeObserver loop')) return
      const message = event.message || 'Unknown error'
      toast.error(`运行时错误: ${message}`, {
        duration: 8000,
        actions: [{ label: '查看详情', onClick: () => console.error('Window error:', event.error) }],
      })
    }

    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    window.addEventListener('error', handleWindowError)
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      window.removeEventListener('error', handleWindowError)
    }
  }, [toast])

  // IPC error listener
  useEffect(() => {
    const handleIpcError = (event: CustomEvent<{ channel: string; error: string }>) => {
      const { channel, error: errMsg } = event.detail
      toast.error(`IPC 错误 [${channel}]: ${errMsg}`, { duration: 6000 })
    }
    window.addEventListener('spark:ipc-error', handleIpcError as EventListener)
    return () => {
      window.removeEventListener('spark:ipc-error', handleIpcError as EventListener)
    }
  }, [toast])

  // Auto-scale 1440x900 -> viewport
  useEffect(() => {
    const el = scaleRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      const sx = el.offsetWidth / 1440
      const sy = el.offsetHeight / 900
      const s = Math.min(sx, sy)
      el.style.setProperty('--scale', String(s))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Navigation handler for command palette
  const handleNavigate = useCallback((view: string) => {
    if (view === '__toggleSidebar') return
    setTweak('view', view as typeof t.view)
  }, [setTweak])

  // Global keyboard shortcuts.
  // The "newSession" shortcut (Cmd/Ctrl+N) now behaves the same as the sidebar
  // "新建任务" button: it clears the active session and enters a fresh chat.
  useGlobalShortcuts({
    setTweak: setTweak as (key: string, val: unknown) => void,
    onNewSession: handleNewBlankSession,
    hasOverlayOpen: () => t.showPalette || t.showPerm || t.showProviderEdit || t.showProfileEdit,
  })

  // Listen for tool approval requests
  useEffect(() => {
    const api = window.spark
    if (!api?.on) return
    return api.on('stream:permission:approval-request', (req) => {
      setApprovalRequests((current) => ({ ...current, [req.sessionId]: req }))
      api.invoke?.('hook:trigger', {
        sessionId: req.sessionId,
        node: 'permission_request',
        title: 'Spark Agent - 权限请求',
        body: 'Agent 正在等待您的审批',
      }).catch(() => {})

      const isVisibleInCurrentSession =
        viewRef.current === 'chat' &&
        chatModeRef.current !== 'workspace' &&
        activeSessionRef.current === req.sessionId
      if (isVisibleInCurrentSession) return

      toast.warning('有新的权限审批等待处理', {
        duration: 8000,
        actions: [{ label: '前往审批', onClick: () => navigateToSession(req.sessionId) }],
      })
    })
  }, [navigateToSession, toast])

  useEffect(() => {
    const api = window.spark
    if (!api?.on) return
    return api.on('stream:session:user-question', (req) => {
      setUserQuestions((current) => ({ ...current, [req.sessionId]: req }))

      const isVisibleInCurrentSession =
        viewRef.current === 'chat' &&
        chatModeRef.current !== 'workspace' &&
        activeSessionRef.current === req.sessionId
      if (isVisibleInCurrentSession) return

      toast.info('有会话需要您补充信息', {
        duration: 8000,
        actions: [{ label: '前往回答', onClick: () => navigateToSession(req.sessionId) }],
      })
    })
  }, [navigateToSession, toast])

  const primary = t.primary
  const info = PRIMARIES[primary]

  // Resolve the effective theme for CSS class (system → light/dark)
  const resolvedTheme = t.theme === 'system'
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : t.theme

  const activeApprovalRequest =
    sessionCtx.activeSessionId != null ? approvalRequests[sessionCtx.activeSessionId] ?? null : null
  const activeUserQuestion =
    sessionCtx.activeSessionId != null ? userQuestions[sessionCtx.activeSessionId] ?? null : null

  const showInlineApproval = t.view === 'chat' && t.chatMode !== 'workspace'
  // Default view is chat (no more home). Render elements directly so the chat
  // tree keeps a stable component identity across Shell re-renders.
  const viewElement = (() => {
    switch (t.view) {
      case 'chat':
        return t.chatMode === 'workspace'
          ? <ProjectView />
          : (
            <ChatView
              approvalRequest={activeApprovalRequest}
              onApprovalClose={dismissApprovalRequest}
              userQuestion={activeUserQuestion}
              onUserQuestionClose={dismissUserQuestion}
            />
          )
      case 'workflows':
        return <WorkflowView />
      case 'agents':
        return <AgentsView />
      case 'board':
        return <BoardView />
      case 'scheduled-tasks':
        return <ScheduledTasksView />
      case 'skills':
        return <SkillStoreView />
      case 'skill-store':
        return <SkillStoreView />
      case 'providers':
        return <ProvidersView />
      case 'settings':
        return <SettingsView />
      default:
        return (
          <ChatView
            approvalRequest={activeApprovalRequest}
            onApprovalClose={dismissApprovalRequest}
            userQuestion={activeUserQuestion}
            onUserQuestionClose={dismissUserQuestion}
          />
        )
    }
  })()

  // Compute dynamic margin for main content area based on sidebar state
  const sidebarOffset = t.sidebarHidden
    ? 0
    : t.floatingSidebarWidth + 16 // sidebar width + left-gap(10px) + right-gap(6px)

  return (
    <ErrorBoundary level="global" name="Shell">
    <div
      ref={scaleRef}
      className={`app window theme-${resolvedTheme} density-${t.density} platform-${sparkPlatform ?? 'unknown'}${t.sidebarHidden ? ' sidebar-hidden' : ''}`}
      style={
        {
          '--primary': primary,
          '--primary-hover': info?.hover ?? primary,
          '--primary-soft': info?.soft ?? 'rgba(99,102,241,0.12)',
          '--sidebar-offset': `${sidebarOffset}px`,
        } as React.CSSProperties
      }
    >
      <FloatingSidebar onNewTask={handleNewBlankSession} />

      <div className="main-content-area">
        {/* Windows: custom title bar spanning full width with drag region */}
        {isPlatformWin32 && (
          <div className="win-titlebar">
            {t.sidebarHidden && <SidebarExpandButton />}
            <div className="win-titlebar-controls">
              <WindowControls />
            </div>
          </div>
        )}
        <div className="main">
          {t.view !== 'chat' && !isPlatformWin32 && (
            <div
              className="transparent-header"
              onDoubleClick={() => { window.spark?.invoke('window:maximize', {}).catch(() => {}) }}
            >
              {t.sidebarHidden && <SidebarExpandButton />}
            </div>
          )}
          <div className="view-body" style={{ display: 'flex', flexDirection: 'column' }}>
            {viewElement}
          </div>
        </div>
        {t.view === 'chat' && <BrowserPanelView />}
      </div>

      {/* Overlays */}
      {t.showPalette && (
        <CommandPalette
          onClose={() => setTweak('showPalette', false)}
          onNavigate={handleNavigate}
          onNewSession={handleNewBlankSession}
        />
      )}
      {t.showPerm && <PermissionModal request={{ requestId: 'preview', sessionId: 'preview-session', toolName: 'write_file', action: 'file_write', toolInput: {}, riskLevel: 'medium', persistentScopes: ['global'] }} onClose={() => setTweak('showPerm', false)} />}

      {t.showProfileEdit && <ProfileEditModal onClose={() => setTweak('showProfileEdit', false)} />}

      <ToastContainer />
    </div>
    </ErrorBoundary>
  )
}

export function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <SessionSidebarProvider>
          <Shell />
        </SessionSidebarProvider>
      </ToastProvider>
    </AppProvider>
  )
}
