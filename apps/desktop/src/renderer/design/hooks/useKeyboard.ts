/**
 * useKeyboard — Global keyboard shortcuts hook
 *
 * Features:
 *   - 9+ global shortcuts (Cmd/Ctrl combos + Escape)
 *   - Skips when input/textarea/contenteditable is focused
 *   - Shortcut bindings persisted to localStorage
 *   - Platform-aware: Mac uses ⌘, Windows/Linux uses Ctrl+
 */
import { useEffect, useCallback, useRef } from 'react'
import type { ViewId } from '../AppContext'

/* ============================================================
   Platform detection
   ============================================================ */

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)

/** Returns the modifier symbol for the current platform: ⌘ on Mac, Ctrl+ elsewhere */
export function modSymbol(): string {
  return isMac ? '⌘' : 'Ctrl+'
}

/** Format a shortcut key combo for display (e.g., ⌘K or Ctrl+K) */
export function formatShortcut(key: string, shift = false): string {
  const mod = isMac ? '⌘' : 'Ctrl+'
  const shiftStr = shift ? (isMac ? '⇧' : 'Shift+') : ''
  return `${shiftStr}${mod}${key.toUpperCase()}`
}

/* ============================================================
   Shortcut types
   ============================================================ */

export type ShortcutId =
  | 'openPalette'
  | 'newSession'
  | 'openSettings'
  | 'viewChat'
  | 'viewWorkflows'
  | 'viewAgents'
  | 'viewSkills'
  | 'viewMcp'
  | 'viewSettings'
  | 'toggleSidebar'
  | 'search'
  | 'escape'
  | 'focusComposer'

export type ShortcutBinding = {
  id: ShortcutId
  /** Human-readable label */
  label: string
  /** The key (e.key value) */
  key: string
  /** Whether Cmd (Mac) or Ctrl (Win/Linux) is required */
  mod: boolean
  /** Whether Shift is required */
  shift: boolean
  /** Description shown in command palette */
  description: string
  /** Group for palette categorization */
  group: 'navigation' | 'action' | 'settings'
}

/* ============================================================
   Default shortcuts
   ============================================================ */

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { id: 'openPalette',   label: '命令面板',       key: 'f', mod: true,  shift: false, description: '打开命令面板（支持搜索会话）',   group: 'action' },
  { id: 'newSession',    label: '新建会话',       key: 'n', mod: true,  shift: false, description: '创建一个新的聊天会话',           group: 'action' },
  { id: 'openSettings',  label: '设置',           key: ',', mod: true,  shift: false, description: '打开设置页面',                   group: 'settings' },
  { id: 'viewChat',      label: 'Chat 视图',      key: '1', mod: true,  shift: false, description: '切换到 Chat 视图',               group: 'navigation' },
  { id: 'viewWorkflows', label: 'Workflows 视图', key: '2', mod: true,  shift: false, description: '切换到 Workflows 视图',          group: 'navigation' },
  { id: 'viewAgents',    label: 'Agents 视图',    key: '3', mod: true,  shift: false, description: '切换到 Agents 视图',             group: 'navigation' },
  { id: 'viewSkills',    label: 'Skills 视图',    key: '4', mod: true,  shift: false, description: '切换到 Skills 视图',             group: 'navigation' },
  { id: 'viewMcp',       label: '连接器与 MCP 视图',       key: '5', mod: true,  shift: false, description: '切换到连接器与 MCP 视图',                group: 'navigation' },
  { id: 'viewSettings',  label: 'Settings 快捷', key: '6', mod: true,  shift: false, description: '切换到 Settings 视图',           group: 'navigation' },
  { id: 'toggleSidebar', label: '快捷录入任务',  key: 'b', mod: true,  shift: false, description: '打开全局任务快捷录入浮窗',       group: 'action' },
  { id: 'search',        label: '会话搜索',       key: 'k', mod: true,  shift: false, description: '聚焦侧边栏会话搜索框（Chat 页面）', group: 'action' },
  { id: 'escape',        label: '关闭',           key: 'Escape', mod: false, shift: false, description: '关闭当前对话框/面板/命令面板', group: 'action' },
  { id: 'focusComposer', label: '聚焦输入框',     key: 'l', mod: true,  shift: false, description: '聚焦聊天输入框并滚动到底部',     group: 'action' },
]

/* ============================================================
   Persistence
   ============================================================ */

export const SHORTCUTS_STORAGE_EVENT = 'spark-agent:shortcuts-updated'

const STORAGE_KEY = 'spark-agent:shortcuts'
const SHORTCUTS_VERSION_KEY = 'spark-agent:shortcuts-version'
const SHORTCUTS_SCHEMA_VERSION = 4

function migrateLegacyShortcutBindings(saved: Partial<ShortcutBinding>[]): Partial<ShortcutBinding>[] {
  const savedVersion = Number(localStorage.getItem(SHORTCUTS_VERSION_KEY) ?? '0')
  if (savedVersion >= SHORTCUTS_SCHEMA_VERSION) return saved

  const openPalette = saved.find((shortcut) => shortcut.id === 'openPalette')
  const search = saved.find((shortcut) => shortcut.id === 'search')
  if (openPalette?.key !== 'k' || search?.key !== 'f') return saved

  return saved.map((shortcut) => {
    if (shortcut.id === 'openPalette') return { ...shortcut, key: 'f' }
    if (shortcut.id === 'search') return { ...shortcut, key: 'k' }
    return shortcut
  })
}

export function loadShortcuts(): ShortcutBinding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = migrateLegacyShortcutBindings(JSON.parse(raw) as Partial<ShortcutBinding>[])
      // Merge saved over defaults (preserves ordering & new shortcuts)
      return DEFAULT_SHORTCUTS.map((def) => {
        const override = saved.find((s) => s.id === def.id)
        return override ? { ...def, ...override } : def
      })
    }
  } catch {
    // ignore corrupt data
  }
  return DEFAULT_SHORTCUTS
}

export function saveShortcuts(shortcuts: ShortcutBinding[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts))
    localStorage.setItem(SHORTCUTS_VERSION_KEY, String(SHORTCUTS_SCHEMA_VERSION))
    window.dispatchEvent(new CustomEvent(SHORTCUTS_STORAGE_EVENT))
  } catch {
    // ignore storage errors
  }
}

/* ============================================================
   Input-focus guard
   ============================================================ */

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

/* ============================================================
   Hook: useGlobalShortcuts
   ============================================================ */

type ShortcutActions = {
  setTweak: <K extends string>(key: K, val: unknown) => void
  /** Optional: trigger a custom search-focus action */
  onSearchFocus?: () => void
  /** Optional: trigger a custom new-session action */
  onNewSession?: () => void
  /** Optional: open the global quick task modal (Ctrl/Cmd+B) */
  onQuickTask?: () => void
  /** Optional: toggle the left sidebar visibility (legacy fallback) */
  onToggleSidebar?: () => void
  /** Optional: check if any overlay panel is currently open */
  hasOverlayOpen?: () => boolean
}

const VIEW_INDEX_MAP: Record<string, ViewId> = {
  '1': 'chat',
  '2': 'workflows',
  '3': 'agents',
  '4': 'skill-store',
  '5': 'mcp',
  '6': 'settings',
}

export function useGlobalShortcuts(actions: ShortcutActions): ShortcutBinding[] {
  const shortcutsRef = useRef<ShortcutBinding[]>(loadShortcuts())
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  // Keep localStorage in sync if shortcuts are updated externally
  useEffect(() => {
    const refreshShortcuts = () => {
      shortcutsRef.current = loadShortcuts()
    }
    refreshShortcuts()
    window.addEventListener(SHORTCUTS_STORAGE_EVENT, refreshShortcuts)
    return () => window.removeEventListener(SHORTCUTS_STORAGE_EVENT, refreshShortcuts)
  }, [])

  const handler = useCallback((e: KeyboardEvent) => {
    // ── 应用内刷新（Ctrl+R / Cmd+R）──────────────────────────────────
    // Chromium / Electron 默认会把 Ctrl+R 路由到 BrowserWindow.reload()，
    // 这会丢弃整个 React 状态、回到默认 view='chat'，用户在面板页里
    // 按刷新会被弹回会话界面。
    //
    // 我们在 keydown 阶段拦截：preventDefault 阻止硬刷新，然后抛出
    // 'spark:refresh-view' 事件，由当前 mounted 的视图自行处理刷新。
    // Shift+Ctrl+R 保留给 Electron 自己的硬刷新（带 cache-bypass），
    // 留作「真的想 reload 应用」的逃生口。
    const modRPressed = isMac ? e.metaKey : e.ctrlKey
    if (
      modRPressed &&
      !e.shiftKey &&
      !e.altKey &&
      e.key.toLowerCase() === 'r' &&
      !e.repeat
    ) {
      // 在 overlay 打开时（命令面板、权限弹窗等）不接管刷新，
      // 让用户沿用浏览器原生的 reload 行为（一般用不上，但更安全）。
      const overlayOpen = actionsRef.current.hasOverlayOpen?.() ?? false
      if (!overlayOpen) {
        e.preventDefault()
        e.stopPropagation()
        window.dispatchEvent(new CustomEvent('spark:refresh-view'))
        return
      }
    }

    const shortcuts = shortcutsRef.current
    const { setTweak, onSearchFocus, onNewSession, onQuickTask, onToggleSidebar, hasOverlayOpen } = actionsRef.current

    for (const sc of shortcuts) {
      const modPressed = isMac ? e.metaKey : e.ctrlKey
      const modMatch = sc.mod ? modPressed : !modPressed

      if (
        e.key === sc.key &&
        modMatch &&
        sc.shift === e.shiftKey
      ) {
        // For mod-required shortcuts, skip if input is focused, except command
        // palette and app search.
        if (sc.mod && sc.id !== 'search' && sc.id !== 'openPalette' && isEditableTarget(e.target)) continue
        // For Escape, always handle (even in inputs)
        if (sc.id === 'escape' && isEditableTarget(e.target)) {
          // Let the input handle Escape naturally (blur, etc.) — only close overlays
          // If no overlay is open, don't intercept
        }

        // For Escape with no overlay open, skip entirely
        if (sc.id === 'escape' && !hasOverlayOpen?.()) continue

        e.preventDefault()
        e.stopPropagation()

        switch (sc.id) {
          case 'openPalette':
            // Cmd/Ctrl+F opens the global palette so commands, sessions, and
            // menu navigation stay available behind one entry point.
            setTweak('paletteMode', 'global')
            setTweak('showPalette', true)
            break
          case 'newSession':
            if (onNewSession) {
              onNewSession()
            } else {
              setTweak('view', 'chat')
            }
            break
          case 'openSettings':
            setTweak('view', 'settings')
            break
          case 'viewChat':
          case 'viewWorkflows':
          case 'viewAgents':
          case 'viewSkills':
          case 'viewMcp':
          case 'viewSettings': {
            const viewId = VIEW_INDEX_MAP[sc.key]
            if (viewId) setTweak('view', viewId)
            break
          }
          case 'toggleSidebar': {
            // Ctrl/Cmd+B 现在用于全局快捷录入任务；保留 onToggleSidebar 作为旧调用方兜底。
            if (onQuickTask) onQuickTask()
            else onToggleSidebar?.()
            break
          }
          case 'search':
            if (onSearchFocus) {
              onSearchFocus()
            }
            break
          case 'focusComposer':
            window.dispatchEvent(new CustomEvent('spark:focus-composer'))
            break
          case 'escape': {
            const anyOpen = hasOverlayOpen ? hasOverlayOpen() : true
            if (anyOpen) {
              setTweak('showPalette', false)
              setTweak('showPerm', false)
              setTweak('showProviderEdit', false)
              setTweak('showProfileEdit', false)
            }
            break
          }
        }
        return // only first match
      }
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handler])

  return shortcutsRef.current
}

/* ============================================================
   Utility: ShortcutHint component helper
   ============================================================ */

/** Render a shortcut hint string for display in the UI */
export function getShortcutLabel(id: ShortcutId, shortcuts?: ShortcutBinding[]): string {
  const list = shortcuts ?? DEFAULT_SHORTCUTS
  const binding = list.find((s) => s.id === id)
  if (!binding) return ''
  if (binding.key === 'Escape') return 'esc'
  return formatShortcut(binding.key, binding.shift)
}
