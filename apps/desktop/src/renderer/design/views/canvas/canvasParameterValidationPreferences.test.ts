import { beforeEach, describe, expect, it } from 'vitest'
import {
  CANVAS_PARAMETER_VALIDATION_PREFERENCE_KEY,
  readSkipCanvasParameterValidation,
  writeSkipCanvasParameterValidation,
} from './canvasParameterValidationPreferences'

function memoryStorage(initial?: string): Storage {
  let value = initial
  return {
    getItem: () => value ?? null,
    setItem: (_key, next) => {
      value = next
    },
    removeItem: () => {
      value = undefined
    },
    clear: () => {
      value = undefined
    },
    key: () => null,
    length: value == null ? 0 : 1,
  }
}

describe('canvas parameter validation preference', () => {
  beforeEach(() => {
    expect(CANVAS_PARAMETER_VALIDATION_PREFERENCE_KEY).toContain('parameter-validation')
  })

  it('defaults to validating and persists the explicit opt-out', () => {
    const storage = memoryStorage()
    expect(readSkipCanvasParameterValidation(storage)).toBe(false)

    writeSkipCanvasParameterValidation(true, storage)
    expect(readSkipCanvasParameterValidation(storage)).toBe(true)

    writeSkipCanvasParameterValidation(false, storage)
    expect(readSkipCanvasParameterValidation(storage)).toBe(false)
  })
})
