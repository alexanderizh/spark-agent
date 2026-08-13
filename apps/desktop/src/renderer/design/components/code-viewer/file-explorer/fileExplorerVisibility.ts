/**
 * 文件树可见性 + 宽度的全局 store（跨会话 / 跨重启持久化）。
 *
 * 设计与 team-log-visibility.ts 一致：模块级状态 + Set<listeners> + useSyncExternalStore
 * + localStorage。visible/width 是用户对文件树的整体偏好（与会话无关），故走全局持久化；
 * 展开目录集合与会话强相关，由 ChatView 的 per-session 快照承载（见 PanelSnapshot）。
 */

import { useSyncExternalStore } from 'react'

const VISIBLE_KEY = 'spark-agent:code-explorer-visible'
const WIDTH_KEY = 'spark-agent:code-explorer-width'

const MIN_WIDTH = 180
const MAX_WIDTH = 460
const DEFAULT_WIDTH = 240

/** 拖拽宽度边界（供拖拽条 clamp 使用） */
export const CODE_EXPLORER_WIDTH_BOUNDS = { min: MIN_WIDTH, max: MAX_WIDTH }

interface ExplorerSettings {
  visible: boolean
  width: number
}

const listeners = new Set<() => void>()

function clampWidth(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(v)))
}

function readSettings(): ExplorerSettings {
  const fallback: ExplorerSettings = { visible: false, width: DEFAULT_WIDTH }
  if (typeof window === 'undefined') return fallback
  let visible = false
  let width = DEFAULT_WIDTH
  try {
    visible = window.localStorage.getItem(VISIBLE_KEY) === 'true'
  } catch {
    /* localStorage 不可用时退回内存默认值 */
  }
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY)
    if (raw != null) width = clampWidth(Number(raw))
  } catch {
    /* 同上 */
  }
  return { visible, width }
}

let settings: ExplorerSettings = readSettings()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getCodeExplorerVisible(): boolean {
  return settings.visible
}

export function getCodeExplorerWidth(): number {
  return settings.width
}

/** 切换文件树开关；首次打开后即持久化，后续无论从哪进入都沿用缓存状态 */
export function setCodeExplorerVisible(next: boolean): void {
  if (settings.visible === next) return
  settings = { ...settings, visible: next }
  try {
    window.localStorage.setItem(VISIBLE_KEY, String(next))
  } catch {
    /* 受限渲染上下文仍可使用内存偏好 */
  }
  emit()
}

/** 更新文件树宽度（自动 clamp 到 [min,max] 并持久化） */
export function setCodeExplorerWidth(next: number): void {
  const clamped = clampWidth(next)
  if (settings.width === clamped) return
  settings = { ...settings, width: clamped }
  try {
    window.localStorage.setItem(WIDTH_KEY, String(clamped))
  } catch {
    /* 同上 */
  }
  emit()
}

export function useCodeExplorerVisible(): boolean {
  return useSyncExternalStore(subscribe, getCodeExplorerVisible, () => false)
}

export function useCodeExplorerWidth(): number {
  return useSyncExternalStore(subscribe, getCodeExplorerWidth, () => DEFAULT_WIDTH)
}

export function resetCodeExplorerSettingsForTest(): void {
  settings = readSettings()
  emit()
}
