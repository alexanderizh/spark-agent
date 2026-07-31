import { useEffect } from 'react'

const PREFILL_EVENT = 'spark:computer-use:prefill-composer'
const PREFILL_TIMEOUT_MS = 1_000

interface ComposerPrefillRequest {
  targetSessionId: string | null
  text: string
  resolve(applied: boolean): void
}

export function requestComposerPrefill(
  text: string,
  targetSessionId: string | null,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (applied: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(applied)
    }
    const timeout = window.setTimeout(() => finish(false), PREFILL_TIMEOUT_MS)
    window.dispatchEvent(
      new CustomEvent<ComposerPrefillRequest>(PREFILL_EVENT, {
        detail: { targetSessionId, text, resolve: finish },
      }),
    )
  })
}

export function useAppControlComposerPrefill(input: {
  sessionId: string | null
  value: string
  setValue(value: string): void
}): void {
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<ComposerPrefillRequest>).detail
      if (detail == null || detail.targetSessionId !== input.sessionId) return
      if (input.value.length > 0) {
        detail.resolve(false)
        return
      }
      input.setValue(detail.text)
      detail.resolve(true)
    }
    window.addEventListener(PREFILL_EVENT, handler)
    return () => window.removeEventListener(PREFILL_EVENT, handler)
  }, [input.sessionId, input.setValue, input.value])
}
