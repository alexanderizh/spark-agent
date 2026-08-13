import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionId } from '@spark/protocol'

export type ReplayTimelineStatus = 'available' | 'partial' | 'empty' | 'unknown'

export interface ReplayEvent {
  id: string
  sessionId: SessionId
  roomId: string
  discussionId: string
  sourceType: string
  sourceId: string
  seq: number
  time: string
  actor: string
  action: string
  before: unknown
  after: unknown
  evidenceRefs: string[]
}

export interface ReplayTimeline {
  sessionId: SessionId
  discussionId: string
  events: ReplayEvent[]
  cursor: string | null
  nextCursor: string | null
  status: ReplayTimelineStatus
  syncedAt: string | null
}

export interface ReplayDiff {
  sessionId: SessionId
  discussionId: string
  fromSeq: number
  toSeq: number
  events: ReplayEvent[]
  status: ReplayTimelineStatus
}

export interface ReplayBranch {
  id: string
  [key: string]: unknown
}

export interface TeamPlaybook {
  id: string
  sessionId: SessionId
  roomId: string
  discussionId: string
  version: number
  status: string
  name: string
  graph: unknown
  roles: unknown
  handoffRules: unknown
  gateRules: unknown
  deliberationRules: unknown
  createdBy: string
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export interface TeamReplayPlaybookListResponse {
  playbook: TeamPlaybook | null
  versions: TeamPlaybook[]
  applications: unknown[]
}

export type TeamReplayPlaybookMutationPayload =
  | { action: 'propose'; id: string; name: string; graph: unknown; roles: unknown; handoffRules: unknown; gateRules: unknown; deliberationRules: unknown }
  | { action: 'publish' | 'archive'; id: string; expectedVersion: number }
  | { action: 'apply'; id: string; expectedVersion: number; targetDiscussionId: string }
  | { action: string; id?: string; expectedVersion?: number; [key: string]: unknown }

export interface ReplayDiffRequest {
  fromSeq: number
  toSeq: number
}

export interface ReplayForkRequest {
  branchId: string
  sourceSeq: number
  reason?: string
}

export interface TeamReplayPlaybookState {
  timeline: ReplayTimeline | null
  diff: ReplayDiff | null
  branch: ReplayBranch | null
  playbook: TeamPlaybook | null
  playbooks: TeamPlaybook[]
  applications: unknown[]
  loading: boolean
  error: string | null
  conflict: boolean
  mutatingKey: string | null
  refresh: () => Promise<void>
  loadDiff: (request: ReplayDiffRequest) => Promise<ReplayDiff | null>
  fork: (request: ReplayForkRequest) => Promise<ReplayBranch | null>
  mutate: (payload: TeamReplayPlaybookMutationPayload) => Promise<TeamPlaybook | null>
}

type Invoke = (channel: string, request: Record<string, unknown>) => Promise<unknown>

const SCHEMA_VERSION = 1

export function useTeamReplayPlaybook(
  sessionId: SessionId | undefined,
  discussionId: string | undefined,
  activePlaybookId?: string,
): TeamReplayPlaybookState {
  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null)
  const [diff, setDiff] = useState<ReplayDiff | null>(null)
  const [branch, setBranch] = useState<ReplayBranch | null>(null)
  const [playbook, setPlaybook] = useState<TeamPlaybook | null>(null)
  const [playbooks, setPlaybooks] = useState<TeamPlaybook[]>([])
  const [applications, setApplications] = useState<unknown[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [mutatingKey, setMutatingKey] = useState<string | null>(null)
  const mounted = useRef(false)
  const generation = useRef(0)
  const activeScope = useRef<{ sessionId?: SessionId; discussionId?: string }>({ sessionId, discussionId })
  const readRef = useRef<() => Promise<void>>(async () => undefined)
  const readFlight = useRef<Promise<void> | null>(null)
  const readSequence = useRef(0)
  const operationIds = useRef(new Map<string, string>())

  activeScope.current = { sessionId, discussionId }

  const isCurrent = useCallback((requestGeneration: number, requestSession: SessionId, requestDiscussion: string) =>
    mounted.current && generation.current === requestGeneration &&
    activeScope.current.sessionId === requestSession && activeScope.current.discussionId === requestDiscussion, [])

  const refresh = useCallback(() => readRef.current(), [])

  const loadDiff = useCallback(async (request: ReplayDiffRequest): Promise<ReplayDiff | null> => {
    if (sessionId == null || discussionId == null || !mounted.current) return null
    const requestGeneration = generation.current
    setError(null)
    try {
      const opId = operationIdFor(operationIds.current, `replay:diff:${stableSerialize(request)}`)
      const result = await invoke('replay:diff', {
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        expectedDiscussionId: discussionId,
        opId,
        ...request,
      })
      const next = unwrapDiff(result)
      if (next != null && isCurrent(requestGeneration, sessionId, discussionId)) {
        setDiff(next)
        return next
      }
      return null
    } catch (caught) {
      if (isCurrent(requestGeneration, sessionId, discussionId)) setError(errorMessage(caught))
      throw caught
    }
  }, [discussionId, isCurrent, sessionId])

  const fork = useCallback(async (request: ReplayForkRequest): Promise<ReplayBranch | null> => {
    if (sessionId == null || discussionId == null || !mounted.current) return null
    const requestGeneration = generation.current
    setError(null)
    try {
      const opId = operationIdFor(operationIds.current, `replay:fork:${stableSerialize(request)}`)
      const result = await invoke('replay:fork', {
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        expectedDiscussionId: discussionId,
        opId,
        ...request,
      })
      const nextBranch = unwrapBranch(result)
      const nextTimeline = unwrapTimeline(result)
      if (isCurrent(requestGeneration, sessionId, discussionId)) {
        if (nextBranch != null) setBranch(nextBranch)
        if (nextTimeline != null) setTimeline(nextTimeline)
      }
      return nextBranch
    } catch (caught) {
      if (isCurrent(requestGeneration, sessionId, discussionId)) setError(errorMessage(caught))
      throw caught
    }
  }, [discussionId, isCurrent, sessionId])

  const mutate = useCallback(async (payload: TeamReplayPlaybookMutationPayload): Promise<TeamPlaybook | null> => {
    if (sessionId == null || discussionId == null || !mounted.current) return null
    const operationKey = operationKeyFor(payload)
    const opId = operationIds.current.get(operationKey) ?? createOperationId()
    operationIds.current.set(operationKey, opId)
    const requestGeneration = generation.current
    setError(null)
    setConflict(false)
    setMutatingKey(operationKey)
    try {
      const result = await invoke('playbook:mutate', {
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        expectedDiscussionId: discussionId,
        opId,
        ...payload,
      })
      const next = unwrapPlaybook(result)
      if (isCurrent(requestGeneration, sessionId, discussionId)) {
        if (next != null) {
          setPlaybook(next)
          setPlaybooks((current) => current.some((item) => item.id === next.id)
            ? current.map((item) => item.id === next.id ? next : item)
            : [next, ...current])
        }
        setConflict(false)
        operationIds.current.delete(operationKey)
      }
      return next
    } catch (caught) {
      if (isCurrent(requestGeneration, sessionId, discussionId)) {
        setError(errorMessage(caught))
        setConflict(isConflict(caught))
      }
      throw caught
    } finally {
      if (isCurrent(requestGeneration, sessionId, discussionId)) setMutatingKey(null)
    }
  }, [discussionId, isCurrent, sessionId])

  useEffect(() => {
    mounted.current = true
    generation.current += 1
    const requestGeneration = generation.current
    const requestSession = sessionId
    const requestDiscussion = discussionId
    activeScope.current = { sessionId, discussionId }
    operationIds.current.clear()
    readFlight.current = null
    readSequence.current = 0
    setTimeline(null)
    setDiff(null)
    setBranch(null)
    setPlaybook(null)
    setPlaybooks([])
    setApplications([])
    setError(null)
    setConflict(false)
    setLoading(requestSession != null && requestDiscussion != null)

    const read = async (): Promise<void> => {
      if (requestSession == null || requestDiscussion == null || !mounted.current ||
        !isCurrent(requestGeneration, requestSession, requestDiscussion)) return
      if (readFlight.current != null) return readFlight.current
      const requestSequence = ++readSequence.current
      setLoading(true)
      const flight = (async () => {
        try {
        const timelineOpId = operationIdFor(operationIds.current, 'replay:timeline')
        const [timelineResult, playbookResult] = await Promise.allSettled([
          invoke('replay:timeline', {
            schemaVersion: SCHEMA_VERSION,
            sessionId: requestSession,
            expectedDiscussionId: requestDiscussion,
            opId: timelineOpId,
          }),
          activePlaybookId == null
            ? Promise.resolve(null)
            : invoke('playbook:list', {
              sessionId: requestSession,
              expectedDiscussionId: requestDiscussion,
              id: activePlaybookId,
            }),
        ])
        if (!isCurrent(requestGeneration, requestSession, requestDiscussion) || readSequence.current !== requestSequence) return
        const failures = [timelineResult, playbookResult].filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        )
        const firstFailure = failures[0]?.reason
        if (timelineResult.status === 'fulfilled') {
          setTimeline(unwrapTimeline(timelineResult.value))
        }
        if (playbookResult.status === 'fulfilled') {
          const nextList = unwrapList(playbookResult.value)
          setPlaybook(nextList.playbook)
          setPlaybooks(nextList.versions)
          setApplications(nextList.applications)
        }
        if (firstFailure !== undefined) {
          setError(errorMessage(firstFailure))
          setConflict(failures.some((result) => isConflict(result.reason)))
        } else {
          setError(null)
          setConflict(false)
        }
        } catch (caught) {
        if (isCurrent(requestGeneration, requestSession, requestDiscussion) && readSequence.current === requestSequence) {
          setError(errorMessage(caught))
          setConflict(isConflict(caught))
        }
        } finally {
          if (readFlight.current === flight) readFlight.current = null
          if (isCurrent(requestGeneration, requestSession, requestDiscussion) && readSequence.current === requestSequence) setLoading(false)
        }
      })()
      readFlight.current = flight
      return flight
    }

    readRef.current = read
    void read()
    return () => {
      mounted.current = false
      generation.current += 1
      readSequence.current += 1
      readFlight.current = null
      readRef.current = async () => undefined
    }
  }, [activePlaybookId, discussionId, isCurrent, sessionId])

  return { timeline, diff, branch, playbook, playbooks, applications, loading, error, conflict, mutatingKey, refresh, loadDiff, fork, mutate }
}

function invoke(channel: string, request: Record<string, unknown>): Promise<unknown> {
  return (window.spark.invoke as unknown as Invoke)(channel, request)
}

function unwrapTimeline(value: unknown): ReplayTimeline | null {
  if (isTimeline(value)) return value
  if (isRecord(value) && isTimeline(value.timeline)) return value.timeline
  return null
}

function unwrapDiff(value: unknown): ReplayDiff | null {
  if (isDiff(value)) return value
  if (isRecord(value) && isDiff(value.diff)) return value.diff
  return null
}

function unwrapBranch(value: unknown): ReplayBranch | null {
  if (!isRecord(value)) return null
  return isRecord(value.branch) ? value.branch as ReplayBranch : null
}

function unwrapPlaybook(value: unknown): TeamPlaybook | null {
  if (isRecord(value) && isPlaybook(value.playbook)) return value.playbook
  return isPlaybook(value) ? value : null
}

function unwrapList(value: unknown): TeamReplayPlaybookListResponse {
  if (!isRecord(value)) return { playbook: null, versions: [], applications: [] }
  const current = isPlaybook(value.playbook) ? value.playbook : null
  const versions = Array.isArray(value.versions) ? value.versions.filter(isPlaybook) : current == null ? [] : [current]
  return { playbook: current, versions, applications: Array.isArray(value.applications) ? value.applications : [] }
}

function isTimeline(value: unknown): value is ReplayTimeline {
  return isRecord(value) && Array.isArray(value.events) && typeof value.sessionId === 'string' && typeof value.discussionId === 'string'
}

function isDiff(value: unknown): value is ReplayDiff {
  return isRecord(value) && Array.isArray(value.events) && typeof value.fromSeq === 'number' && typeof value.toSeq === 'number'
}

function isPlaybook(value: unknown): value is TeamPlaybook {
  return isRecord(value) && typeof value.id === 'string' && typeof value.version === 'number' && typeof value.name === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function operationKeyFor(payload: TeamReplayPlaybookMutationPayload): string {
  return `playbook:${stableSerialize(payload)}`
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value) ?? String(value)
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
}

function createOperationId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  return `replay-playbook:${randomUUID != null ? randomUUID.call(globalThis.crypto) : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function operationIdFor(operationIds: Map<string, string>, key: string): string {
  const existing = operationIds.get(key)
  if (existing != null) return existing
  const created = createOperationId()
  operationIds.set(key, created)
  return created
}

function isConflict(error: unknown): boolean {
  if (!isRecord(error)) return false
  if (error.code === 'CONFLICT' || error.code === 'VERSION_CONFLICT') return true
  return typeof error.message === 'string' && /version|版本|cas/i.test(error.message) &&
    /(current|expected|conflict|冲突|版本)/i.test(error.message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : isRecord(error) && typeof error.message === 'string' ? error.message : String(error)
}
