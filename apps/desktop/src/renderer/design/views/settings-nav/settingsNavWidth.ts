/**
 * 设置左侧导航宽度偏好（全局、跨重启持久化）。
 *
 * 与 components/code-viewer 下三个宽度 store 同构：模块级状态 + Set<listeners>
 * + useSyncExternalStore + localStorage。区别在于本偏好没有独立的宽度容器 ——
 * 布局由 CSS 变量驱动，所以每次写入都把宽度同步到 `document.documentElement`
 * 的 `--settings-nav-width` 上。
 *
 * 必须写**根节点**而不是 `.settings-layout`：标题栏
 * （`.app.titlebar-surface-settings .shell-titlebar`）用同一个变量绘制
 * 「导航底色 → 内容底色」的渐变分界，只有写在根节点上，两层表面才共用一份宽度。
 */

import { useSyncExternalStore } from 'react'

const WIDTH_KEY = 'spark-agent:settings-nav-width'
const CSS_VAR = '--settings-nav-width'

/** 默认宽度，需与 styles.css 里 `--settings-nav-width` 的初值保持一致 */
export const SETTINGS_NAV_WIDTH_DEFAULT = 240
const MIN_WIDTH = 200
const MAX_WIDTH = 460

/** 拖拽条 clamp 边界 */
export const SETTINGS_NAV_WIDTH_BOUNDS = { min: MIN_WIDTH, max: MAX_WIDTH }
/** 方向键单次步进（按住 Shift 翻倍） */
export const SETTINGS_NAV_KEYBOARD_STEP = 16

const listeners = new Set<() => void>()

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return SETTINGS_NAV_WIDTH_DEFAULT
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)))
}

function readWidth(): number {
  if (typeof window === 'undefined') return SETTINGS_NAV_WIDTH_DEFAULT
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY)
    // 未写入过时 getItem 返回 null → 沿用默认宽度，不下发内联变量
    if (raw == null) return SETTINGS_NAV_WIDTH_DEFAULT
    return clampWidth(Number(raw))
  } catch {
    /* localStorage 不可用时退回默认宽度 */
  }
  return SETTINGS_NAV_WIDTH_DEFAULT
}

/** 即时下发 CSS 变量；等于默认值时清掉内联值，让 styles.css 继续充当默认的唯一来源 */
function applyWidth(next: number): void {
  if (typeof document === 'undefined') return
  const style = document.documentElement.style
  if (next === SETTINGS_NAV_WIDTH_DEFAULT) style.removeProperty(CSS_VAR)
  else style.setProperty(CSS_VAR, `${next}px`)
}

let width = readWidth()
// 模块首次被引入（React.lazy 加载设置页）时即恢复偏好，避免首帧先用默认宽度再回弹
applyWidth(width)

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSettingsNavWidth(): number {
  return width
}

/** 更新导航宽度：clamp → 写 CSS 变量（即时生效）→ 落盘 */
export function setSettingsNavWidth(next: number): void {
  const clamped = clampWidth(next)
  applyWidth(clamped)
  if (clamped === width) return
  width = clamped
  try {
    window.localStorage.setItem(WIDTH_KEY, String(clamped))
  } catch {
    /* 受限渲染上下文仍可使用内存偏好 */
  }
  emit()
}

export function useSettingsNavWidth(): number {
  return useSyncExternalStore(subscribe, getSettingsNavWidth, () => SETTINGS_NAV_WIDTH_DEFAULT)
}

export function resetSettingsNavWidthForTest(): void {
  width = readWidth()
  applyWidth(width)
  emit()
}
