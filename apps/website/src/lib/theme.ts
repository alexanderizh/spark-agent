/**
 * 主题（浅色 / 深色）工具：按时间默认 + localStorage 持久化。
 * 首屏由 index.html 的 inline 脚本同步写入 data-theme，本模块负责运行时切换与读取。
 */

export type ThemeName = 'light' | 'dark'

export const LIGHT: ThemeName = 'light'
export const DARK: ThemeName = 'dark'

/** 本地 6:00–18:59 视为白天 → 浅色，其余 → 深色 */
const TIME_LIGHT_START = 6
const TIME_LIGHT_END = 19

const STORAGE_KEY = 'theme'

/** 浏览器地址栏/标题栏底色，随主题同步 */
const THEME_COLOR: Record<ThemeName, string> = {
  light: '#f6f7fb',
  dark: '#0a0b0f',
}

export function getTimeBasedTheme(): ThemeName {
  const h = new Date().getHours()
  return h >= TIME_LIGHT_START && h < TIME_LIGHT_END ? LIGHT : DARK
}

function isValidTheme(v: unknown): v is ThemeName {
  return v === LIGHT || v === DARK
}

/** 读取用户已保存的偏好；无合法值返回 null（调用方应回退到按时间） */
export function getStoredTheme(): ThemeName | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isValidTheme(v) ? v : null
  } catch {
    return null
  }
}

/** 当前应当采用的主题：有合法偏好用之，否则按本地时间 */
export function resolveTheme(): ThemeName {
  return getStoredTheme() ?? getTimeBasedTheme()
}

/** 当前 <html> 上实际生效的主题（防闪脚本已设好） */
export function getActiveTheme(): ThemeName {
  const t = document.documentElement.dataset.theme
  return isValidTheme(t) ? t : DARK
}

/** 应用主题：写 data-theme + 持久化 + 同步浏览器主题色 */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* 无痕模式等场景，静默忽略 */
  }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[theme])
}

/** 在两态间翻转 */
export function toggleTheme(): ThemeName {
  const next: ThemeName = getActiveTheme() === LIGHT ? DARK : LIGHT
  applyTheme(next)
  return next
}
