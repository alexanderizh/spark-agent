import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { SparkDatabase } from '../../../storage/src/database.js'
import { TeamReplayPlaybookRuntimeAdapter } from './team-replay-playbook-runtime-adapter.js'

describe('TeamReplayPlaybookRuntimeAdapter', () => {
  let db: SparkDatabase
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `spark-team-replay-playbook-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(fileURLToPath(new URL('../../../storage/migrations', import.meta.url)))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('binds replay scope to trusted context and rejects forged or unknown fields', async () => {
    const adapter = new TeamReplayPlaybookRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent',
    })
    const definitions = adapter.buildToolDefinitions()
    expect(definitions.map((definition) => definition.name)).toEqual([
      'team_replay_read', 'team_replay_diff', 'team_replay_fork', 'team_playbook_list', 'team_playbook_propose',
    ])
    for (const definition of definitions) {
      expect(definition.schema).not.toHaveProperty('sessionId')
      expect(definition.schema).not.toHaveProperty('roomId')
      expect(definition.schema).not.toHaveProperty('discussionId')
    }
    const fork = definitions.find((definition) => definition.name === 'team_replay_fork')!
    const forged = await fork.handler({ branchId: 'branch-a', sourceSeq: 0, reason: 'start', discussionId: 'forged' })
    expect(forged.isError).toBe(true)
    expect(JSON.stringify(forged)).not.toContain('forged')

    const timeline = definitions.find((definition) => definition.name === 'team_replay_read')!
    expect((await timeline.handler({ extra: true })).isError).toBe(true)
  })

  it('supports timeline, diff, fork, bounded lists, and idempotent operation ids', async () => {
    const adapter = new TeamReplayPlaybookRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent',
    })
    const tool = (name: string) => adapter.buildToolDefinitions().find((definition) => definition.name === name)!
    const fork = tool('team_replay_fork')
    const emptyFork = await fork.handler({ branchId: 'branch-a', sourceSeq: 0, reason: 'start', opId: 'fork-a' })
    expect(emptyFork.isError).not.toBe(true)

    const read = tool('team_replay_read')
    const initial = await read.handler({ limit: 100, opId: 'read-a' })
    expect(initial.isError).not.toBe(true)
    expect(initial.structuredContent).toMatchObject({ status: 'empty', events: [] })

    const diff = await tool('team_replay_diff').handler({ fromSeq: 1, toSeq: 2, limit: 100, opId: 'diff-a' })
    expect(diff.isError).not.toBe(true)
    expect(diff.structuredContent).toMatchObject({ status: 'empty', events: [] })

    const list = await tool('team_playbook_list').handler({ id: 'missing', limit: 100 })
    expect(list.isError).not.toBe(true)
    expect(list.structuredContent).toMatchObject({ playbook: null, versions: [], applications: [] })
  })

  it('allows agents to propose playbooks but keeps governance tools unavailable', async () => {
    const adapter = new TeamReplayPlaybookRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent',
    })
    const tool = (name: string) => adapter.buildToolDefinitions().find((definition) => definition.name === name)!
    const proposed = await tool('team_playbook_propose').handler({
      id: 'playbook-a', name: 'Safe flow', graph: { nodes: ['review'] }, roles: { reviewer: 'agent-a' },
      handoffRules: {}, gateRules: {}, deliberationRules: {}, expectedVersion: 0, opId: 'propose-a',
    })
    expect(proposed.isError).toBe(true)

    const valid = await tool('team_playbook_propose').handler({
      id: 'playbook-a', name: 'Safe flow', graph: { nodes: ['review'] }, roles: { reviewer: 'agent-a' },
      handoffRules: {}, gateRules: {}, deliberationRules: {}, opId: 'propose-b',
    })
    expect(valid.isError).not.toBe(true)
    expect(valid.structuredContent).toMatchObject({ id: 'playbook-a', status: 'proposed', version: 1 })
    expect(tool('team_playbook_publish')).toBeUndefined()
    expect(tool('team_playbook_apply')).toBeUndefined()
    expect(tool('team_playbook_archive')).toBeUndefined()
  })

  it('supports user governance, CAS/idempotency, and audit-only apply', async () => {
    const adapter = new TeamReplayPlaybookRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'user-a', capability: 'user',
    })
    const tool = (name: string) => adapter.buildToolDefinitions().find((definition) => definition.name === name)!
    const proposed = await tool('team_playbook_propose').handler({
      id: 'playbook-a', name: 'Release flow', graph: { nodes: ['build', 'review'] }, roles: {},
      handoffRules: {}, gateRules: {}, deliberationRules: {}, opId: 'propose-a',
    })
    expect(proposed.isError).not.toBe(true)
    const published = await tool('team_playbook_publish').handler({ id: 'playbook-a', expectedVersion: 1, opId: 'publish-a' })
    expect(published.isError).not.toBe(true)
    expect((await tool('team_playbook_publish').handler({ id: 'playbook-a', expectedVersion: 1, opId: 'publish-a' }))).toEqual(published)

    const applied = await tool('team_playbook_apply').handler({
      id: 'playbook-a', expectedVersion: 1, targetDiscussionId: 'discussion-b', opId: 'apply-a',
    })
    expect(applied.isError).not.toBe(true)
    expect(applied.structuredContent).toMatchObject({ appliedDiscussionId: 'discussion-b', applicationId: expect.any(String) })
    expect(JSON.stringify(applied)).not.toContain('task_graph_nodes')
    expect((await tool('team_playbook_apply').handler({
      id: 'playbook-a', expectedVersion: 1, targetDiscussionId: 'discussion-b', opId: 'apply-a',
    }))).toEqual(applied)

    const stale = await tool('team_playbook_archive').handler({ id: 'playbook-a', expectedVersion: 2, opId: 'archive-stale' })
    expect(stale.isError).toBe(true)
    expect(JSON.stringify(stale)).toContain('Expected current playbook version 2, current version is 1')

    const missing = await tool('team_playbook_archive').handler({ id: 'missing', expectedVersion: 1, opId: 'archive-missing' })
    expect(missing.isError).toBe(true)
    expect(JSON.stringify(missing)).toContain('Playbook missing does not exist')
  })

  it('rejects oversized or cyclic playbook JSON before persistence', async () => {
    const adapter = new TeamReplayPlaybookRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent',
    })
    const propose = adapter.buildToolDefinitions().find((definition) => definition.name === 'team_playbook_propose')!
    const oversized = await propose.handler({
      id: 'large', name: 'Large', graph: 'x'.repeat(12_001), roles: {}, handoffRules: {}, gateRules: {}, deliberationRules: {},
    })
    expect(oversized.isError).toBe(true)

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const cyclicResult = await propose.handler({
      id: 'cyclic', name: 'Cyclic', graph: cyclic, roles: {}, handoffRules: {}, gateRules: {}, deliberationRules: {},
    })
    expect(cyclicResult.isError).toBe(true)
  })
})
