import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DeliberationMutateRequest,
  DeliberationSnapshot,
  SessionId,
  TaskGraphMutation,
  TaskGraphSnapshot,
} from '@spark/protocol'

export type TaskGraphMutationPayload = Omit<TaskGraphMutation, 'sessionId' | 'opId'>
export type DeliberationMutationPayload = Omit<DeliberationMutateRequest, 'sessionId' | 'opId'>

export interface TeamRuntimeState {
  taskGraph: TaskGraphSnapshot | null
  deliberation: DeliberationSnapshot | null
  loading: boolean
  error: string | null
  mutatingKey: string | null
  refresh: () => Promise<void>
  mutateTaskGraph: (payload: TaskGraphMutationPayload) => Promise<void>
  mutateDeliberation: (payload: DeliberationMutationPayload) => Promise<void>
}

const POLL_INTERVAL = 4_000

export function useTeamRuntime(sessionId: SessionId | undefined): TeamRuntimeState {
  const [taskGraph, setTaskGraph] = useState<TaskGraphSnapshot | null>(null)
  const [deliberation, setDeliberation] = useState<DeliberationSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mutatingKey, setMutatingKey] = useState<string | null>(null)
  const mounted = useRef(false)
  const activeSession = useRef<SessionId | undefined>(sessionId)
  const sessionEpoch = useRef(0)
  const latestMutation = useRef(0)
  const readFlight = useRef<Promise<void> | null>(null)
  const readRef = useRef<() => Promise<void>>(async () => undefined)
  const operationIds = useRef(new Map<string, string>())

  activeSession.current = sessionId

  const refresh = useCallback(() => readRef.current(), [])

  const mutateTaskGraph = useCallback(async (payload: TaskGraphMutationPayload) => {
    const requestSession = sessionId
    if (requestSession == null || !mounted.current) return
    const operationKey = `task-graph:${operationKeyFor(payload)}`
    const opId = operationIds.current.get(operationKey) ?? createOperationId()
    operationIds.current.set(operationKey, opId)
    const requestEpoch = sessionEpoch.current
    const mutationToken = ++latestMutation.current
    setError(null)
    setMutatingKey(operationKey)
    try {
      const result = await window.spark.invoke('task-graph:mutate', {
        sessionId: requestSession,
        ...payload,
        opId,
      } as TaskGraphMutation)
      if (isCurrent(requestSession, requestEpoch)) {
        latestMutation.current = mutationToken
        setTaskGraph(result.snapshot)
        setError(null)
      }
    } catch (caught) {
      if (isCurrent(requestSession, requestEpoch)) setError(errorMessage(caught))
      throw caught
    } finally {
      if (isCurrent(requestSession, requestEpoch)) setMutatingKey(null)
    }
  }, [sessionId])

  const mutateDeliberation = useCallback(async (payload: DeliberationMutationPayload) => {
    const requestSession = sessionId
    if (requestSession == null || !mounted.current) return
    const operationKey = `deliberation:${operationKeyFor(payload)}`
    const opId = operationIds.current.get(operationKey) ?? createOperationId()
    operationIds.current.set(operationKey, opId)
    const requestEpoch = sessionEpoch.current
    const mutationToken = ++latestMutation.current
    setError(null)
    setMutatingKey(operationKey)
    try {
      const result = await window.spark.invoke('deliberation:mutate', {
        sessionId: requestSession,
        ...payload,
        opId,
      } as DeliberationMutateRequest)
      if (isCurrent(requestSession, requestEpoch)) {
        latestMutation.current = mutationToken
        setDeliberation(result.snapshot)
        setError(null)
      }
    } catch (caught) {
      if (isCurrent(requestSession, requestEpoch)) setError(errorMessage(caught))
      throw caught
    } finally {
      if (isCurrent(requestSession, requestEpoch)) setMutatingKey(null)
    }
  }, [sessionId])

  useEffect(() => {
    mounted.current = true
    activeSession.current = sessionId
    sessionEpoch.current += 1
    latestMutation.current = 0
    operationIds.current.clear()
    readFlight.current = null
    setTaskGraph(null)
    setDeliberation(null)
    setError(null)
    setLoading(sessionId != null)

    const requestSession = sessionId
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    const read = async (): Promise<void> => {
      if (requestSession == null || disposed || !mounted.current || activeSession.current !== requestSession) return
      if (readFlight.current != null) return readFlight.current
      const requestEpoch = sessionEpoch.current
      const mutationAtStart = latestMutation.current
      setLoading(true)
      const flight = Promise.all([
        window.spark.invoke('task-graph:get', { sessionId: requestSession }),
        window.spark.invoke('deliberation:get', { sessionId: requestSession }),
      ]).then(([nextGraph, nextDeliberation]) => {
        if (!disposed && isCurrent(requestSession, requestEpoch) && mutationAtStart === latestMutation.current) {
          setTaskGraph(nextGraph)
          setDeliberation(nextDeliberation)
          setError(null)
        }
      }).catch((caught) => {
        if (!disposed && isCurrent(requestSession, requestEpoch)) setError(errorMessage(caught))
      }).finally(() => {
        if (readFlight.current === flight) readFlight.current = null
        if (!disposed && isCurrent(requestSession, requestEpoch)) setLoading(false)
        if (!disposed && isCurrent(requestSession, requestEpoch) && document.visibilityState !== 'hidden') {
          timer = setTimeout(() => void read(), POLL_INTERVAL)
        }
      })
      readFlight.current = flight
      return flight
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (timer != null) clearTimeout(timer)
        void read()
      }
    }
    const onFocus = () => void read()
    readRef.current = read
    void read()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      disposed = true
      mounted.current = false
      sessionEpoch.current += 1
      if (timer != null) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      readRef.current = async () => undefined
      readFlight.current = null
    }
  }, [sessionId])

  const isCurrent = (requestSession: SessionId, requestEpoch: number) =>
    mounted.current && activeSession.current === requestSession && sessionEpoch.current === requestEpoch

  return { taskGraph, deliberation, loading, error, mutatingKey, refresh, mutateTaskGraph, mutateDeliberation }
}

function operationKeyFor(payload: object): string {
  const value = payload as Record<string, unknown>
  return [value.action, value.id, value.expectedVersion ?? 'create', value.expectedRecordId ?? ''].join(':')
}

function createOperationId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  return `team-runtime:${randomUUID != null ? randomUUID.call(globalThis.crypto) : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
