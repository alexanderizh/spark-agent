import { describe, expect, it } from 'vitest'
import {
  CANVAS_BATCH_SUBMIT_CONFIRMATION_KEY,
  readSkipCanvasBatchSubmitConfirmation,
  writeSkipCanvasBatchSubmitConfirmation,
} from './canvasBatchSubmitPreferences'

function memoryStorage(initial?: string): Storage {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(CANVAS_BATCH_SUBMIT_CONFIRMATION_KEY, initial)
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

describe('canvasBatchSubmitPreferences', () => {
  it('defaults to showing confirmation', () => {
    expect(readSkipCanvasBatchSubmitConfirmation(memoryStorage())).toBe(false)
    expect(readSkipCanvasBatchSubmitConfirmation(memoryStorage('invalid'))).toBe(false)
  })

  it('persists and resets the global user preference', () => {
    const storage = memoryStorage()

    writeSkipCanvasBatchSubmitConfirmation(true, storage)
    expect(storage.getItem(CANVAS_BATCH_SUBMIT_CONFIRMATION_KEY)).toBe('true')
    expect(readSkipCanvasBatchSubmitConfirmation(storage)).toBe(true)

    writeSkipCanvasBatchSubmitConfirmation(false, storage)
    expect(storage.getItem(CANVAS_BATCH_SUBMIT_CONFIRMATION_KEY)).toBeNull()
    expect(readSkipCanvasBatchSubmitConfirmation(storage)).toBe(false)
  })

  it('fails closed when storage is unavailable', () => {
    const throwing = {
      getItem: () => {
        throw new Error('unavailable')
      },
      setItem: () => {
        throw new Error('unavailable')
      },
      removeItem: () => {
        throw new Error('unavailable')
      },
    }

    expect(readSkipCanvasBatchSubmitConfirmation(throwing)).toBe(false)
    expect(() => writeSkipCanvasBatchSubmitConfirmation(true, throwing)).not.toThrow()
  })
})
