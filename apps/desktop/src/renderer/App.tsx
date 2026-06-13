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
import { LobeThemeProvider } from './design/theme/LobeThemeProvider'
import { getGuestAvatarConfig, getUserAvatarConfig, resolveAvatarSrc } from './design/avatar'
import { AuthProvider, useAuth } from './design/auth/AuthContext'
import type { PermissionApprovalRequest, SessionId, UpdateStatus, UserQuestionPrompt } from '@spark/protocol'
import { useGlobalShortcuts } from './design/hooks/useKeyboard'
import { useAppearanceEffects } from './design/hooks/useAppearance'

import { ChatView } from './design/views/ChatView'
import { ProjectView } from './design/views/ProjectView'
import { WorkflowView } from './design/views/WorkflowView'
import { AgentsView } from './design/views/AgentsView'
import { BoardView } from './design/views/BoardView'
import { CanvasProjectsView } from './design/views/canvas/CanvasProjectsView'
import { ScheduledTasksView } from './design/views/ScheduledTasksView'
import { McpView } from './design/views/McpView'
import { SkillStoreView } from './design/views/SkillStoreView'
import { SettingsView, ProfileEditModal } from './design/views/SettingsView'
import ProvidersView from './design/views/ProvidersView'
import { LobePreviewView } from './design/theme/LobePreviewView'
import { BrowserPanelView } from './design/views/BrowserPanelView'
import { CommandPalette, PermissionModal } from './design/views/overlays'
import { SidebarExpandButton } from './design/SidebarExpandButton'
import { SidebarSessionList } from './design/SidebarSessionList'
import { Icons } from './design/Icons'
import { useI18n, type TranslationKey } from './design/i18n'
import './FloatingSidebar.less'
import sparkLogo from './assets/spark-logo.png'
import { Dropdown, type MenuProps } from 'antd'

const sparkPlatform = typeof window !== 'undefined' ? window.spark?.platform : undefined
const isPlatformDarwin = sparkPlatform === 'darwin'
const isPlatformWin32 = sparkPlatform === 'win32'
const downloadedUpdateActionLabel = isPlatformDarwin ? '打开安装镜像' : '安装更新'
const REPOSITORY_URL = 'https://github.com/alexanderizh/spark-agent'
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

function CircularProgressGlyph({
  progress,
}: {
  progress: number
}) {
  const clamped = Math.max(0, Math.min(100, progress))
  const radius = 9
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - clamped / 100)

  return (
    <span className="sidebar-update-progress-ring" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <circle className="sidebar-update-progress-track" cx="12" cy="12" r={radius} />
        <circle
          className="sidebar-update-progress-value"
          cx="12"
          cy="12"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
    </span>
  )
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

const NAV_ITEMS: Array<{ id: string; labelKey: TranslationKey; icon: React.FC<{ size?: number }> }> = [
  { id: 'agents', labelKey: 'nav.agents', icon: Icons.Bot },
  { id: 'providers', labelKey: 'nav.providers', icon: Icons.Server },
  { id: 'skill-store', labelKey: 'nav.skills', icon: Icons.Skills },
  { id: 'scheduled-tasks', labelKey: 'nav.tasks', icon: Icons.Clock },
  { id: 'mcp', labelKey: 'nav.mcp', icon: Icons.MCP },
  { id: 'board', labelKey: 'nav.board', icon: Icons.Board },
  { id: 'workflows', labelKey: 'nav.workflows', icon: Icons.Workflow },
  { id: 'canvas', labelKey: 'nav.canvas', icon: Icons.Canvas },
]

/* ---------- FloatingSidebar — navigation menu + full session list ---------- */
function FloatingSidebar({ onNewTask }: { onNewTask: () => void }) {
  const { t, setTweak } = useApp()
  const { t: tr } = useI18n()
  const auth = useAuth()
  const { setHistoryImportOpen } = useSessionSidebar()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [navExpanded, setNavExpanded] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  // 已登录时使用云端用户头像/昵称；未登录时使用产品 logo（白底）作为占位
  const userAvatarSrc = auth.isAuthenticated
    ? (auth.user?.avatarUrl || resolveAvatarSrc(getUserAvatarConfig(null)))
    : resolveAvatarSrc(getGuestAvatarConfig())
  const userName = auth.isAuthenticated
    ? (auth.user?.nickname || auth.user?.account || '用户')
    : '未登录'
  const isResizing = useRef(false)

  useEffect(() => {
    let cancelled = false
    window.spark?.invoke('update:get-status', {}).then((res) => {
      if (!cancelled) setUpdateStatus(res.status)
    }).catch(() => {})
    const unsub = window.spark?.on('stream:update:status', (payload) => {
      setUpdateStatus(payload)
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

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
  const resolvedNavItems = NAV_ITEMS.map((item) => ({ ...item, label: tr(item.labelKey) }))
  const visibleItems = resolvedNavItems.slice(0, VISIBLE_COUNT)
  const collapsedItems = resolvedNavItems.slice(VISIBLE_COUNT)
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

  const handleOpenExternal = useCallback((url: string) => {
    void window.spark?.invoke('browser:open-external', { url })
    setUserMenuOpen(false)
  }, [])

  const updateState = updateStatus?.state ?? 'idle'
  const updateProgressPercent = updateStatus?.progress?.percent ?? 0
  const handleUpdateClick = useCallback(() => {
    if (updateState === 'checking') return
    if (updateState === 'available') {
      void window.spark?.invoke('update:download', {})
      return
    }
    if (updateState === 'downloaded') {
      void window.spark?.invoke('update:install-restart', {})
      return
    }
    if (updateState === 'downloading') {
      void setTweak('view', 'settings')
      return
    }
    void window.spark?.invoke('update:check', {})
  }, [setTweak, updateState])

  const getUpdateButtonTitle = () => {
    if (updateState === 'checking') return '正在检查更新'
    if (updateState === 'available') return `发现新版本 ${updateStatus?.updateInfo?.version ?? ''}`.trim()
    if (updateState === 'downloading') {
      const percentLabel = Math.round(updateProgressPercent)
      return `正在下载更新 ${Number.isFinite(percentLabel) ? `${percentLabel}%` : ''}`.trim()
    }
    if (updateState === 'downloaded') return downloadedUpdateActionLabel
    if (updateState === 'error') return `更新异常：${updateStatus?.error ?? '点击重试'}`
    return '检查更新'
  }

  const renderUpdateButtonIcon = () => {
    if (updateState === 'checking') return <Icons.Refresh size={15} className="spin" />
    if (updateState === 'available') return <Icons.Download size={15} />
    if (updateState === 'downloading') {
      return <CircularProgressGlyph progress={updateProgressPercent} />
    }
    if (updateState === 'downloaded') return <Icons.CheckCircle size={15} />
    if (updateState === 'error') return <Icons.AlertTriangle size={15} />
    return <Icons.Refresh size={15} />
  }

  const menuLabel = (
    leading: React.ReactNode,
    text: string,
    checked = false,
  ) => (
    <span className="user-menu-label">
      {leading}
      <span className="user-menu-label-text">{text}</span>
      {checked && <span className="user-menu-check">✓</span>}
    </span>
  )

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
        <div className="sidebar-header-actions">
          <button
            className="icon-btn sidebar-import-btn"
            onClick={() => setHistoryImportOpen(true)}
            title="导入对话历史"
            aria-label="导入对话历史"
          >
            <Icons.Download size={15} />
          </button>
          <button
            className={`icon-btn sidebar-update-btn state-${updateState}`}
            onClick={handleUpdateClick}
            title={getUpdateButtonTitle()}
            aria-label={getUpdateButtonTitle()}
          >
            {renderUpdateButtonIcon()}
            {(updateState === 'available' || updateState === 'downloaded' || updateState === 'error') && (
              <span className="sidebar-update-dot" />
            )}
          </button>
          <button
            className="icon-btn sidebar-hide-btn"
            onClick={handleHideSidebar}
            title="隐藏菜单栏"
          >
            <Icons.SidebarHide size={15} />
          </button>
        </div>
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
        <Dropdown
          open={userMenuOpen}
          onOpenChange={setUserMenuOpen}
          trigger={['click']}
          placement="topRight"
          menu={{
            className: 'user-menu',
            items: [
              ...(auth.isAuthenticated
                ? []
                : [
                    { key: 'login', label: menuLabel(<Icons.User size={14} />, '登录 / 注册') },
                    { type: 'divider' as const },
                  ]),
              {
                key: 'theme',
                label: menuLabel(<Icons.Sun size={14} />, 'Theme'),
                children: [
                  { key: 'theme-light', label: menuLabel(<Icons.Sun size={14} />, 'Light', t.theme === 'light') },
                  { key: 'theme-dark', label: menuLabel(<Icons.Moon size={14} />, 'Dark', t.theme === 'dark') },
                  { key: 'theme-system', label: menuLabel(<Icons.Monitor size={14} />, 'System', t.theme === 'system') },
                  { type: 'divider' as const },
                  {
                    key: 'accent',
                    label: menuLabel(<span className="user-menu-accent-dot" style={{ background: t.primary }} />, '主题色'),
                    children: Object.entries(PRIMARIES).map(([color, info]) => ({
                      key: `accent-${color}`,
                      label: menuLabel(
                        <span className="user-menu-accent-swatch" style={{ background: color }} />,
                        info.name,
                        t.primary === color,
                      ),
                    })),
                  },
                ],
              },
              { type: 'divider' as const },
              { key: 'remote', label: menuLabel(<Icons.Globe size={14} />, '远程连接') },
              { key: 'github', label: menuLabel(<Icons.GitHub size={14} />, 'GitHub') },
              { key: 'settings', label: menuLabel(<Icons.Settings size={14} />, 'Settings') },
              { key: 'lobe-preview', label: menuLabel(<Icons.Layers size={14} />, 'Lobe UI 沙箱') },
            ],
            onClick: ({ key }: { key: string }) => {
              switch (key) {
                case 'login':
                  auth.setFlow('login')
                  setTweak('view', 'settings')
                  setTweak('settingsSection', 'account')
                  break
                case 'theme-light':
                  setTweak('theme', 'light' as typeof t.theme)
                  break
                case 'theme-dark':
                  setTweak('theme', 'dark' as typeof t.theme)
                  break
                case 'theme-system':
                  setTweak('theme', 'system' as typeof t.theme)
                  break
                default:
                  if (key.startsWith('accent-')) {
                    setTweak('primary', key.slice('accent-'.length))
                  } else if (key === 'remote') {
                    setTweak('view', 'settings')
                    setTweak('settingsSection', 'remote-connections')
                  } else if (key === 'github') {
                    handleOpenExternal(REPOSITORY_URL)
                  } else if (key === 'settings') {
                    setTweak('view', 'settings')
                  } else if (key === 'lobe-preview') {
                    setTweak('view', 'lobe-preview')
                  }
              }
              setUserMenuOpen(false)
            },
          } as MenuProps}
        >
          <button
            className={`sidebar-user${auth.isAuthenticated ? '' : ' sidebar-user-guest'}`}
            style={{ cursor: 'pointer' }}
          >
            <div className="avatar sidebar-user-avatar">
              {userAvatarSrc ? (
                <AvatarImage
                  src={userAvatarSrc}
                  seed={auth.user?.account || 'spark-user'}
                  name={userName}
                  alt={auth.isAuthenticated ? '用户头像' : '未登录占位头像'}
                  className={`sidebar-user-avatar-image${auth.isAuthenticated ? '' : ' sidebar-user-avatar-image-guest'}`}
                />
              ) : null}
            </div>
            <div className="sidebar-user-info">
              <div className="name">{userName}</div>
              <div className="meta">
                {auth.isAuthenticated ? '已登录 · Cloud' : '未登录 · 点击登录'}
              </div>
            </div>
            <Icons.ChevronDown size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          </button>
        </Dropdown>
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
    // Keep current workspace so new session inherits the active project context
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
      case 'canvas':
        return <CanvasProjectsView />
      case 'scheduled-tasks':
        return <ScheduledTasksView />
      case 'skills':
        return <SkillStoreView />
      case 'skill-store':
        return <SkillStoreView />
      case 'providers':
        return <ProvidersView />
      case 'mcp':
        return <McpView />
      case 'settings':
        return <SettingsView />
      case 'lobe-preview':
        return <LobePreviewView />
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
            {t.sidebarHidden && t.view !== 'chat' && <SidebarExpandButton />}
            <div className="win-titlebar-controls">
              <WindowControls />
            </div>
          </div>
        )}
        {t.view === 'chat' ? (
          <div className="main-with-browser">
            <div className="main">
              <div className="view-body" style={{ display: 'flex', flexDirection: 'column' }}>
                {viewElement}
              </div>
            </div>
            <BrowserPanelView />
          </div>
        ) : (
          <div className="main">
            {!isPlatformWin32 && t.sidebarHidden && (
              <div
                className="transparent-header"
                onDoubleClick={() => { window.spark?.invoke('window:maximize', {}).catch(() => {}) }}
              >
                <SidebarExpandButton />
              </div>
            )}
            <div className="view-body" style={{ display: 'flex', flexDirection: 'column' }}>
              {viewElement}
            </div>
          </div>
        )}
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
      <LobeThemeBridge>
        <AuthProvider>
          <ToastProvider>
            <SessionSidebarProvider>
              <GateAwareShell />
            </SessionSidebarProvider>
          </ToastProvider>
        </AuthProvider>
      </LobeThemeBridge>
    </AppProvider>
  )
}

/**
 * LobeThemeBridge — 读取 AppContext 的主题/配色,为 antd + lobe-ui 注入 ThemeProvider。
 * 必须放在 AppProvider 内层(读 useApp)。
 */
function LobeThemeBridge({ children }: { children: React.ReactNode }) {
  const { t } = useApp()
  const resolvedTheme: 'light' | 'dark' = t.theme === 'system'
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : (t.theme as 'light' | 'dark')
  return (
    <LobeThemeProvider themeMode={t.theme} resolvedTheme={resolvedTheme} primary={t.primary}>
      {children}
    </LobeThemeProvider>
  )
}

/**
 * 启动期拦截：
 *   - bootstrapping 显示 loading
 *   - 登录是可选的，未登录也进 Shell
 *   - 登录入口在侧边栏底部用户信息处 + 设置-账号页
 */
function GateAwareShell(): React.ReactElement {
  const auth = useAuth()
  if (auth.bootstrapping) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-1, #f7f8fa)',
          fontSize: 13,
          color: 'var(--color-text-3, #86909c)',
        }}
      >
        正在启动 Spark Agent…
      </div>
    )
  }
  return <Shell />
}
