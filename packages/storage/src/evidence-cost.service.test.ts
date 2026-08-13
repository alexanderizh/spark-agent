import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { SparkDatabase } from './database.js'
import { EvidenceCostConflictError, EvidenceCostService } from './evidence-cost.service.js'

describe('EvidenceCostService', () => {
  let db: SparkDatabase
  let dir: string
  const scope = { sessionId: 'session-a', roomId: 'room-a', discussionId: 'discussion-a', actorId: 'agent-a' }

  function applyMigrationsThrough(versionLimit: number) {
    const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))
    db.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))')
    for (const name of readdirSync(migrationsDir).filter((item) => item.endsWith('.sql')).sort()) {
      const version = Number.parseInt(name, 10)
      if (!Number.isFinite(version) || version > versionLimit) continue
      db.raw.exec(readFileSync(join(migrationsDir, name), 'utf8'))
      db.raw.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(version, name)
    }
  }

  beforeEach(() => {
    dir = join(tmpdir(), `spark-evidence-cost-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    // The parallel Replay line owns migration 080; this storage slice intentionally
    // verifies the 079 schema without loading later migrations.
    applyMigrationsThrough(79)
  })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

  function evidence(service: EvidenceCostService, id = 'evidence-1', opId = `add-${id}`) {
    return service.addEvidence({
      id, claim: 'Claim', links: [{ type: 'task', id: 'task-1' }],
      source: { type: 'test', ref: 'test:evidence' }, version: 'v1', summary: 'Summary', hash: 'sha256:x', opId,
    })
  }

  it('scopes evidence and cost reads, supports idempotency, and rejects op collisions', () => {
    const service = EvidenceCostService.forAgent(db, scope)
    const created = evidence(service)
    expect(evidence(service, 'evidence-1', 'add-evidence-1')).toEqual(created)
    expect(() => evidence(service, 'other', 'add-evidence-1')).toThrow(EvidenceCostConflictError)
    const cost = service.recordUsage({ id: 'usage-1', taskId: 'task-1', agentId: 'agent-a', dispatchId: 'dispatch-1', tokens: 10, amount: 0.5, currency: 'USD', latencyMs: 20, status: 'recorded', source: 'usage-ledger', opId: 'usage-1-op' })
    expect(cost).toHaveProperty('actorId', scope.actorId)
    expect(service.recordUsage({ id: 'usage-1', taskId: 'task-1', agentId: 'agent-a', dispatchId: 'dispatch-1', tokens: 10, amount: 0.5, currency: 'USD', latencyMs: 20, status: 'recorded', source: 'usage-ledger', opId: 'usage-1-op' })).toEqual(cost)
    expect(() => service.recordUsage({ id: 'usage-2', tokens: 99, status: 'recorded', opId: 'usage-1-op' })).toThrow(EvidenceCostConflictError)
    const other = EvidenceCostService.forAgent(db, { ...scope, discussionId: 'discussion-b' })
    expect(other.listEvidence()).toHaveLength(0)
    expect(other.listCosts()).toHaveLength(0)
  })

  it('enforces agent permissions, evidence CAS transitions, and invalidation audit', () => {
    const agent = EvidenceCostService.forAgent(db, scope)
    const created = evidence(agent)
    expect(() => agent.verifyEvidence({ id: created.id, expectedVersion: 1, opId: 'verify-agent' })).toThrow(/agent/i)
    const user = EvidenceCostService.forUser(db, { ...scope, actorId: 'user-a' })
    const verified = user.verifyEvidence({ id: created.id, expectedVersion: 1, opId: 'verify-1' })
    expect(verified).toMatchObject({ status: 'verified', verifiedBy: 'user-a', versionNumber: 2 })
    expect(() => user.invalidateEvidence({ id: created.id, expectedVersion: 1, reason: 'stale', opId: 'invalidate-stale' })).toThrow(/version/i)
    const invalid = user.invalidateEvidence({ id: created.id, expectedVersion: 2, reason: 'stale', opId: 'invalidate-1' })
    expect(invalid).toMatchObject({ status: 'invalid', versionNumber: 3 })
    expect(invalid.summary).toContain('[invalid: stale]')
    expect(user.listEvidence()[0]).toEqual(invalid)
  })

  it('enforces evidence quota and bounded list results', () => {
    const service = EvidenceCostService.forSystem(db, scope)
    for (let index = 0; index < 100; index += 1) evidence(service, `evidence-${index}`, `add-${index}`)
    expect(service.listEvidence(1_000)).toHaveLength(100)
    expect(() => evidence(service, 'evidence-over-quota', 'add-over-quota')).toThrow(/quota/i)
  })

  it('aggregates each usage once and preserves unknown values', () => {
    const service = EvidenceCostService.forSystem(db, scope)
    service.recordUsage({ id: 'usage-1', taskId: 'task-1', agentId: 'agent-a', dispatchId: 'dispatch-1', tokens: 10, amount: 1, latencyMs: 20, status: 'recorded', opId: 'usage-op-1' })
    service.recordUsage({ id: 'usage-2', taskId: 'task-1', agentId: 'agent-a', dispatchId: 'dispatch-2', tokens: null, amount: 2, latencyMs: null, status: 'unknown', opId: 'usage-op-2' })
    const task = service.aggregate().find((item) => item.dimension === 'task' && item.key === 'task-1')
    expect(task).toMatchObject({ eventCount: 2, tokens: null, amount: 3, latencyMs: null, unknown: true })
    expect(service.aggregate().filter((item) => item.dimension === 'room' && item.key === scope.roomId)[0]).toMatchObject({ eventCount: 2, tokens: null })
  })

  it('uses budget CAS/idempotency, disallows agents, and cleans every session table', () => {
    const agent = EvidenceCostService.forAgent(db, scope)
    expect(() => agent.setBudget({ tokens: 100, amount: 5, currency: 'USD', expectedVersion: 0, opId: 'budget-agent' })).toThrow(/agent/i)
    const user = EvidenceCostService.forUser(db, { ...scope, actorId: 'user-a' })
    const first = user.setBudget({ tokens: 100, amount: 5, currency: 'USD', expectedVersion: 0, opId: 'budget-1' })
    expect(first).toMatchObject({ tokens: 100, amount: 5, version: 1 })
    expect(user.setBudget({ tokens: 100, amount: 5, currency: 'USD', expectedVersion: 0, opId: 'budget-1' })).toEqual(first)
    expect(() => user.setBudget({ tokens: 200, amount: 6, currency: 'USD', expectedVersion: 0, opId: 'budget-1' })).toThrow(/opId/i)
    expect(() => user.setBudget({ tokens: 200, amount: 6, currency: 'USD', expectedVersion: 0, opId: 'budget-stale' })).toThrow(/version/i)
    evidence(user)
    user.recordUsage({ id: 'usage-1', tokens: 10, amount: 1, status: 'recorded', opId: 'usage-1-op' })
    expect(EvidenceCostService.deleteBySession(db, scope.sessionId)).toBeGreaterThan(0)
    expect(user.listEvidence()).toHaveLength(0)
    expect(user.listCosts()).toHaveLength(0)
    expect(user.budget()).toBeUndefined()
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM evidence_cost_evidence_events WHERE session_id=?').get(scope.sessionId)).toEqual({ count: 0 })
  })
})
