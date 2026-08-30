import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SessionId } from '@spark/protocol'
import { SessionRepository, SparkDatabase, TeamDiscussionRepository } from '@spark/storage'
import { ReplayPlaybookService } from '../../../../../packages/storage/src/replay-playbook.service.js'
import { TeamReplayPlaybookBackend } from './teamReplayPlaybookBackend.js'

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId
const otherSessionId = '22222222-2222-4222-8222-222222222222' as SessionId
const migrationsDir = existsSync(join(process.cwd(), '../../packages/storage/migrations'))
  ? join(process.cwd(), '../../packages/storage/migrations')
  : join(process.cwd(), 'packages/storage/migrations')

describe('TeamReplayPlaybookBackend', () => {
  let db: SparkDatabase
  let dir: string

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `spark-replay-playbook-backend-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(migrationsDir)
    const sessions = new SessionRepository(db)
    sessions.create({
      id: sessionId,
      kind: 'chat',
      title: 'Replay',
      status: 'active',
      projectId: 'project-1',
    })
    sessions.patchMetadata(sessionId, { team: { enabled: true } })
    sessions.create({
      id: otherSessionId,
      kind: 'chat',
      title: 'Other',
      status: 'active',
      projectId: 'project-1',
    })
    sessions.patchMetadata(otherSessionId, { team: { enabled: true } })
    const discussions = new TeamDiscussionRepository(db)
    discussions.createDiscussion({
      id: 'discussion-1',
      sessionId,
      hostAgentId: 'host',
      topic: 'Replay',
      maxRounds: 6,
    })
    discussions.createDiscussion({
      id: 'discussion-2',
      sessionId: otherSessionId,
      hostAgentId: 'host',
      topic: 'Other',
      maxRounds: 6,
    })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('binds timeline, diff and fork to the trusted discussion scope', () => {
    const scope = {
      sessionId,
      roomId: `team-room:${sessionId}`,
      discussionId: 'discussion-1',
      actorId: 'agent-1',
    }
    const service = ReplayPlaybookService.forAgent(db, scope)
    service.append({
      sourceType: 'manual',
      sourceId: 'source-1',
      action: 'started',
      opId: 'event-1',
    })
    service.append({ sourceType: 'task', sourceId: 'task-1', action: 'completed', opId: 'event-2' })
    const backend = new TeamReplayPlaybookBackend({ db })

    const first = backend.getTimeline({
      schemaVersion: 1,
      sessionId,
      expectedDiscussionId: 'discussion-1',
      limit: 1,
      opId: 'read-1',
    })
    expect(first.timeline.events).toHaveLength(1)
    expect(first.timeline.nextCursor).toBe('1')
    const rest = backend.getTimeline({
      schemaVersion: 1,
      sessionId,
      expectedDiscussionId: 'discussion-1',
      cursor: first.timeline.nextCursor!,
      opId: 'read-2',
    })
    expect(rest.timeline.events[0]).toMatchObject({ seq: 2, discussionId: 'discussion-1' })
    expect(
      backend.getDiff({
        schemaVersion: 1,
        sessionId,
        expectedDiscussionId: 'discussion-1',
        fromSeq: 1,
        toSeq: 2,
        opId: 'diff-1',
      }).events,
    ).toHaveLength(2)

    const fork = backend.fork({
      schemaVersion: 1,
      sessionId,
      expectedDiscussionId: 'discussion-1',
      branchId: 'branch-1',
      sourceSeq: 1,
      reason: 'review',
      opId: 'fork-1',
    })
    expect(fork.branch).toMatchObject({ sessionId, discussionId: 'discussion-1', sourceSeq: 1 })
    expect(() =>
      backend.getTimeline({
        schemaVersion: 1,
        sessionId,
        expectedDiscussionId: 'forged',
        opId: 'read-forged',
      }),
    ).toThrow(/讨论已切换/)
    expect(() =>
      backend.getTimeline({
        schemaVersion: 1,
        sessionId: otherSessionId,
        expectedDiscussionId: 'discussion-1',
        opId: 'read-cross-scope',
      }),
    ).toThrow(/讨论已切换/)
  })

  it('supports playbook lifecycle, stable operation ids, CAS and apply audit', () => {
    const backend = new TeamReplayPlaybookBackend({ db })
    const base = {
      schemaVersion: 1,
      sessionId,
      expectedDiscussionId: 'discussion-1',
      id: 'playbook-1',
      name: 'Release',
      graph: { nodes: ['build'] },
      roles: {},
      handoffRules: {},
      gateRules: {},
      deliberationRules: {},
      opId: 'propose-1',
    } as const
    const proposed = backend.mutate({ ...base, action: 'propose' })
    expect(proposed.playbook).toMatchObject({ id: 'playbook-1', version: 1, status: 'proposed' })
    expect(backend.mutate({ ...base, action: 'propose' })).toEqual(proposed)
    const published = backend.mutate({
      schemaVersion: 1,
      sessionId,
      expectedDiscussionId: 'discussion-1',
      action: 'publish',
      id: 'playbook-1',
      expectedVersion: 1,
      opId: 'publish-1',
    })
    expect(published.playbook).toMatchObject({ version: 1, status: 'published' })
    const applied = backend.mutate({
      schemaVersion: 1,
      sessionId,
      expectedDiscussionId: 'discussion-1',
      action: 'apply',
      id: 'playbook-1',
      expectedVersion: 1,
      targetDiscussionId: 'discussion-1',
      opId: 'apply-1',
    })
    expect(applied).toMatchObject({
      appliedDiscussionId: 'discussion-1',
      applicationId: expect.any(String),
    })
    expect(
      backend.mutate({
        schemaVersion: 1,
        sessionId,
        expectedDiscussionId: 'discussion-1',
        action: 'apply',
        id: 'playbook-1',
        expectedVersion: 1,
        targetDiscussionId: 'discussion-1',
        opId: 'apply-1',
      }),
    ).toEqual(applied)
    expect(() =>
      backend.mutate({
        schemaVersion: 1,
        sessionId,
        expectedDiscussionId: 'discussion-1',
        action: 'archive',
        id: 'playbook-1',
        expectedVersion: 2,
        opId: 'archive-stale',
      }),
    ).toThrow(/Expected current playbook version 2, current version is 1/)
    const archived = backend.mutate({
      schemaVersion: 1,
      sessionId,
      expectedDiscussionId: 'discussion-1',
      action: 'archive',
      id: 'playbook-1',
      expectedVersion: 1,
      opId: 'archive-1',
    })
    expect(archived.playbook).toMatchObject({ status: 'archived' })
    expect(
      backend.listPlaybook({ sessionId, expectedDiscussionId: 'discussion-1', id: 'playbook-1' })
        .applications,
    ).toHaveLength(1)
  })

  it('keeps agent governance isolated while user and system can govern', () => {
    const base = {
      schemaVersion: 1,
      sessionId,
      expectedDiscussionId: 'discussion-1',
      id: 'playbook-2',
      name: 'Governed',
      graph: {},
      roles: {},
      handoffRules: {},
      gateRules: {},
      deliberationRules: {},
      opId: 'agent-propose',
    } as const
    const agent = new TeamReplayPlaybookBackend({ db, actorId: 'agent-1', capability: 'agent' })
    agent.mutate({ ...base, action: 'propose' })
    expect(() =>
      agent.mutate({
        schemaVersion: 1,
        sessionId,
        expectedDiscussionId: 'discussion-1',
        action: 'publish',
        id: 'playbook-2',
        expectedVersion: 1,
        opId: 'agent-publish',
      }),
    ).toThrow(/Agents cannot publish/)
    const system = new TeamReplayPlaybookBackend({ db, actorId: 'system-1', capability: 'system' })
    expect(
      system.mutate({
        schemaVersion: 1,
        sessionId,
        expectedDiscussionId: 'discussion-1',
        action: 'publish',
        id: 'playbook-2',
        expectedVersion: 1,
        opId: 'system-publish',
      }).playbook,
    ).toMatchObject({ status: 'published' })
    expect(() =>
      system.mutate({
        schemaVersion: 1,
        sessionId,
        expectedDiscussionId: 'forged',
        action: 'apply',
        id: 'playbook-2',
        expectedVersion: 1,
        targetDiscussionId: 'discussion-1',
        opId: 'cross-scope',
      }),
    ).toThrow(/讨论已切换/)
  })
})
