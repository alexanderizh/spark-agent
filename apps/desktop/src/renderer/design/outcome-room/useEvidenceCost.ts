import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionId } from '@spark/protocol'

export type EvidenceSourceType = 'file' | 'test' | 'tool' | 'url' | 'manual'
export type EvidenceStatus = 'verified' | 'invalid' | 'unknown'
export type EvidenceLinkType = 'claim' | 'task' | 'handoff' | 'deliberation' | 'ledger'
export type CostStatus = 'estimated' | 'recorded' | 'failed' | 'unknown'
export type CostDimension = 'room' | 'task' | 'agent' | 'dispatch'

export interface EvidenceRecord {
  id: string
  claim: string
  links: Array<{ type: EvidenceLinkType; id: string }>
  source: { type: EvidenceSourceType; ref: string }
  version: string | null
  summary: string
  hash: string | null
  status: EvidenceStatus
  verifiedBy: string | null
  verifiedAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  versionNumber: number
}

export interface CostEvent {
  id: string
  taskId: string | null
  agentId: string | null
  dispatchId: string | null
  tokens: number | null
  amount: number | null
  currency: string | null
  latencyMs: number | null
  status: CostStatus
  source: string | null
  createdAt: string
}

export interface CostAggregate {
  dimension: CostDimension
  key: string
  tokens: number | null
  amount: number | null
  latencyMs: number | null
  eventCount: number
  unknown: boolean
}

export interface EvidenceCostSnapshot {
  sessionId: string
  roomId: string
  discussionId: string | null
  evidence: EvidenceRecord[]
  costs: CostEvent[]
  aggregates: CostAggregate[]
  budgetTokens: number | null
  budgetAmount: number | null
  budgetCurrency: string | null
  /** Optional for forward-compatible backends; the current backend starts at version 0. */
  budgetVersion?: number
  syncedAt: string
}

type EvidenceMutation =
  | { kind: 'evidence'; action: 'verify'; id: string; expectedVersion: number }
  | { kind: 'evidence'; action: 'invalidate'; id: string; expectedVersion: number; reason?: string }
  | { kind: 'budget'; action: 'set'; expectedVersion: number; tokens?: number | null; amount?: number | null; currency?: string | null }

export type EvidenceCostMutationPayload = EvidenceMutation

type EvidenceCostMutationRequest = EvidenceMutation & {
  sessionId: SessionId
  expectedDiscussionId: string
  opId: string
}

interface EvidenceCostState {
  snapshot: EvidenceCostSnapshot | null
  loading: boolean
  error: string | null
  mutatingKey: string | null
  refresh: () => Promise<void>
  mutate: (payload: EvidenceCostMutationPayload) => Promise<void>
}

type Invoke = (channel: string, request: object) => Promise<unknown>

const MAX_ITEMS = 100

export function useEvidenceCost(sessionId: SessionId | undefined, discussionId: string | undefined): EvidenceCostState {
  const [snapshot, setSnapshot] = useState<EvidenceCostSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mutatingKey, setMutatingKey] = useState<string | null>(null)
  const mounted = useRef(false)
  const activeSession = useRef<SessionId | undefined>(sessionId)
  const activeDiscussion = useRef<string | undefined>(discussionId)
  const epoch = useRef(0)
  const snapshotRef = useRef<EvidenceCostSnapshot | null>(null)
  const readFlight = useRef<Promise<void> | null>(null)
  const readRef = useRef<() => Promise<void>>(async () => undefined)
  const operationIds = useRef(new Map<string, string>())
  const mutationFlights = useRef(new Map<string, Promise<void>>())

  activeSession.current = sessionId
  activeDiscussion.current = discussionId
  snapshotRef.current = snapshot

  const refresh = useCallback(() => readRef.current(), [])

  const mutate = useCallback(async (payload: EvidenceCostMutationPayload) => {
    const requestSession = sessionId
    const requestDiscussion = discussionId
    if (requestSession == null || requestDiscussion == null || !mounted.current) return

    const operationKey = operationKeyFor(payload)
    const existingFlight = mutationFlights.current.get(operationKey)
    if (existingFlight != null) return existingFlight

    const opId = operationIds.current.get(operationKey) ?? createOperationId()
    operationIds.current.set(operationKey, opId)
    const requestEpoch = epoch.current
    setError(null)
    setMutatingKey(operationKey)
    const request: EvidenceCostMutationRequest = {
      ...payload,
      sessionId: requestSession,
      expectedDiscussionId: requestDiscussion,
      opId,
    }
    const flight = invoke('evidence-cost:mutate', request).then((result) => {
      const next = unwrapSnapshot(result)
      if (isCurrent(requestSession, requestDiscussion, requestEpoch) && next != null) {
        snapshotRef.current = next
        setSnapshot(next)
        setError(null)
        operationIds.current.delete(operationKey)
      }
    }).catch((caught: unknown) => {
      if (isCurrent(requestSession, requestDiscussion, requestEpoch)) setError(errorMessage(caught))
      throw caught
    }).finally(() => {
      mutationFlights.current.delete(operationKey)
      if (isCurrent(requestSession, requestDiscussion, requestEpoch)) setMutatingKey(null)
    })
    mutationFlights.current.set(operationKey, flight)
    return flight
  }, [discussionId, sessionId])

  useEffect(() => {
    mounted.current = true
    activeSession.current = sessionId
    activeDiscussion.current = discussionId
    epoch.current += 1
    operationIds.current.clear()
    mutationFlights.current.clear()
    readFlight.current = null
    snapshotRef.current = null
    setSnapshot(null)
    setError(null)
    setLoading(sessionId != null)
    const requestSession = sessionId
    const requestDiscussion = discussionId
    let disposed = false

    const read = async (): Promise<void> => {
      if (requestSession == null || requestDiscussion == null || disposed || !mounted.current || activeSession.current !== requestSession || activeDiscussion.current !== requestDiscussion) return
      if (readFlight.current != null) return readFlight.current
      const requestEpoch = epoch.current
      setLoading(true)
      const flight = invoke('evidence-cost:get', { sessionId: requestSession, expectedDiscussionId: requestDiscussion })
        .then((result) => {
          const next = unwrapSnapshot(result)
          if (next != null && !disposed && isCurrent(requestSession, requestDiscussion, requestEpoch)) {
            snapshotRef.current = next
            setSnapshot(next)
            setError(null)
          }
        })
        .catch((caught: unknown) => {
          if (!disposed && isCurrent(requestSession, requestDiscussion, requestEpoch)) setError(errorMessage(caught))
        })
        .finally(() => {
          if (readFlight.current === flight) readFlight.current = null
          if (!disposed && isCurrent(requestSession, requestDiscussion, requestEpoch)) setLoading(false)
        })
      readFlight.current = flight
      return flight
    }

    readRef.current = read
    void read()
    return () => {
      disposed = true
      mounted.current = false
      epoch.current += 1
      readFlight.current = null
      readRef.current = async () => undefined
    }
  }, [discussionId, sessionId])

  const isCurrent = (requestSession: SessionId, requestDiscussion: string, requestEpoch: number) =>
    mounted.current && activeSession.current === requestSession && activeDiscussion.current === requestDiscussion && epoch.current === requestEpoch

  return { snapshot, loading, error, mutatingKey, refresh, mutate }
}

function invoke(channel: string, request: object): Promise<unknown> {
  return (window.spark.invoke as unknown as Invoke)(channel, request)
}

function unwrapSnapshot(value: unknown): EvidenceCostSnapshot | null {
  if (isSnapshot(value)) return value
  if (isRecord(value) && isSnapshot(value.snapshot)) return value.snapshot
  return null
}

function isSnapshot(value: unknown): value is EvidenceCostSnapshot {
  return isRecord(value) && Array.isArray(value.evidence) && Array.isArray(value.costs) && Array.isArray(value.aggregates)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

function operationKeyFor(payload: EvidenceCostMutationPayload): string {
  return [payload.kind, payload.action, 'id' in payload ? payload.id : 'budget', payload.expectedVersion].join(':')
}

function createOperationId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  return `evidence-cost:${randomUUID != null ? randomUUID.call(globalThis.crypto) : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export { MAX_ITEMS }
