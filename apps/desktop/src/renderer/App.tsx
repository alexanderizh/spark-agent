import React, { useEffect, useCallback, useRef } from 'react'
import { AppProvider, useApp, PRIMARIES } from './design/AppContext'

import { HomeView } from './design/views/HomeView'
import { ChatView } from './design/views/ChatView'
import { ProjectView } from './design/views/ProjectView'
import { WorkflowView } from './design/views/WorkflowView'
import { AgentsView } from './design/views/AgentsView'
import { McpView } from './design/views/McpView'
import { SkillsView } from './design/views/SkillsView'
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

function Shell() {
  const { t, setTweak } = useApp()
  const scaleRef = useRef<HTMLDivElement>(null)

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

  // Keyboard shortcuts
  const onKey = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setTweak('showPalette', true)
    }
    if (e.key === 'Escape') {
      setTweak('showPalette', false)
      setTweak('showPerm', false)
      setTweak('showProviderEdit', false)
      setTweak('showProfileEdit', false)
    }
  }, [setTweak])

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  const primary = t.primary
  const info = PRIMARIES[primary]

  const nav = [
    { id: 'home' as const, icon: <Icons.Home />, label: 'Home' },
    { id: 'chat' as const, icon: <Icons.Chat />, label: 'Chat' },
    { id: 'projects' as const, icon: <Icons.Folder />, label: 'Projects' },
    { id: 'workflows' as const, icon: <Icons.Workflow />, label: 'Workflows' },
    { id: 'agents' as const, icon: <Icons.Bot />, label: 'Agents' },
    { id: 'mcp' as const, icon: <Icons.MCP />, label: 'MCP' },
    { id: 'skills' as const, icon: <Icons.Skills />, label: 'Skills' },
  ]

  const ViewMap: Record<string, () => React.ReactElement> = {
    home: HomeView,
    chat: t.chatMode === 'workspace' ? ProjectView : ChatView,
    projects: ProjectView,
    workflows: WorkflowView,
    agents: AgentsView,
    mcp: McpView,
    skills: SkillsView,
    settings: SettingsView,
  }
  const View = ViewMap[t.view] ?? HomeView

  return (
    <div
      ref={scaleRef}
      className={`app window theme-${t.theme} density-${t.density}`}
      style={{
        '--primary': primary,
        '--primary-hover': info?.hover ?? primary,
        '--primary-soft': info?.soft ?? 'rgba(99,102,241,0.12)',
      } as React.CSSProperties}
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
          <button className="icon-btn" onClick={() => setTweak('showPalette', true)}><Icons.Search size={14} /></button>
          <button className="icon-btn" onClick={() => setTweak('showPerm', true)}><Icons.Shield size={14} /></button>
        </div>
      </div>

      {/* Body */}
      <div className="app-body">
        {/* Sidebar */}
        <div className={`sidebar ${t.sidebar === 'expanded' ? 'expanded' : 'collapsed'}`}>
          <div className="sidebar-top">
            {nav.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${t.view === item.id ? 'active' : ''}`}
                onClick={() => setTweak('view', item.id)}
                title={item.label}
              >
                <span className="nav-icon">{item.icon}</span>
                {t.sidebar === 'expanded' && <span className="nav-label">{item.label}</span>}
              </button>
            ))}
          </div>
          <div className="sidebar-bottom">
            <button
              className={`nav-item ${t.view === 'settings' ? 'active' : ''}`}
              onClick={() => setTweak('view', 'settings')}
              title="Settings"
            >
              <span className="nav-icon"><Icons.Settings /></span>
              {t.sidebar === 'expanded' && <span className="nav-label">Settings</span>}
            </button>
          </div>
        </div>

        {/* Main content */}
        <div className="main">
          <View />
        </div>
      </div>

      {/* Overlays */}
      {t.showPalette && <CommandPalette onClose={() => setTweak('showPalette', false)} />}
      {t.showPerm && <PermissionModal onClose={() => setTweak('showPerm', false)} />}

      {t.showProfileEdit && <ProfileEditModal onClose={() => setTweak('showProfileEdit', false)} />}
    </div>
  )
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
