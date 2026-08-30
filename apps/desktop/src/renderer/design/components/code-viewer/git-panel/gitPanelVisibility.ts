/**
 * Git 面板可见性 + 宽度 store（与文件树互斥，跨会话 / 跨重启持久化）。
 *
 * Git 面板与文件树共用同一个左侧栏槽位和拖拽条，但宽度各自独立偏好：
 * Git 面板内容（路径 + 状态徽章 + 行数）比文件树更宽，默认 300 且上限更高；
 * 互斥协调集中在 openGitPanel()（打开 Git 面板必收起文件树）与
 * CodeViewerPanel 的文件树开关（打开文件树时调 closeGitPanel()）。
 */

import { useSyncExternalStore } from 'react'
import { setCodeExplorerVisible } from '../file-explorer/fileExplorerVisibility'

const VISIBLE_KEY = 'spark-agent:code-git-panel-visible'
const WIDTH_KEY = 'spark-agent:code-git-panel-width'
const VIEW_KEY = 'spark-agent:code-git-panel-view'

const MIN_WIDTH = 200
const MAX_WIDTH = 520
const DEFAULT_WIDTH = 300

/** 更改列表显示方式：平铺（默认，同名自动消歧）或树形目录 */
export type GitPanelViewMode = 'list' | 'tree'

/** 拖拽宽度边界（供拖拽条 clamp 使用） */
export const GIT_PANEL_WIDTH_BOUNDS = { min: MIN_WIDTH, max: MAX_WIDTH }

const listeners = new Set<() => void>()

function readVisible(): boolean {
  // 默认收起：仅当用户显式打开过（localStorage 存了 'true'）才保持展开
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(VISIBLE_KEY)
    return raw === 'true'
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

function readViewMode(): GitPanelViewMode {
  if (typeof window === 'undefined') return 'list'
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'list'
  } catch {
    return 'list'
  }
}

let visible = readVisible()
let width = readWidth()
let viewMode = readViewMode()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getGitPanelVisible(): boolean {
  return visible
}

export function getGitPanelWidth(): number {
  return width
}

function setGitPanelVisible(next: boolean): void {
  if (visible === next) return
  visible = next
  try {
    window.localStorage.setItem(VISIBLE_KEY, String(next))
  } catch {
    /* 受限渲染上下文仍可使用内存状态 */
  }
  emit()
}

/** 更新 Git 面板宽度（自动 clamp 到 [min,max] 并持久化） */
export function setGitPanelWidth(next: number): void {
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

/** 打开 Git 面板（互斥：同时收起文件树）。审查面板「在编辑器中打开」等外部入口也走这里。 */
export function openGitPanel(): void {
  setCodeExplorerVisible(false)
  setGitPanelVisible(true)
}

/** 关闭 Git 面板（文件树开关打开时由 CodeViewerPanel 调用）。 */
export function closeGitPanel(): void {
  setGitPanelVisible(false)
}

/** 面板顶部开关直接切换（不联动文件树，互斥由调用方处理）。 */
export function toggleGitPanel(next: boolean): void {
  setGitPanelVisible(next)
}

export function getGitPanelViewMode(): GitPanelViewMode {
  return viewMode
}

/** 更改列表显示方式（平铺 / 树形）并持久化。 */
export function setGitPanelViewMode(next: GitPanelViewMode): void {
  if (viewMode === next) return
  viewMode = next
  try {
    window.localStorage.setItem(VIEW_KEY, next)
  } catch {
    /* localStorage 不可用时仅内存生效 */
  }
  emit()
}

export function useGitPanelVisible(): boolean {
  return useSyncExternalStore(subscribe, getGitPanelVisible, () => false)
}

export function useGitPanelWidth(): number {
  return useSyncExternalStore(subscribe, getGitPanelWidth, () => DEFAULT_WIDTH)
}

export function useGitPanelViewMode(): GitPanelViewMode {
  return useSyncExternalStore(subscribe, getGitPanelViewMode, () => 'list' as const)
}

export function resetGitPanelSettingsForTest(): void {
  visible = readVisible()
  width = readWidth()
  viewMode = readViewMode()
  emit()
}
