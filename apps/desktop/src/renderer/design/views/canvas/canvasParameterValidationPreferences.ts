export const CANVAS_PARAMETER_VALIDATION_PREFERENCE_KEY =
  'spark-canvas:parameter-validation:skip:v1'
export const CANVAS_PARAMETER_VALIDATION_PREFERENCE_EVENT =
  'spark-canvas:parameter-validation-preference-changed'

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem' | 'removeItem'>

function defaultStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

export function readSkipCanvasParameterValidation(
  storage: ReadStorage | null = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(CANVAS_PARAMETER_VALIDATION_PREFERENCE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeSkipCanvasParameterValidation(
  skip: boolean,
  storage: WriteStorage | null = defaultStorage(),
): void {
  try {
    if (skip) storage?.setItem(CANVAS_PARAMETER_VALIDATION_PREFERENCE_KEY, 'true')
    else storage?.removeItem(CANVAS_PARAMETER_VALIDATION_PREFERENCE_KEY)
    globalThis.dispatchEvent?.(new Event(CANVAS_PARAMETER_VALIDATION_PREFERENCE_EVENT))
  } catch {
    // preference storage is optional and must never block task submission
  }
}
