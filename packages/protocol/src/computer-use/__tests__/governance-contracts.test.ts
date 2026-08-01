import { describe, expect, it } from 'vitest'
import * as protocol from '../../index.js'

interface RuntimeSchema {
  safeParse(value: unknown): { success: boolean }
  parse(value: unknown): unknown
}

function exportedSchema(name: string): RuntimeSchema {
  const candidate = (protocol as Record<string, unknown>)[name]
  expect(candidate, `${name} must be exported by @spark/protocol`).toBeDefined()
  return candidate as RuntimeSchema
}

const taskContract = {
  objective: 'Save the open document into the approved workspace',
  successCriteria: [
    {
      kind: 'file',
      pathPolicyRef: 'workspace-output',
      assertion: { operator: 'exists', expected: true },
    },
  ],
  allowedApps: [{ kind: 'app_id', value: 'com.apple.TextEdit' }],
  allowedDomains: ['docs.example.com', '*.assets.example.com'],
  allowedDataClasses: ['internal'],
  forbiddenActions: ['keypress'],
  maxSteps: 80,
  maxRuntimeMs: 900_000,
  maxConsecutiveNoops: 3,
  userPresence: 'required',
} as const

describe('computer task and session governance', () => {
  it('accepts an explicit task contract and rejects URL-shaped domain grants', () => {
    const schema = exportedSchema('ComputerTaskContractSchema')

    expect(schema.parse(taskContract)).toEqual(taskContract)
    expect(
      schema.safeParse({ ...taskContract, allowedDomains: ['https://docs.example.com/private'] })
        .success,
    ).toBe(false)
    expect(schema.safeParse({ ...taskContract, allowedApps: [] }).success).toBe(true)
  })

  it('requires a task contract for every computer session', () => {
    const schema = exportedSchema('ComputerSessionSchema')
    const session = {
      id: 'computer-session-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      workflowRunId: null,
      environment: 'my_desktop',
      status: 'preflighting',
      providerProfileId: 'provider-1',
      modelId: 'gpt-computer',
      taskContract,
      actuatorLeaseId: null,
      createdAt: '2026-07-28T02:30:00.000Z',
      updatedAt: '2026-07-28T02:30:00.000Z',
    }

    expect(schema.parse(session)).toEqual(session)
    const { taskContract: _contract, ...withoutContract } = session
    expect(schema.safeParse(withoutContract).success).toBe(false)
  })
})

describe('computer approval governance', () => {
  const approval = {
    id: 'approval-1',
    computerSessionId: 'computer-session-1',
    actionId: 'action-7',
    riskLevel: 'L2',
    actionDigest: 'a'.repeat(64),
    targetDigest: 'b'.repeat(64),
    dataClassDigest: null,
    approvedBy: 'remote_device',
    approverId: 'device-1',
    approvedAt: '2026-07-28T02:30:00.000Z',
    expiresAt: '2026-07-28T02:31:00.000Z',
    nonce: 'single-use-nonce-01JZ',
    usedAt: null,
  } as const

  it('allows a remote device to approve L2 once but never L3', () => {
    const schema = exportedSchema('ComputerApprovalTicketSchema')

    expect(schema.parse(approval)).toEqual(approval)
    expect(schema.safeParse({ ...approval, riskLevel: 'L3' }).success).toBe(false)
    expect(schema.safeParse({ ...approval, actionDigest: 'A'.repeat(64) }).success).toBe(false)
  })

  it('rejects expired-at-creation and already-used tickets', () => {
    const schema = exportedSchema('ComputerApprovalTicketSchema')

    expect(
      schema.safeParse({
        ...approval,
        expiresAt: '2026-07-28T02:29:59.000Z',
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        ...approval,
        usedAt: '2026-07-28T02:29:59.000Z',
      }).success,
    ).toBe(false)
  })

  it('never permits an L4 action and requires a concrete reason for policy decisions', () => {
    const schema = exportedSchema('ComputerPolicyDecisionSchema')
    const handoff = {
      actionId: 'action-8',
      riskLevel: 'L4',
      decision: 'require_handoff',
      reasonCode: 'handoff_required',
      requiresUserPresence: true,
    }

    expect(schema.parse(handoff)).toEqual(handoff)
    expect(schema.safeParse({ ...handoff, decision: 'allow' }).success).toBe(false)
    expect(schema.safeParse({ ...handoff, requiresUserPresence: false }).success).toBe(false)
    expect(schema.safeParse({ ...handoff, reasonCode: 'make_it_work' }).success).toBe(false)
    expect(
      schema.safeParse({
        ...handoff,
        riskLevel: 'L1',
        decision: 'deny',
        reasonCode: 'within_task_scope',
        requiresUserPresence: false,
      }).success,
    ).toBe(false)
  })

  it('uses stable non-error reason codes for allowed actions', () => {
    const schema = exportedSchema('ComputerPolicyDecisionSchema')

    expect(
      schema.safeParse({
        actionId: 'action-read-1',
        riskLevel: 'L0',
        decision: 'allow',
        reasonCode: 'read_only_action',
        requiresUserPresence: false,
      }).success,
    ).toBe(true)
  })

  it('represents a single active actuator lease with ordered timestamps', () => {
    const schema = exportedSchema('ComputerActuatorLeaseSchema')
    const lease = {
      id: 'lease-1',
      environmentKey: 'my-desktop:local',
      computerSessionId: 'computer-session-1',
      operatorId: 'operator-1',
      acquiredAt: '2026-07-28T02:30:00.000Z',
      heartbeatAt: '2026-07-28T02:30:05.000Z',
      expiresAt: '2026-07-28T02:30:20.000Z',
      releasedAt: null,
    }

    expect(schema.parse(lease)).toEqual(lease)
    expect(schema.safeParse({ ...lease, expiresAt: '2026-07-28T02:29:59.000Z' }).success).toBe(
      false,
    )
  })
})

describe('computer events and stable errors', () => {
  it('requires verification IDs before a session can emit completed', () => {
    const schema = exportedSchema('ComputerUseEventSchema')
    const event = {
      id: 'event-1',
      type: 'computer_session_completed',
      sessionId: 'session-1',
      turnId: 'turn-1',
      computerSessionId: 'computer-session-1',
      timestamp: '2026-07-28T02:40:00.000Z',
      seq: 19,
      verificationIds: ['verification-1'],
    }

    expect(schema.parse(event)).toEqual(event)
    expect(schema.safeParse({ ...event, verificationIds: [] }).success).toBe(false)
  })

  it('fails closed on unknown error codes and unknown event types', () => {
    const errorSchema = exportedSchema('ComputerUseErrorCodeSchema')
    const eventSchema = exportedSchema('ComputerUseEventSchema')

    expect(errorSchema.safeParse('stale_frame').success).toBe(true)
    expect(errorSchema.safeParse('action_not_allowed').success).toBe(true)
    expect(errorSchema.safeParse('session_paused').success).toBe(true)
    expect(errorSchema.safeParse('just_keep_clicking').success).toBe(false)
    expect(
      eventSchema.safeParse({
        id: 'event-2',
        type: 'computer_magic_happened',
        sessionId: 'session-1',
        turnId: 'turn-1',
        computerSessionId: 'computer-session-1',
        timestamp: '2026-07-28T02:40:00.000Z',
        seq: 20,
      }).success,
    ).toBe(false)
  })

  it('allows a draft app snapshot event before a turn or computer session exists', () => {
    const schema = exportedSchema('ApplicationSnapshotEventSchema')
    const event = {
      id: 'snapshot-event-1',
      type: 'app_snapshot_created',
      snapshotId: 'snapshot-1',
      kind: 'user_context',
      sessionId: null,
      turnId: null,
      computerSessionId: null,
      timestamp: '2026-07-28T02:40:00.000Z',
    }

    expect(schema.parse(event)).toEqual(event)
  })
})
