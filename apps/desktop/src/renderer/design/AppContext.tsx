/**
 * AppContext — 全局 Tweaks 状态（主题/主色/密度/侧栏/视图/覆盖层显示等）
 *
 * 取代原设计 jsx 中的 window.__app 共享状态，提供 React Context 给所有视图使用。
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type ThemeMode = 'light' | 'dark'
export type Density = 'compact' | 'regular' | 'comfy'
export type SidebarState = 'collapsed' | 'expanded'
export type ViewId = 'home' | 'chat' | 'workflows' | 'agents' | 'skills' | 'skill-store' | 'mcp' | 'settings'
export type ChatMode = 'vibe' | 'workspace'

export type Tweaks = {
  theme: ThemeMode
  primary: string
  density: Density
  sidebar: SidebarState
  view: ViewId
  chatMode: ChatMode
  settingsSection: string
  showPalette: boolean
  showPerm: boolean
  showProviderEdit: boolean
  showProfileEdit: boolean
  /** Browser automation side panel visibility (chat view only). Default: closed. */
  browserPanelOpen: boolean
  /** Browser panel width in pixels, persisted across sessions. */
  browserPanelWidth: number
}

export const DEFAULT_TWEAKS: Tweaks = {
  theme: 'light',
  primary: '#6366f1',
  density: 'regular',
  sidebar: 'collapsed',
  view: 'chat',
  chatMode: 'vibe',
  settingsSection: 'providers',
  showPalette: false,
  showPerm: false,
  showProviderEdit: false,
  showProfileEdit: false,
  browserPanelOpen: false,
  browserPanelWidth: 380,
}

const SIDEBAR_STORAGE_KEY = 'spark-agent:sidebar'
const BROWSER_PANEL_OPEN_KEY = 'spark-agent:browser-panel-open'
const BROWSER_PANEL_WIDTH_KEY = 'spark-agent:browser-panel-width'

/** Min/max bounds for the browser panel width (px). */
export const BROWSER_PANEL_WIDTH_MIN = 280
export const BROWSER_PANEL_WIDTH_MAX = 1200

function readInitialTweaks(): Tweaks {
  if (typeof window === 'undefined') return DEFAULT_TWEAKS

  let tweaks = DEFAULT_TWEAKS

  const savedSidebar = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
  if (savedSidebar === 'collapsed' || savedSidebar === 'expanded') {
    tweaks = { ...tweaks, sidebar: savedSidebar }
  }

  // Always start with browser panel closed — user opens it explicitly
  // (prevents auto-opening on app launch)
  // const savedBrowserOpen = window.localStorage.getItem(BROWSER_PANEL_OPEN_KEY)

  const savedBrowserWidth = window.localStorage.getItem(BROWSER_PANEL_WIDTH_KEY)
  if (savedBrowserWidth != null) {
    const parsed = Number.parseInt(savedBrowserWidth, 10)
    if (
      Number.isFinite(parsed) &&
      parsed >= BROWSER_PANEL_WIDTH_MIN &&
      parsed <= BROWSER_PANEL_WIDTH_MAX
    ) {
      tweaks = { ...tweaks, browserPanelWidth: parsed }
    }
  }

  return tweaks
}

export const PRIMARIES: Record<string, { name: string; hover: string; soft: string }> = {
  '#cc785c': { name: 'Claude', hover: '#b86a50', soft: 'rgba(204,120,92,0.13)' },
  '#6366f1': { name: 'Indigo', hover: '#4f46e5', soft: 'rgba(99,102,241,0.12)' },
  '#3b82f6': { name: 'Blue', hover: '#2563eb', soft: 'rgba(59,130,246,0.12)' },
  '#8b5cf6': { name: 'Violet', hover: '#7c3aed', soft: 'rgba(139,92,246,0.14)' },
  '#10b981': { name: 'Emerald', hover: '#059669', soft: 'rgba(16,185,129,0.12)' },
  '#f97316': { name: 'Orange', hover: '#ea580c', soft: 'rgba(249,115,22,0.12)' },
  '#f43f5e': { name: 'Rose', hover: '#e11d48', soft: 'rgba(244,63,94,0.12)' },
  '#64748b': { name: 'Slate', hover: '#475569', soft: 'rgba(100,116,139,0.14)' },
}

type AppCtx = {
  t: Tweaks
  setTweak: <K extends keyof Tweaks>(key: K, val: Tweaks[K]) => void
}

const Ctx = createContext<AppCtx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Tweaks>(readInitialTweaks)
  const setTweak = useCallback<AppCtx['setTweak']>((key, val) => {
    if (key === 'sidebar') {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, val as SidebarState)
    } else if (key === 'browserPanelOpen') {
      window.localStorage.setItem(BROWSER_PANEL_OPEN_KEY, String(val))
    } else if (key === 'browserPanelWidth') {
      window.localStorage.setItem(BROWSER_PANEL_WIDTH_KEY, String(val))
    }
    setT((prev) => {
      if (prev[key] === val) return prev
      return { ...prev, [key]: val }
    })
  }, [])
  const value = useMemo<AppCtx>(() => ({ t, setTweak }), [t, setTweak])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be inside <AppProvider>')
  return v
}
