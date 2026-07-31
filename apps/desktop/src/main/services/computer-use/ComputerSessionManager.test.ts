import type { ComputerActionEnvelope, ComputerTaskContract } from '@spark/protocol'
import type {
  ComputerActuatorLeaseRow,
  ComputerSessionRow,
  CreateComputerSessionParams,
  StoredComputerSessionStatus,
} from '@spark/storage'
import { describe, expect, it, vi } from 'vitest'
import type { ComputerUseTimelineSink } from './ComputerUseTimelineStore.js'
import {
  ComputerSessionManager,
  type ComputerActuatorLeaseStore,
  type ComputerSessionStore,
} from './ComputerSessionManager.js'

const taskContract: ComputerTaskContract = {
  objective: 'Edit the approved document',
  successCriteria: [
    {
      kind: 'accessibility',
      selector: { elementId: 'document-editor' },
      assertion: { operator: 'enabled', expected: true },
    },
  ],
  allowedApps: [{ kind: 'app_id', value: 'com.spark.Editor' }],
  allowedDomains: [],
  allowedDataClasses: ['internal'],
  forbiddenActions: [],
  maxSteps: 20,
  maxRuntimeMs: 60_000,
  maxConsecutiveNoops: 3,
  userPresence: 'required',
}

class MemorySessionStore implements ComputerSessionStore {
  readonly rows = new Map<string, ComputerSessionRow>()

  create(params: CreateComputerSessionParams): ComputerSessionRow {
    const row: ComputerSessionRow = {
      id: params.id,
      session_id: params.sessionId,
      turn_id: params.turnId,
      workflow_run_id: params.workflowRunId,
      environment: params.environment,
      status: 'preflighting',
      provider_profile_id: params.providerProfileId,
      model_id: params.modelId,
      task_contract_json: JSON.stringify(params.taskContract),
      actuator_lease_id: null,
      created_at: params.createdAt,
      updated_at: params.createdAt,
      ended_at: null,
    }
    this.rows.set(row.id, row)
    return row
  }

  get(id: string): ComputerSessionRow | null {
    return this.rows.get(id) ?? null
  }

  listActive(limit = 10_000): ComputerSessionRow[] {
    return [...this.rows.values()]
      .filter((row) => !['completed', 'failed', 'canceled'].includes(row.status))
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .slice(0, limit)
  }

  listBySession(sessionId: string, limit = 100): ComputerSessionRow[] {
    return [...this.rows.values()]
      .filter((row) => row.session_id === sessionId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, limit)
  }

  updateStatus(
    id: string,
    status: StoredComputerSessionStatus,
    updatedAt: string,
    endedAt: string | null = null,
  ): ComputerSessionRow | null {
    const row = this.get(id)
    if (row == null) return null
    const updated = { ...row, status, updated_at: updatedAt, ended_at: endedAt }
    this.rows.set(id, updated)
    return updated
  }
}

class MemoryLeaseStore implements ComputerActuatorLeaseStore {
  readonly rows = new Map<string, ComputerActuatorLeaseRow>()

  constructor(private readonly sessions: MemorySessionStore) {}

  acquire(params: {
    id: string
    environmentKey: string
    computerSessionId: string
    operatorId: string
    acquiredAt: string
    expiresAt: string
  }): ComputerActuatorLeaseRow {
    for (const row of this.rows.values()) {
      if (
        row.environment_key === params.environmentKey &&
        row.released_at == null &&
        row.expires_at > params.acquiredAt
      ) {
        throw new Error('active lease conflict')
      }
    }
    const row: ComputerActuatorLeaseRow = {
      id: params.id,
      environment_key: params.environmentKey,
      computer_session_id: params.computerSessionId,
      operator_id: params.operatorId,
      acquired_at: params.acquiredAt,
      heartbeat_at: params.acquiredAt,
      expires_at: params.expiresAt,
      released_at: null,
    }
    this.rows.set(row.id, row)
    const session = this.sessions.get(params.computerSessionId)
    if (session != null) {
      this.sessions.rows.set(session.id, { ...session, actuator_lease_id: row.id })
    }
    return row
  }

  get(id: string): ComputerActuatorLeaseRow | null {
    return this.rows.get(id) ?? null
  }

  heartbeat(
    id: string,
    operatorId: string,
    heartbeatAt: string,
    expiresAt: string,
  ): ComputerActuatorLeaseRow | null {
    const row = this.get(id)
    if (
      row == null ||
      row.operator_id !== operatorId ||
      row.released_at !== null ||
      row.expires_at <= heartbeatAt
    ) {
      return null
    }
    const updated = { ...row, heartbeat_at: heartbeatAt, expires_at: expiresAt }
    this.rows.set(id, updated)
    return updated
  }

  release(id: string, operatorId: string, releasedAt: string): boolean {
    const row = this.get(id)
    if (row == null || row.operator_id !== operatorId || row.released_at !== null) return false
    this.rows.set(id, { ...row, released_at: releasedAt })
    const session = this.sessions.get(row.computer_session_id)
    if (session?.actuator_lease_id === id) {
      this.sessions.rows.set(session.id, { ...session, actuator_lease_id: null })
    }
    return true
  }
}

function actionEnvelope(sessionId: string, leaseId: string): ComputerActionEnvelope {
  return {
    computerSessionId: sessionId,
    actionId: 'action-1',
    actuatorLeaseId: leaseId,
    observedFrameId: 'frame-1',
    observedTreeVersion: 'tree-1',
    targetAppId: 'com.spark.Editor',
    targetWindowId: 'window-1',
    action: { type: 'scroll', deltaX: 0, deltaY: 100 },
    policyContext: {
      effect: 'read_only',
      target: { kind: 'element', id: 'document-editor' },
      dataClasses: [],
    },
    intent: 'Read the document',
  }
}

function createHarness(timeline?: ComputerUseTimelineSink) {
  let nowMs = Date.parse('2026-07-28T05:00:00.000Z')
  let nextId = 1
  const sessions = new MemorySessionStore()
  const leases = new MemoryLeaseStore(sessions)
  const manager = new ComputerSessionManager({
    sessions,
    leases,
    now: () => new Date(nowMs),
    createId: () => `generated-${nextId++}`,
    leaseTtlMs: 10_000,
    ...(timeline == null ? {} : { timeline }),
  })
  return {
    manager,
    sessions,
    leases,
    advance(ms: number) {
      nowMs += ms
    },
  }
}

function createSession(manager: ComputerSessionManager, id: string) {
  return manager.createSession({
    id,
    sessionId: `chat-${id}`,
    turnId: `turn-${id}`,
    workflowRunId: null,
    environment: 'my_desktop',
    providerProfileId: 'provider-1',
    modelId: 'model-1',
    taskContract,
  })
}

describe('ComputerSessionManager', () => {
  it('publishes actual session status transitions without letting listeners break control flow', () => {
    const { manager } = createHarness()
    const statuses: string[] = []
    manager.subscribeStatus((session) => statuses.push(session.status))
    manager.subscribeStatus(() => {
      throw new Error('projection failed')
    })

    const session = createSession(manager, 'computer-session-status')
    manager.pause(session.id)
    manager.resume(session.id)
    manager.cancel(session.id)

    expect(statuses).toEqual(['preflighting', 'paused', 'observing', 'canceled'])
  })

  it('emits durable session lifecycle events with chat provenance', () => {
    const record = vi.fn()
    const { manager } = createHarness({ record })
    const session = createSession(manager, 'computer-session-1')

    manager.acquireLease({
      computerSessionId: session.id,
      environmentKey: 'my-desktop:local',
      operatorId: 'agent-1',
    })
    manager.setPhase(session.id, 'verifying')
    manager.completeVerified(session.id, ['verification-1'])

    expect(record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'computer_session_started',
        sessionId: `chat-${session.id}`,
        turnId: `turn-${session.id}`,
      }),
    )
    expect(record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'computer_session_completed',
        verificationIds: ['verification-1'],
      }),
    )
  })
  it('enforces one active operator lease per environment', () => {
    const { manager, sessions } = createHarness()
    createSession(manager, 'computer-session-1')
    createSession(manager, 'computer-session-2')
    sessions.create({
      id: 'computer-session-recovered',
      sessionId: 'chat-recovered',
      turnId: 'turn-recovered',
      workflowRunId: null,
      environment: 'safe_desktop',
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      taskContract,
      createdAt: '2026-07-28T04:59:00.000Z',
    })

    expect(manager.getSession('computer-session-1')).toMatchObject({
      id: 'computer-session-1',
      status: 'preflighting',
    })
    expect(manager.getSession('missing-session')).toBeNull()
    expect(manager.listActiveSessionIds()).toEqual([
      'computer-session-recovered',
      'computer-session-1',
      'computer-session-2',
    ])

    const lease = manager.acquireLease({
      computerSessionId: 'computer-session-1',
      environmentKey: 'my-desktop:local',
      operatorId: 'operator-1',
    })
    expect(lease.computerSessionId).toBe('computer-session-1')

    expect(() =>
      manager.acquireLease({
        computerSessionId: 'computer-session-2',
        environmentKey: 'my-desktop:local',
        operatorId: 'operator-2',
      }),
    ).toThrowError(expect.objectContaining({ code: 'actuator_lease_conflict' }))
    expect(() =>
      manager.acquireLease({
        computerSessionId: 'computer-session-2',
        environmentKey: 'my-desktop:alternate',
        operatorId: 'operator-2',
      }),
    ).toThrowError(expect.objectContaining({ code: 'actuator_lease_conflict' }))
  })

  it('validates lease ownership, session binding and expiry before dispatch', () => {
    const { manager, advance } = createHarness()
    createSession(manager, 'computer-session-1')
    const lease = manager.acquireLease({
      computerSessionId: 'computer-session-1',
      environmentKey: 'my-desktop:local',
      operatorId: 'operator-1',
    })

    expect(
      manager.assertDispatchAllowed(actionEnvelope('computer-session-1', lease.id)),
    ).toMatchObject({
      session: { id: 'computer-session-1', status: 'observing' },
      lease: { id: lease.id, operatorId: 'operator-1' },
    })
    expect(() =>
      manager.assertDispatchAllowed(actionEnvelope('computer-session-1', 'wrong-lease')),
    ).toThrowError(expect.objectContaining({ code: 'actuator_lease_conflict' }))

    advance(10_000)
    expect(() =>
      manager.assertDispatchAllowed(actionEnvelope('computer-session-1', lease.id)),
    ).toThrowError(expect.objectContaining({ code: 'actuator_lease_conflict' }))
  })

  it('heartbeats an active lease but cannot revive an expired lease', () => {
    const { manager, advance } = createHarness()
    createSession(manager, 'computer-session-1')
    const lease = manager.acquireLease({
      computerSessionId: 'computer-session-1',
      environmentKey: 'my-desktop:local',
      operatorId: 'operator-1',
    })

    advance(5_000)
    expect(
      manager.heartbeatLease({
        computerSessionId: 'computer-session-1',
        leaseId: lease.id,
        operatorId: 'operator-1',
      }).expiresAt,
    ).toBe('2026-07-28T05:00:15.000Z')

    advance(10_000)
    expect(() =>
      manager.heartbeatLease({
        computerSessionId: 'computer-session-1',
        leaseId: lease.id,
        operatorId: 'operator-1',
      }),
    ).toThrowError(expect.objectContaining({ code: 'actuator_lease_conflict' }))
  })

  it('persists broker phases without allowing a paused session to re-enter execution', () => {
    const { manager } = createHarness()
    createSession(manager, 'computer-session-1')
    const lease = manager.acquireLease({
      computerSessionId: 'computer-session-1',
      environmentKey: 'my-desktop:local',
      operatorId: 'operator-1',
    })

    expect(manager.setPhase('computer-session-1', 'waiting_approval').status).toBe(
      'waiting_approval',
    )
    expect(
      manager.assertDispatchAllowed(actionEnvelope('computer-session-1', lease.id)).session.status,
    ).toBe('waiting_approval')
    expect(manager.setPhase('computer-session-1', 'acting').status).toBe('acting')
    expect(manager.setPhase('computer-session-1', 'observing').status).toBe('observing')

    manager.pause('computer-session-1')
    expect(() => manager.setPhase('computer-session-1', 'acting')).toThrowError(
      expect.objectContaining({ code: 'session_paused' }),
    )
  })

  it('aborts in-flight work and releases the lease on pause and cancel', () => {
    const { manager, leases } = createHarness()
    createSession(manager, 'computer-session-1')
    const lease = manager.acquireLease({
      computerSessionId: 'computer-session-1',
      environmentKey: 'my-desktop:local',
      operatorId: 'operator-1',
    })
    const firstSignal = manager.getAbortSignal('computer-session-1')

    expect(manager.pause('computer-session-1').status).toBe('paused')
    expect(firstSignal.aborted).toBe(true)
    expect(leases.get(lease.id)?.released_at).not.toBeNull()
    expect(() =>
      manager.assertDispatchAllowed(actionEnvelope('computer-session-1', lease.id)),
    ).toThrowError(expect.objectContaining({ code: 'session_paused' }))

    expect(manager.resume('computer-session-1').status).toBe('observing')
    const resumedSignal = manager.getAbortSignal('computer-session-1')
    expect(resumedSignal).not.toBe(firstSignal)
    expect(resumedSignal.aborted).toBe(false)

    expect(manager.cancel('computer-session-1').status).toBe('canceled')
    expect(resumedSignal.aborted).toBe(true)
    expect(() => manager.getAbortSignal('computer-session-1')).toThrowError(
      expect.objectContaining({ code: 'session_canceled' }),
    )
  })

  it('allows only the verification engine to complete and release an active session', () => {
    const { manager, leases } = createHarness()
    createSession(manager, 'computer-session-1')
    const lease = manager.acquireLease({
      computerSessionId: 'computer-session-1',
      environmentKey: 'my-desktop:local',
      operatorId: 'operator-1',
    })
    const signal = manager.getAbortSignal('computer-session-1')
    manager.setPhase('computer-session-1', 'verifying')

    expect(manager.completeVerified('computer-session-1').status).toBe('completed')
    expect(signal.aborted).toBe(true)
    expect(leases.get(lease.id)?.released_at).not.toBeNull()
    expect(() => manager.completeVerified('computer-session-1')).toThrowError(
      expect.objectContaining({ code: 'session_canceled' }),
    )
  })

  it('terminates failed operator runs and releases their lease', () => {
    const { manager, leases } = createHarness()
    createSession(manager, 'computer-session-1')
    const lease = manager.acquireLease({
      computerSessionId: 'computer-session-1',
      environmentKey: 'my-desktop:local',
      operatorId: 'operator-1',
    })
    const signal = manager.getAbortSignal('computer-session-1')

    expect(manager.fail('computer-session-1').status).toBe('failed')
    expect(signal.aborted).toBe(true)
    expect(leases.get(lease.id)?.released_at).not.toBeNull()
  })
})
