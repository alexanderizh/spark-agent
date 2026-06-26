/**
 * AppContext — 全局 Tweaks 状态（主题/主色/密度/侧栏/视图/覆盖层显示等）
 *
 * 取代原设计 jsx 中的 window.__app 共享状态，提供 React Context 给所有视图使用。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ConfirmDialog } from './components/ConfirmDialog'
import { useGlobalDialogEnterConfirm } from './hooks/useAppDialogKeyboard'
import { PromptDialog } from './components/PromptDialog'
import { applyArcoTheme } from './arcoTheme'

export type NavGuard = () => boolean | Promise<boolean>

export type ThemeMode = 'light' | 'dark' | 'system'
/** The resolved (actual) theme after resolving 'system' → 'light' | 'dark'. */
export type ResolvedTheme = 'light' | 'dark'
export type Density = 'compact' | 'regular' | 'comfy'
export type SidebarState = 'collapsed' | 'expanded'
/** User-selectable sidebar panel appearance.
 *  'floating' = macOS-style: inset, rounded, shadowed, translucent.
 *  'flat'     = Windows-style: flush to edges, no rounding/shadow/blur.
 *  Independent of the actual OS — both styles are available on every platform.
 *  Defaults follow the platform's native look unless the user has switched. */
export type SidebarStyle = 'floating' | 'flat'
export type ViewId = 'chat' | 'workflows' | 'agents' | 'board' | 'canvas' | 'scheduled-tasks' | 'skills' | 'skill-store' | 'mcp' | 'providers' | 'settings' | 'lobe-preview' | 'account-center' | 'onboarding'
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
  /** Sidebar panel appearance (floating vs flat), user-selectable & persisted. */
  sidebarStyle: SidebarStyle
}

export const DEFAULT_TWEAKS: Tweaks = {
  theme: 'light',
  primary: '#6366f1',
  density: 'regular',
  sidebar: 'collapsed',
  view: 'chat',
  chatMode: 'vibe',
  settingsSection: 'general',
  showPalette: false,
  showPerm: false,
  showProviderEdit: false,
  showProfileEdit: false,
  browserPanelOpen: false,
  browserPanelWidth: 380,
  floatingSidebarWidth: 200,
  sidebarHidden: false,
  sidebarStyle: 'floating',
}

/** Min/max bounds for the floating sidebar width (px). */
export const FLOATING_SIDEBAR_WIDTH_MIN = 187
export const FLOATING_SIDEBAR_WIDTH_MAX = 420

const THEME_STORAGE_KEY = 'spark-agent:theme'
const SIDEBAR_STORAGE_KEY = 'spark-agent:sidebar'
const BROWSER_PANEL_OPEN_KEY = 'spark-agent:browser-panel-open'
const BROWSER_PANEL_WIDTH_KEY = 'spark-agent:browser-panel-width'
const FLOATING_SIDEBAR_WIDTH_KEY = 'spark-agent:floating-sidebar-width'
const SIDEBAR_HIDDEN_KEY = 'spark-agent:sidebar-hidden'
const SIDEBAR_STYLE_KEY = 'spark-agent:sidebar-style'

/** Min/max bounds for the browser panel width (px). */
export const BROWSER_PANEL_WIDTH_MIN = 280
export const BROWSER_PANEL_WIDTH_MAX = 1200

function readInitialTweaks(): Tweaks {
  if (typeof window === 'undefined') return DEFAULT_TWEAKS

  let tweaks = DEFAULT_TWEAKS

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
    tweaks = { ...tweaks, theme: savedTheme }
  }

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

  // Sidebar panel appearance: floating vs flat.
  // If the user has explicitly switched, honor the saved value.
  // Otherwise default to the platform's native look
  // (macOS/Linux → floating, Windows → flat) so existing users see no change.
  const savedSidebarStyle = window.localStorage.getItem(SIDEBAR_STYLE_KEY)
  if (savedSidebarStyle === 'floating' || savedSidebarStyle === 'flat') {
    tweaks = { ...tweaks, sidebarStyle: savedSidebarStyle }
  } else if (window.spark?.platform === 'win32') {
    tweaks = { ...tweaks, sidebarStyle: 'flat' }
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
  hasDialogOpen: boolean
  dialogHost: DialogHostProps
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
    if (key === 'theme') {
      window.localStorage.setItem(THEME_STORAGE_KEY, val as ThemeMode)
    } else if (key === 'sidebar') {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, val as SidebarState)
    } else if (key === 'browserPanelOpen') {
      window.localStorage.setItem(BROWSER_PANEL_OPEN_KEY, String(val))
    } else if (key === 'browserPanelWidth') {
      window.localStorage.setItem(BROWSER_PANEL_WIDTH_KEY, String(val))
    } else if (key === 'floatingSidebarWidth') {
      window.localStorage.setItem(FLOATING_SIDEBAR_WIDTH_KEY, String(val))
    } else if (key === 'sidebarHidden') {
      window.localStorage.setItem(SIDEBAR_HIDDEN_KEY, String(val))
    } else if (key === 'sidebarStyle') {
      window.localStorage.setItem(SIDEBAR_STYLE_KEY, val as SidebarStyle)
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
    root.style.setProperty('--primary', primary)
    root.style.setProperty('--primary-hover', info?.hover ?? primary)
    root.style.setProperty('--primary-soft', info?.soft ?? 'rgba(99,102,241,0.12)')
    const applyResolvedTheme = (resolved: ResolvedTheme) => {
      root.dataset.theme = resolved
      applyArcoTheme(resolved, primary)
    }
    if (t.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      applyResolvedTheme(mq.matches ? 'dark' : 'light')
      const handler = (e: MediaQueryListEvent) => {
        applyResolvedTheme(e.matches ? 'dark' : 'light')
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
    applyResolvedTheme(t.theme)
  }, [t.theme, t.primary])
  // Mirror density class onto <html> so Arco popups portaled to <body>
  // can resolve density-driven design tokens (--row-h / --pad-* / --font-*).
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('density-compact', 'density-regular', 'density-comfy')
    root.classList.add(`density-${t.density}`)
  }, [t.density])
  const value = useMemo<AppCtx>(
    () => ({
      t,
      setTweak,
      registerNavGuard,
      requestConfirm,
      requestPrompt,
      hasDialogOpen: confirmRequest != null || promptRequest != null,
      dialogHost: {
        confirmRequest,
        promptRequest,
        onConfirmResolve: (v) => {
          confirmHandledRef.current = true
          confirmRequest?.resolve(v)
          setConfirmRequest(null)
        },
        onConfirmCancel: () => {
          if (confirmHandledRef.current) {
            confirmHandledRef.current = false
            return
          }
          confirmRequest?.resolve(false)
          setConfirmRequest(null)
        },
        onPromptResolve: (v) => {
          promptHandledRef.current = true
          promptRequest?.resolve(v)
          setPromptRequest(null)
        },
        onPromptCancel: () => {
          if (promptHandledRef.current) {
            promptHandledRef.current = false
            return
          }
          promptRequest?.resolve(null)
          setPromptRequest(null)
        },
      },
    }),
    [
      t,
      setTweak,
      registerNavGuard,
      requestConfirm,
      requestPrompt,
      confirmRequest,
      promptRequest,
    ],
  )
  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  )
}

type ConfirmRequest = ConfirmOptions & { resolve: (value: boolean) => void }
type PromptRequest = PromptOptions & { resolve: (value: string | null) => void }

type DialogHostProps = {
  confirmRequest: ConfirmRequest | null
  promptRequest: PromptRequest | null
  onConfirmResolve: (v: boolean) => void
  onConfirmCancel: () => void
  onPromptResolve: (v: string | null) => void
  onPromptCancel: () => void
}

function DialogHost({
  confirmRequest,
  promptRequest,
  onConfirmResolve,
  onConfirmCancel,
  onPromptResolve,
  onPromptCancel,
}: DialogHostProps) {
  useGlobalDialogEnterConfirm()

  return (
    <>
      <ConfirmDialog
        open={confirmRequest != null}
        title={confirmRequest?.title ?? ''}
        description={confirmRequest?.description}
        confirmText={confirmRequest?.confirmText}
        cancelText={confirmRequest?.cancelText}
        danger={confirmRequest?.danger}
        onOpenChange={(open) => {
          if (open || confirmRequest == null) return
          onConfirmCancel()
        }}
        onConfirm={() => onConfirmResolve(true)}
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
          onPromptCancel()
        }}
        onConfirm={(value) => onPromptResolve(value)}
      />
    </>
  )
}

export function AppDialogHost() {
  const v = useContext(Ctx)
  if (!v) return null
  return <DialogHost {...v.dialogHost} />
}

export function useApp(): AppCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be inside <AppProvider>')
  return v
}
