import type {
  ComputerActionEnvelope,
  ComputerActuatorLease,
  ComputerApprovalTicket,
  ComputerObservation,
  ComputerSession,
} from '@spark/protocol'
import type { ComputerActionRow, CreateComputerActionParams } from '@spark/storage'
import { describe, expect, it, vi } from 'vitest'
import {
  ComputerControlBroker,
  type ComputerActionStore,
  type ComputerApprovalController,
  type ComputerSessionController,
} from './ComputerControlBroker.js'
import {
  ComputerUseTimelineStore,
  type ComputerUseTimelineSink,
} from './ComputerUseTimelineStore.js'
import {
  UnavailableComputerUseBackend,
  type ComputerExecutorBackend,
  type ComputerObserverBackend,
} from './ComputerUseBackend.js'
import { ComputerPolicyService } from './ComputerPolicyService.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'

const beforeObservation: ComputerObservation = {
  frameId: 'frame-1',
  treeVersion: 'tree-1',
  capturedAt: '2026-07-28T05:00:00.000Z',
  display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 2 },
  foreground: {
    app: { id: 'com.spark.Editor', name: 'Spark Editor', processId: 100 },
    window: {
      id: 'window-1',
      title: 'Draft',
      bounds: { x: 0, y: 0, width: 960, height: 720 },
    },
  },
  screenshot: { snapshotId: 'snapshot-before', width: 1920, height: 1080 },
  tree: { mode: 'full', text: 'Draft', elementCount: 1 },
  elements: [
    {
      id: 'document-editor',
      treeVersion: 'tree-1',
      role: 'text_area',
      name: 'Draft',
      bounds: { x: 100, y: 120, width: 600, height: 400 },
      enabled: true,
      focused: true,
      actions: ['set_value'],
    },
  ],
  loading: false,
  sensitiveRegions: [],
}

const beforeElement = beforeObservation.elements[0]
if (beforeElement == null) throw new Error('Expected a baseline accessibility element')

const afterObservation: ComputerObservation = {
  ...beforeObservation,
  frameId: 'frame-2',
  treeVersion: 'tree-2',
  capturedAt: '2026-07-28T05:00:01.000Z',
  screenshot: { snapshotId: 'snapshot-after', width: 1920, height: 1080 },
  elements: [{ ...beforeElement, treeVersion: 'tree-2', name: 'Approved' }],
  tree: { mode: 'diff', text: 'Approved', elementCount: 1 },
}

const session: ComputerSession = {
  id: 'computer-session-1',
  sessionId: 'chat-session-1',
  turnId: 'turn-1',
  workflowRunId: null,
  environment: 'my_desktop',
  status: 'observing',
  providerProfileId: 'provider-1',
  modelId: 'model-1',
  taskContract: {
    objective: 'Edit the approved document',
    successCriteria: [
      {
        kind: 'accessibility',
        selector: { elementId: 'document-editor' },
        assertion: { operator: 'text_contains', expected: 'Approved' },
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
  },
  actuatorLeaseId: 'lease-1',
  createdAt: '2026-07-28T05:00:00.000Z',
  updatedAt: '2026-07-28T05:00:00.000Z',
}

const lease: ComputerActuatorLease = {
  id: 'lease-1',
  environmentKey: 'my-desktop:local',
  computerSessionId: session.id,
  operatorId: 'operator-1',
  acquiredAt: '2026-07-28T05:00:00.000Z',
  heartbeatAt: '2026-07-28T05:00:00.000Z',
  expiresAt: '2026-07-28T05:01:00.000Z',
  releasedAt: null,
}

function envelope(overrides: Partial<ComputerActionEnvelope> = {}): ComputerActionEnvelope {
  return {
    computerSessionId: session.id,
    actionId: 'action-1',
    actuatorLeaseId: lease.id,
    observedFrameId: beforeObservation.frameId,
    observedTreeVersion: beforeObservation.treeVersion,
    targetAppId: beforeObservation.foreground.app.id,
    targetWindowId: beforeObservation.foreground.window.id,
    action: { type: 'set_value', elementId: 'document-editor', value: 'Approved' },
    policyContext: {
      effect: 'reversible_local',
      target: { kind: 'element', id: 'document-editor' },
      dataClasses: [],
    },
    intent: 'Update the approved draft',
    ...overrides,
  }
}

class MemoryActionStore implements ComputerActionStore {
  readonly rows = new Map<string, ComputerActionRow>()

  get(id: string): ComputerActionRow | null {
    return this.rows.get(id) ?? null
  }

  nextStepIndex(computerSessionId: string): number {
    return [...this.rows.values()].filter((row) => row.computer_session_id === computerSessionId)
      .length
  }

  create(params: CreateComputerActionParams): ComputerActionRow {
    const row: ComputerActionRow = {
      id: params.id,
      computer_session_id: params.computerSessionId,
      step_index: params.stepIndex,
      action_json: JSON.stringify(params.action),
      intent: params.intent,
      risk_level: params.riskLevel,
      policy_decision: params.policyDecision,
      approval_ticket_id: params.approvalTicketId,
      before_frame_id: params.beforeFrameId,
      after_frame_id: null,
      expected_postcondition_json:
        params.expectedPostcondition == null ? null : JSON.stringify(params.expectedPostcondition),
      status: 'requested',
      error_code: null,
      created_at: params.createdAt,
      completed_at: null,
    }
    this.rows.set(row.id, row)
    return row
  }

  startExecuting(id: string, approvalTicketId: string | null): ComputerActionRow | null {
    const row = this.get(id)
    if (row == null || row.status !== 'requested') return null
    const updated = { ...row, status: 'executing' as const, approval_ticket_id: approvalTicketId }
    this.rows.set(id, updated)
    return updated
  }

  complete(
    id: string,
    params: {
      status: 'blocked' | 'executed' | 'failed' | 'canceled'
      afterFrameId: string | null
      errorCode: string | null
      completedAt: string
    },
  ): ComputerActionRow | null {
    const row = this.get(id)
    if (row == null || !['requested', 'executing'].includes(row.status)) return null
    const updated = {
      ...row,
      status: params.status,
      after_frame_id: params.afterFrameId,
      error_code: params.errorCode,
      completed_at: params.completedAt,
    }
    this.rows.set(id, updated)
    return updated
  }
}

function createSessionController(): ComputerSessionController & {
  current: ComputerSession
  controller: AbortController
} {
  return {
    current: { ...session },
    controller: new AbortController(),
    assertDispatchAllowed(action) {
      if (this.current.status === 'paused') {
        throw new ComputerUseBrokerError('session_paused', 'paused')
      }
      if (this.current.status === 'canceled') {
        throw new ComputerUseBrokerError('session_canceled', 'canceled')
      }
      if (action.actuatorLeaseId !== lease.id) {
        throw new ComputerUseBrokerError('actuator_lease_conflict', 'invalid lease')
      }
      return { session: this.current, lease, signal: this.controller.signal }
    },
    getAbortSignal() {
      if (this.current.status === 'canceled') {
        throw new ComputerUseBrokerError('session_canceled', 'canceled')
      }
      return this.controller.signal
    },
    setPhase(_computerSessionId, phase) {
      this.current = { ...this.current, status: phase }
      return this.current
    },
    pause() {
      this.current = { ...this.current, status: 'paused', actuatorLeaseId: null }
      this.controller.abort()
      return this.current
    },
    resume() {
      this.current = { ...this.current, status: 'observing' }
      this.controller = new AbortController()
      return this.current
    },
    cancel() {
      this.current = { ...this.current, status: 'canceled', actuatorLeaseId: null }
      this.controller.abort()
      return this.current
    },
  }
}

function createHarness(
  options: {
    executor?: ComputerExecutorBackend
    observer?: ComputerObserverBackend
    timeline?: ComputerUseTimelineSink
  } = {},
) {
  const actions = new MemoryActionStore()
  const sessions = createSessionController()
  const approvals: ComputerApprovalController = {
    request: vi.fn(() => ({ id: 'approval-1' })),
    consume: vi.fn(),
    cancelPending: vi.fn(() => 0),
  }
  const observer: ComputerObserverBackend = options.observer ?? {
    observe: vi.fn(async () => beforeObservation),
  }
  const executor: ComputerExecutorBackend =
    options.executor ??
    ({
      execute: vi.fn(async () => ({ observation: afterObservation, noop: false })),
      cancelSession: vi.fn(async () => undefined),
    } satisfies ComputerExecutorBackend)
  const broker = new ComputerControlBroker({
    sessions,
    policy: new ComputerPolicyService(),
    approvals,
    actions,
    observer,
    executor,
    ...(options.timeline == null ? {} : { timeline: options.timeline }),
    now: () => new Date('2026-07-28T05:00:02.000Z'),
  })
  return {
    broker,
    actions,
    sessions,
    approvals,
    observer,
    executor,
    ...(options.timeline == null ? {} : { timeline: options.timeline }),
  }
}

describe('ComputerControlBroker', () => {
  it('executes only against the broker-owned observation and persists the after frame', async () => {
    const { broker, actions, executor } = createHarness()
    await expect(broker.observe(session.id, true)).resolves.toEqual(beforeObservation)

    await expect(broker.dispatch(envelope())).resolves.toEqual({
      observation: afterObservation,
      noop: false,
    })
    expect(executor.execute).toHaveBeenCalledWith({
      envelope: envelope(),
      observation: beforeObservation,
      signal: expect.any(AbortSignal),
    })
    expect(actions.get('action-1')).toMatchObject({
      status: 'executed',
      before_frame_id: 'frame-1',
      after_frame_id: 'frame-2',
      risk_level: 'L1',
    })
  })

  it('rejects stale frames, stale trees and foreground window drift before execution', async () => {
    const { broker, executor } = createHarness()
    await broker.observe(session.id, true)

    await expect(
      broker.dispatch(envelope({ observedFrameId: 'frame-stale' })),
    ).rejects.toMatchObject({ code: 'stale_frame' })
    await expect(
      broker.dispatch(envelope({ observedTreeVersion: 'tree-stale' })),
    ).rejects.toMatchObject({ code: 'stale_tree' })
    await expect(
      broker.dispatch(envelope({ targetWindowId: 'window-drifted' })),
    ).rejects.toMatchObject({ code: 'focus_mismatch' })
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('persists an approval request and consumes its exact ticket before execution', async () => {
    const { broker, approvals, actions, sessions } = createHarness()
    await broker.observe(session.id, true)
    const governed = envelope({
      policyContext: {
        effect: 'external_write',
        target: { kind: 'recipient', id: 'recipient-alice' },
        dataClasses: ['internal'],
      },
    })

    await expect(broker.dispatch(governed)).rejects.toMatchObject({
      code: 'approval_required',
      details: { approvalId: 'approval-1' },
    })
    expect(sessions.current.status).toBe('waiting_approval')
    expect(actions.get(governed.actionId)?.status).toBe('requested')
    expect(approvals.request).toHaveBeenCalledWith(governed, 'L2')

    const ticket = { id: 'approval-1' } as ComputerApprovalTicket
    await expect(broker.dispatch(governed, ticket)).resolves.toMatchObject({ noop: false })
    expect(sessions.current.status).toBe('observing')
    expect(approvals.consume).toHaveBeenCalledWith(ticket, governed, 'L2')
  })

  it('records the action lifecycle on the timeline sink when executed', async () => {
    const timeline = new ComputerUseTimelineStore({
      createId: () => 'ev',
      now: () => new Date('2026-07-28T05:00:02.000Z'),
    })
    const { broker } = createHarness({ timeline })
    await broker.observe(session.id, true)

    await broker.dispatch(envelope())

    const { events } = timeline.read(session.id)
    expect(events.map((event) => event.type)).toEqual([
      'computer_observation_created',
      'computer_action_requested',
      'computer_action_executed',
    ])
    expect(events[1]).toMatchObject({ actionId: 'action-1', riskLevel: 'L1' })
    expect(events[2]).toMatchObject({
      actionId: 'action-1',
      beforeFrameId: 'frame-1',
      afterFrameId: 'frame-2',
    })
  })

  it('records an approval request on the timeline before the ticket is presented', async () => {
    const timeline = new ComputerUseTimelineStore({
      createId: () => 'ev',
      now: () => new Date('2026-07-28T05:00:02.000Z'),
    })
    const { broker } = createHarness({ timeline })
    await broker.observe(session.id, true)
    const governed = envelope({
      policyContext: {
        effect: 'external_write',
        target: { kind: 'recipient', id: 'recipient-alice' },
        dataClasses: ['internal'],
      },
    })

    await expect(broker.dispatch(governed)).rejects.toMatchObject({ code: 'approval_required' })

    const { events } = timeline.read(session.id)
    expect(events.map((event) => event.type)).toEqual([
      'computer_observation_created',
      'computer_action_requested',
      'computer_approval_requested',
    ])
    expect(events[2]).toMatchObject({
      approvalId: 'approval-1',
      actionId: governed.actionId,
      riskLevel: 'L2',
    })
  })

  it('records a noop as a failed action on the timeline', async () => {
    const executor: ComputerExecutorBackend = {
      execute: vi.fn(async () => ({ observation: beforeObservation, noop: true })),
      cancelSession: vi.fn(async () => undefined),
    }
    const timeline = new ComputerUseTimelineStore({
      createId: () => 'ev',
      now: () => new Date('2026-07-28T05:00:02.000Z'),
    })
    const { broker } = createHarness({ executor, timeline })
    await broker.observe(session.id, true)

    await expect(broker.dispatch(envelope())).rejects.toMatchObject({ code: 'action_noop' })

    const { events } = timeline.read(session.id)
    expect(events.map((event) => event.type)).toEqual([
      'computer_observation_created',
      'computer_action_requested',
      'computer_action_failed',
    ])
    expect(events[2]).toMatchObject({ actionId: 'action-1', errorCode: 'action_noop' })
  })

  it('marks noop execution as failed instead of claiming completion', async () => {
    const executor: ComputerExecutorBackend = {
      execute: vi.fn(async () => ({ observation: beforeObservation, noop: true })),
      cancelSession: vi.fn(async () => undefined),
    }
    const { broker, actions } = createHarness({ executor })
    await broker.observe(session.id, true)

    await expect(broker.dispatch(envelope())).rejects.toMatchObject({ code: 'action_noop' })
    expect(actions.get('action-1')).toMatchObject({ status: 'failed', error_code: 'action_noop' })
  })

  it('keeps the session runnable after a recoverable native execution error', async () => {
    const executor: ComputerExecutorBackend = {
      execute: vi.fn(async () => {
        throw new ComputerUseBrokerError('stale_frame', 'The native frame changed')
      }),
      cancelSession: vi.fn(async () => undefined),
    }
    const { broker, sessions, actions } = createHarness({ executor })
    await broker.observe(session.id, true)

    await expect(broker.dispatch(envelope())).rejects.toMatchObject({ code: 'stale_frame' })
    expect(sessions.current.status).toBe('observing')
    expect(actions.get('action-1')).toMatchObject({ status: 'failed', error_code: 'stale_frame' })
  })

  it('never allows two actions to execute concurrently in one session', async () => {
    let finishFirst:
      | ((value: { observation: ComputerObservation; noop: boolean }) => void)
      | undefined
    const executor: ComputerExecutorBackend = {
      execute: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<{ observation: ComputerObservation; noop: boolean }>((resolve) => {
              finishFirst = resolve
            }),
        )
        .mockResolvedValue({ observation: afterObservation, noop: false }),
      cancelSession: vi.fn(async () => undefined),
    }
    const { broker } = createHarness({ executor })
    await broker.observe(session.id, true)

    const first = broker.dispatch(envelope())
    await expect(broker.dispatch(envelope({ actionId: 'action-2' }))).rejects.toMatchObject({
      code: 'actuator_lease_conflict',
    })
    expect(executor.execute).toHaveBeenCalledTimes(1)
    if (finishFirst == null) throw new Error('Expected first action to start')
    finishFirst({ observation: afterObservation, noop: false })
    await expect(first).resolves.toMatchObject({ noop: false })
  })

  it('cancels synchronously before waiting for the backend kill switch', async () => {
    let finishCancel: (() => void) | undefined
    const executor: ComputerExecutorBackend = {
      execute: vi.fn(async () => ({ observation: afterObservation, noop: false })),
      cancelSession: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishCancel = resolve
          }),
      ),
    }
    const { broker, approvals, sessions } = createHarness({ executor })
    await broker.observe(session.id, true)

    const stopping = broker.stop(session.id)
    expect(sessions.current.status).toBe('canceled')
    expect(sessions.controller.signal.aborted).toBe(true)
    expect(approvals.cancelPending).toHaveBeenCalledWith(session.id)
    await expect(broker.dispatch(envelope())).rejects.toMatchObject({ code: 'session_canceled' })
    if (finishCancel == null) throw new Error('Expected backend cancellation to start')
    finishCancel()
    await stopping
  })

  it('fails closed when the trusted native backend is unavailable', async () => {
    const unavailable = new UnavailableComputerUseBackend()
    const { broker } = createHarness({ observer: unavailable, executor: unavailable })

    await expect(broker.observe(session.id, true)).rejects.toMatchObject({
      code: 'native_host_missing',
    })
  })

  it('converts malformed caller and backend payloads into stable fail-closed errors', async () => {
    const observer: ComputerObserverBackend = {
      observe: vi.fn(
        async () => ({ ...beforeObservation, rawImagePath: '/tmp/frame.png' }) as never,
      ),
    }
    const { broker } = createHarness({ observer })

    await expect(broker.observe(session.id, true)).rejects.toMatchObject({
      code: 'native_host_incompatible',
    })
    await expect(
      broker.dispatch({ ...envelope(), action: { type: 'shell', command: 'whoami' } } as never),
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
  })
})
