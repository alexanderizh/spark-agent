import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SessionId } from '@spark/protocol'
import { SessionRepository, SparkDatabase, TeamDiscussionRepository } from '@spark/storage'
import { TeamEvidenceCostBackend } from './teamEvidenceCostBackend.js'

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId
const migrationsDir = existsSync(join(process.cwd(), '../../packages/storage/migrations')) ? join(process.cwd(), '../../packages/storage/migrations') : join(process.cwd(), 'packages/storage/migrations')

describe('TeamEvidenceCostBackend', () => {
  let db: SparkDatabase
  let dir: string
  let backend: TeamEvidenceCostBackend
  beforeEach(() => {
    dir = join(tmpdir(), `spark-evidence-cost-backend-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(migrationsDir)
    const sessions = new SessionRepository(db)
    sessions.create({ id: sessionId, kind: 'chat', title: 'Evidence cost', status: 'active', projectId: 'project-1' })
    sessions.patchMetadata(sessionId, { team: { enabled: true } })
    new TeamDiscussionRepository(db).createDiscussion({ id: 'discussion-1', sessionId, hostAgentId: 'host', topic: 'Evidence', maxRounds: 6 })
    backend = new TeamEvidenceCostBackend({ db })
  })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

  it('binds the scope and preserves idempotent evidence and usage writes', () => {
    const evidence = backend.mutate({ sessionId, expectedDiscussionId: 'discussion-1', opId: 'evidence-1', kind: 'evidence', action: 'add', id: 'e-1', claim: 'CI passed', links: [{ type: 'task', id: 'task-1' }], source: { type: 'test', ref: 'ci/run-1' }, summary: 'All checks passed' })
    expect(evidence.evidence[0]).toMatchObject({ id: 'e-1', sessionId, roomId: `team-room:${sessionId}`, discussionId: 'discussion-1', status: 'unknown' })
    const retry = backend.mutate({ sessionId, expectedDiscussionId: 'discussion-1', opId: 'evidence-1', kind: 'evidence', action: 'add', id: 'e-1', claim: 'CI passed', links: [{ type: 'task', id: 'task-1' }], source: { type: 'test', ref: 'ci/run-1' }, summary: 'All checks passed' })
    expect(retry.evidence).toHaveLength(1)
    const usage = backend.mutate({ sessionId, expectedDiscussionId: 'discussion-1', opId: 'usage-1', kind: 'usage', action: 'record', id: 'u-1', agentId: 'agent-1', status: 'unknown' })
    expect(usage.costs).toHaveLength(1)
    expect(usage.costs[0]).toMatchObject({ agentId: 'agent-1', tokens: null })
    expect(usage.aggregates.find((item) => item.dimension === 'agent')).toMatchObject({ key: 'agent-1', unknown: true })
  })

  it('uses expected versions for governance and rejects forged discussion scope', () => {
    const added = backend.mutate({ sessionId, expectedDiscussionId: 'discussion-1', opId: 'evidence-2', kind: 'evidence', action: 'add', id: 'e-2', claim: 'A claim', links: [], source: { type: 'manual', ref: 'user' }, summary: 'Summary' })
    const verified = backend.mutate({ sessionId, expectedDiscussionId: 'discussion-1', opId: 'verify-1', kind: 'evidence', action: 'verify', id: 'e-2', expectedVersion: added.evidence[0]!.versionNumber })
    expect(verified.evidence[0]).toMatchObject({ status: 'verified', versionNumber: 2 })
    expect(() => backend.mutate({ sessionId, expectedDiscussionId: 'forged', opId: 'budget-1', kind: 'budget', action: 'set', expectedVersion: 0, tokens: 100 })).toThrow(/讨论已切换|discussion/i)
  })

  it('rejects a stale read scope after the active discussion changes', () => {
    expect(() => backend.getSnapshot(sessionId, 'forged')).toThrow(/讨论已切换|discussion/i)
    expect(backend.getSnapshot(sessionId, 'discussion-1').discussionId).toBe('discussion-1')
  })
})
