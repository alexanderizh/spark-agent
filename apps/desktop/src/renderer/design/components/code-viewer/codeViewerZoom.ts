/**
 * 代码编辑器缩放偏好（跨会话 / 跨重启持久化，localStorage）。
 *
 * 顶部行右侧 【- n% +】 控件：步进 10%，范围 [50, 200]，点百分比数字重置 100%。
 * 作用于 Monaco fontSize（基准 13px，行高同步）与 diff 视图字号（基准 12.5px，
 * 行高为相对值自动跟随）。
 */

import { useSyncExternalStore } from 'react'

const ZOOM_KEY = 'spark-agent:code-viewer-zoom'

const MIN_ZOOM = 50
const MAX_ZOOM = 200
const DEFAULT_ZOOM = 100
const ZOOM_STEP = 10

/** Monaco 基准字号 / 行高（未缩放时的值，与 CodeViewerEditor 原默认一致） */
const EDITOR_BASE_FONT_SIZE = 13
const EDITOR_BASE_LINE_HEIGHT = 20
/** diff 视图基准字号（与 index.less .code-viewer-diff 原值一致） */
const DIFF_BASE_FONT_SIZE = 12.5

/** 缩放边界（供按钮 disabled 判定） */
export const CODE_VIEWER_ZOOM_BOUNDS = { min: MIN_ZOOM, max: MAX_ZOOM }

function clampZoom(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(v)))
}

function readZoom(): number {
  if (typeof window === 'undefined') return DEFAULT_ZOOM
  try {
    const raw = window.localStorage.getItem(ZOOM_KEY)
    if (raw != null) return clampZoom(Number(raw))
  } catch {
    /* localStorage 不可用时退回内存默认值 */
  }
  return DEFAULT_ZOOM
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

let zoom = readZoom()

export function getCodeViewerZoom(): number {
  return zoom
}

/** 设置缩放（自动 clamp 并持久化） */
export function setCodeViewerZoom(next: number): void {
  const clamped = clampZoom(next)
  if (zoom === clamped) return
  zoom = clamped
  try {
    window.localStorage.setItem(ZOOM_KEY, String(clamped))
  } catch {
    /* 受限渲染上下文仍可使用内存状态 */
  }
  emit()
}

/** 步进缩放（+10 / -10） */
export function stepCodeViewerZoom(delta: number): void {
  setCodeViewerZoom(zoom + delta)
}

/** 重置到 100% */
export function resetCodeViewerZoom(): void {
  setCodeViewerZoom(DEFAULT_ZOOM)
}

export function useCodeViewerZoom(): number {
  return useSyncExternalStore(subscribe, getCodeViewerZoom, () => DEFAULT_ZOOM)
}

/** 缩放百分比 → Monaco fontSize（px，下限 9 保证极端缩小仍可读） */
export function editorFontSizeFor(z: number): number {
  return Math.max(9, Math.round((EDITOR_BASE_FONT_SIZE * z) / 100))
}

/** fontSize → 匹配的行高（保持基准 13→20 的比例，四舍五入取整） */
export function editorLineHeightFor(fontSize: number): number {
  return Math.round((fontSize * EDITOR_BASE_LINE_HEIGHT) / EDITOR_BASE_FONT_SIZE)
}

/** 缩放百分比 → diff 视图字号（px，保留 1 位小数，下限 9） */
export function diffFontSizeFor(z: number): number {
  return Math.max(9, Math.round(((DIFF_BASE_FONT_SIZE * z) / 100) * 10) / 10)
}

/** 测试辅助：重置为 localStorage 中的值并广播 */
export function resetCodeViewerZoomForTest(): void {
  zoom = readZoom()
  emit()
}
