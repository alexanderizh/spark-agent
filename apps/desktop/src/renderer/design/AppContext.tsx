/**
 * AppContext — 全局 Tweaks 状态（主题/主色/密度/侧栏/视图/覆盖层显示等）
 *
 * 取代原设计 jsx 中的 window.__app 共享状态，提供 React Context 给所有视图使用。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ConfirmDialog } from './components/ConfirmDialog'
import { PromptDialog } from './components/PromptDialog'

export type NavGuard = () => boolean | Promise<boolean>

export type ThemeMode = 'light' | 'dark'
export type Density = 'compact' | 'regular' | 'comfy'
export type SidebarState = 'collapsed' | 'expanded'
export type ViewId = 'chat' | 'workflows' | 'agents' | 'skills' | 'skill-store' | 'mcp' | 'providers' | 'settings'
export type ChatMode = 'vibe' | 'workspace'

export type ConfirmOptions = {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

export type PromptOptions = {
  title: string
  description?: string
  value?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
}

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
  /** Floating sidebar width in pixels, persisted across sessions. */
  floatingSidebarWidth: number
  /** Whether the floating sidebar is completely hidden. */
  sidebarHidden: boolean
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
  floatingSidebarWidth: 200,
  sidebarHidden: false,
}

/** Min/max bounds for the floating sidebar width (px). */
export const FLOATING_SIDEBAR_WIDTH_MIN = 170
export const FLOATING_SIDEBAR_WIDTH_MAX = 420

const SIDEBAR_STORAGE_KEY = 'spark-agent:sidebar'
const BROWSER_PANEL_OPEN_KEY = 'spark-agent:browser-panel-open'
const BROWSER_PANEL_WIDTH_KEY = 'spark-agent:browser-panel-width'
const FLOATING_SIDEBAR_WIDTH_KEY = 'spark-agent:floating-sidebar-width'
const SIDEBAR_HIDDEN_KEY = 'spark-agent:sidebar-hidden'

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

  const savedSidebarWidth = window.localStorage.getItem(FLOATING_SIDEBAR_WIDTH_KEY)
  if (savedSidebarWidth != null) {
    const parsed = Number.parseInt(savedSidebarWidth, 10)
    if (
      Number.isFinite(parsed) &&
      parsed >= FLOATING_SIDEBAR_WIDTH_MIN &&
      parsed <= FLOATING_SIDEBAR_WIDTH_MAX
    ) {
      tweaks = { ...tweaks, floatingSidebarWidth: parsed }
    }
  }

  const savedSidebarHidden = window.localStorage.getItem(SIDEBAR_HIDDEN_KEY)
  if (savedSidebarHidden === 'true') {
    tweaks = { ...tweaks, sidebarHidden: true }
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
  registerNavGuard: (guard: NavGuard | null) => void
  requestConfirm: (options: ConfirmOptions) => Promise<boolean>
  requestPrompt: (options: PromptOptions) => Promise<string | null>
}

const Ctx = createContext<AppCtx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Tweaks>(readInitialTweaks)
  const [confirmRequest, setConfirmRequest] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null)
  const [promptRequest, setPromptRequest] = useState<(PromptOptions & { resolve: (value: string | null) => void }) | null>(null)
  const navGuardRef = useRef<NavGuard | null>(null)
  const confirmHandledRef = useRef(false)
  const promptHandledRef = useRef(false)
  const registerNavGuard = useCallback<AppCtx['registerNavGuard']>((guard) => {
    navGuardRef.current = guard
  }, [])
  const requestConfirm = useCallback<AppCtx['requestConfirm']>((options) => (
    new Promise<boolean>((resolve) => {
      setConfirmRequest({ ...options, resolve })
    })
  ), [])
  const requestPrompt = useCallback<AppCtx['requestPrompt']>((options) => (
    new Promise<string | null>((resolve) => {
      setPromptRequest({ ...options, resolve })
    })
  ), [])
  const applyTweak = useCallback<AppCtx['setTweak']>((key, val) => {
    if (key === 'sidebar') {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, val as SidebarState)
    } else if (key === 'browserPanelOpen') {
      window.localStorage.setItem(BROWSER_PANEL_OPEN_KEY, String(val))
    } else if (key === 'browserPanelWidth') {
      window.localStorage.setItem(BROWSER_PANEL_WIDTH_KEY, String(val))
    } else if (key === 'floatingSidebarWidth') {
      window.localStorage.setItem(FLOATING_SIDEBAR_WIDTH_KEY, String(val))
    } else if (key === 'sidebarHidden') {
      window.localStorage.setItem(SIDEBAR_HIDDEN_KEY, String(val))
    }
    setT((prev) => {
      if (prev[key] === val) return prev
      return { ...prev, [key]: val }
    })
  }, [])

  const setTweak = useCallback<AppCtx['setTweak']>((key, val) => {
    if (key === 'view' && navGuardRef.current && val !== t.view) {
      void (async () => {
        if (await navGuardRef.current?.()) applyTweak(key, val)
      })()
      return
    }
    applyTweak(key, val)
  }, [applyTweak, t.view])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (navGuardRef.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])
  useEffect(() => {
    const root = document.documentElement
    const primary = t.primary
    const info = PRIMARIES[primary]
    root.dataset.theme = t.theme
    root.style.setProperty('--primary', primary)
    root.style.setProperty('--primary-hover', info?.hover ?? primary)
    root.style.setProperty('--primary-soft', info?.soft ?? 'rgba(99,102,241,0.12)')
    // Sync Arco Design dark mode
    if (t.theme === 'dark') {
      document.body.setAttribute('arco-theme', 'dark')
    } else {
      document.body.removeAttribute('arco-theme')
    }
  }, [t.theme, t.primary])
  const value = useMemo<AppCtx>(
    () => ({ t, setTweak, registerNavGuard, requestConfirm, requestPrompt }),
    [t, setTweak, registerNavGuard, requestConfirm, requestPrompt],
  )
  return (
    <Ctx.Provider value={value}>
      {children}
      <ConfirmDialog
        open={confirmRequest != null}
        title={confirmRequest?.title ?? ''}
        description={confirmRequest?.description}
        confirmText={confirmRequest?.confirmText}
        cancelText={confirmRequest?.cancelText}
        danger={confirmRequest?.danger}
        onOpenChange={(open) => {
          if (open || confirmRequest == null) return
          if (confirmHandledRef.current) {
            confirmHandledRef.current = false
            return
          }
          confirmRequest.resolve(false)
          setConfirmRequest(null)
        }}
        onConfirm={() => {
          confirmHandledRef.current = true
          confirmRequest?.resolve(true)
          setConfirmRequest(null)
        }}
      />
      <PromptDialog
        open={promptRequest != null}
        title={promptRequest?.title ?? ''}
        description={promptRequest?.description}
        value={promptRequest?.value}
        placeholder={promptRequest?.placeholder}
        confirmText={promptRequest?.confirmText}
        cancelText={promptRequest?.cancelText}
        onOpenChange={(open) => {
          if (open || promptRequest == null) return
          if (promptHandledRef.current) {
            promptHandledRef.current = false
            return
          }
          promptRequest.resolve(null)
          setPromptRequest(null)
        }}
        onConfirm={(value) => {
          promptHandledRef.current = true
          promptRequest?.resolve(value)
          setPromptRequest(null)
        }}
      />
    </Ctx.Provider>
  )
}

export function useApp(): AppCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be inside <AppProvider>')
  return v
}
