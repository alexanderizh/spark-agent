import { describe, expect, it } from 'vitest'
import {
  CANVAS_WINDOW_THEME_STORAGE_KEY,
  DEFAULT_CANVAS_WINDOW_THEME,
  persistCanvasWindowTheme,
  readCanvasWindowTheme,
} from './canvas-window-theme'

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    read: (key: string) => values.get(key),
  }
}

describe('canvas window theme persistence', () => {
  it('defaults to dark and ignores unsupported stored values', () => {
    expect(readCanvasWindowTheme(createStorage())).toBe(DEFAULT_CANVAS_WINDOW_THEME)
    expect(
      readCanvasWindowTheme(createStorage({ [CANVAS_WINDOW_THEME_STORAGE_KEY]: 'system' })),
    ).toBe('dark')
  })

  it('reads and writes light/dark choices through the dedicated storage key', () => {
    const storage = createStorage()

    persistCanvasWindowTheme('light', storage)

    expect(storage.read(CANVAS_WINDOW_THEME_STORAGE_KEY)).toBe('light')
    expect(readCanvasWindowTheme(storage)).toBe('light')
  })
})
