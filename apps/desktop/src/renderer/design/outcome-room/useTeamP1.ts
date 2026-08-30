import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionId, TeamP1Mutation, TeamP1Snapshot } from '@spark/protocol'

type TeamP1MutationWithoutSessionAndOpId<T> = T extends { sessionId: SessionId; opId: string }
  ? Omit<T, 'sessionId' | 'opId'>
  : never

export type TeamP1MutationPayload = TeamP1MutationWithoutSessionAndOpId<TeamP1Mutation>

type TeamP1State = {
  snapshot: TeamP1Snapshot | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  mutate: (payload: TeamP1MutationPayload) => Promise<void>
}

export function useTeamP1(sessionId: SessionId | undefined): TeamP1State {
  const [snapshot, setSnapshot] = useState<TeamP1Snapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const activeSession = useRef<SessionId | undefined>(sessionId)
  const generation = useRef(0)
  const readRef = useRef<() => Promise<void>>(async () => undefined)
  const operationIds = useRef(new Map<string, string>())

  activeSession.current = sessionId

  const refresh = useCallback(() => readRef.current(), [])

  const mutate = useCallback(async (payload: TeamP1MutationPayload) => {
    const requestSession = sessionId
    if (requestSession == null || !mounted.current) return
    const operationKey = `${payload.kind}:${payload.action}:${payload.id}:${'expectedVersion' in payload ? payload.expectedVersion : 'create'}`
    const opId = operationIds.current.get(operationKey) ?? createOperationId()
    operationIds.current.set(operationKey, opId)
    const requestGeneration = ++generation.current
    setError(null)
    setLoading(true)
    try {
      const result = await window.spark.invoke('team-p1:mutate', {
        sessionId: requestSession,
        ...payload,
        opId,
      } as TeamP1Mutation)
      if (mounted.current && activeSession.current === requestSession && generation.current === requestGeneration) {
        setSnapshot(result.snapshot)
        setError(null)
        setLoading(false)
        operationIds.current.delete(operationKey)
      }
    } catch (caught) {
      if (mounted.current && activeSession.current === requestSession && generation.current === requestGeneration) {
        setError(errorMessage(caught))
        setLoading(false)
      }
    }
  }, [sessionId])

  useEffect(() => {
    mounted.current = true
    activeSession.current = sessionId
    const requestSession = sessionId
    ++generation.current
    operationIds.current.clear()
    setSnapshot(null)
    setError(null)
    setLoading(requestSession != null)

    const read = async () => {
      if (requestSession == null || !mounted.current || activeSession.current !== requestSession) return
      const readGeneration = ++generation.current
      setLoading(true)
      try {
        const next = await window.spark.invoke('team-p1:get', { sessionId: requestSession })
        if (mounted.current && activeSession.current === requestSession && generation.current === readGeneration) {
          setSnapshot(next)
          setError(null)
          setLoading(false)
        }
      } catch (caught) {
        if (mounted.current && activeSession.current === requestSession && generation.current === readGeneration) {
          setError(errorMessage(caught))
          setLoading(false)
        }
      }
    }

    readRef.current = read
    void read()
    return () => {
      generation.current += 1
      mounted.current = false
      readRef.current = async () => undefined
    }
  }, [sessionId])

  return { snapshot, loading, error, refresh, mutate }
}

function createOperationId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  return `team-p1:${randomUUID != null ? randomUUID.call(globalThis.crypto) : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
