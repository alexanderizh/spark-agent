import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from './database.js'
import { ReplayPlaybookConflictError, ReplayPlaybookService } from './replay-playbook.service.js'

describe('ReplayPlaybookService timeline storage', () => {
  let db: SparkDatabase
  let dir: string
  const sessionId = '11111111-1111-4111-8111-111111111111'
  const scope = { sessionId, roomId: `team-room:${sessionId}`, discussionId: 'discussion-a', actorId: 'agent-a' }

  beforeEach(() => {
    dir = join(tmpdir(), `spark-replay-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
    db.runMigrations(migrations)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('applies migration 081 and keeps replay tables append-only', () => {
    expect(db.raw.prepare('SELECT name FROM schema_migrations WHERE version=81').get()).toEqual({ name: '081_replay_playbook.sql' })
    const sql = readFileSync(fileURLToPath(new URL('../migrations/081_replay_playbook.sql', import.meta.url)), 'utf8')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS replay_events')
    const service = ReplayPlaybookService.forAgent(db, scope)
    const first = service.append({ sourceType: 'task', sourceId: 'task-1', action: 'created', before: null, after: { status: 'ready' }, opId: 'op-1' })
    const second = service.append({ sourceType: 'task', sourceId: 'task-1', action: 'started', before: { status: 'ready' }, after: { status: 'running' }, opId: 'op-2' })
    expect([first.seq, second.seq]).toEqual([1, 2])
    expect(service.getTimeline().events).toHaveLength(2)
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM replay_events').get()).toEqual({ count: 2 })
  })

  it('is idempotent for the same opId and rejects payload or cross-scope collisions', () => {
    const service = ReplayPlaybookService.forAgent(db, scope)
    const input = { sourceType: 'manual' as const, sourceId: 'source-1', action: 'note', after: { ok: true }, opId: 'op-same' }
    const first = service.append(input)
    expect(service.append(input)).toEqual(first)
    expect(() => service.append({ ...input, action: 'changed' })).toThrow(ReplayPlaybookConflictError)
    const other = ReplayPlaybookService.forAgent(db, { ...scope, discussionId: 'discussion-b', actorId: 'agent-b' })
    expect(() => other.append(input)).toThrow(ReplayPlaybookConflictError)
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM replay_events').get()).toEqual({ count: 1 })
  })

  it('enforces expected sequence CAS and stable cursor pagination', () => {
    const service = ReplayPlaybookService.forSystem(db, scope)
    service.append({ sourceType: 'ledger', sourceId: 'ledger-1', action: 'one', opId: 'op-1' })
    expect(() => service.append({ sourceType: 'ledger', sourceId: 'ledger-2', action: 'two', expectedSeq: 0, opId: 'op-2' })).toThrow(/sequence/i)
    service.append({ sourceType: 'ledger', sourceId: 'ledger-2', action: 'two', expectedSeq: 1, opId: 'op-2' })
    service.append({ sourceType: 'ledger', sourceId: 'ledger-3', action: 'three', expectedSeq: 2, opId: 'op-3' })
    const page1 = service.getTimeline({ limit: 2 })
    expect(page1.events.map((event) => event.seq)).toEqual([1, 2])
    expect(page1.status).toBe('partial')
    expect(page1.nextCursor).toBe('2')
    const page2 = service.getTimeline({ cursor: page1.nextCursor!, limit: 2 })
    expect(page2.events.map((event) => event.seq)).toEqual([3])
    expect(page2.nextCursor).toBeNull()
    expect(page2.status).toBe('available')
  })

  it('returns bounded sequence diffs without fabricating missing history', () => {
    const service = ReplayPlaybookService.forAgent(db, scope)
    service.append({ sourceType: 'tool', sourceId: 'tool-1', action: 'one', opId: 'op-1' })
    service.append({ sourceType: 'tool', sourceId: 'tool-2', action: 'two', opId: 'op-2' })
    service.append({ sourceType: 'tool', sourceId: 'tool-3', action: 'three', opId: 'op-3' })
    expect(service.getDiff({ fromSeq: 2, toSeq: 9 }).events.map((event) => event.seq)).toEqual([2, 3])
    expect(service.getDiff({ fromSeq: 4, toSeq: 9 })).toMatchObject({ events: [], status: 'empty' })
    expect(service.getDiff({ fromSeq: 1, toSeq: 3, limit: 2 })).toMatchObject({ events: [{ seq: 1 }, { seq: 2 }], status: 'partial' })
    expect(() => service.getDiff({ fromSeq: 3, toSeq: 2 })).toThrow(/range/i)
  })

  it('records branch lineage and never mutates or copies the source event log', () => {
    const service = ReplayPlaybookService.forUser(db, scope)
    service.append({ sourceType: 'deliberation', sourceId: 'deliberation-1', action: 'decide', opId: 'op-1' })
    const branch = service.createBranch({ branchId: 'branch-1', sourceSeq: 1, reason: 'try an alternative', opId: 'op-branch' })
    expect(branch).toMatchObject({ sourceDiscussionId: scope.discussionId, sourceSeq: 1, createdBy: scope.actorId })
    expect(service.getTimeline().events).toHaveLength(1)
    expect(service.listBranches()).toEqual([branch])
    expect(service.fork({ branchId: 'branch-2', sourceSeq: 1, reason: 'second alternative', opId: 'op-fork' }).timeline.events).toHaveLength(1)
    expect(() => service.createBranch({ branchId: 'branch-3', sourceSeq: 2, reason: 'missing event', opId: 'op-bad' })).toThrow(/does not exist/i)
  })

  it('enforces scope, list/json bounds, and the 100-event quota', () => {
    const service = ReplayPlaybookService.forAgent(db, scope)
    expect(() => service.getTimeline({ limit: 101 })).toThrow(/limit/i)
    expect(() => service.append({ sourceType: 'manual', sourceId: 'x', action: 'x', after: { value: Number.NaN }, opId: 'op-bad-json' })).toThrow(/JSON/i)
    for (let i = 1; i <= 100; i += 1) service.append({ sourceType: 'manual', sourceId: `source-${i}`, action: 'record', opId: `op-${i}` })
    expect(service.getTimeline({ limit: 100 }).events).toHaveLength(100)
    expect(() => service.append({ sourceType: 'manual', sourceId: 'source-101', action: 'record', opId: 'op-101' })).toThrow(/quota/i)
  })

  it('cleans every replay table for a session without touching another session', () => {
    const service = ReplayPlaybookService.forAgent(db, scope)
    service.append({ sourceType: 'manual', sourceId: 'source-1', action: 'record', opId: 'op-1' })
    service.createBranch({ branchId: 'branch-1', sourceSeq: 1, reason: 'cleanup', opId: 'op-branch' })
    const cleanupPlaybook = service.propose({
      id: 'cleanup-playbook', name: 'Cleanup', graph: {}, roles: {}, handoffRules: {}, gateRules: {},
      deliberationRules: {}, opId: 'op-playbook-propose',
    })
    ReplayPlaybookService.forSystem(db, scope).publish({ id: cleanupPlaybook.id, expectedVersion: 1, opId: 'op-playbook-publish' })
    ReplayPlaybookService.forSystem(db, scope).apply({
      id: cleanupPlaybook.id, expectedVersion: 1, targetDiscussionId: 'discussion-cleanup', opId: 'op-playbook-apply',
    })
    const otherScope = { ...scope, sessionId: '22222222-2222-4222-8222-222222222222', roomId: 'team-room:other', discussionId: 'discussion-other' }
    ReplayPlaybookService.forAgent(db, otherScope).append({ sourceType: 'manual', sourceId: 'other', action: 'keep', opId: 'op-other' })
    expect(ReplayPlaybookService.deleteBySession(db, scope.sessionId)).toBeGreaterThanOrEqual(7)
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM replay_events WHERE session_id=?').get(scope.sessionId)).toEqual({ count: 0 })
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM replay_branches WHERE session_id=?').get(scope.sessionId)).toEqual({ count: 0 })
    for (const table of ['replay_playbooks', 'replay_playbook_versions', 'replay_playbook_operations', 'replay_playbook_applications']) {
      expect(db.raw.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id=?`).get(scope.sessionId)).toEqual({ count: 0 })
    }
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM replay_events WHERE session_id=?').get(otherScope.sessionId)).toEqual({ count: 1 })
  })

  it('runs the playbook lifecycle with versioned CAS, capability checks, and audit-only apply', () => {
    const draft = ReplayPlaybookService.forAgent(db, scope)
    const proposalInput = {
      id: 'playbook-1', name: 'Ship safely', graph: { nodes: ['build', 'review'] }, roles: { reviewer: 'user' },
      handoffRules: { review: 'required' }, gateRules: { tests: true }, deliberationRules: { quorum: 1 }, opId: 'pb-propose-1',
    }
    const proposed = draft.propose(proposalInput)
    expect(proposed).toMatchObject({ id: 'playbook-1', version: 1, status: 'proposed', name: 'Ship safely' })
    expect(draft.propose(proposalInput)).toEqual(proposed)
    expect(() => draft.propose({ ...proposalInput, name: 'Changed payload' })).toThrow(/opId conflicts/i)
    const otherScope = { ...scope, discussionId: 'discussion-b', actorId: 'agent-b' }
    expect(() => ReplayPlaybookService.forAgent(db, otherScope).propose(proposalInput)).toThrow(/opId conflicts/i)
    expect(() => draft.publish({ id: 'playbook-1', expectedVersion: 1, opId: 'pb-publish-agent' })).toThrow(/cannot publish/i)
    expect(() => draft.apply({ id: 'playbook-1', expectedVersion: 1, targetDiscussionId: 'discussion-b', opId: 'pb-apply-agent' })).toThrow(/cannot apply/i)
    expect(() => draft.archive({ id: 'playbook-1', expectedVersion: 1, opId: 'pb-archive-agent' })).toThrow(/cannot archive/i)

    const governance = ReplayPlaybookService.forUser(db, scope)
    expect(() => governance.apply({ id: 'playbook-1', expectedVersion: 1, targetDiscussionId: 'discussion-b', opId: 'pb-apply-unpublished' }))
      .toThrow(/published/i)
    const published = governance.publish({ id: 'playbook-1', expectedVersion: 1, opId: 'pb-publish-1' })
    expect(published.status).toBe('published')
    expect(governance.current('playbook-1')).toEqual(published)
    expect(governance.listVersions('playbook-1')).toMatchObject([{ version: 1, status: 'published' }])
    expect(() => governance.publish({ id: 'playbook-1', expectedVersion: 1, opId: 'pb-publish-stale' })).toThrow(/proposed/i)
    expect(() => governance.apply({ id: 'playbook-1', expectedVersion: 2, targetDiscussionId: 'discussion-b', opId: 'pb-apply-bad' }))
      .toThrow('Expected current playbook version 2, current version is 1')

    const application = governance.apply({ id: 'playbook-1', expectedVersion: 1, targetDiscussionId: 'discussion-b', opId: 'pb-apply-1' })
    expect(application).toMatchObject({ playbook: published, appliedDiscussionId: 'discussion-b' })
    expect(governance.apply({ id: 'playbook-1', expectedVersion: 1, targetDiscussionId: 'discussion-b', opId: 'pb-apply-1' })).toEqual(application)
    expect(() => governance.apply({ id: 'playbook-1', expectedVersion: 1, targetDiscussionId: 'discussion-c', opId: 'pb-apply-1' })).toThrow(/opId conflicts/i)
    expect(() => ReplayPlaybookService.forUser(db, otherScope).apply({
      id: 'playbook-1', expectedVersion: 1, targetDiscussionId: 'discussion-b', opId: 'pb-apply-1',
    })).toThrow(/opId conflicts/i)
    expect(governance.listApplications('playbook-1')).toHaveLength(1)
    expect(governance.getTimeline().events).toHaveLength(0)
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM task_graph_nodes WHERE session_id=?').get(scope.sessionId)).toEqual({ count: 0 })
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM task_graph_events WHERE session_id=?').get(scope.sessionId)).toEqual({ count: 0 })

    const archived = governance.archive({ id: 'playbook-1', expectedVersion: 1, opId: 'pb-archive-1' })
    expect(archived.status).toBe('archived')
    expect(governance.current('playbook-1')).toEqual(archived)
    expect(() => governance.archive({ id: 'missing', expectedVersion: 1, opId: 'pb-archive-missing' }))
      .toThrow('Playbook missing does not exist')
    expect(ReplayPlaybookService.deleteBySession(db, scope.sessionId)).toBeGreaterThanOrEqual(4)
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM replay_playbook_applications WHERE session_id=?').get(scope.sessionId)).toEqual({ count: 0 })
  })

  it('supports system governance, CAS versioning, published-only apply, and the 100-playbook quota', () => {
    const system = ReplayPlaybookService.forSystem(db, scope)
    const base = {
      id: 'system-playbook', name: 'System flow', graph: { nodes: ['run'] }, roles: { runner: 'system' },
      handoffRules: {}, gateRules: { tests: true }, deliberationRules: {},
    }
    const proposed = system.propose({ ...base, opId: 'system-propose-1' })
    expect(() => system.propose({ ...base, expectedVersion: 0, opId: 'system-propose-stale' })).toThrow(/version/i)
    expect(() => system.apply({ id: base.id, expectedVersion: 1, targetDiscussionId: 'discussion-system', opId: 'system-apply-unpublished' }))
      .toThrow(/published/i)

    const published = system.publish({ id: base.id, expectedVersion: proposed.version, opId: 'system-publish-1' })
    expect(system.publish({ id: base.id, expectedVersion: 1, opId: 'system-publish-1' })).toEqual(published)
    expect(() => system.publish({ id: base.id, expectedVersion: 1, opId: 'system-publish-1-collision' })).toThrow(/proposed/i)
    const applied = system.apply({ id: base.id, expectedVersion: 1, targetDiscussionId: 'discussion-system', opId: 'system-apply-1' })
    expect(applied.playbook).toEqual(published)
    expect(system.apply({ id: base.id, expectedVersion: 1, targetDiscussionId: 'discussion-system', opId: 'system-apply-1' })).toEqual(applied)
    const second = system.propose({ ...base, name: 'System flow v2', expectedVersion: 1, opId: 'system-propose-2' })
    expect(second).toMatchObject({ version: 2, status: 'proposed' })
    expect(() => system.publish({ id: base.id, expectedVersion: 1, opId: 'system-publish-stale' })).toThrow(/current/i)
    const publishedSecond = system.publish({ id: base.id, expectedVersion: 2, opId: 'system-publish-2' })
    expect(publishedSecond.status).toBe('published')
    expect(system.archive({ id: base.id, expectedVersion: 2, opId: 'system-archive-2' }).status).toBe('archived')

    const quotaScope = { ...scope, discussionId: 'discussion-playbook-quota' }
    const quota = ReplayPlaybookService.forAgent(db, quotaScope)
    for (let i = 1; i <= 100; i += 1) {
      quota.propose({
        id: `quota-playbook-${i}`, name: `Quota ${i}`, graph: {}, roles: {}, handoffRules: {}, gateRules: {},
        deliberationRules: {}, opId: `quota-propose-${i}`,
      })
    }
    expect(() => quota.propose({
      id: 'quota-playbook-101', name: 'Quota 101', graph: {}, roles: {}, handoffRules: {}, gateRules: {},
      deliberationRules: {}, opId: 'quota-propose-101',
    })).toThrow(/quota/i)
  })
})
