import { useEffect } from 'react'
import type { SessionReferenceDragPayload } from './session-reference-dnd'

const SESSION_REFERENCE_ADD_EVENT = 'spark:session-reference:add'
const SESSION_REFERENCE_ADD_TIMEOUT_MS = 1_000

interface SessionReferenceAddRequest {
  targetSessionId: string | null
  payload: SessionReferenceDragPayload
  resolve(applied: boolean): void
}

export function requestSessionReferenceAdd(
  payload: SessionReferenceDragPayload,
  targetSessionId: string | null,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (applied: boolean): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      resolve(applied)
    }
    const timeout = window.setTimeout(() => finish(false), SESSION_REFERENCE_ADD_TIMEOUT_MS)
    window.dispatchEvent(
      new CustomEvent<SessionReferenceAddRequest>(SESSION_REFERENCE_ADD_EVENT, {
        detail: { targetSessionId, payload, resolve: finish },
      }),
    )
  })
}

export function useSessionReferenceAddControl(input: {
  sessionId: string | null
  onAdd(payload: SessionReferenceDragPayload): void
}): void {
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<SessionReferenceAddRequest>).detail
      if (detail == null || detail.targetSessionId !== input.sessionId) return
      input.onAdd(detail.payload)
      detail.resolve(true)
    }
    window.addEventListener(SESSION_REFERENCE_ADD_EVENT, handler)
    return () => window.removeEventListener(SESSION_REFERENCE_ADD_EVENT, handler)
  }, [input.onAdd, input.sessionId])
}
