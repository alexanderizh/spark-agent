import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from './database.js'
import { DeliberationConflictError, DeliberationService } from './deliberation.service.js'

describe('DeliberationService', () => {
  let db: SparkDatabase
  let dir: string
  const scope = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    roomId: 'team-room:11111111-1111-4111-8111-111111111111',
    discussionId: 'discussion-1',
    actorId: 'agent-1',
  }

  beforeEach(() => {
    dir = join(tmpdir(), `spark-deliberation-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('stores the proposal chain with CAS, audit history, and idempotent operations', () => {
    const service = DeliberationService.forAgent(db, scope)
    const created = service.create({
      id: 'proposal-1', topic: 'Ship runtime',
      proposal: { claim: 'Ship now', position: 'support', rationale: 'Evidence is ready' }, opId: 'op-create',
    })
    const withEvidence = service.addEvidence({
      id: created.id, expectedVersion: created.version, opId: 'op-evidence',
      evidence: { summary: 'CI is green', sourceRef: 'run-1', polarity: 'supports' },
    })
    expect(service.addEvidence({
      id: created.id, expectedVersion: created.version, opId: 'op-evidence',
      evidence: { summary: 'CI is green', sourceRef: 'run-1', polarity: 'supports' },
    })).toEqual(withEvidence)
    expect(withEvidence.evidence).toHaveLength(1)
    expect(service.listEvents(created.id).items).toHaveLength(2)
    expect(() => service.addRisk({
      id: created.id, expectedVersion: created.version, opId: 'op-stale',
      risk: { title: 'stale', severity: 'low', mitigation: 'retry' },
    })).toThrow(DeliberationConflictError)
  })

  it('detects contradictory proposals and resolves them only with user capability', () => {
    const first = DeliberationService.forAgent(db, scope).create({
      id: 'proposal-a', topic: 'Release',
      proposal: { claim: 'Release today', position: 'support', rationale: 'Ready' }, opId: 'op-a',
    })
    const second = DeliberationService.forAgent(db, { ...scope, actorId: 'agent-2' }).create({
      id: 'proposal-b', topic: 'Release',
      proposal: { claim: 'Delay release', position: 'oppose', rationale: 'Risk remains' }, opId: 'op-b',
    })
    expect(first.status).toBe('proposed')
    expect(second.status).toBe('conflicted')
    expect(DeliberationService.forAgent(db, scope).snapshot().conflicts).toHaveLength(1)
    expect(() => DeliberationService.forAgent(db, scope).resolve({
      id: second.id, conflictingRecordId: first.id, expectedVersion: second.version, reason: 'Need a human ruling', opId: 'op-agent-resolve',
    })).toThrow(/capability|user|system/i)
    const resolved = DeliberationService.forUser(db, { ...scope, actorId: 'user-1' }).resolve({
      id: second.id, conflictingRecordId: first.id, expectedVersion: second.version, reason: 'Risk wins', opId: 'op-resolve',
    })
    expect(resolved.status).toBe('proposed')
    expect(resolved.conflict?.resolvedBy).toBe('user-1')
    expect(DeliberationService.forUser(db, { ...scope, actorId: 'user-1' }).snapshot().records.find((record) => record.id === first.id)?.status).toBe('superseded')
  })

  it('enforces decision capability, ledger JSON limits, and decision conflict detection', () => {
    const service = DeliberationService.forAgent(db, scope)
    const record = service.create({
      id: 'proposal-1', topic: 'Policy',
      proposal: { claim: 'Adopt policy A', position: 'conditional', rationale: 'With guardrails' }, opId: 'op-policy',
    })
    expect(() => service.decide({
      id: record.id, expectedVersion: record.version, opId: 'op-agent-decide',
      decision: { outcome: 'conditional', reason: 'Needs approval', ledgerWrite: null },
    })).toThrow(/capability|user|system/i)
    const decided = DeliberationService.forUser(db, { ...scope, actorId: 'user-1' }).decide({
      id: record.id, expectedVersion: record.version, opId: 'op-decide',
      decision: { outcome: 'conditional', reason: 'Needs approval', ledgerWrite: { logicalKey: 'policy', value: { enabled: true }, reason: 'record decision' } },
    })
    expect(decided.status).toBe('decided')
    expect(decided.decision?.resolverId).toBe('user-1')
    expect(() => DeliberationService.forUser(db, { ...scope, actorId: 'user-1' }).decide({
      id: record.id, expectedVersion: decided.version, opId: 'op-too-big',
      decision: { outcome: 'approved', reason: 'x'.repeat(4_001), ledgerWrite: null },
    })).toThrow()
  })

  it('does not leak data across discussions and deletes all session records', () => {
    DeliberationService.forSystem(db, scope).create({
      id: 'proposal-1', topic: 'Secret',
      proposal: { claim: 'Keep private', position: 'support', rationale: 'Scope test' }, opId: 'op-secret',
    })
    expect(DeliberationService.forSystem(db, { ...scope, discussionId: 'discussion-2' }).snapshot().records).toHaveLength(0)
    expect(DeliberationService.deleteBySession(db, scope.sessionId)).toBeGreaterThan(0)
    expect(DeliberationService.forSystem(db, scope).snapshot().records).toHaveLength(0)
    expect(DeliberationService.forSystem(db, scope).listEvents().items).toHaveLength(0)
  })
})
