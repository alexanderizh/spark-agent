import type {
  ComputerActionEnvelope,
  ComputerActuatorLease,
  ComputerEnvironment,
  ComputerUseErrorCode,
  ComputerSession,
  ComputerTaskContract,
} from '@spark/protocol'
import {
  ComputerActuatorLeaseSchema,
  ComputerSessionSchema,
  ComputerTaskContractSchema,
} from '@spark/protocol'
import type {
  ComputerActuatorLeaseRow,
  ComputerSessionRow,
  CreateComputerSessionParams,
  StoredComputerSessionStatus,
} from '@spark/storage'
import { randomUUID } from 'node:crypto'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { ComputerUseTimelineSink } from './ComputerUseTimelineStore.js'

const DEFAULT_LEASE_TTL_MS = 10_000
export const MY_DESKTOP_ENVIRONMENT_KEY = 'my-desktop:local'
const EXECUTABLE_STATUSES = new Set<StoredComputerSessionStatus>([
  'observing',
  'planning',
  'waiting_approval',
  'acting',
])

export type ManagedComputerSessionPhase =
  | 'observing'
  | 'planning'
  | 'waiting_approval'
  | 'acting'
  | 'verifying'
  | 'handoff_required'
  | 'failed'

interface SessionRuntimeState {
  controller: AbortController
  environmentKey: string | null
  leaseId: string | null
  operatorId: string | null
}

export interface ComputerSessionStore {
  create(params: CreateComputerSessionParams): ComputerSessionRow
  get(id: string): ComputerSessionRow | null
  listActive(limit?: number): ComputerSessionRow[]
  listBySession(sessionId: string, limit?: number): ComputerSessionRow[]
  updateStatus(
    id: string,
    status: StoredComputerSessionStatus,
    updatedAt: string,
    endedAt?: string | null,
  ): ComputerSessionRow | null
}

export interface ComputerActuatorLeaseStore {
  acquire(params: {
    id: string
    environmentKey: string
    computerSessionId: string
    operatorId: string
    acquiredAt: string
    expiresAt: string
  }): ComputerActuatorLeaseRow
  get(id: string): ComputerActuatorLeaseRow | null
  heartbeat(
    id: string,
    operatorId: string,
    heartbeatAt: string,
    expiresAt: string,
  ): ComputerActuatorLeaseRow | null
  release(id: string, operatorId: string, releasedAt: string): boolean
}

export interface CreateManagedComputerSessionInput {
  id?: string
  sessionId: string
  turnId: string
  workflowRunId: string | null
  environment: ComputerEnvironment
  providerProfileId: string
  modelId: string
  taskContract: ComputerTaskContract
}

export interface ComputerSessionManagerOptions {
  sessions: ComputerSessionStore
  leases: ComputerActuatorLeaseStore
  now?: () => Date
  createId?: () => string
  leaseTtlMs?: number
  timeline?: ComputerUseTimelineSink
}

export class ComputerSessionManager {
  private readonly sessions: ComputerSessionStore
  private readonly leases: ComputerActuatorLeaseStore
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly leaseTtlMs: number
  private readonly timeline: ComputerUseTimelineSink | undefined
  private readonly runtime = new Map<string, SessionRuntimeState>()

  constructor(options: ComputerSessionManagerOptions) {
    this.sessions = options.sessions
    this.leases = options.leases
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS
    this.timeline = options.timeline
    if (!Number.isSafeInteger(this.leaseTtlMs) || this.leaseTtlMs < 1_000) {
      throw new RangeError('Computer actuator lease TTL must be at least one second')
    }
  }

  createSession(input: CreateManagedComputerSessionInput): ComputerSession {
    const taskContract = ComputerTaskContractSchema.parse(input.taskContract)
    const createdAt = this.now().toISOString()
    const row = this.sessions.create({
      id: input.id ?? this.createId(),
      sessionId: input.sessionId,
      turnId: input.turnId,
      workflowRunId: input.workflowRunId,
      environment: input.environment,
      providerProfileId: input.providerProfileId,
      modelId: input.modelId,
      taskContract,
      createdAt,
    })
    this.runtime.set(row.id, createRuntimeState())
    const session = toComputerSession(row)
    this.timeline?.record({
      type: 'computer_session_started',
      sessionId: session.sessionId,
      turnId: session.turnId,
      computerSessionId: session.id,
      environment: session.environment,
    })
    return session
  }

  getSession(computerSessionId: string): ComputerSession | null {
    const row = this.sessions.get(computerSessionId)
    return row == null ? null : toComputerSession(row)
  }

  listActiveSessionIds(): string[] {
    return this.sessions.listActive().map((session) => session.id)
  }

  listBySession(sessionId: string, limit = 100): ComputerSession[] {
    return this.sessions.listBySession(sessionId, limit).map(toComputerSession)
  }

  setPhase(computerSessionId: string, phase: ManagedComputerSessionPhase): ComputerSession {
    const session = this.requireSessionRow(computerSessionId)
    if (session.status === 'paused') throw sessionPaused()
    if (
      session.status === 'canceled' ||
      session.status === 'completed' ||
      session.status === 'failed'
    ) {
      throw sessionCanceled()
    }
    const updatedAt = this.now().toISOString()
    const updated = this.sessions.updateStatus(
      computerSessionId,
      phase,
      updatedAt,
      phase === 'failed' ? updatedAt : null,
    )
    if (updated == null) throw sessionCanceled()
    return toComputerSession(updated)
  }

  acquireLease(input: {
    computerSessionId: string
    environmentKey: string
    operatorId: string
  }): ComputerActuatorLease {
    const session = this.requireSessionRow(input.computerSessionId)
    this.assertSessionCanAcquire(session)
    if (!environmentKeyMatches(session.environment, input.environmentKey)) throw leaseConflict()
    const now = this.now()
    let leaseRow: ComputerActuatorLeaseRow
    try {
      leaseRow = this.leases.acquire({
        id: this.createId(),
        environmentKey: input.environmentKey,
        computerSessionId: input.computerSessionId,
        operatorId: input.operatorId,
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.leaseTtlMs).toISOString(),
      })
    } catch {
      throw leaseConflict()
    }

    if (
      leaseRow.computer_session_id !== input.computerSessionId ||
      leaseRow.environment_key !== input.environmentKey ||
      leaseRow.operator_id !== input.operatorId
    ) {
      throw leaseConflict()
    }
    const runtime = this.ensureRuntime(input.computerSessionId)
    runtime.environmentKey = input.environmentKey
    runtime.leaseId = leaseRow.id
    runtime.operatorId = input.operatorId
    const updated = this.sessions.updateStatus(
      input.computerSessionId,
      'observing',
      now.toISOString(),
    )
    if (updated == null) throw sessionCanceled()
    return toComputerLease(leaseRow)
  }

  heartbeatLease(input: {
    computerSessionId: string
    leaseId: string
    operatorId: string
  }): ComputerActuatorLease {
    const session = this.requireSessionRow(input.computerSessionId)
    if (session.actuator_lease_id !== input.leaseId || !EXECUTABLE_STATUSES.has(session.status)) {
      throw leaseConflict()
    }
    const now = this.now()
    const updated = this.leases.heartbeat(
      input.leaseId,
      input.operatorId,
      now.toISOString(),
      new Date(now.getTime() + this.leaseTtlMs).toISOString(),
    )
    if (updated == null || updated.computer_session_id !== input.computerSessionId) {
      throw leaseConflict()
    }
    return toComputerLease(updated)
  }

  assertDispatchAllowed(envelope: ComputerActionEnvelope): {
    session: ComputerSession
    lease: ComputerActuatorLease
    signal: AbortSignal
  } {
    const sessionRow = this.requireSessionRow(envelope.computerSessionId)
    if (sessionRow.status === 'paused') throw sessionPaused()
    if (!EXECUTABLE_STATUSES.has(sessionRow.status)) throw sessionCanceled()
    if (sessionRow.actuator_lease_id !== envelope.actuatorLeaseId) throw leaseConflict()

    const leaseRow = this.leases.get(envelope.actuatorLeaseId)
    const now = this.now().toISOString()
    if (
      leaseRow == null ||
      leaseRow.computer_session_id !== envelope.computerSessionId ||
      leaseRow.released_at !== null ||
      leaseRow.expires_at <= now
    ) {
      throw leaseConflict()
    }
    const runtime = this.ensureRuntime(envelope.computerSessionId)
    if (
      runtime.leaseId != null &&
      (runtime.leaseId !== leaseRow.id || runtime.operatorId !== leaseRow.operator_id)
    ) {
      throw leaseConflict()
    }
    if (runtime.controller.signal.aborted) throw sessionCanceled()
    return {
      session: toComputerSession(sessionRow),
      lease: toComputerLease(leaseRow),
      signal: runtime.controller.signal,
    }
  }

  getAbortSignal(computerSessionId: string): AbortSignal {
    const session = this.requireSessionRow(computerSessionId)
    if (session.status === 'paused') throw sessionPaused()
    if (
      session.status === 'canceled' ||
      session.status === 'failed' ||
      session.status === 'completed'
    ) {
      throw sessionCanceled()
    }
    const signal = this.ensureRuntime(computerSessionId).controller.signal
    if (signal.aborted) throw sessionCanceled()
    return signal
  }

  pause(computerSessionId: string): ComputerSession {
    const session = this.requireSessionRow(computerSessionId)
    if (session.status === 'paused') return toComputerSession(session)
    if (
      session.status === 'canceled' ||
      session.status === 'failed' ||
      session.status === 'completed'
    ) {
      throw sessionCanceled()
    }
    const now = this.now().toISOString()
    const runtime = this.ensureRuntime(computerSessionId)
    runtime.controller.abort('computer_session_paused')
    this.releaseRuntimeLease(runtime, now)
    const updated = this.sessions.updateStatus(computerSessionId, 'paused', now)
    if (updated == null) throw sessionCanceled()
    return toComputerSession(updated)
  }

  resume(computerSessionId: string): ComputerSession {
    const session = this.requireSessionRow(computerSessionId)
    if (session.status !== 'paused') {
      if (EXECUTABLE_STATUSES.has(session.status)) return toComputerSession(session)
      throw sessionCanceled()
    }
    this.runtime.set(computerSessionId, createRuntimeState())
    const updated = this.sessions.updateStatus(
      computerSessionId,
      'observing',
      this.now().toISOString(),
    )
    if (updated == null) throw sessionCanceled()
    return toComputerSession(updated)
  }

  cancel(computerSessionId: string): ComputerSession {
    const session = this.requireSessionRow(computerSessionId)
    if (session.status === 'canceled') return toComputerSession(session)
    if (session.status === 'completed') throw sessionCanceled()
    const now = this.now().toISOString()
    const updated = this.sessions.updateStatus(computerSessionId, 'canceled', now, now)
    if (updated == null) throw sessionCanceled()
    const runtime = this.ensureRuntime(computerSessionId)
    runtime.controller.abort('computer_session_canceled')
    this.releaseRuntimeLease(runtime, now)
    const canceled = toComputerSession(this.requireSessionRow(computerSessionId))
    this.timeline?.record({
      type: 'computer_session_canceled',
      sessionId: canceled.sessionId,
      turnId: canceled.turnId,
      computerSessionId: canceled.id,
      errorCode: 'session_canceled',
    })
    return canceled
  }

  completeVerified(computerSessionId: string, verificationIds: string[] = []): ComputerSession {
    const session = this.requireSessionRow(computerSessionId)
    if (session.status !== 'verifying') throw sessionCanceled()
    const now = this.now().toISOString()
    const runtime = this.ensureRuntime(computerSessionId)
    runtime.controller.abort('computer_session_completed')
    this.releaseRuntimeLease(runtime, now)
    const updated = this.sessions.updateStatus(computerSessionId, 'completed', now, now)
    if (updated == null) throw sessionCanceled()
    const completed = toComputerSession(updated)
    if (verificationIds.length > 0) {
      this.timeline?.record({
        type: 'computer_session_completed',
        sessionId: completed.sessionId,
        turnId: completed.turnId,
        computerSessionId: completed.id,
        verificationIds,
      })
    }
    return completed
  }

  fail(
    computerSessionId: string,
    errorCode: ComputerUseErrorCode = 'environment_unavailable',
  ): ComputerSession {
    const session = this.requireSessionRow(computerSessionId)
    if (
      session.status === 'completed' ||
      session.status === 'canceled' ||
      session.status === 'failed'
    ) {
      throw sessionCanceled()
    }
    const now = this.now().toISOString()
    const runtime = this.ensureRuntime(computerSessionId)
    runtime.controller.abort('computer_session_failed')
    this.releaseRuntimeLease(runtime, now)
    const updated = this.sessions.updateStatus(computerSessionId, 'failed', now, now)
    if (updated == null) throw sessionCanceled()
    const failed = toComputerSession(updated)
    this.timeline?.record({
      type: 'computer_session_failed',
      sessionId: failed.sessionId,
      turnId: failed.turnId,
      computerSessionId: failed.id,
      errorCode,
    })
    return failed
  }

  private requireSessionRow(computerSessionId: string): ComputerSessionRow {
    const session = this.sessions.get(computerSessionId)
    if (session == null) throw sessionCanceled()
    return session
  }

  private assertSessionCanAcquire(session: ComputerSessionRow): void {
    if (session.status === 'paused') throw sessionPaused()
    if (
      session.status === 'canceled' ||
      session.status === 'completed' ||
      session.status === 'failed'
    ) {
      throw sessionCanceled()
    }
    if (session.actuator_lease_id != null) throw leaseConflict()
  }

  private ensureRuntime(computerSessionId: string): SessionRuntimeState {
    let state = this.runtime.get(computerSessionId)
    if (state == null) {
      state = createRuntimeState()
      const session = this.sessions.get(computerSessionId)
      if (session?.actuator_lease_id != null) {
        const lease = this.leases.get(session.actuator_lease_id)
        if (lease != null) {
          state.environmentKey = lease.environment_key
          state.leaseId = lease.id
          state.operatorId = lease.operator_id
        }
      }
      this.runtime.set(computerSessionId, state)
    }
    return state
  }

  private releaseRuntimeLease(runtime: SessionRuntimeState, releasedAt: string): void {
    if (runtime.leaseId != null && runtime.operatorId != null) {
      this.leases.release(runtime.leaseId, runtime.operatorId, releasedAt)
    }
    runtime.environmentKey = null
    runtime.leaseId = null
    runtime.operatorId = null
  }
}

function createRuntimeState(): SessionRuntimeState {
  return {
    controller: new AbortController(),
    environmentKey: null,
    leaseId: null,
    operatorId: null,
  }
}

function environmentKeyMatches(environment: ComputerEnvironment, environmentKey: string): boolean {
  if (environment === 'my_desktop') return environmentKey === MY_DESKTOP_ENVIRONMENT_KEY
  const prefix = environment === 'safe_browser' ? 'safe-browser:' : 'safe-desktop:'
  return environmentKey.startsWith(prefix) && environmentKey.length > prefix.length
}

function toComputerSession(row: ComputerSessionRow): ComputerSession {
  return ComputerSessionSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    workflowRunId: row.workflow_run_id,
    environment: row.environment,
    status: row.status,
    providerProfileId: row.provider_profile_id,
    modelId: row.model_id,
    taskContract: JSON.parse(row.task_contract_json) as unknown,
    actuatorLeaseId: row.actuator_lease_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function toComputerLease(row: ComputerActuatorLeaseRow): ComputerActuatorLease {
  return ComputerActuatorLeaseSchema.parse({
    id: row.id,
    environmentKey: row.environment_key,
    computerSessionId: row.computer_session_id,
    operatorId: row.operator_id,
    acquiredAt: row.acquired_at,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at,
  })
}

function leaseConflict(): ComputerUseBrokerError {
  return new ComputerUseBrokerError(
    'actuator_lease_conflict',
    'Computer actuator lease is missing, expired, or owned by another operator',
  )
}

function sessionPaused(): ComputerUseBrokerError {
  return new ComputerUseBrokerError('session_paused', 'Computer session is paused')
}

function sessionCanceled(): ComputerUseBrokerError {
  return new ComputerUseBrokerError('session_canceled', 'Computer session is not executable')
}
