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
import type { PermissionApprovalRequest } from '@spark/protocol'
import { useGlobalShortcuts } from './design/hooks/useKeyboard'

import { ChatView } from './design/views/ChatView'
import { ProjectView } from './design/views/ProjectView'
import { WorkflowView } from './design/views/WorkflowView'
import { AgentsView } from './design/views/AgentsView'
import { McpView } from './design/views/McpView'
import { SkillsView } from './design/views/SkillsView'
import { SkillStoreView } from './design/views/SkillStoreView'
import { SettingsView, ProfileEditModal } from './design/views/SettingsView'
import ProvidersView from './design/views/ProvidersView'
import { BrowserPanelView } from './design/views/BrowserPanelView'
import { CommandPalette, PermissionModal } from './design/views/overlays'
import { SidebarExpandButton } from './design/SidebarExpandButton'
import { SidebarSessionList } from './design/SidebarSessionList'
import { Icons } from './design/Icons'
import sparkLogo from './assets/spark-logo.png'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@spark/ui-kit'

const isPlatformDarwin = typeof window !== 'undefined' && window.spark.platform === 'darwin'
const isPlatformWin32 = typeof window !== 'undefined' && window.spark.platform === 'win32'

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

/* ---------- WindowControls — custom title bar buttons (Windows/Linux only) ---------- */
function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await window.spark.invoke('window:is-maximized', {})
        if (res?.maximized != null) setIsMaximized(res.maximized)
      } catch {
        // ignore window chrome state errors in test and preview environments
      }
    })()
  }, [])

  const handleMinimize = useCallback(() => {
    window.spark.invoke('window:minimize', {}).catch(() => {})
  }, [])

  const handleMaximize = useCallback(async () => {
    try {
      const res = await window.spark.invoke('window:maximize', {})
      setIsMaximized(res.maximized)
    } catch { /* ignore */ }
  }, [])

  const handleClose = useCallback(() => {
    window.spark.invoke('window:close', {}).catch(() => {})
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

/* ---------- FloatingSidebar — navigation menu + full session list ---------- */
function FloatingSidebar({ onNewTask }: { onNewTask: () => void }) {
  const { t, setTweak } = useApp()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
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
        {navItem('workflows', 'Workflows', Icons.Workflow)}
        {navItem('agents', 'Agents', Icons.Bot)}
        {navItem('skill-store', 'Skills', Icons.Skills)}
        {navItem('providers', 'Providers', Icons.Server)}
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
              <div className="avatar">U</div>
              <div className="sidebar-user-info">
                <div className="name">User</div>
                <div className="meta">Local · Desktop</div>
              </div>
              <Icons.ChevronDown size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="user-menu user-menu-portal">
            <DropdownMenuItem onSelect={() => { setTweak('view', 'settings'); setUserMenuOpen(false) }}>
              <Icons.Settings size={14} /> Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Windows uses the system-native title bar; the custom HTML
            controls below are only needed on Linux (frameless window). */}
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
  const [approvalRequest, setApprovalRequest] = useState<PermissionApprovalRequest | null>(null)

  // Shared "start a brand new conversation" handler.
  // - Clears any active session/workspace so the chat view renders in fresh
  //   "new conversation" state.
  // - Used by both the sidebar "新建任务" button and the Cmd+N keyboard
  //   shortcut so they stay in lockstep.
  const sessionCtx = useSessionSidebar()
  const handleNewBlankSession = useCallback(() => {
    sessionCtx.setActiveSession(null)
    sessionCtx.setActiveWorkspace(null)
    setTweak('view', 'chat')
  }, [sessionCtx, setTweak])

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
    return window.spark.on('stream:permission:approval-request', (req) => {
      setApprovalRequest(req)
    })
  }, [])

  const primary = t.primary
  const info = PRIMARIES[primary]

  const showInlineApproval = t.view === 'chat' && t.chatMode !== 'workspace'
  // Default view is chat (no more home). Render elements directly so the chat
  // tree keeps a stable component identity across Shell re-renders.
  const viewElement = (() => {
    switch (t.view) {
      case 'chat':
        return t.chatMode === 'workspace'
          ? <ProjectView />
          : <ChatView approvalRequest={approvalRequest} onApprovalClose={() => setApprovalRequest(null)} />
      case 'workflows':
        return <WorkflowView />
      case 'agents':
        return <AgentsView />
      case 'skills':
        return <SkillsView />
      case 'skill-store':
        return <SkillStoreView />
      case 'providers':
        return <ProvidersView />
      case 'settings':
        return <SettingsView />
      default:
        return <ChatView approvalRequest={approvalRequest} onApprovalClose={() => setApprovalRequest(null)} />
    }
  })()

  // Compute dynamic margin for main content area based on sidebar state
  const sidebarOffset = t.sidebarHidden
    ? 0
    : t.floatingSidebarWidth + 10 // sidebar width + left-gap(5px) + right-gap(5px)

  return (
    <ErrorBoundary level="global" name="Shell">
    <div
      ref={scaleRef}
      className={`app window theme-${t.theme} density-${t.density} platform-${window.spark.platform}${t.sidebarHidden ? ' sidebar-hidden' : ''}`}
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
        <div className="main">
          {t.view !== 'chat' && (
            <div
              className="transparent-header"
              onDoubleClick={() => { window.spark.invoke('window:maximize', {}).catch(() => {}) }}
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
      {approvalRequest && !showInlineApproval && <PermissionModal request={approvalRequest} onClose={() => setApprovalRequest(null)} />}

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
