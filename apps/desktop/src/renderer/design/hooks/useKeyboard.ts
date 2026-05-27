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
import type { ViewId, SidebarState } from '../AppContext'

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
  | 'newProject'
  | 'openSettings'
  | 'viewHome'
  | 'viewChat'
  | 'viewProjects'
  | 'viewWorkflows'
  | 'viewAgents'
  | 'viewSkills'
  | 'viewMcp'
  | 'viewSettings'
  | 'toggleSidebar'
  | 'search'
  | 'escape'

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
  { id: 'openPalette',   label: '命令面板',       key: 'k', mod: true,  shift: false, description: '打开命令面板',                   group: 'action' },
  { id: 'newSession',    label: '新建会话',       key: 'n', mod: true,  shift: false, description: '创建一个新的聊天会话',           group: 'action' },
  { id: 'newProject',    label: '新建项目',       key: 'n', mod: true,  shift: true,  description: '创建一个新项目',                 group: 'action' },
  { id: 'openSettings',  label: '设置',           key: ',', mod: true,  shift: false, description: '打开设置页面',                   group: 'settings' },
  { id: 'viewHome',      label: 'Home 视图',      key: '1', mod: true,  shift: false, description: '切换到 Home 视图',               group: 'navigation' },
  { id: 'viewChat',      label: 'Chat 视图',      key: '2', mod: true,  shift: false, description: '切换到 Chat 视图',               group: 'navigation' },
  { id: 'viewProjects',  label: 'Projects 视图',  key: '3', mod: true,  shift: false, description: '切换到 Projects 视图',           group: 'navigation' },
  { id: 'viewWorkflows', label: 'Workflows 视图', key: '4', mod: true,  shift: false, description: '切换到 Workflows 视图',          group: 'navigation' },
  { id: 'viewAgents',    label: 'Agents 视图',    key: '5', mod: true,  shift: false, description: '切换到 Agents 视图',             group: 'navigation' },
  { id: 'viewSkills',    label: 'Skills 视图',    key: '6', mod: true,  shift: false, description: '切换到 Skills 视图',             group: 'navigation' },
  { id: 'viewMcp',       label: 'MCP 视图',       key: '7', mod: true,  shift: false, description: '切换到 MCP 视图',                group: 'navigation' },
  { id: 'viewSettings',  label: 'Settings 快捷', key: '8', mod: true,  shift: false, description: '切换到 Settings 视图',           group: 'navigation' },
  { id: 'toggleSidebar', label: '切换侧边栏',    key: 'b', mod: true,  shift: false, description: '折叠/展开侧边栏',               group: 'action' },
  { id: 'search',        label: '搜索',           key: 'f', mod: true,  shift: false, description: '聚焦搜索框（Chat 页面）',        group: 'action' },
  { id: 'escape',        label: '关闭',           key: 'Escape', mod: false, shift: false, description: '关闭当前对话框/面板/命令面板', group: 'action' },
]

/* ============================================================
   Persistence
   ============================================================ */

const STORAGE_KEY = 'spark-agent:shortcuts'

export function loadShortcuts(): ShortcutBinding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved: Partial<ShortcutBinding>[] = JSON.parse(raw)
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
  } catch {
    // ignore storage errors
  }
}

/* ============================================================
   Input-focus guard
   ============================================================ */

function isEditableTarget(target: EventTarget | null): boolean {
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
  /** Optional: trigger a custom new-project action */
  onNewProject?: () => void
}

const VIEW_INDEX_MAP: Record<string, ViewId> = {
  '1': 'home',
  '2': 'chat',
  '3': 'projects',
  '4': 'workflows',
  '5': 'agents',
  '6': 'skills',
  '7': 'mcp',
  '8': 'settings',
}

export function useGlobalShortcuts(actions: ShortcutActions): ShortcutBinding[] {
  const shortcutsRef = useRef<ShortcutBinding[]>(loadShortcuts())
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  // Keep localStorage in sync if shortcuts are updated externally
  useEffect(() => {
    shortcutsRef.current = loadShortcuts()
  }, [])

  const handler = useCallback((e: KeyboardEvent) => {
    const shortcuts = shortcutsRef.current
    const { setTweak, onSearchFocus, onNewSession, onNewProject } = actionsRef.current

    for (const sc of shortcuts) {
      const modPressed = isMac ? e.metaKey : e.ctrlKey
      const modMatch = sc.mod ? modPressed : !modPressed

      if (
        e.key === sc.key &&
        modMatch &&
        sc.shift === e.shiftKey
      ) {
        // For mod-required shortcuts, skip if input is focused
        if (sc.mod && isEditableTarget(e.target)) continue
        // For Escape, always handle (even in inputs)
        if (sc.id === 'escape' && isEditableTarget(e.target)) {
          // Let the input handle Escape naturally (blur, etc.) — only close overlays
          // If no overlay is open, don't intercept
        }

        e.preventDefault()
        e.stopPropagation()

        switch (sc.id) {
          case 'openPalette':
            setTweak('showPalette', true)
            break
          case 'newSession':
            if (onNewSession) {
              onNewSession()
            } else {
              setTweak('view', 'chat')
            }
            break
          case 'newProject':
            if (onNewProject) {
              onNewProject()
            } else {
              setTweak('view', 'projects')
            }
            break
          case 'openSettings':
            setTweak('view', 'settings')
            break
          case 'viewHome':
          case 'viewChat':
          case 'viewProjects':
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
            // We need to read current sidebar state — use a heuristic
            // The setTweak will be handled by the component reading current state
            setTweak('__toggleSidebar', true)
            break
          }
          case 'search':
            if (onSearchFocus) {
              onSearchFocus()
            }
            break
          case 'escape':
            setTweak('showPalette', false)
            setTweak('showPerm', false)
            setTweak('showProviderEdit', false)
            setTweak('showProfileEdit', false)
            break
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
