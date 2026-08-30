export const CANVAS_COMPOSER_ADVANCED_OPEN_KEY =
  'spark-canvas:inline-ai-composer:advanced-open:v1'

type ComposerPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): ComposerPreferenceStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

export function readCanvasComposerAdvancedOpen(
  storage: ComposerPreferenceStorage | null = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(CANVAS_COMPOSER_ADVANCED_OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeCanvasComposerAdvancedOpen(
  open: boolean,
  storage: ComposerPreferenceStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(CANVAS_COMPOSER_ADVANCED_OPEN_KEY, String(open))
  } catch {
    // 本地偏好不可用时保持内存态即可，不阻断任务创建。
  }
}
