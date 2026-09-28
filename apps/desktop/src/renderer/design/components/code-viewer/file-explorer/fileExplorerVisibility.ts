/**
 * 文件树可见性 + 宽度的全局 store（跨会话 / 跨重启持久化）。
 *
 * 设计与 team-log-visibility.ts 一致：模块级状态 + Set<listeners> + useSyncExternalStore
 * + localStorage。visible/width 是用户对文件树的整体偏好（与会话无关），故走全局持久化；
 * 展开目录集合与项目强相关，由 ChatView 的 per-project 快照承载（见 CodePanelSnapshot）。
 */

import { useSyncExternalStore } from 'react'

const VISIBLE_KEY = 'spark-agent:code-explorer-visible'
const WIDTH_KEY = 'spark-agent:code-explorer-width'
// 宽度偏好的 schema 版本：v2 收窄默认值（240 → 200）与上限（460 → 400），
// 让老用户缓存里那份「偏宽」的旧偏好一次性重置为新默认；此后尊重用户手动拖拽的结果。
const WIDTH_SCHEMA_KEY = 'spark-agent:code-explorer-width-schema'
const WIDTH_SCHEMA_VERSION = 2

const MIN_WIDTH = 160
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 200

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
  // 默认展开文件树；仅当用户显式收起过（localStorage 存了 'false'）才保持收起
  const fallback: ExplorerSettings = { visible: true, width: DEFAULT_WIDTH }
  if (typeof window === 'undefined') return fallback
  let visible = true
  let width = DEFAULT_WIDTH
  try {
    const raw = window.localStorage.getItem(VISIBLE_KEY)
    // 仅在用户显式操作过（存了 'true'/'false'）时才覆盖默认值；
    // 未写入过时 getItem 返回 null，保持默认展开
    if (raw != null) visible = raw === 'true'
  } catch {
    /* localStorage 不可用时退回内存默认值 */
  }
  try {
    const version = Number(window.localStorage.getItem(WIDTH_SCHEMA_KEY) ?? '0')
    if (version < WIDTH_SCHEMA_VERSION) {
      persistWidth(DEFAULT_WIDTH)
      return { visible, width: DEFAULT_WIDTH }
    }
    const raw = window.localStorage.getItem(WIDTH_KEY)
    if (raw != null) width = clampWidth(Number(raw))
  } catch {
    /* 同上 */
  }
  return { visible, width }
}

/** 写入宽度偏好并同步 schema 版本（避免下一次启动被迁移逻辑再重置一次） */
function persistWidth(next: number): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(next))
    window.localStorage.setItem(WIDTH_SCHEMA_KEY, String(WIDTH_SCHEMA_VERSION))
  } catch {
    /* 受限渲染上下文仍可使用内存偏好 */
  }
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
  persistWidth(clamped)
  emit()
}

export function useCodeExplorerVisible(): boolean {
  return useSyncExternalStore(subscribe, getCodeExplorerVisible, () => true)
}

export function useCodeExplorerWidth(): number {
  return useSyncExternalStore(subscribe, getCodeExplorerWidth, () => DEFAULT_WIDTH)
}

export function resetCodeExplorerSettingsForTest(): void {
  settings = readSettings()
  emit()
}
