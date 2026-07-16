export const CANVAS_BATCH_SUBMIT_CONFIRMATION_KEY =
  'spark-canvas:batch-submit:skip-confirmation:v1'
export const CANVAS_BATCH_SUBMIT_PREFERENCE_EVENT =
  'spark-canvas:batch-submit-preference-changed'

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem' | 'removeItem'>

function defaultStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

export function readSkipCanvasBatchSubmitConfirmation(
  storage: ReadStorage | null = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(CANVAS_BATCH_SUBMIT_CONFIRMATION_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeSkipCanvasBatchSubmitConfirmation(
  skip: boolean,
  storage: WriteStorage | null = defaultStorage(),
): void {
  try {
    if (skip) storage?.setItem(CANVAS_BATCH_SUBMIT_CONFIRMATION_KEY, 'true')
    else storage?.removeItem(CANVAS_BATCH_SUBMIT_CONFIRMATION_KEY)
    globalThis.dispatchEvent?.(new Event(CANVAS_BATCH_SUBMIT_PREFERENCE_EVENT))
  } catch {
    // 偏好不可用时保持安全默认值，不阻断提交。
  }
}
