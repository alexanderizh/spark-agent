import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkError } from '@spark/shared'
import type { SessionId } from '@spark/protocol'
import {
  DeliberationService,
  SessionRepository,
  SparkDatabase,
  TaskGraphService,
  TeamDiscussionRepository,
} from '@spark/storage'
import { TeamRuntimeBackend } from './teamRuntimeBackend.js'

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId
const migrationsDir = existsSync(join(process.cwd(), '../../packages/storage/migrations'))
  ? join(process.cwd(), '../../packages/storage/migrations')
  : join(process.cwd(), 'packages/storage/migrations')

describe('TeamRuntimeBackend', () => {
  let db: SparkDatabase
  let dir: string
  let backend: TeamRuntimeBackend

  beforeEach(() => {
    dir = join(tmpdir(), `spark-team-runtime-backend-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(migrationsDir)

    const sessions = new SessionRepository(db)
    sessions.create({ id: sessionId, kind: 'chat', title: 'Team runtime', status: 'active', projectId: 'project-1' })
    sessions.patchMetadata(sessionId, { team: { enabled: true } })
    new TeamDiscussionRepository(db).createDiscussion({
      id: 'discussion-1', sessionId, hostAgentId: 'host', topic: 'Runtime', maxRounds: 6,
    })
    backend = new TeamRuntimeBackend({ db })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('resolves scope from the session and keeps task mutations idempotent with CAS', () => {
    const created = backend.mutateTaskGraph({
      sessionId, expectedDiscussionId: 'discussion-1', opId: 'task:create-1',
      kind: 'node', action: 'create', id: 'task-1', title: 'Collect evidence',
    })
    expect(created.snapshot).toMatchObject({ sessionId, discussionId: 'discussion-1' })
    expect(created.snapshot.nodes[0]).toMatchObject({ id: 'task-1', status: 'ready' })

    const transition = backend.mutateTaskGraph({
      sessionId, expectedDiscussionId: 'discussion-1', opId: 'task:start-1',
      kind: 'node', action: 'transition', id: 'task-1', expectedVersion: 1, status: 'running',
    })
    expect(transition.snapshot.nodes[0]?.status).toBe('running')

    expect(() => backend.mutateTaskGraph({
      sessionId, expectedDiscussionId: 'discussion-1', opId: 'task:stale',
      kind: 'node', action: 'transition', id: 'task-1', expectedVersion: 1, status: 'completed',
    })).toThrow(SparkError)
    expect(() => backend.mutateTaskGraph({
      sessionId, expectedDiscussionId: 'discussion-forged', opId: 'task:forged-scope',
      kind: 'node', action: 'create', id: 'task-forged', title: 'Must reject',
    })).toThrowError(/讨论已切换|discussion/i)
  })

  it('passes deliberation operations through the trusted scope and rejects cross-scope writes', () => {
    const created = backend.mutateDeliberation({
      sessionId, expectedDiscussionId: 'discussion-1', opId: 'decision:create-1',
      id: 'decision-1', action: 'create', topic: 'Ship runtime',
      proposal: { claim: 'Ship now', position: 'support', rationale: 'Evidence is ready' },
    })
    expect(created.snapshot).toMatchObject({ sessionId, discussionId: 'discussion-1' })
    expect(created.record.capability).toBe('user')

    const withEvidence = backend.mutateDeliberation({
      sessionId, expectedDiscussionId: 'discussion-1', opId: 'decision:evidence-1',
      id: 'decision-1', action: 'evidence', expectedVersion: created.record.version,
      evidence: { summary: 'CI is green', sourceRef: 'run-1', polarity: 'supports' },
    })
    expect(withEvidence.record.evidence).toHaveLength(1)
    expect(() => backend.mutateDeliberation({
      sessionId, expectedDiscussionId: 'discussion-forged', opId: 'decision:forged',
      id: 'decision-1', action: 'evidence', expectedVersion: withEvidence.record.version,
      evidence: { summary: 'wrong scope', sourceRef: 'run-2', polarity: 'neutral' },
    })).toThrowError(/讨论已切换|discussion/i)

    // The IPC boundary is user-scoped; an agent cannot smuggle in a governance operation.
    const agent = DeliberationService.forAgent(db, {
      sessionId, roomId: `team-room:${sessionId}`, discussionId: 'discussion-1', actorId: 'agent-1',
    })
    expect(() => agent.decide({
      id: created.record.id, expectedVersion: withEvidence.record.version, opId: 'decision:agent',
      decision: { outcome: 'approved', reason: 'agent cannot decide', ledgerWrite: null },
    })).toThrow(/capability|user|system/i)
    expect(TaskGraphService.forUser(db, {
      sessionId, roomId: `team-room:${sessionId}`, discussionId: 'discussion-1', actorId: 'desktop-user',
    }).snapshot().nodes).toHaveLength(0)
  })
})
