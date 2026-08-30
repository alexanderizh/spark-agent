import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from './database.js'
import { SessionRepository } from './repositories/session.repository.js'
import { TeamHandoffConflictError, TeamHandoffService } from './team-handoff.service.js'

describe('TeamHandoffService', () => {
  let db: SparkDatabase
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `spark-team-handoff-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function agent(discussionId = 'discussion-a') {
    return TeamHandoffService.forAgent(db, {
      sessionId: 'session-a',
      roomId: 'team-room:session-a',
      discussionId,
      actorId: 'agent-a',
    })
  }

  it('persists a typed handoff with task links, acceptance data, and audit evidence', () => {
    const service = agent()
    const created = service.create({
      id: 'handoff-1',
      taskId: 'task-1',
      dispatchId: 'dispatch-1',
      recipientId: 'agent-b',
      purpose: 'Implement parser',
      inputs: { source: 'spec.md' },
      attachments: ['file-1'],
      expectedOutput: 'A tested parser',
      acceptanceCriteria: ['tests pass'],
      deadline: '2026-08-14T12:00:00.000Z',
      sensitivity: 'confidential',
      opId: 'op-create',
    })
    expect(created).toMatchObject({
      id: 'handoff-1',
      sessionId: 'session-a',
      roomId: 'team-room:session-a',
      discussionId: 'discussion-a',
      senderId: 'agent-a',
      recipientId: 'agent-b',
      status: 'draft',
      version: 1,
    })

    const submitted = service.submit({ id: created.id, expectedVersion: 1, opId: 'op-submit' })
    const accepted = TeamHandoffService.forAgent(db, {
      sessionId: 'session-a',
      roomId: 'team-room:session-a',
      discussionId: 'discussion-a',
      actorId: 'agent-b',
    }).accept({ id: created.id, expectedVersion: 2, opId: 'op-accept' })
    const completed = service.complete({
      id: created.id,
      expectedVersion: 3,
      artifactRefs: ['artifact-1'],
      evidenceRefs: ['evidence-1'],
      opId: 'op-complete',
    })

    expect([submitted.status, accepted.status, completed.status]).toEqual([
      'submitted',
      'accepted',
      'completed',
    ])
    expect(completed).toMatchObject({
      version: 4,
      artifactRefs: ['artifact-1'],
      evidenceRefs: ['evidence-1'],
    })
    expect(service.listEvents(created.id, 20, 0).items.map((event) => event.operation)).toEqual([
      'create',
      'submit',
      'accept',
      'complete',
    ])
  })

  it('enforces legal transitions, optimistic CAS, and opId idempotency', () => {
    const service = agent()
    const created = service.create({
      id: 'handoff-1',
      recipientId: 'agent-b',
      purpose: 'Review',
      inputs: null,
      expectedOutput: 'Notes',
      acceptanceCriteria: [],
      sensitivity: 'internal',
      opId: 'op-create',
    })
    expect(() =>
      service.create({
        id: 'different-id',
        recipientId: 'agent-x',
        purpose: 'Ignored',
        inputs: null,
        expectedOutput: 'Ignored',
        acceptanceCriteria: [],
        sensitivity: 'public',
        opId: 'op-create',
      }),
    ).toThrow(/opId|payload|target/i)
    expect(() =>
      service.complete({ id: created.id, expectedVersion: 1, opId: 'op-illegal' }),
    ).toThrow(TeamHandoffConflictError)
    expect(() => service.submit({ id: created.id, expectedVersion: 9, opId: 'op-stale' })).toThrow(
      /version/i,
    )

    const otherDiscussion = agent('discussion-b')
    expect(() =>
      otherDiscussion.create({
        id: 'handoff-cross-scope',
        recipientId: 'agent-x',
        purpose: 'Must not leak',
        inputs: null,
        expectedOutput: 'None',
        acceptanceCriteria: [],
        sensitivity: 'internal',
        opId: 'op-create',
      }),
    ).toThrow(/scope|opId/i)
  })

  it('rejects opId reuse for a different transition target or payload', () => {
    const service = agent()
    const created = service.create({
      id: 'handoff-1',
      recipientId: 'agent-b',
      purpose: 'Review',
      inputs: { source: 'a' },
      expectedOutput: 'Notes',
      acceptanceCriteria: [],
      sensitivity: 'internal',
      opId: 'op-create',
    })
    service.create({
      id: 'handoff-2',
      recipientId: 'agent-b',
      purpose: 'Other',
      inputs: null,
      expectedOutput: 'Other notes',
      acceptanceCriteria: [],
      sensitivity: 'internal',
      opId: 'op-create-2',
    })
    service.submit({ id: created.id, expectedVersion: 1, opId: 'op-submit' })
    expect(() =>
      service.submit({ id: 'handoff-2', expectedVersion: 1, opId: 'op-submit' }),
    ).toThrow(/target|opId/i)
    expect(() =>
      service.submit({
        id: created.id,
        expectedVersion: 1,
        artifactRefs: ['different'],
        opId: 'op-submit',
      }),
    ).toThrow(/payload|opId|conflict/i)
  })

  it('treats omitted refs as inherited for idempotent retries, while explicit empty refs clear them', () => {
    const service = agent()
    const created = service.create({
      id: 'handoff-refs',
      recipientId: 'agent-b',
      purpose: 'Review refs',
      inputs: null,
      expectedOutput: 'Notes',
      acceptanceCriteria: [],
      sensitivity: 'internal',
      opId: 'op-create-refs',
    })

    const firstSubmit = service.submit({
      id: created.id,
      expectedVersion: 1,
      artifactRefs: ['artifact-1'],
      evidenceRefs: ['evidence-1'],
      opId: 'op-submit-refs',
    })
    expect(firstSubmit).toMatchObject({
      artifactRefs: ['artifact-1'],
      evidenceRefs: ['evidence-1'],
    })

    expect(
      service.submit({
        id: created.id,
        expectedVersion: 1,
        opId: 'op-submit-refs',
      }),
    ).toEqual(firstSubmit)

    const accepted = TeamHandoffService.forAgent(db, {
      sessionId: 'session-a',
      roomId: 'team-room:session-a',
      discussionId: 'discussion-a',
      actorId: 'agent-b',
    }).accept({ id: created.id, expectedVersion: 2, opId: 'op-accept-refs' })
    expect(accepted).toMatchObject({ artifactRefs: ['artifact-1'], evidenceRefs: ['evidence-1'] })

    expect(() =>
      service.accept({
        id: created.id,
        expectedVersion: 2,
        artifactRefs: [],
        evidenceRefs: [],
        opId: 'op-accept-refs',
      }),
    ).toThrow(/payload|opId|conflict/i)

    const cleared = service.complete({
      id: created.id,
      expectedVersion: 3,
      artifactRefs: [],
      evidenceRefs: [],
      opId: 'op-complete-refs',
    })
    expect(cleared).toMatchObject({ artifactRefs: [], evidenceRefs: [] })
  })

  it('keeps omitted and explicit empty refs distinct in both idempotency directions', () => {
    const service = agent()
    const first = service.create({
      id: 'handoff-presence-a',
      recipientId: 'agent-b',
      purpose: 'Presence A',
      inputs: null,
      expectedOutput: 'Notes',
      acceptanceCriteria: [],
      sensitivity: 'internal',
      opId: 'op-presence-a-create',
    })
    service.submit({
      id: first.id,
      expectedVersion: 1,
      artifactRefs: ['artifact-1'],
      evidenceRefs: ['evidence-1'],
      opId: 'op-presence-a-submit',
    })
    const recipient = TeamHandoffService.forAgent(db, {
      sessionId: 'session-a',
      roomId: 'team-room:session-a',
      discussionId: 'discussion-a',
      actorId: 'agent-b',
    })
    recipient.accept({
      id: first.id,
      expectedVersion: 2,
      artifactRefs: [],
      evidenceRefs: [],
      opId: 'op-presence-a-accept',
    })
    expect(() =>
      recipient.accept({ id: first.id, expectedVersion: 2, opId: 'op-presence-a-accept' }),
    ).toThrow(/payload|opId|conflict/i)

    const second = service.create({
      id: 'handoff-presence-b',
      recipientId: 'agent-b',
      purpose: 'Presence B',
      inputs: null,
      expectedOutput: 'Notes',
      acceptanceCriteria: [],
      sensitivity: 'internal',
      opId: 'op-presence-b-create',
    })
    service.submit({ id: second.id, expectedVersion: 1, opId: 'op-presence-b-submit' })
    recipient.accept({ id: second.id, expectedVersion: 2, opId: 'op-presence-b-accept' })
    expect(() =>
      recipient.accept({
        id: second.id,
        expectedVersion: 2,
        artifactRefs: [],
        evidenceRefs: [],
        opId: 'op-presence-b-accept',
      }),
    ).toThrow(/payload|opId|conflict/i)
  })

  it('rejects create when the handoff id is already owned by another scope', () => {
    const scopeA = agent('discussion-a')
    const created = scopeA.create({
      id: 'handoff-shared-id',
      recipientId: 'agent-b',
      purpose: 'Scope A handoff',
      inputs: null,
      expectedOutput: 'Scope A result',
      acceptanceCriteria: [],
      sensitivity: 'internal',
      opId: 'op-a-create',
    })
    scopeA.submit({ id: created.id, expectedVersion: 1, opId: 'op-a-submit' })

    const scopeB = TeamHandoffService.forAgent(db, {
      sessionId: 'session-b',
      roomId: 'team-room:session-b',
      discussionId: 'discussion-b',
      actorId: 'agent-b',
    })
    let collision: unknown
    try {
      scopeB.create({
        id: created.id,
        recipientId: 'agent-c',
        purpose: 'Scope B handoff',
        inputs: null,
        expectedOutput: 'Scope B result',
        acceptanceCriteria: [],
        sensitivity: 'internal',
        opId: 'op-b-create',
      })
    } catch (error) {
      collision = error
    }

    expect(collision).toBeInstanceOf(TeamHandoffConflictError)
    expect(scopeA.list(10, 0).items).toMatchObject([
      { id: created.id, status: 'submitted', version: 2 },
    ])
    expect(scopeA.listEvents(created.id, 10, 0).items.map((event) => event.operation)).toEqual([
      'create',
      'submit',
    ])
  })

  it('isolates discussions, paginates in SQL, enforces quota, and cleans a deleted session', () => {
    const sessionRepo = new SessionRepository(db)
    sessionRepo.create({
      id: 'session-a',
      kind: 'chat',
      title: 'A',
      status: 'idle',
      projectId: 'default',
    })
    const d1 = agent('discussion-a')
    const d2 = agent('discussion-b')
    for (let index = 0; index < 100; index += 1) {
      d1.create({
        id: `h-${index}`,
        recipientId: 'agent-b',
        purpose: `P${index}`,
        inputs: null,
        expectedOutput: 'result',
        acceptanceCriteria: [],
        sensitivity: 'internal',
        opId: `op-${index}`,
      })
    }
    expect(() =>
      d1.create({
        id: 'h-over',
        recipientId: 'agent-b',
        purpose: 'overflow',
        inputs: null,
        expectedOutput: 'result',
        acceptanceCriteria: [],
        sensitivity: 'internal',
        opId: 'op-over',
      }),
    ).toThrow(/quota|limit/i)
    const page = d1.list(5, 5)
    expect(page.total).toBe(100)
    expect(page.items).toHaveLength(5)
    expect(page.items[0]?.id).toBe('h-5')
    expect(d2.list(10, 0)).toMatchObject({ total: 0, items: [] })
    expect(
      d2.create({
        id: 'h-other',
        recipientId: 'agent-b',
        purpose: 'other',
        inputs: null,
        expectedOutput: 'result',
        acceptanceCriteria: [],
        sensitivity: 'internal',
        opId: 'op-other',
      }).version,
    ).toBe(1)

    expect(sessionRepo.deleteWithRelatedData('session-a')).toBe(true)
    expect(d1.list(10, 0)).toMatchObject({ total: 0, items: [] })
    expect(d1.listEvents(undefined, 10, 0)).toMatchObject({ total: 0, items: [] })
  })

  it('lets the desktop user govern an agent-targeted handoff without changing its audit actor', () => {
    const sender = agent()
    const created = sender.create({
      id: 'handoff-user-governed',
      recipientId: 'agent-b',
      purpose: 'Review',
      inputs: null,
      expectedOutput: 'Notes',
      acceptanceCriteria: [],
      sensitivity: 'internal',
      opId: 'user-governed-create',
    })
    const user = TeamHandoffService.forUser(db, {
      sessionId: 'session-a',
      roomId: 'team-room:session-a',
      discussionId: 'discussion-a',
      actorId: 'desktop-user',
    })
    user.submit({ id: created.id, expectedVersion: 1, opId: 'user-governed-submit' })
    const accepted = user.accept({
      id: created.id,
      expectedVersion: 2,
      opId: 'user-governed-accept',
    })
    expect(accepted).toMatchObject({ status: 'accepted', recipientId: 'agent-b' })
    expect(user.listEvents(created.id, 10, 0).items.map((event) => event.actorId)).toEqual([
      'agent-a',
      'desktop-user',
      'desktop-user',
    ])
  })

  it('cleans handoffs and audit events by session without requiring session deletion', () => {
    const created = agent().create({
      id: 'handoff-clear-session',
      recipientId: 'agent-b',
      purpose: 'Clear',
      inputs: null,
      expectedOutput: 'Result',
      acceptanceCriteria: [],
      sensitivity: 'internal',
      opId: 'clear-create',
    })
    expect(TeamHandoffService.deleteBySession(db, 'session-a')).toBeGreaterThan(0)
    expect(agent().list(10, 0).items).toEqual([])
    expect(agent().listEvents(created.id, 10, 0).items).toEqual([])
  })
})
