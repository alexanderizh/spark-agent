import type { ComputerActuatorLease, ComputerObservation, ComputerSession } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ComputerTaskOperator } from './ComputerTaskOperator.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'

const BEFORE = observation('frame-1', 'tree-1', 'snapshot-1', 'Edit')
const AFTER = observation('frame-2', 'tree-2', 'snapshot-2', 'Saved')

const SESSION = {
  id: 'computer-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  workflowRunId: null,
  environment: 'my_desktop',
  status: 'observing',
  providerProfileId: 'provider-1',
  modelId: 'vision-model',
  actuatorLeaseId: 'lease-1',
  createdAt: '2026-07-28T08:00:00.000Z',
  updatedAt: '2026-07-28T08:00:00.000Z',
  taskContract: {
    objective: 'Save the document',
    successCriteria: [
      { kind: 'visual', assertion: { operator: 'text_present', expected: 'Saved' } },
    ],
    allowedApps: [{ kind: 'app_id', value: 'app-1' }],
    allowedDomains: [],
    allowedDataClasses: ['public'],
    forbiddenActions: [],
    maxSteps: 10,
    maxRuntimeMs: 60_000,
    maxConsecutiveNoops: 3,
    userPresence: 'required',
  },
} satisfies ComputerSession

const LEASE = {
  id: 'lease-1',
  environmentKey: 'my-desktop:local',
  computerSessionId: 'computer-1',
  operatorId: 'agent:session-1',
  acquiredAt: '2026-07-28T08:00:00.000Z',
  heartbeatAt: '2026-07-28T08:00:00.000Z',
  expiresAt: '2026-07-28T08:00:10.000Z',
  releasedAt: null,
} satisfies ComputerActuatorLease

describe('ComputerTaskOperator', () => {
  it('runs model decisions only through Broker actions and completes only after verification', async () => {
    const decisions = [
      {
        type: 'action' as const,
        intent: 'Save through the exposed button',
        action: {
          type: 'invoke_element' as const,
          elementId: 'save-button',
          action: 'invoke' as const,
        },
      },
      { type: 'ready_for_verification' as const, reason: 'Saved status is visible' },
    ]
    const adapter = { decide: vi.fn(async () => decisions.shift()!) }
    const sessions = sessionController()
    const broker = {
      observe: vi.fn(async () => BEFORE),
      dispatch: vi.fn(async () => ({ observation: AFTER, noop: false })),
    }
    const operator = new ComputerTaskOperator({
      sessions,
      broker,
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      createId: () => 'action-1',
      now: () => Date.parse(SESSION.createdAt),
    })

    const result = await operator.run({ session: SESSION, lease: LEASE, adapter })
    expect(result).toEqual({
      status: 'completed',
      verification: expect.objectContaining({ passed: true }),
    })
    expect(broker.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'action-1',
        observedFrameId: 'frame-1',
        observedTreeVersion: 'tree-1',
        actuatorLeaseId: SESSION.id,
        executionLane: 'background_semantic',
        policyContext: expect.objectContaining({ target: { kind: 'element', id: 'save-button' } }),
      }),
    )
    expect(sessions.completeVerified).toHaveBeenCalledWith('computer-1', [expect.any(String)])
  })

  it('executes every action in a batch decision sequentially and then verifies', async () => {
    const decisions = [
      {
        type: 'actions' as const,
        intent: 'Click the field and type the sign-off',
        actions: [
          { type: 'click' as const, point: { x: 10, y: 20 } },
          { type: 'type_text' as const, text: 'Thanks' },
        ],
      },
      { type: 'ready_for_verification' as const, reason: 'Saved status is visible' },
    ]
    const broker = {
      observe: vi.fn(async () => BEFORE),
      dispatch: vi.fn(async () => ({ observation: AFTER, noop: false })),
    }
    let sequence = 0
    const operator = new ComputerTaskOperator({
      sessions: sessionController(),
      broker,
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      createId: () => `action-${(sequence += 1)}`,
      now: () => Date.parse(SESSION.createdAt),
    })

    const result = await operator.run({
      session: SESSION,
      lease: LEASE,
      adapter: { decide: vi.fn(async () => decisions.shift()!) },
    })
    expect(result).toEqual({
      status: 'completed',
      verification: expect.objectContaining({ passed: true }),
    })
    expect(broker.dispatch).toHaveBeenCalledTimes(2)
  })

  it('stops a batch when a later step noops and re-plans against fresh state', async () => {
    const decisions = [
      {
        type: 'actions' as const,
        intent: 'Two clicks',
        actions: [
          { type: 'click' as const, point: { x: 1, y: 1 } },
          { type: 'click' as const, point: { x: 2, y: 2 } },
        ],
      },
      {
        type: 'action' as const,
        intent: 'Single retry',
        action: { type: 'click' as const, point: { x: 3, y: 3 } },
      },
      { type: 'ready_for_verification' as const, reason: 'Saved status is visible' },
    ]
    const broker = {
      observe: vi.fn(async () => BEFORE),
      dispatch: vi
        .fn()
        // first batch step ok, second batch step noops → batch stops
        .mockResolvedValueOnce({ observation: AFTER, noop: false })
        .mockRejectedValueOnce(new ComputerUseBrokerError('action_noop', 'nothing changed'))
        // single retry after re-plan succeeds
        .mockResolvedValueOnce({ observation: AFTER, noop: false }),
    }
    let sequence = 0
    const operator = new ComputerTaskOperator({
      sessions: sessionController(),
      broker,
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      createId: () => `action-${(sequence += 1)}`,
      now: () => Date.parse(SESSION.createdAt),
    })

    const result = await operator.run({
      session: SESSION,
      lease: LEASE,
      adapter: { decide: vi.fn(async () => decisions.shift()!) },
    })
    expect(result).toEqual({
      status: 'completed',
      verification: expect.objectContaining({ passed: true }),
    })
    // The no-op second batch step stopped the batch; the model re-planned and the
    // third decision (single action) ran to completion.
    expect(broker.dispatch).toHaveBeenCalledTimes(3)
  })

  it('locally recovers a stale frame on a non-approval action instead of re-querying the model', async () => {
    const decisions = [
      {
        type: 'action' as const,
        intent: 'Save through the exposed button',
        action: {
          type: 'invoke_element' as const,
          elementId: 'save-button',
          action: 'invoke' as const,
        },
      },
      { type: 'ready_for_verification' as const, reason: 'Saved status is visible' },
    ]
    const broker = {
      observe: vi.fn().mockResolvedValueOnce(BEFORE).mockResolvedValue(AFTER),
      dispatch: vi
        .fn()
        .mockRejectedValueOnce(new ComputerUseBrokerError('stale_frame', 'frame drifted'))
        .mockResolvedValueOnce({ observation: AFTER, noop: false }),
    }
    const operator = new ComputerTaskOperator({
      sessions: sessionController(),
      broker,
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      createId: () => 'action-1',
      now: () => Date.parse(SESSION.createdAt),
    })

    const result = await operator.run({
      session: SESSION,
      lease: LEASE,
      adapter: { decide: vi.fn(async () => decisions.shift()!) },
    })
    expect(result).toEqual({
      status: 'completed',
      verification: expect.objectContaining({ passed: true }),
    })

    // The stale frame was recovered locally: dispatch retried once with a refreshed envelope
    // (observedFrameId advanced to the re-observed frame) and the model decided exactly twice
    // (action + verification). Had recovery fallen back to the model loop, decide would have
    // been called a third time and the decisions array would have shifted past its end.
    expect(broker.dispatch).toHaveBeenCalledTimes(2)
    expect(broker.dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ observedFrameId: 'frame-2', observedTreeVersion: 'tree-2' }),
    )
    expect(broker.observe).toHaveBeenCalledTimes(2)
  })

  it('dispatches an external write directly without consulting approval services', async () => {
    const decisions = [
      {
        type: 'action' as const,
        intent: 'Save through the exposed button',
        action: {
          type: 'invoke_element' as const,
          elementId: 'save-button',
          action: 'invoke' as const,
        },
      },
      { type: 'ready_for_verification' as const, reason: 'Saved status is visible' },
    ]
    const dispatch = vi.fn(async () => ({ observation: AFTER, noop: false }))
    const takeApprovedTicket = vi.fn()
    const sessions = sessionController()
    const operator = new ComputerTaskOperator({
      sessions,
      broker: { observe: vi.fn(async () => BEFORE), dispatch },
      approvals: { takeApprovedTicket },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      createId: () => 'action-1',
      wait: vi.fn(async () => undefined),
      now: () => Date.parse(SESSION.createdAt),
    })

    await expect(
      operator.run({
        session: SESSION,
        adapter: { decide: vi.fn(async () => decisions.shift()!) },
      }),
    ).resolves.toMatchObject({ status: 'completed' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(takeApprovedTicket).not.toHaveBeenCalled()
    expect(sessions.heartbeatLease).not.toHaveBeenCalled()
  })

  it('hands control to the user when the native host detects real user input', async () => {
    const sessions = sessionController()
    const timeline = { record: vi.fn() }
    const dispatch = vi.fn(async () => {
      throw new ComputerUseBrokerError('handoff_required', 'The user took control')
    })
    const operator = new ComputerTaskOperator({
      sessions,
      broker: { observe: vi.fn(async () => BEFORE), dispatch },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      timeline,
      createId: () => 'action-1',
      now: () => Date.parse(SESSION.createdAt),
    })

    await expect(
      operator.run({
        session: SESSION,
        lease: LEASE,
        adapter: {
          decide: vi.fn(async () => ({
            type: 'action' as const,
            intent: 'Click the save button',
            action: { type: 'click' as const, point: { x: 10, y: 10 } },
          })),
        },
      }),
    ).resolves.toEqual({ status: 'handoff_required', reason: 'user_takeover' })
    expect(sessions.setPhase).toHaveBeenCalledWith(SESSION.id, 'handoff_required')
    expect(sessions.fail).not.toHaveBeenCalled()
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'computer_handoff_required',
        computerSessionId: SESSION.id,
        errorCode: 'handoff_required',
      }),
    )
  })

  it('fails closed when the decision provider throws', async () => {
    const sessions = sessionController()
    const operator = new ComputerTaskOperator({
      sessions,
      broker: { observe: vi.fn(async () => BEFORE), dispatch: vi.fn() },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      wait: vi.fn(async () => undefined),
      now: () => Date.parse(SESSION.createdAt),
    })

    await expect(
      operator.run({
        session: SESSION,
        lease: LEASE,
        adapter: {
          decide: vi.fn(async () => {
            throw new Error('provider failed')
          }),
        },
      }),
    ).resolves.toEqual({ status: 'failed', reason: 'operator_failed' })
    expect(sessions.fail).toHaveBeenCalledWith(SESSION.id, 'environment_unavailable')
  })

  it('preserves the decision model error instead of reporting an authorization failure', async () => {
    const sessions = sessionController()
    const operator = new ComputerTaskOperator({
      sessions,
      broker: { observe: vi.fn(async () => BEFORE), dispatch: vi.fn() },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      wait: vi.fn(async () => undefined),
      now: () => Date.parse(SESSION.createdAt),
    })

    await expect(
      operator.run({
        session: SESSION,
        lease: LEASE,
        adapter: {
          decide: vi.fn(async () => {
            throw new ComputerUseBrokerError(
              'decision_model_error',
              'Computer decision output is invalid',
            )
          }),
        },
      }),
    ).resolves.toEqual({ status: 'failed', reason: 'decision_model_error' })
    expect(sessions.fail).toHaveBeenCalledWith(SESSION.id, 'decision_model_error')
  })

  it('waits for a slow visual-model decision without a persistent actuator lease', async () => {
    const sessions = sessionController()
    const decisions = [
      {
        type: 'action' as const,
        intent: 'Save through the exposed button',
        action: {
          type: 'invoke_element' as const,
          elementId: 'save-button',
          action: 'invoke' as const,
        },
      },
      { type: 'ready_for_verification' as const, reason: 'Saved status is visible' },
    ]
    const operator = new ComputerTaskOperator({
      sessions,
      broker: {
        observe: vi.fn(async () => BEFORE),
        dispatch: vi.fn(async () => ({ observation: AFTER, noop: false })),
      },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      now: () => Date.parse(SESSION.createdAt),
    })

    await expect(
      operator.run({
        session: SESSION,
        adapter: {
          decide: vi.fn(async () => decisions.shift()!),
        },
      }),
    ).resolves.toMatchObject({ status: 'completed' })
    expect(sessions.heartbeatLease).not.toHaveBeenCalled()
  })

  it('re-observes after a noop and continues until a later action changes state', async () => {
    const decisions = [
      {
        type: 'action' as const,
        intent: 'Try the save button',
        action: {
          type: 'invoke_element' as const,
          elementId: 'save-button',
          action: 'invoke' as const,
        },
      },
      {
        type: 'action' as const,
        intent: 'Try the enabled save command',
        action: { type: 'keypress' as const, keys: ['META', 'S'] },
      },
      { type: 'ready_for_verification' as const, reason: 'Saved status is visible' },
    ]
    const observe = vi.fn().mockResolvedValueOnce(BEFORE).mockResolvedValueOnce(BEFORE)
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(
        new ComputerUseBrokerError('action_noop', 'Computer action made no observable change'),
      )
      .mockResolvedValueOnce({ observation: AFTER, noop: false })
    const sessions = sessionController()
    let actionIndex = 0
    const operator = new ComputerTaskOperator({
      sessions,
      broker: { observe, dispatch },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      createId: () => `action-${++actionIndex}`,
      now: () => Date.parse(SESSION.createdAt),
    })

    await expect(
      operator.run({
        session: SESSION,
        lease: LEASE,
        adapter: { decide: vi.fn(async () => decisions.shift()!) },
      }),
    ).resolves.toMatchObject({ status: 'completed' })
    expect(observe).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('falls back to re-observing and replanning when a stale frame cannot be locally relocated', async () => {
    const decisions = [
      {
        type: 'action' as const,
        intent: 'Use the current search field',
        action: { type: 'type_text' as const, text: 'comfyui' },
      },
      {
        type: 'action' as const,
        intent: 'Use the refreshed search field',
        action: { type: 'type_text' as const, text: 'comfyui' },
      },
      { type: 'ready_for_verification' as const, reason: 'The query is visible' },
    ]
    // The re-observe during local stale recovery sees a different foreground window, so the
    // operator cannot safely relocate the action and must fall back to model replanning.
    const movedWindow = {
      ...BEFORE,
      foreground: {
        ...BEFORE.foreground,
        window: { ...BEFORE.foreground.window, id: 'window-9' },
      },
    }
    const observe = vi
      .fn()
      .mockResolvedValueOnce(BEFORE)
      .mockResolvedValueOnce(movedWindow)
      .mockResolvedValue(BEFORE)
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(new ComputerUseBrokerError('stale_frame', 'The frame changed'))
      .mockResolvedValueOnce({ observation: AFTER, noop: false })
    const sessions = sessionController()
    const operator = new ComputerTaskOperator({
      sessions,
      broker: { observe, dispatch },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      wait: vi.fn(async () => undefined),
      now: () => Date.parse(SESSION.createdAt),
    })

    await expect(
      operator.run({
        session: SESSION,
        lease: LEASE,
        adapter: { decide: vi.fn(async () => decisions.shift()!) },
      }),
    ).resolves.toMatchObject({ status: 'completed' })
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(observe).toHaveBeenCalledTimes(3)
    expect(sessions.fail).not.toHaveBeenCalled()
  })

  it('fails after the task contract consecutive noop limit is reached', async () => {
    const sessions = sessionController()
    const actionDecision = {
      type: 'action' as const,
      intent: 'Try the save button',
      action: {
        type: 'invoke_element' as const,
        elementId: 'save-button',
        action: 'invoke' as const,
      },
    }
    const observe = vi.fn(async () => BEFORE)
    const dispatch = vi.fn(async () => {
      throw new ComputerUseBrokerError('action_noop', 'Computer action made no observable change')
    })
    const operator = new ComputerTaskOperator({
      sessions,
      broker: { observe, dispatch },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      now: () => Date.parse(SESSION.createdAt),
    })

    await expect(
      operator.run({
        session: SESSION,
        lease: LEASE,
        adapter: { decide: vi.fn(async () => actionDecision) },
      }),
    ).resolves.toEqual({ status: 'failed', reason: 'maximum_consecutive_noops_reached' })
    expect(dispatch).toHaveBeenCalledTimes(SESSION.taskContract.maxConsecutiveNoops)
    expect(observe).toHaveBeenCalledTimes(SESSION.taskContract.maxConsecutiveNoops)
    expect(sessions.fail).toHaveBeenCalledWith(SESSION.id)
  })

  it('enforces maxRuntimeMs even when no Broker action is dispatched', async () => {
    const sessions = sessionController()
    const startedAt = Date.parse(SESSION.createdAt)
    const now = vi
      .fn()
      .mockReturnValueOnce(startedAt)
      .mockReturnValue(startedAt + 60_000)
    const decide = vi.fn(async () => ({
      type: 'ready_for_verification' as const,
      reason: 'Check current state',
    }))
    const operator = new ComputerTaskOperator({
      sessions,
      broker: { observe: vi.fn(async () => BEFORE), dispatch: vi.fn() },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      now,
    })

    await expect(
      operator.run({ session: SESSION, lease: LEASE, adapter: { decide } }),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'maximum_runtime_reached',
    })
    expect(decide).toHaveBeenCalledTimes(1)
    expect(sessions.fail).toHaveBeenCalledWith(SESSION.id)
  })

  it('persists completed verification evidence before transitioning the session to completed', async () => {
    const sessions = sessionController()
    const verifications = verificationStore()
    const timeline = { record: vi.fn() }
    const operator = new ComputerTaskOperator({
      sessions,
      broker: { observe: vi.fn(async () => AFTER), dispatch: vi.fn() },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications,
      windowInventory: { listWindows: vi.fn(async () => []) },
      createId: () => 'verification-1',
      now: () => Date.parse(SESSION.createdAt),
      timeline,
    })

    await expect(
      operator.run({
        session: SESSION,
        lease: LEASE,
        adapter: {
          decide: vi.fn(async () => ({
            type: 'ready_for_verification' as const,
            reason: 'Saved status is visible',
          })),
        },
      }),
    ).resolves.toMatchObject({ status: 'completed' })
    expect(verifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'verification-1', computerSessionId: SESSION.id }),
    )
    expect(verifications.complete).toHaveBeenCalledWith(
      'verification-1',
      expect.objectContaining({ status: 'passed', evidence: expect.any(Array) }),
    )
    expect(verifications.complete.mock.invocationCallOrder[0]).toBeLessThan(
      sessions.completeVerified.mock.invocationCallOrder[0]!,
    )
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'computer_verification_started',
        verificationId: 'verification-1',
      }),
    )
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'computer_verification_completed',
        verificationId: 'verification-1',
        status: 'passed',
      }),
    )
    expect(sessions.completeVerified).toHaveBeenCalledWith(SESSION.id, ['verification-1'])
  })

  it('completes the turn even when the verification record cannot be persisted', async () => {
    const sessions = sessionController()
    const verifications = {
      create: vi.fn(() => ({ id: 'verification-1', status: 'pending' })),
      complete: vi.fn(() => null),
    }
    const operator = new ComputerTaskOperator({
      sessions,
      broker: { observe: vi.fn(async () => AFTER), dispatch: vi.fn() },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications,
      windowInventory: { listWindows: vi.fn(async () => []) },
      createId: () => 'verification-1',
      now: () => Date.parse(SESSION.createdAt),
    })

    await expect(
      operator.run({
        session: SESSION,
        lease: LEASE,
        adapter: {
          decide: vi.fn(async () => ({
            type: 'ready_for_verification' as const,
            reason: 'Saved status is visible',
          })),
        },
      }),
    ).resolves.toMatchObject({ status: 'completed' })
    expect(verifications.complete).toHaveBeenCalledWith(
      'verification-1',
      expect.objectContaining({ status: 'passed' }),
    )
    // A storage fault on the verification record must not fail the whole turn once the
    // verification outcome itself is valid in-memory.
    expect(sessions.completeVerified).toHaveBeenCalledWith(SESSION.id, ['verification-1'])
    expect(sessions.fail).not.toHaveBeenCalled()
  })

  it('keeps ordinary non-sensitive text entry in the low-friction public tier', async () => {
    const decisions = [
      {
        type: 'action' as const,
        intent: 'Fill the visible field',
        action: { type: 'type_text' as const, text: 'ordinary text' },
      },
      { type: 'ready_for_verification' as const, reason: 'Saved status is visible' },
    ]
    const dispatch = vi.fn(async () => ({ observation: AFTER, noop: false }))
    const operator = new ComputerTaskOperator({
      sessions: sessionController(),
      broker: { observe: vi.fn(async () => BEFORE), dispatch },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      now: () => Date.parse(SESSION.createdAt),
    })

    await operator.run({
      session: SESSION,
      lease: LEASE,
      adapter: { decide: vi.fn(async () => decisions.shift()!) },
    })

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        policyContext: expect.objectContaining({ dataClasses: ['public'] }),
      }),
    )
  })

  it('classifies sensitive composer prefill as credential data before broker dispatch', async () => {
    const decisions = [
      {
        type: 'action' as const,
        intent: 'Prefill the chat draft',
        action: {
          type: 'app_command' as const,
          command: {
            name: 'prefill_composer' as const,
            text: 'secret',
            sensitive: true,
          },
        },
      },
      { type: 'ready_for_verification' as const, reason: 'Draft is visible' },
    ]
    const dispatch = vi.fn(async () => ({ observation: AFTER, noop: false }))
    const operator = new ComputerTaskOperator({
      sessions: sessionController(),
      broker: { observe: vi.fn(async () => BEFORE), dispatch },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      now: () => Date.parse(SESSION.createdAt),
    })

    await operator.run({
      session: SESSION,
      lease: LEASE,
      adapter: { decide: vi.fn(async () => decisions.shift()!) },
    })

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        policyContext: expect.objectContaining({
          effect: 'reversible_local',
          dataClasses: ['credential'],
        }),
      }),
    )
  })

  it('marks non-committing semantic navigation as reversible local activity', async () => {
    const decisions = [
      {
        type: 'action' as const,
        intent: 'Expand the navigation group',
        action: {
          type: 'invoke_element' as const,
          elementId: 'group-1',
          action: 'expand' as const,
        },
      },
      { type: 'ready_for_verification' as const, reason: 'Saved status is visible' },
    ]
    const dispatch = vi.fn(async () => ({ observation: AFTER, noop: false }))
    const operator = new ComputerTaskOperator({
      sessions: sessionController(),
      broker: { observe: vi.fn(async () => BEFORE), dispatch },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      now: () => Date.parse(SESSION.createdAt),
    })

    await operator.run({
      session: SESSION,
      lease: LEASE,
      adapter: { decide: vi.fn(async () => decisions.shift()!) },
    })

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        policyContext: expect.objectContaining({ effect: 'reversible_local' }),
      }),
    )
  })
})

function sessionController() {
  return {
    heartbeatLease: vi.fn(() => LEASE),
    setPhase: vi.fn((_id: string, phase: string) => ({ ...SESSION, status: phase })),
    completeVerified: vi.fn(() => ({ ...SESSION, status: 'completed' })),
    fail: vi.fn(() => ({ ...SESSION, status: 'failed' })),
  }
}

function verificationStore() {
  return {
    create: vi.fn(() => ({ id: 'verification-1', status: 'pending' })),
    complete: vi.fn(() => ({ id: 'verification-1', status: 'passed' })),
  }
}

function observation(
  frameId: string,
  treeVersion: string,
  snapshotId: string,
  text: string,
): ComputerObservation {
  return {
    frameId,
    treeVersion,
    capturedAt: '2026-07-28T08:00:00.000Z',
    display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
    foreground: {
      app: { id: 'app-1', name: 'Editor' },
      window: {
        id: 'window-1',
        title: 'Document',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      },
    },
    screenshot: { snapshotId, width: 800, height: 600 },
    tree: { mode: 'full', text, elementCount: 1 },
    elements: [
      {
        id: 'status-1',
        treeVersion,
        role: 'status',
        name: text,
        value: text,
        bounds: { x: 10, y: 10, width: 100, height: 30 },
        enabled: true,
        focused: false,
        actions: [],
      },
    ],
    loading: false,
    sensitiveRegions: [],
  }
}
