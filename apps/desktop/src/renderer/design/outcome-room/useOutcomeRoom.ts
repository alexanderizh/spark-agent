import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  OutcomeRoomMutateRequest,
  OutcomeRoomSnapshot,
  SessionId,
} from '@spark/protocol'

type MutationPayload = Omit<OutcomeRoomMutateRequest, 'sessionId'>

const POLL_DELAY_MS = 2_000
const MAX_BACKOFF_MS = 30_000

export function useOutcomeRoom(sessionId: SessionId | undefined) {
  const [snapshot, setSnapshot] = useState<OutcomeRoomSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mutatingKey, setMutatingKey] = useState<string | null>(null)
  const activeSession = useRef(sessionId)
  const readGeneration = useRef(0)
  const readInFlight = useRef<Promise<void> | null>(null)
  const pollTimer = useRef<number | null>(null)
  const pendingImmediateRead = useRef(false)
  const consecutiveFailures = useRef(0)
  const mounted = useRef(false)
  const mutatingKeys = useRef(new Set<string>())
  const readNowRef = useRef<(force: boolean) => Promise<void>>(async () => undefined)
  const scheduleRef = useRef<(delay: number) => void>(() => undefined)
  activeSession.current = sessionId

  const clearPollTimer = useCallback(() => {
    if (pollTimer.current != null) window.clearTimeout(pollTimer.current)
    pollTimer.current = null
  }, [])

  const refresh = useCallback(async () => readNowRef.current(true), [])

  const mutate = useCallback(
    async (payload: MutationPayload) => {
      if (sessionId == null || mutatingKeys.current.has(payload.logicalKey)) return
      const requestSession = sessionId
      mutatingKeys.current.add(payload.logicalKey)
      readGeneration.current += 1
      clearPollTimer()
      setLoading(false)
      setMutatingKey(payload.logicalKey)
      setError(null)
      try {
        const result = await window.spark.invoke('outcome-room:mutate', {
          sessionId,
          ...payload,
        })
        if (mounted.current && activeSession.current === requestSession) {
          readGeneration.current += 1
          setSnapshot(result.snapshot)
          consecutiveFailures.current = 0
        }
      } catch (caught) {
        if (mounted.current && activeSession.current === requestSession) {
          setError(errorMessage(caught))
        }
      } finally {
        mutatingKeys.current.delete(payload.logicalKey)
        if (mounted.current && activeSession.current === requestSession) {
          setMutatingKey(null)
          scheduleRef.current(POLL_DELAY_MS)
        }
      }
    },
    [clearPollTimer, sessionId],
  )

  useEffect(() => {
    mounted.current = true
    activeSession.current = sessionId
    readGeneration.current += 1
    consecutiveFailures.current = 0
    pendingImmediateRead.current = false
    mutatingKeys.current.clear()
    clearPollTimer()
    setSnapshot(null)
    setMutatingKey(null)

    const schedule = (delay: number) => {
      clearPollTimer()
      if (!mounted.current || activeSession.current !== sessionId) return
      if (document.visibilityState !== 'visible') return
      pollTimer.current = window.setTimeout(() => {
        pollTimer.current = null
        void readNow(false)
      }, delay)
    }

    const readNow = (force: boolean): Promise<void> => {
      if (sessionId == null || !mounted.current || activeSession.current !== sessionId) {
        return Promise.resolve()
      }
      clearPollTimer()
      if (force) consecutiveFailures.current = 0
      if (readInFlight.current != null) {
        if (force) pendingImmediateRead.current = true
        return readInFlight.current
      }
      const generation = ++readGeneration.current
      const requestSession = sessionId
      setLoading(true)
      if (force) setError(null)
      const request = window.spark
        .invoke('outcome-room:get', { sessionId })
        .then((next) => {
          if (mounted.current && activeSession.current === requestSession && readGeneration.current === generation) {
            setSnapshot(next)
            setError(null)
          }
          consecutiveFailures.current = 0
        })
        .catch((caught: unknown) => {
          consecutiveFailures.current = Math.min(consecutiveFailures.current + 1, 4)
          if (mounted.current && activeSession.current === requestSession && readGeneration.current === generation) {
            setError(errorMessage(caught))
          }
        })
        .finally(() => {
          if (readInFlight.current === request) readInFlight.current = null
          if (!mounted.current || activeSession.current !== requestSession) return
          if (readGeneration.current === generation) setLoading(false)
          if (pendingImmediateRead.current) {
            pendingImmediateRead.current = false
            void readNow(true)
            return
          }
          const backoff = consecutiveFailures.current === 0
            ? POLL_DELAY_MS
            : Math.min(MAX_BACKOFF_MS, POLL_DELAY_MS * 2 ** consecutiveFailures.current)
          schedule(backoff)
        })
      readInFlight.current = request
      return request
    }

    readNowRef.current = readNow
    scheduleRef.current = schedule
    void readNow(true)
    const onFocus = () => void readNow(true)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void readNow(true)
      else clearPollTimer()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      mounted.current = false
      readGeneration.current += 1
      readInFlight.current = null
      pendingImmediateRead.current = false
      clearPollTimer()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [clearPollTimer, sessionId])

  return { snapshot, loading, error, mutatingKey, refresh, mutate }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
