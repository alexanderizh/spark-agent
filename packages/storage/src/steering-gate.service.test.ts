import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from './database.js'
import { SessionRepository } from './repositories/session.repository.js'
import { SteeringGateConflictError, SteeringGateService } from './steering-gate.service.js'

describe('SteeringGateService', () => {
  let db: SparkDatabase
  let dir: string
  const scope = { sessionId: 'session-a', roomId: 'team-room:session-a', discussionId: 'discussion-a', actorId: 'agent-a' }

  beforeEach(() => {
    dir = join(tmpdir(), `spark-steering-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('records a high-impact gate and allows only user capability to approve it', () => {
    const agent = SteeringGateService.forAgent(db, scope)
    const gate = agent.create({
      id: 'gate-1', targetType: 'task', targetId: 'task-1', trigger: 'budget_threshold',
      reason: 'Projected spend exceeds threshold', impact: 'high',
      budgetSnapshot: { spent: 90, limit: 100 }, recommendedAction: 'reduce scope', opId: 'op-create',
    })
    expect(gate).toMatchObject({
      status: 'waiting', version: 1, capability: 'agent', discussionId: 'discussion-a',
    })

    expect(() => agent.approve({ id: gate.id, expectedVersion: 1, opId: 'op-agent-approve' })).toThrow(/user/i)
    const system = SteeringGateService.forSystem(db, { ...scope, actorId: 'system' })
    expect(() => system.approve({
      id: gate.id, expectedVersion: 1, opId: 'op-forged', capability: 'user',
    } as Parameters<typeof system.approve>[0])).toThrow(/user/i)

    const user = SteeringGateService.forUser(db, { ...scope, actorId: 'user-1' })
    const approved = user.approve({ id: gate.id, expectedVersion: 1, opId: 'op-approve' })
    expect(approved).toMatchObject({ status: 'approved', version: 2, capability: 'user' })
    expect(user.listEvents(gate.id, 10, 0).items).toMatchObject([
      { operation: 'create', highImpact: true, capability: 'agent' },
      { operation: 'approve', highImpact: true, capability: 'user' },
    ])
  })

  it('enforces state transitions, CAS, expiry, and opId idempotency', () => {
    const agent = SteeringGateService.forAgent(db, scope)
    const gate = agent.create({
      id: 'gate-1', targetType: 'artifact', targetId: 'artifact-1', trigger: 'review', reason: 'Needs sign-off',
      impact: 'medium', budgetSnapshot: null, recommendedAction: 'review evidence', opId: 'op-create',
    })
    expect(() => agent.create({
      id: 'gate-other', targetType: 'task', targetId: 'ignored', trigger: 'ignored', reason: 'ignored',
      impact: 'low', budgetSnapshot: null, recommendedAction: 'ignored', opId: 'op-create',
    })).toThrow(/opId|payload|target/i)
    const user = SteeringGateService.forUser(db, { ...scope, actorId: 'user-1' })
    expect(() => user.stop({ id: gate.id, expectedVersion: 9, opId: 'op-stale' })).toThrow(/version/i)
    const revised = user.revise({ id: gate.id, expectedVersion: 1, reason: 'Narrow scope', opId: 'op-revise' })
    expect(revised).toMatchObject({ status: 'revise', reason: 'Narrow scope', version: 2 })
    expect(() => user.approve({ id: gate.id, expectedVersion: 2, opId: 'op-illegal' })).toThrow(SteeringGateConflictError)

    const expiring = agent.create({
      id: 'gate-expire', targetType: 'handoff', targetId: 'handoff-1', trigger: 'deadline', reason: 'Timed out',
      impact: 'low', budgetSnapshot: null, recommendedAction: 'cancel', opId: 'op-expiring',
    })
    expect(SteeringGateService.forSystem(db, { ...scope, actorId: 'system' }).expire({
      id: expiring.id, expectedVersion: 1, opId: 'op-expire',
    }).status).toBe('expired')

    const otherDiscussion = SteeringGateService.forAgent(db, { ...scope, discussionId: 'discussion-b' })
    expect(() => otherDiscussion.create({
      id: 'gate-cross-scope', targetType: 'task', targetId: 'task-other', trigger: 'review', reason: 'Must not leak',
      impact: 'low', budgetSnapshot: null, recommendedAction: 'stop', opId: 'op-create',
    })).toThrow(/scope|opId/i)
  })

  it('rejects opId reuse for a different target, operation, or payload', () => {
    const agent = SteeringGateService.forAgent(db, scope)
    const gate = agent.create({
      id: 'gate-1', targetType: 'artifact', targetId: 'artifact-1', trigger: 'review', reason: 'Needs sign-off',
      impact: 'medium', budgetSnapshot: { spent: 1 }, recommendedAction: 'review evidence', opId: 'op-create',
    })
    expect(() => agent.create({
      id: 'gate-2', targetType: 'task', targetId: 'task-2', trigger: 'other', reason: 'other',
      impact: 'low', budgetSnapshot: null, recommendedAction: 'stop', opId: 'op-create',
    })).toThrow(/opId|payload|target/i)
    const user = SteeringGateService.forUser(db, { ...scope, actorId: 'user-1' })
    user.revise({ id: gate.id, expectedVersion: 1, reason: 'Narrow scope', opId: 'op-revise' })
    expect(() => user.revise({ id: gate.id, expectedVersion: 1, reason: 'Different scope', opId: 'op-revise' })).toThrow(/opId|payload|conflict/i)
  })

  it('rejects create when the gate id is already owned by another scope', () => {
    const scopeAAgent = SteeringGateService.forAgent(db, scope)
    const created = scopeAAgent.create({
      id: 'gate-shared-id', targetType: 'task', targetId: 'task-a', trigger: 'review', reason: 'Scope A review',
      impact: 'high', budgetSnapshot: null, recommendedAction: 'approve', opId: 'op-a-create',
    })
    SteeringGateService.forUser(db, { ...scope, actorId: 'user-a' }).approve({
      id: created.id, expectedVersion: 1, opId: 'op-a-approve',
    })

    const scopeBAgent = SteeringGateService.forAgent(db, {
      sessionId: 'session-b', roomId: 'team-room:session-b', discussionId: 'discussion-b', actorId: 'agent-b',
    })
    let collision: unknown
    try {
      scopeBAgent.create({
        id: created.id, targetType: 'task', targetId: 'task-b', trigger: 'review', reason: 'Scope B review',
        impact: 'low', budgetSnapshot: null, recommendedAction: 'continue', opId: 'op-b-create',
      })
    } catch (error) {
      collision = error
    }

    expect(collision).toBeInstanceOf(SteeringGateConflictError)
    expect(scopeAAgent.list(10, 0).items).toMatchObject([{
      id: created.id, status: 'approved', capability: 'user', version: 2,
    }])
    expect(scopeAAgent.listEvents(created.id, 10, 0).items.map((event) => event.operation)).toEqual(['create', 'approve'])
  })

  it('isolates discussion pages, enforces quota, and cleans session current plus audit rows', () => {
    const sessionRepo = new SessionRepository(db)
    sessionRepo.create({ id: 'session-a', kind: 'chat', title: 'A', status: 'idle', projectId: 'default' })
    const d1 = SteeringGateService.forAgent(db, scope)
    const d2 = SteeringGateService.forAgent(db, { ...scope, discussionId: 'discussion-b' })
    for (let index = 0; index < 100; index += 1) {
      d1.create({
        id: `gate-${index}`, targetType: 'task', targetId: `task-${index}`, trigger: 'review', reason: `R${index}`,
        impact: 'low', budgetSnapshot: null, recommendedAction: 'continue', opId: `op-${index}`,
      })
    }
    expect(() => d1.create({
      id: 'gate-over', targetType: 'task', targetId: 'over', trigger: 'review', reason: 'overflow',
      impact: 'low', budgetSnapshot: null, recommendedAction: 'continue', opId: 'op-over',
    })).toThrow(/quota|limit/i)
    expect(d1.list(4, 4)).toMatchObject({ total: 100 })
    expect(d1.list(4, 4).items.map((item) => item.id)).toEqual(['gate-4', 'gate-5', 'gate-6', 'gate-7'])
    expect(d2.list(10, 0)).toMatchObject({ total: 0, items: [] })
    expect(d2.create({
      id: 'gate-other', targetType: 'task', targetId: 'other', trigger: 'review', reason: 'other',
      impact: 'low', budgetSnapshot: null, recommendedAction: 'continue', opId: 'op-other',
    }).version).toBe(1)

    expect(sessionRepo.deleteWithRelatedData('session-a')).toBe(true)
    expect(d1.list(10, 0)).toMatchObject({ total: 0, items: [] })
    expect(d1.listEvents(undefined, 10, 0)).toMatchObject({ total: 0, items: [] })
  })
})
