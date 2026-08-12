import { describe, expect, it, vi } from 'vitest'
import { OutcomeRoomBackend } from './outcomeRoomBackend.js'

const sessionId = '11111111-1111-4111-8111-111111111111'

function createHarness() {
  const records = [
    {
      id: 'old',
      roomId: `team-room:${sessionId}`,
      discussionId: 'discussion-1',
      logicalKey: 'goal',
      value: 'draft',
      status: 'superseded',
      authority: 'agent-inferred',
      confidence: 0.5,
      sourceRefs: [],
      version: 1,
      createdBy: 'member',
      createdAt: '2026-08-12T12:00:00.000Z',
      updatedBy: 'member',
      updatedAt: '2026-08-12T12:00:00.000Z',
      expiresAt: null,
      supersedes: null,
      reason: null,
    },
    {
      id: 'current',
      roomId: `team-room:${sessionId}`,
      discussionId: 'discussion-1',
      logicalKey: 'goal',
      value: 'ready',
      status: 'active',
      authority: 'user-confirmed',
      confidence: 1,
      sourceRefs: ['test:focused'],
      version: 2,
      createdBy: 'user',
      createdAt: '2026-08-12T12:01:00.000Z',
      updatedBy: 'user',
      updatedAt: '2026-08-12T12:01:00.000Z',
      expiresAt: null,
      supersedes: 'old',
      reason: 'verified',
    },
  ] as const
  const sessionRepository = {
    get: vi.fn(() => ({ id: sessionId })),
    getMetadata: vi.fn(() => ({ team: { enabled: true } })),
  }
  const discussionRepository = {
    findActiveBySession: vi.fn(() => null),
    listBySession: vi.fn(() => [
      {
        id: 'discussion-1',
        session_id: sessionId,
        host_agent_id: 'host',
        topic: 'Outcome Room',
        round_index: 3,
        max_rounds: 6,
        state: 'concluded',
        started_at: '2026-08-12T12:00:00.000Z',
        ended_at: '2026-08-12T12:04:00.000Z',
      },
    ]),
  }
  const ledger = {
    getCurrentProjection: vi.fn((_roomId: string, discussionId: string, limit: number) => records.filter((record) => record.status !== 'superseded' && record.discussionId === discussionId).slice(0, limit)),
    confirm: vi.fn(() => records[1]),
    reject: vi.fn(),
    correct: vi.fn(),
    invalidate: vi.fn(),
    restore: vi.fn(),
  }
  const backend = new OutcomeRoomBackend({
    sessionRepository: sessionRepository as never,
    discussionRepository: discussionRepository as never,
    ledger: ledger as never,
    now: () => new Date('2026-08-12T12:05:00.000Z'),
    createOpId: () => 'ui-op-1',
  })
  return { backend, sessionRepository, discussionRepository, ledger }
}

describe('OutcomeRoomBackend', () => {
  it('derives room and latest discussion from the trusted session scope', async () => {
    const { backend, ledger } = createHarness()
    const snapshot = await backend.getSnapshot(sessionId)

    expect(ledger.getCurrentProjection).toHaveBeenCalledWith(`team-room:${sessionId}`, 'discussion-1', 100)
    expect(snapshot.discussion?.id).toBe('discussion-1')
    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.records[0]).toMatchObject({ id: 'current', version: 2 })
  })

  it('does not project records owned by an older discussion in the same session room', async () => {
    const { backend, ledger } = createHarness()
    const current = ledger.getCurrentProjection('', 'discussion-1', 100)[0]!
    ledger.getCurrentProjection.mockReturnValue([
      {
        ...current,
        id: 'old-discussion-record',
        discussionId: 'discussion-previous',
      },
    ])

    const snapshot = await backend.getSnapshot(sessionId)
    expect(snapshot.records).toEqual([])
  })

  it('rejects non-team sessions before reading the ledger', async () => {
    const { backend, sessionRepository, ledger } = createHarness()
    sessionRepository.getMetadata.mockReturnValue({ team: { enabled: false } })

    await expect(backend.getSnapshot(sessionId)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(ledger.getCurrentProjection).not.toHaveBeenCalled()
  })

  it('binds user mutations to the resolved discussion and current version', async () => {
    const { backend, ledger } = createHarness()
    await backend.mutate({
      sessionId,
      expectedDiscussionId: 'discussion-1',
      expectedRecordId: 'current',
      action: 'confirm',
      logicalKey: 'goal',
      expectedVersion: 2,
    })

    expect(ledger.confirm).toHaveBeenCalledWith({
      roomId: `team-room:${sessionId}`,
      discussionId: 'discussion-1',
      expectedSessionId: sessionId,
      expectedDiscussionId: 'discussion-1',
      expectedRecordId: 'current',
      logicalKey: 'goal',
      expectedVersion: 2,
      opId: 'ui-op-1',
      authority: 'user-confirmed',
    })
  })

  it('clears expiry when restoring from the Outcome Room boundary', async () => {
    const { backend, ledger } = createHarness()
    ledger.restore.mockReturnValue({
      ...ledger.getCurrentProjection('', 'discussion-1', 100)[0]!,
      id: 'restored',
      status: 'active',
      expiresAt: null,
    })

    await backend.mutate({
      sessionId,
      expectedDiscussionId: 'discussion-1',
      expectedRecordId: 'expired-record',
      action: 'restore',
      logicalKey: 'temporary',
      expectedVersion: 3,
    })

    expect(ledger.restore).toHaveBeenCalledWith(expect.objectContaining({
      discussionId: 'discussion-1',
      logicalKey: 'temporary',
      expiresAt: null,
    }))
  })

  it('rejects a stale card when the active discussion changed before mutation', async () => {
    const { backend, discussionRepository, ledger } = createHarness()
    discussionRepository.findActiveBySession.mockReturnValue({
      ...discussionRepository.listBySession()[0],
      id: 'discussion-2',
      state: 'active',
      ended_at: null,
    })

    await expect(backend.mutate({
      sessionId,
      expectedDiscussionId: 'discussion-1',
      expectedRecordId: 'current',
      action: 'confirm',
      logicalKey: 'goal',
      expectedVersion: 2,
    })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(ledger.confirm).not.toHaveBeenCalled()
  })
})
