import React, { useEffect, useCallback, useRef, useState } from 'react'
import { AppProvider, useApp, PRIMARIES } from './design/AppContext'
import { ToastProvider, ToastContainer, useToast } from './design/components/Toast'
import { ErrorBoundary } from './design/components/ErrorBoundary'
import { SparkInput } from './design/components/FormControls'
import type { PermissionApprovalRequest } from '@spark/protocol'
import { useGlobalShortcuts, getShortcutLabel } from './design/hooks/useKeyboard'

import { HomeView } from './design/views/HomeView'
import { ChatView } from './design/views/ChatView'
import { ProjectView } from './design/views/ProjectView'
import { WorkflowView } from './design/views/WorkflowView'
import { AgentsView } from './design/views/AgentsView'
import { McpView } from './design/views/McpView'
import { SkillsView } from './design/views/SkillsView'
import { SkillStoreView } from './design/views/SkillStoreView'
import { SettingsView, ProviderEditPanel, ProfileEditModal } from './design/views/SettingsView'
import { CommandPalette, PermissionModal } from './design/views/overlays'
import { Icons } from './design/Icons'

function SparkLogoMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="spark-logo-gradient" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="var(--primary-hover)" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="16" height="16" rx="5" fill="url(#spark-logo-gradient)" />
      <path
        d="M9 14.8 12.2 7.8c.2-.5.9-.5 1.1 0l1.1 2.4h2.3c.5 0 .8.6.4 1l-3.1 3.2.8 1.8c.2.5-.3 1-.8.8l-2-1-2 1c-.5.2-1-.3-.8-.8l.8-1.7-1.3-1.4c-.4-.4-.1-1 .4-1h1.7Z"
        fill="#fff"
      />
    </svg>
  )
}

/* ---------- ViewHeader — per-view title bar (matches design spec) ---------- */
function ViewHeader({ view, chatMode }: { view: string; chatMode: string }) {
  const { t, setTweak } = useApp()

  const viewMeta: Record<string, { title: string; sub: string }> = {
    home: { title: 'Home', sub: 'Sessions, projects & running tasks' },
    chat:
      chatMode === 'workspace'
        ? { title: 'Chat', sub: 'Workspace mode' }
        : { title: 'Chat', sub: 'Vibe mode · Streaming chat & tool calls' },
    workflows: { title: 'Workflows', sub: 'DAG orchestration' },
    agents: { title: 'Agents', sub: 'Multi-agent collaboration' },
    skills: { title: 'Skills', sub: 'Reusable agent capabilities' },
    'skill-store': { title: 'Skill 商店', sub: 'Discover, install and manage AI Skills' },
    mcp: { title: 'MCP', sub: 'Tool servers & data sources' },
    settings: { title: 'Settings', sub: 'App & team configuration' },
  }
  const meta = viewMeta[view] ?? { title: view, sub: '' }
  const isCompact = view === 'chat' || view === 'workflows'

  const paletteHint = getShortcutLabel('openPalette')

  return (
    <div
      className="view-header"
      style={isCompact ? { minHeight: 46, paddingBlock: 8 } : undefined}
    >
      <div>
        <div className="view-title">{meta!.title}</div>
        <div className="view-subtitle truncate">{meta!.sub}</div>
      </div>
      {view === 'chat' && (
        <div className="row" style={{ marginLeft: 16, gap: 8 }}>
          <div className="seg-control">
            <button
              className={chatMode === 'vibe' ? 'active' : ''}
              onClick={() => setTweak('chatMode', 'vibe')}
            >
              <span className="row" style={{ gap: 5, alignItems: 'center' }}>
                <Icons.Sparkles size={11} /> Vibe
              </span>
            </button>
            <button
              className={chatMode === 'workspace' ? 'active' : ''}
              onClick={() => setTweak('chatMode', 'workspace')}
            >
              <span className="row" style={{ gap: 5, alignItems: 'center' }}>
                <Icons.Code size={11} /> Workspace
              </span>
            </button>
          </div>
        </div>
      )}
      <div className="view-header-actions">
        {!isCompact && (
          <div className="search-input">
            <Icons.Search />
            <SparkInput placeholder="Search this view..." />
          </div>
        )}
        <button className="btn ghost sm" onClick={() => setTweak('showPalette', true)}>
          <Icons.Command size={12} /> {paletteHint}
        </button>
      </div>
    </div>
  )
}

function Shell() {
  const { t, setTweak } = useApp()
  const { toast } = useToast()
  const scaleRef = useRef<HTMLDivElement>(null)
  const [approvalRequest, setApprovalRequest] = useState<PermissionApprovalRequest | null>(null)

  // Global error handlers: unhandledrejection + window.onerror → toast
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
      // Ignore ResizeObserver loop errors (benign)
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

  // Auto-scale 1440×900 → viewport
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
    if (view === '__toggleSidebar') {
      setTweak('sidebar', t.sidebar === 'expanded' ? 'collapsed' : 'expanded')
    } else {
      setTweak('view', view as typeof t.view)
    }
  }, [setTweak, t.sidebar])

  // New session handler
  const handleNewSession = useCallback(() => {
    setTweak('view', 'chat')
  }, [setTweak])

  // Global keyboard shortcuts
  useGlobalShortcuts({
    setTweak: setTweak as (key: string, val: unknown) => void,
    onSearchFocus: () => {
      // Focus the search input in the current view if possible
      const searchInput = document.querySelector('.search-input input, .search-input .spark-input') as HTMLElement | null
      if (searchInput) {
        searchInput.focus()
      }
    },
    onNewSession: handleNewSession,
    hasOverlayOpen: () => t.showPalette || t.showPerm || t.showProviderEdit || t.showProfileEdit,
  })

  // Listen for tool approval requests from main process
  useEffect(() => {
    return window.spark.on('stream:permission:approval-request', (req) => {
      setApprovalRequest(req)
    })
  }, [])

  const primary = t.primary
  const info = PRIMARIES[primary]

  const showInlineApproval = t.view === 'chat' && t.chatMode !== 'workspace'
  const ViewMap: Record<string, () => React.ReactElement> = {
    home: HomeView,
    chat: t.chatMode === 'workspace'
      ? ProjectView
      : () => <ChatView approvalRequest={approvalRequest} onApprovalClose={() => setApprovalRequest(null)} />,
    workflows: WorkflowView,
    agents: AgentsView,
    mcp: McpView,
    skills: SkillsView,
    'skill-store': SkillStoreView,
    settings: SettingsView,
  }
  const View = ViewMap[t.view] ?? HomeView

  const isExpanded = t.sidebar === 'expanded'

  const paletteHint = getShortcutLabel('openPalette')
  const sidebarHint = getShortcutLabel('toggleSidebar')

  return (
    <ErrorBoundary level="global" name="Shell">
    <div
      ref={scaleRef}
      className={`app window theme-${t.theme} density-${t.density}`}
      style={
        {
          '--primary': primary,
          '--primary-hover': info?.hover ?? primary,
          '--primary-soft': info?.soft ?? 'rgba(99,102,241,0.12)',
        } as React.CSSProperties
      }
    >
      {/* Titlebar */}
      <div className="titlebar">
        <div className="titlebar-brand" aria-label="Spark Agent">
          <div className="titlebar-logo" aria-hidden="true">
            <SparkLogoMark />
          </div>
          <div className="titlebar-title">Spark Agent</div>
        </div>
        <div className="titlebar-spacer" />
        <div className="titlebar-actions">
          <button className="icon-btn" onClick={() => setTweak('showPalette', true)} title={paletteHint}>
            <Icons.Search size={14} />
          </button>
          <button className="icon-btn" onClick={() => setTweak('showPerm', true)}>
            <Icons.Shield size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="app-body">
        {/* Sidebar */}
        <div className={`sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
          {/* Search / Command bar */}
          <div className="sidebar-section" style={{ paddingTop: 10 }}>
            <button
              className="nav-item"
              onClick={() => setTweak('showPalette', true)}
              style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
            >
              <span className="nav-icon">
                <Icons.Search />
              </span>
              {isExpanded && (
                <>
                  <span className="nav-label">Search / Command</span>
                  <span style={{ display: 'flex', gap: 2 }}>
                    <span className="kbd">{paletteHint}</span>
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Primary navigation */}
          <div className="sidebar-section">
            <button
              className={`nav-item ${t.view === 'home' ? 'active' : ''}`}
              onClick={() => setTweak('view', 'home')}
              title="Home"
            >
              <span className="nav-icon">
                <Icons.Home />
              </span>
              {isExpanded && (
                <span className="nav-label">Home</span>
              )}
            </button>
            <button
              className={`nav-item ${t.view === 'chat' ? 'active' : ''}`}
              onClick={() => setTweak('view', 'chat')}
              title="Chat"
            >
              <span className="nav-icon">
                <Icons.Chat />
              </span>
              {isExpanded && (
                <span className="nav-label">Chat</span>
              )}
            </button>

            <button
              className={`nav-item ${t.view === 'workflows' ? 'active' : ''}`}
              onClick={() => setTweak('view', 'workflows')}
              title="Workflows"
            >
              <span className="nav-icon">
                <Icons.Workflow />
              </span>
              {isExpanded && (
                <span className="nav-label">Workflows</span>
              )}
            </button>
            <button
              className={`nav-item ${t.view === 'agents' ? 'active' : ''}`}
              onClick={() => setTweak('view', 'agents')}
              title="Agents"
            >
              <span className="nav-icon">
                <Icons.Bot />
              </span>
              {isExpanded && (
                <span className="nav-label">Agents</span>
              )}
            </button>
          </div>

          {/* Secondary navigation */}
          <div className="sidebar-section">
            <button
              className={`nav-item ${t.view === 'skills' || t.view === 'skill-store' ? 'active' : ''}`}
              onClick={() => setTweak('view', 'skill-store')}
              title="Skill 商店"
            >
              <span className="nav-icon">
                <Icons.Skills />
              </span>
              {isExpanded && (
                <span className="nav-label">Skills</span>
              )}
            </button>
            <button
              className={`nav-item ${t.view === 'mcp' ? 'active' : ''}`}
              onClick={() => setTweak('view', 'mcp')}
              title="MCP"
            >
              <span className="nav-icon">
                <Icons.MCP />
              </span>
              {isExpanded && (
                <span className="nav-label">MCP</span>
              )}
            </button>
          </div>

          {/* Settings */}
          <div className="sidebar-section">
            <button
              className={`nav-item ${t.view === 'settings' ? 'active' : ''}`}
              onClick={() => setTweak('view', 'settings')}
              title="Settings"
            >
              <span className="nav-icon">
                <Icons.Settings />
              </span>
              {isExpanded && (
                <span className="nav-label">Settings</span>
              )}
            </button>
          </div>

          {/* User info + sidebar toggle */}
          <div className="sidebar-bottom">
            <div className="sidebar-user">
              <div className="avatar">U</div>
              <div className="sidebar-user-info">
                <div className="name">User</div>
                <div className="meta">Local · Desktop</div>
              </div>
              {isExpanded && (
                <button
                  className="icon-btn sidebar-toggle-btn"
                  onClick={() => setTweak('sidebar', 'collapsed')}
                  aria-label="Collapse sidebar"
                  title={`Collapse sidebar (${sidebarHint})`}
                >
                  <Icons.ChevronLeft size={14} />
                </button>
              )}
            </div>
            {!isExpanded && (
              <button
                className="icon-btn sidebar-toggle-btn collapsed-toggle"
                onClick={() => setTweak('sidebar', 'expanded')}
                aria-label="Expand sidebar"
                title={`Expand sidebar (${sidebarHint})`}
              >
                <Icons.PanelLeft size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="main">
          <ViewHeader view={t.view} chatMode={t.chatMode} />
          <div className="view-body" style={{ display: 'flex', flexDirection: 'column' }}>
            <View />
          </div>
        </div>
      </div>

      {/* Overlays */}
      {t.showPalette && (
        <CommandPalette
          onClose={() => setTweak('showPalette', false)}
          onNavigate={handleNavigate}
          onNewSession={handleNewSession}
        />
      )}
      {t.showPerm && <PermissionModal request={{ requestId: 'preview', sessionId: 'preview-session', toolName: 'write_file', action: 'file_write', toolInput: {}, riskLevel: 'medium', persistentScopes: ['global'] }} onClose={() => setTweak('showPerm', false)} />}
      {approvalRequest && !showInlineApproval && <PermissionModal request={approvalRequest} onClose={() => setApprovalRequest(null)} />}

      {t.showProfileEdit && <ProfileEditModal onClose={() => setTweak('showProfileEdit', false)} />}

      {/* Global toast notifications */}
      <ToastContainer />
    </div>
    </ErrorBoundary>
  )
}

export function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AppProvider>
  )
}
