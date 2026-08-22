export type CanvasWindowTheme = 'light' | 'dark'

export const CANVAS_WINDOW_THEME_STORAGE_KEY = 'spark-agent:canvas-window-theme'
export const DEFAULT_CANVAS_WINDOW_THEME: CanvasWindowTheme = 'dark'

type CanvasWindowThemeStorage = Pick<Storage, 'getItem' | 'setItem'>

function resolveStorage(storage?: CanvasWindowThemeStorage): CanvasWindowThemeStorage | null {
  if (storage != null) return storage
  if (typeof window === 'undefined') return null
  return window.localStorage
}

export function readCanvasWindowTheme(storage?: CanvasWindowThemeStorage): CanvasWindowTheme {
  try {
    const stored = resolveStorage(storage)?.getItem(CANVAS_WINDOW_THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : DEFAULT_CANVAS_WINDOW_THEME
  } catch {
    return DEFAULT_CANVAS_WINDOW_THEME
  }
}

export function persistCanvasWindowTheme(
  theme: CanvasWindowTheme,
  storage?: CanvasWindowThemeStorage,
): void {
  try {
    resolveStorage(storage)?.setItem(CANVAS_WINDOW_THEME_STORAGE_KEY, theme)
  } catch {
    // A storage failure should not prevent changing the theme in the current window.
  }
}
