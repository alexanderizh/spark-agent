/**
 * 搜索面板可见性 + 宽度 store（与文件树 / Git 面板互斥，跨会话 / 跨重启持久化）。
 *
 * 三者共用同一个左侧栏槽位和拖拽条，宽度各自独立偏好；
 * 互斥协调集中在 openSearchPanel()（打开搜索必收起文件树与 Git 面板），
 * 对应地 CodeViewerPanel 打开文件树 / Git 面板时调 closeSearchPanel()。
 */

import { useSyncExternalStore } from 'react'
import { setCodeExplorerVisible } from '../file-explorer/fileExplorerVisibility'
import { toggleGitPanel } from '../git-panel/gitPanelVisibility'

const VISIBLE_KEY = 'spark-agent:code-search-panel-visible'
const WIDTH_KEY = 'spark-agent:code-search-panel-width'

const MIN_WIDTH = 240
const MAX_WIDTH = 640
const DEFAULT_WIDTH = 380

/** 搜索模式：文件名（quick open）/ 内容（跨文件） */
export type SearchPanelMode = 'files' | 'content'

const MODE_KEY = 'spark-agent:code-search-panel-mode'
const MODE_SCHEMA_KEY = 'spark-agent:code-search-panel-mode-schema'
const MODE_SCHEMA_VERSION = 2

/** 拖拽宽度边界（供拖拽条 clamp 使用） */
export const SEARCH_PANEL_WIDTH_BOUNDS = { min: MIN_WIDTH, max: MAX_WIDTH }

const listeners = new Set<() => void>()

function readVisible(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(VISIBLE_KEY) === 'true'
  } catch {
    return false
  }
}

function clampWidth(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(v)))
}

function readWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY)
    if (raw != null) return clampWidth(Number(raw))
  } catch {
    /* localStorage 不可用时退回内存默认值 */
  }
  return DEFAULT_WIDTH
}

function readMode(): SearchPanelMode {
  if (typeof window === 'undefined') return 'content'
  try {
    // v1 默认写入 files；升级到 v2 时迁移为新的产品默认「内容搜索」。此后尊重用户选择。
    const version = Number(window.localStorage.getItem(MODE_SCHEMA_KEY) ?? '0')
    if (version < MODE_SCHEMA_VERSION) {
      window.localStorage.setItem(MODE_KEY, 'content')
      window.localStorage.setItem(MODE_SCHEMA_KEY, String(MODE_SCHEMA_VERSION))
      return 'content'
    }
    return window.localStorage.getItem(MODE_KEY) === 'files' ? 'files' : 'content'
  } catch {
    return 'content'
  }
}

let visible = readVisible()
let width = readWidth()
let mode = readMode()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSearchPanelVisible(): boolean {
  return visible
}

export function getSearchPanelWidth(): number {
  return width
}

export function getSearchPanelMode(): SearchPanelMode {
  return mode
}

function setSearchPanelVisible(next: boolean): void {
  if (visible === next) return
  visible = next
  try {
    window.localStorage.setItem(VISIBLE_KEY, String(next))
  } catch {
    /* 受限渲染上下文仍可使用内存状态 */
  }
  emit()
}

/** 更新搜索面板宽度（自动 clamp 并持久化） */
export function setSearchPanelWidth(next: number): void {
  const clamped = clampWidth(next)
  if (width === clamped) return
  width = clamped
  try {
    window.localStorage.setItem(WIDTH_KEY, String(clamped))
  } catch {
    /* 同上 */
  }
  emit()
}

/** 打开搜索面板（互斥：同时收起文件树与 Git 面板）。 */
export function openSearchPanel(nextMode?: SearchPanelMode): void {
  setCodeExplorerVisible(false)
  toggleGitPanel(false)
  if (nextMode != null) setSearchPanelMode(nextMode)
  setSearchPanelVisible(true)
}

/** 关闭搜索面板（文件树 / Git 面板打开时由 CodeViewerPanel 调用）。 */
export function closeSearchPanel(): void {
  setSearchPanelVisible(false)
}

/** 顶部开关直接切换（不联动其他面板，互斥由调用方处理）。 */
export function toggleSearchPanel(next: boolean): void {
  setSearchPanelVisible(next)
}

/** 更新搜索模式并持久化。 */
export function setSearchPanelMode(next: SearchPanelMode): void {
  if (mode === next) return
  mode = next
  try {
    window.localStorage.setItem(MODE_KEY, next)
    window.localStorage.setItem(MODE_SCHEMA_KEY, String(MODE_SCHEMA_VERSION))
  } catch {
    /* localStorage 不可用时仅内存生效 */
  }
  emit()
}

export function useSearchPanelVisible(): boolean {
  return useSyncExternalStore(subscribe, getSearchPanelVisible, () => false)
}

export function useSearchPanelWidth(): number {
  return useSyncExternalStore(subscribe, getSearchPanelWidth, () => DEFAULT_WIDTH)
}

export function useSearchPanelMode(): SearchPanelMode {
  return useSyncExternalStore(subscribe, getSearchPanelMode, () => 'content' as const)
}

export function resetSearchPanelSettingsForTest(): void {
  visible = readVisible()
  width = readWidth()
  mode = readMode()
  emit()
}
