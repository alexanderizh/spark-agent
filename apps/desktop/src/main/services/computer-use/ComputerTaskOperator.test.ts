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
        actuatorLeaseId: 'lease-1',
        policyContext: expect.objectContaining({ target: { kind: 'element', id: 'save-button' } }),
      }),
    )
    expect(sessions.completeVerified).toHaveBeenCalledWith('computer-1')
  })

  it('waits for the exact approval id and replays the unchanged governed envelope', async () => {
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
    const ticket = {
      id: 'approval-1',
      computerSessionId: SESSION.id,
      actionId: 'action-1',
      riskLevel: 'L2' as const,
      actionDigest: 'a'.repeat(64),
      targetDigest: 'b'.repeat(64),
      dataClassDigest: null,
      approvedBy: 'local_user' as const,
      approverId: 'renderer:1',
      approvedAt: '2026-07-28T08:00:00.000Z',
      expiresAt: '2026-07-28T08:01:00.000Z',
      nonce: 'approval-nonce-1234',
      usedAt: null,
    }
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(
        new ComputerUseBrokerError('approval_required', 'Approval required', {
          approvalId: ticket.id,
          riskLevel: 'L2',
        }),
      )
      .mockResolvedValueOnce({ observation: AFTER, noop: false })
    const takeApprovedTicket = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(ticket)
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
        lease: LEASE,
        adapter: { decide: vi.fn(async () => decisions.shift()!) },
      }),
    ).resolves.toMatchObject({ status: 'completed' })
    expect(takeApprovedTicket).toHaveBeenNthCalledWith(1, ticket.id)
    expect(takeApprovedTicket).toHaveBeenNthCalledWith(2, ticket.id)
    expect(dispatch.mock.calls[1]?.[0]).toBe(dispatch.mock.calls[0]?.[0])
    expect(dispatch.mock.calls[1]?.[1]).toBe(ticket)
    expect(sessions.heartbeatLease).toHaveBeenCalled()
  })

  it('presents an exact action approval and dispatches only the returned one-time ticket', async () => {
    const decisions = [
      {
        type: 'action' as const,
        intent: 'Send the prepared message',
        action: {
          type: 'invoke_element' as const,
          elementId: 'send-button',
          action: 'invoke' as const,
        },
      },
      { type: 'ready_for_verification' as const, reason: 'Sent status is visible' },
    ]
    const ticket = {
      id: 'approval-2',
      computerSessionId: SESSION.id,
      actionId: 'action-1',
      riskLevel: 'L2' as const,
      actionDigest: 'c'.repeat(64),
      targetDigest: 'd'.repeat(64),
      dataClassDigest: null,
      approvedBy: 'local_user' as const,
      approverId: 'renderer:1',
      approvedAt: '2026-07-28T08:00:00.000Z',
      expiresAt: '2026-07-28T08:01:00.000Z',
      nonce: 'approval-nonce-5678',
      usedAt: null,
    }
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(
        new ComputerUseBrokerError('approval_required', 'Approval required', {
          approvalId: ticket.id,
          riskLevel: 'L2',
        }),
      )
      .mockResolvedValueOnce({ observation: AFTER, noop: false })
    const requestApproval = vi.fn(async () => ticket)
    const operator = new ComputerTaskOperator({
      sessions: sessionController(),
      broker: { observe: vi.fn(async () => BEFORE), dispatch },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      requestApproval,
      createId: () => 'action-1',
      now: () => Date.parse(SESSION.createdAt),
    })

    await expect(
      operator.run({
        session: SESSION,
        lease: LEASE,
        permissionMode: 'codex-full-access',
        adapter: { decide: vi.fn(async () => decisions.shift()!) },
      }),
    ).resolves.toMatchObject({ status: 'completed' })
    expect(requestApproval).toHaveBeenCalledWith({
      session: SESSION,
      envelope: dispatch.mock.calls[0]?.[0],
      approvalId: ticket.id,
      riskLevel: 'L2',
      permissionMode: 'codex-full-access',
    })
    expect(dispatch.mock.calls[1]?.[0]).toBe(dispatch.mock.calls[0]?.[0])
    expect(dispatch.mock.calls[1]?.[1]).toBe(ticket)
  })

  it('enters handoff without dispatching an action when the decision model requests takeover', async () => {
    const sessions = sessionController()
    const dispatch = vi.fn()
    const operator = new ComputerTaskOperator({
      sessions,
      broker: { observe: vi.fn(async () => BEFORE), dispatch },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
      now: () => Date.parse(SESSION.createdAt),
    })

    await expect(
      operator.run({
        session: SESSION,
        lease: LEASE,
        adapter: {
          decide: vi.fn(async () => ({ type: 'handoff' as const, reason: 'User must confirm' })),
        },
      }),
    ).resolves.toEqual({ status: 'handoff_required', reason: 'User must confirm' })
    expect(sessions.setPhase).toHaveBeenCalledWith(SESSION.id, 'handoff_required')
    expect(dispatch).not.toHaveBeenCalled()
    expect(sessions.completeVerified).not.toHaveBeenCalled()
  })

  it('fails closed when the decision provider throws', async () => {
    const sessions = sessionController()
    const operator = new ComputerTaskOperator({
      sessions,
      broker: { observe: vi.fn(async () => BEFORE), dispatch: vi.fn() },
      approvals: { takeApprovedTicket: vi.fn(() => null) },
      evidence: { readLatestImage: vi.fn(async () => Buffer.from('png')) },
      verifications: verificationStore(),
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
    expect(sessions.fail).toHaveBeenCalledWith(SESSION.id)
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
  })

  it('classifies unlabeled text entry as personal data instead of trusting the model to mark it sensitive', async () => {
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
        policyContext: expect.objectContaining({ dataClasses: ['personal'] }),
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
