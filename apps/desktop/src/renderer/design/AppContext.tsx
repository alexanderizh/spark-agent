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
import {
  DEFAULT_EMPTY_HERO_THEME,
  isEmptyHeroThemeId,
  type EmptyHeroThemeId,
} from './views/chat/emptyHeroThemes'

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
 *  Defaults to floating on every platform unless the user has switched. */
export type SidebarStyle = 'floating' | 'flat'
/** 侧栏工作模式。'workbench' = 对话式任务工作台，'canvas' = 无限画布。
 *  两者是平级主功能，切换只改变侧栏上半部分（主列表 + 上下文入口），
 *  底部的全局共享资源（智能体/模型服务/技能/MCP）不随模式变化。 */
export type WorkspaceMode = 'workbench' | 'canvas'
export type ViewId =
  | 'chat'
  | 'workflows'
  | 'agents'
  | 'board'
  | 'canvas'
  | 'canvas-workflows'
  | 'canvas-prompts'
  | 'canvas-video-tasks'
  | 'sub-apps'
  | 'sub-app'
  | 'scheduled-tasks'
  | 'skills'
  | 'skill-store'
  | 'mcp'
  | 'plugins'
  | 'providers'
  | 'memory'
  | 'settings'
  | 'lobe-preview'
  | 'account-center'
  | 'onboarding'
/**
 * 会话模式。workspace 仅为历史状态保留，已废弃；新入口必须使用 vibe。
 * @deprecated workspace 不再是当前工作台页面，不要用于新的导航或交互。
 */
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
  /** 空会话页的视觉主题；与全局 light/dark 模式独立。 */
  emptyHeroTheme: EmptyHeroThemeId
  primary: string
  density: Density
  sidebar: SidebarState
  view: ViewId
  chatMode: ChatMode
  settingsSection: string
  showPalette: boolean
  /** Palette scope: 'command' = command-only palette, 'global' = global search (commands + sessions + menus). Session-only, not persisted. */
  paletteMode: 'command' | 'global'
  showPerm: boolean
  showProviderEdit: boolean
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
  /** 当前侧栏工作模式（工作台 / 画布），持久化。 */
  workspaceMode: WorkspaceMode
  /** 侧栏「新建项目」按钮触发计数器（非持久化）。
   *  CanvasProjectsView 监听其变化，>0 时打开新建弹窗。
   *  用于跨视图触发：用户在任意模式点新建项目 → 切到 canvas view + 弹窗。 */
  canvasCreateSignal: number
  /** 子应用运行页当前打开的 appId（非持久化；null 时运行页回退到管理页）。
   *  SubAppRunView 读取；SubAppsView / 菜单入口写入并切 view 到 'sub-app'。 */
  subAppOpenId: string | null
  /** 子应用运行页的初始版本：菜单默认发布版，管理页可显式进入草稿预览。 */
  subAppOpenMode: 'published' | 'draft'
}

export const DEFAULT_TWEAKS: Tweaks = {
  theme: 'system',
  emptyHeroTheme: DEFAULT_EMPTY_HERO_THEME,
  primary: '#6366f1',
  density: 'regular',
  sidebar: 'collapsed',
  view: 'chat',
  chatMode: 'vibe',
  settingsSection: 'general',
  showPalette: false,
  paletteMode: 'command',
  showPerm: false,
  showProviderEdit: false,
  browserPanelOpen: false,
  browserPanelWidth: 380,
  floatingSidebarWidth: 288,
  sidebarHidden: false,
  sidebarStyle: 'flat',
  workspaceMode: 'workbench',
  canvasCreateSignal: 0,
  subAppOpenId: null,
  subAppOpenMode: 'published',
}

/** Min/max bounds for the floating sidebar width (px). */
export const FLOATING_SIDEBAR_WIDTH_MIN = 187
export const FLOATING_SIDEBAR_WIDTH_MAX = 420

const THEME_STORAGE_KEY = 'spark-agent:theme'
const APPEARANCE_SETTINGS_STORAGE_KEY = 'spark-settings-appearance'
const SETTINGS_UPDATED_EVENT = 'spark-settings-updated'
const APPEARANCE_SETTINGS_CATEGORY = 'appearance'
const APPEARANCE_SETTINGS_KEY = 'data'
const SIDEBAR_STORAGE_KEY = 'spark-agent:sidebar'
const BROWSER_PANEL_OPEN_KEY = 'spark-agent:browser-panel-open'
const BROWSER_PANEL_WIDTH_KEY = 'spark-agent:browser-panel-width'
const FLOATING_SIDEBAR_WIDTH_KEY = 'spark-agent:floating-sidebar-width'
const SIDEBAR_HIDDEN_KEY = 'spark-agent:sidebar-hidden'
const SIDEBAR_STYLE_KEY = 'spark-agent:sidebar-style'
const WORKSPACE_MODE_KEY = 'spark-agent:workspace-mode'

/** Min/max bounds for the browser panel width (px). */
export const BROWSER_PANEL_WIDTH_MIN = 280
export const BROWSER_PANEL_WIDTH_MAX = 1200

type PersistedVisualTweaks = Partial<
  Pick<Tweaks, 'theme' | 'emptyHeroTheme' | 'primary' | 'density'>
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function readLocalAppearanceSettings(): Record<string, unknown> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(APPEARANCE_SETTINGS_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeLocalAppearanceRecord(value: Record<string, unknown>): Record<string, unknown> {
  window.localStorage.setItem(APPEARANCE_SETTINGS_STORAGE_KEY, JSON.stringify(value))
  window.dispatchEvent(
    new CustomEvent(SETTINGS_UPDATED_EVENT, { detail: { key: APPEARANCE_SETTINGS_STORAGE_KEY } }),
  )
  return value
}

function pickVisualTweaks(value: unknown): PersistedVisualTweaks {
  if (!isRecord(value)) return {}
  const next: PersistedVisualTweaks = {}
  if (value.theme === 'light' || value.theme === 'dark' || value.theme === 'system') {
    next.theme = value.theme
  }
  if (isEmptyHeroThemeId(value.emptyHeroTheme)) {
    next.emptyHeroTheme = value.emptyHeroTheme
  }
  if (typeof value.primary === 'string' && PRIMARIES[value.primary] != null) {
    next.primary = value.primary
  }
  if (value.density === 'compact' || value.density === 'regular' || value.density === 'comfy') {
    next.density = value.density
  }
  return next
}

function writeLocalAppearanceSettings(patch: PersistedVisualTweaks): Record<string, unknown> {
  const next = { ...readLocalAppearanceSettings(), ...patch }
  return writeLocalAppearanceRecord(next)
}

function persistVisualTweaks(patch: PersistedVisualTweaks): void {
  if (typeof window === 'undefined') return
  const localNext = writeLocalAppearanceSettings(patch)
  const invoke = window.spark?.invoke
  if (invoke == null) return

  const remoteBeforeSet = invoke('settings:get', {
    category: APPEARANCE_SETTINGS_CATEGORY,
    key: APPEARANCE_SETTINGS_KEY,
  }).catch(() => ({ value: null }))

  void invoke('settings:set', {
    category: APPEARANCE_SETTINGS_CATEGORY,
    key: APPEARANCE_SETTINGS_KEY,
    value: localNext,
  })
    .then(() => remoteBeforeSet)
    .then((res) => {
      const remote = isRecord(res?.value) ? res.value : {}
      const merged = { ...remote, ...localNext, ...patch }
      writeLocalAppearanceRecord(merged)
      return invoke('settings:set', {
        category: APPEARANCE_SETTINGS_CATEGORY,
        key: APPEARANCE_SETTINGS_KEY,
        value: merged,
      })
    })
    .catch(() => {
      /* ignore IPC errors outside Electron */
    })
}

function readInitialTweaks(): Tweaks {
  if (typeof window === 'undefined') return DEFAULT_TWEAKS

  let tweaks = DEFAULT_TWEAKS

  const savedAppearanceTweaks = pickVisualTweaks(readLocalAppearanceSettings())
  tweaks = { ...tweaks, ...savedAppearanceTweaks }

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (
    savedAppearanceTweaks.theme == null &&
    (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system')
  ) {
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
  // If the user has explicitly switched, honor the saved value; otherwise keep
  // DEFAULT_TWEAKS.flat so every platform starts with the same flat panel.
  const savedSidebarStyle = window.localStorage.getItem(SIDEBAR_STYLE_KEY)
  if (savedSidebarStyle === 'floating' || savedSidebarStyle === 'flat') {
    tweaks = { ...tweaks, sidebarStyle: savedSidebarStyle }
  }

  const savedWorkspaceMode = window.localStorage.getItem(WORKSPACE_MODE_KEY)
  if (savedWorkspaceMode === 'workbench' || savedWorkspaceMode === 'canvas') {
    tweaks = { ...tweaks, workspaceMode: savedWorkspaceMode }
  }

  // view 不持久化（每次启动回到主视图），但启动时要和 workspaceMode 联动，
  // 否则上次切到画布模式后重启，会出现「侧栏画布 + 主区聊天」的割裂：
  // 画布模式 → view 默认 'canvas'；工作台模式 → view 默认 'chat'。
  if (tweaks.workspaceMode === 'canvas' && tweaks.view === 'chat') {
    tweaks = { ...tweaks, view: 'canvas' }
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
  /**
   * 同步设置全局是否有未保存改动。`beforeunload` 监听器会读取这个 ref
   * 决定是否拦截窗口关闭；同步设置是为了让 beforeunload 同步阶段能拿到正确值
   * （之前的实现只看 navGuardRef 是否注册，对干净的画布/助手页也误拦截，
   * 导致 macOS Dock 退出和程序坞右键退出完全没反应）。
   *
   * 各 view 应在 mount 时把当前的 dirty 同步推进来，unmount 时清回 false，
   * 避免视图卸载后脏标志残留而无法退出应用。
   */
  setHasUnsavedChanges: (value: boolean) => void
  requestConfirm: (options: ConfirmOptions) => Promise<boolean>
  requestPrompt: (options: PromptOptions) => Promise<string | null>
  /** 一次性将主题/主色/密度/空状态主题等视觉 tweak 重置为默认值。
   *  相比连调多次 setTweak，这里单条 persist 链避免远端 merge 竞态。 */
  resetVisualTweaks: () => void
  hasDialogOpen: boolean
  dialogHost: DialogHostProps
}

const Ctx = createContext<AppCtx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Tweaks>(readInitialTweaks)
  const [confirmRequest, setConfirmRequest] = useState<
    (ConfirmOptions & { resolve: (value: boolean) => void }) | null
  >(null)
  const [promptRequest, setPromptRequest] = useState<
    (PromptOptions & { resolve: (value: string | null) => void }) | null
  >(null)
  const navGuardRef = useRef<NavGuard | null>(null)
  const confirmHandledRef = useRef(false)
  const promptHandledRef = useRef(false)
  // 全局脏标志：beforeunload 同步判断窗口是否真的有未保存内容。各 view 在
  // mount/unmount 与 dirty 变化时同步设置；不放在 state 里是为了避免
  // beforeunload 触发时拿到陈旧值（state 更新是异步的）。
  const hasUnsavedChangesRef = useRef<boolean>(false)
  const hasUserVisualChangeRef = useRef<boolean>(false)
  const registerNavGuard = useCallback<AppCtx['registerNavGuard']>((guard) => {
    navGuardRef.current = guard
  }, [])
  const setHasUnsavedChanges = useCallback<AppCtx['setHasUnsavedChanges']>((value) => {
    hasUnsavedChangesRef.current = value
  }, [])
  const requestConfirm = useCallback<AppCtx['requestConfirm']>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setConfirmRequest({ ...options, resolve })
      }),
    [],
  )
  const requestPrompt = useCallback<AppCtx['requestPrompt']>(
    (options) =>
      new Promise<string | null>((resolve) => {
        setPromptRequest({ ...options, resolve })
      }),
    [],
  )
  const applyTweak = useCallback<AppCtx['setTweak']>((key, val) => {
    if (key === 'theme') {
      window.localStorage.setItem(THEME_STORAGE_KEY, val as ThemeMode)
      hasUserVisualChangeRef.current = true
      persistVisualTweaks({ theme: val as ThemeMode })
    } else if (key === 'emptyHeroTheme') {
      hasUserVisualChangeRef.current = true
      persistVisualTweaks({ emptyHeroTheme: val as EmptyHeroThemeId })
    } else if (key === 'primary') {
      hasUserVisualChangeRef.current = true
      persistVisualTweaks({ primary: val as string })
    } else if (key === 'density') {
      hasUserVisualChangeRef.current = true
      persistVisualTweaks({ density: val as Density })
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
    } else if (key === 'workspaceMode') {
      window.localStorage.setItem(WORKSPACE_MODE_KEY, val as WorkspaceMode)
    }
    setT((prev) => {
      if (prev[key] === val) return prev
      return { ...prev, [key]: val }
    })
  }, [])

  const resetVisualTweaks = useCallback<AppCtx['resetVisualTweaks']>(() => {
    const patch: PersistedVisualTweaks = {
      theme: DEFAULT_TWEAKS.theme,
      emptyHeroTheme: DEFAULT_TWEAKS.emptyHeroTheme,
      primary: DEFAULT_TWEAKS.primary,
      density: DEFAULT_TWEAKS.density,
    }
    hasUserVisualChangeRef.current = true
    // 同步清理旧版 theme 残留（applyTweak('theme') 也会写这个 key），保持重启后一致
    window.localStorage.setItem(THEME_STORAGE_KEY, DEFAULT_TWEAKS.theme)
    persistVisualTweaks(patch)
    setT((prev) => ({ ...prev, ...patch }))
  }, [])

  const setTweak = useCallback<AppCtx['setTweak']>(
    (key, val) => {
      if (key === 'view' && navGuardRef.current && val !== t.view) {
        void (async () => {
          if (await navGuardRef.current?.()) applyTweak(key, val)
        })()
        return
      }
      applyTweak(key, val)
    },
    [applyTweak, t.view],
  )
  useEffect(() => {
    let cancelled = false
    window.spark
      ?.invoke('settings:get', {
        category: APPEARANCE_SETTINGS_CATEGORY,
        key: APPEARANCE_SETTINGS_KEY,
      })
      .then((res) => {
        if (cancelled || hasUserVisualChangeRef.current) return
        const remote = isRecord(res?.value) ? res.value : {}
        const patch = pickVisualTweaks(remote)
        if (Object.keys(patch).length === 0) return
        writeLocalAppearanceRecord({ ...readLocalAppearanceSettings(), ...remote, ...patch })
        if (patch.theme != null) window.localStorage.setItem(THEME_STORAGE_KEY, patch.theme)
        setT((prev) => ({ ...prev, ...patch }))
      })
      .catch(() => {
        /* ignore IPC errors outside Electron */
      })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      // 只在视图真的有未保存内容时才拦截窗口关闭。之前的实现只判断
      // `navGuardRef.current` 有没有注册，会对 Assistants / Canvas 这类
      // 始终注册 guard 的视图全量拦截，导致 macOS Dock 退出、托盘退出、
      // ⌘Q 全部没反应；navGuard 的 dirty 检查是异步的（要弹确认框），
      // beforeunload 是同步阶段，不能信任它的返回值。
      if (hasUnsavedChangesRef.current) {
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
      setHasUnsavedChanges,
      requestConfirm,
      requestPrompt,
      resetVisualTweaks,
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
      setHasUnsavedChanges,
      requestConfirm,
      requestPrompt,
      resetVisualTweaks,
      confirmRequest,
      promptRequest,
    ],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
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
