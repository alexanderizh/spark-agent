import { describe, expect, it } from 'vitest'
import {
  CANVAS_COMPOSER_ADVANCED_OPEN_KEY,
  readCanvasComposerAdvancedOpen,
  writeCanvasComposerAdvancedOpen,
} from './canvasComposerPreferences'

function memoryStorage(initial?: string): Storage {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(CANVAS_COMPOSER_ADVANCED_OPEN_KEY, initial)
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

describe('canvasComposerPreferences', () => {
  it('defaults to collapsed and restores a persisted open state', () => {
    expect(readCanvasComposerAdvancedOpen(memoryStorage())).toBe(false)
    expect(readCanvasComposerAdvancedOpen(memoryStorage('true'))).toBe(true)
  })

  it('writes a stable boolean value', () => {
    const storage = memoryStorage()
    writeCanvasComposerAdvancedOpen(true, storage)
    expect(storage.getItem(CANVAS_COMPOSER_ADVANCED_OPEN_KEY)).toBe('true')
  })

  it('fails closed for malformed or unavailable storage', () => {
    expect(readCanvasComposerAdvancedOpen(memoryStorage('{bad'))).toBe(false)
    const throwing = {
      getItem: () => {
        throw new Error('unavailable')
      },
      setItem: () => {
        throw new Error('unavailable')
      },
    }
    expect(readCanvasComposerAdvancedOpen(throwing)).toBe(false)
    expect(() => writeCanvasComposerAdvancedOpen(true, throwing)).not.toThrow()
  })
})
