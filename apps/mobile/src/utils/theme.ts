/**
 * 小程序主题状态：浅色 / 深色 / 跟随系统。
 *
 * 页面内容通过根节点 themeClass 切换；原生导航栏、窗口背景和下拉样式由本模块同步。
 * 不向认证 store 混入 UI 偏好，也不要求每个页面各自注册系统主题监听。
 */

import { getItem, setItem, StorageKeys } from './storage'

export type ThemePreference = 'system' | 'light' | 'dark'
export type EffectiveTheme = 'light' | 'dark'

export interface ThemeState {
  preference: ThemePreference
  resolved: EffectiveTheme
}

interface ThemePage {
  setData(data: Record<string, unknown>): void
}

const THEME_COLORS = {
  light: {
    background: '#f7f6f4',
    front: '#000000',
    text: '#1a1a1a',
    placeholder: '#b3b0ab',
    accent: '#3b82f6',
    track: '#d8d5d0',
    block: '#ffffff',
  },
  dark: {
    background: '#171716',
    front: '#ffffff',
    text: '#f2f1ef',
    placeholder: '#79766f',
    accent: '#60a5fa',
    track: '#484641',
    block: '#242422',
  },
} as const

let state: ThemeState = { preference: 'system', resolved: 'light' }
let initialized = false

function normalizePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

function readSystemTheme(): EffectiveTheme {
  try {
    return wx.getSystemInfoSync().theme === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function resolveTheme(preference: ThemePreference): EffectiveTheme {
  return preference === 'system' ? readSystemTheme() : preference
}

function preferenceLabel(preference: ThemePreference): string {
  if (preference === 'light') return '浅色'
  if (preference === 'dark') return '深色'
  return '跟随系统'
}

function pageThemeData(): Record<string, unknown> {
  const colors = THEME_COLORS[state.resolved]
  return {
    theme: state.resolved,
    themeClass: `theme-${state.resolved}`,
    themePreference: state.preference,
    themeModeLabel: preferenceLabel(state.preference),
    themeResolvedLabel: state.resolved === 'dark' ? '深色' : '浅色',
    themeTextColor: colors.text,
    themePlaceholderColor: colors.placeholder,
    themeAccentColor: colors.accent,
    themeTrackColor: colors.track,
    themeBlockColor: colors.block,
  }
}

function updatePage(page: ThemePage): void {
  try {
    page.setData(pageThemeData())
  } catch {
    // 页面正在销毁时不再阻塞主题切换
  }
}

/** 同步原生窗口。手动模式也需要更新，不能只依赖 app.json 的 darkmode。 */
function applyNativeTheme(): void {
  const colors = THEME_COLORS[state.resolved]
  const backgroundTextStyle = state.resolved === 'dark' ? 'light' : 'dark'
  try {
    wx.setNavigationBarColor?.({
      backgroundColor: colors.background,
      frontColor: colors.front,
      fail: () => {},
    })
    wx.setBackgroundColor?.({
      backgroundColor: colors.background,
      backgroundColorTop: colors.background,
      backgroundColorBottom: colors.background,
      fail: () => {},
    })
    wx.setBackgroundTextStyle?.({ textStyle: backgroundTextStyle, fail: () => {} })
  } catch {
    // 低版本基础库缺少原生窗口 API 时，页面内容主题仍可正常切换
  }
}

function applyTheme(): void {
  if (typeof getCurrentPages === 'function') {
    const pages = getCurrentPages() as unknown as ThemePage[]
    pages.forEach(updatePage)
  }
  applyNativeTheme()
}

/** App.onLaunch 调用一次；重复调用只校正原生窗口，不重复注册监听。 */
export function initTheme(): void {
  if (initialized) {
    if (state.preference === 'system') {
      const resolved = resolveTheme('system')
      if (resolved !== state.resolved) {
        state = { ...state, resolved }
        applyTheme()
        return
      }
    }
    applyNativeTheme()
    return
  }
  initialized = true
  const preference = normalizePreference(getItem<string>(StorageKeys.themePreference))
  state = { preference, resolved: resolveTheme(preference) }
  if (typeof wx.onThemeChange === 'function') {
    wx.onThemeChange(({ theme }) => {
      if (state.preference !== 'system') return
      const resolved = theme === 'dark' ? 'dark' : 'light'
      if (state.resolved === resolved) return
      state = { ...state, resolved }
      applyTheme()
    })
  }
  applyTheme()
}

/** 页面 onShow 调用：刷新根节点类，并校正新进入页面的原生窗口。 */
export function syncPageTheme(page: ThemePage): void {
  if (!initialized) initTheme()
  updatePage(page)
  applyNativeTheme()
}

export function setThemePreference(preference: ThemePreference): void {
  if (!initialized) initTheme()
  const normalized = normalizePreference(preference)
  setItem(StorageKeys.themePreference, normalized)
  const next = { preference: normalized, resolved: resolveTheme(normalized) }
  if (state.preference === next.preference && state.resolved === next.resolved) {
    applyNativeTheme()
    return
  }
  state = next
  applyTheme()
}

export function getThemeState(): ThemeState {
  return { ...state }
}

/** 原生 ActionSheet 等 JS API 使用当前文字色。 */
export function getThemeTextColor(): string {
  return THEME_COLORS[state.resolved].text
}
