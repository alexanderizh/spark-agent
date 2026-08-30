import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '@spark/storage'
import { TeamP1RuntimeAdapter } from './team-p1-runtime-adapter.js'

describe('TeamP1RuntimeAdapter', () => {
  let db: SparkDatabase
  let dir: string
  beforeEach(() => {
    dir = join(tmpdir(), `spark-team-p1-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))
  })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

  it('accepts a caller opId so retries return the same handoff without a duplicate event', async () => {
    const adapter = new TeamP1RuntimeAdapter(db, { sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent' })
    const create = adapter.buildToolDefinitions().find((tool) => tool.name === 'team_handoff_create')!
    const args = { id: 'handoff-1', opId: 'retry-safe-1', recipientId: 'agent-b', purpose: 'Review', inputs: { file: 'a' }, expectedOutput: 'Notes', acceptanceCriteria: ['done'], sensitivity: 'internal' }
    const first = await create.handler(args)
    const second = await create.handler(args)
    expect(second).toEqual(first)
    await expect(adapter.buildToolDefinitions().find((tool) => tool.name === 'team_p1_read')?.handler({})).resolves.toBeDefined()
    expect(first.structuredContent).toMatchObject({ id: 'handoff-1', version: 1 })
    expect((db.raw.prepare('SELECT COUNT(*) AS count FROM team_handoff_events').get() as { count: number }).count).toBe(1)
  })

  it('rejects oversized JSON before handoff and gate persistence', async () => {
    const adapter = new TeamP1RuntimeAdapter(db, { sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent' })
    const defs = adapter.buildToolDefinitions()
    const handoff = await defs.find((tool) => tool.name === 'team_handoff_create')!.handler({
      id: 'handoff-big', opId: 'big-handoff', recipientId: 'agent-b', purpose: 'Review', inputs: 'x'.repeat(20_000), expectedOutput: 'Notes', acceptanceCriteria: [], sensitivity: 'internal',
    })
    const gate = await defs.find((tool) => tool.name === 'team_steering_gate_create')!.handler({
      id: 'gate-big', opId: 'big-gate', targetType: 'task', targetId: 'task-1', trigger: 'budget', reason: 'Review', impact: 'high', budgetSnapshot: 'x'.repeat(20_000), recommendedAction: 'stop',
    })
    expect(handoff.isError).toBe(true)
    expect(gate.isError).toBe(true)
    expect((db.raw.prepare('SELECT COUNT(*) AS count FROM team_handoff_events').get() as { count: number }).count).toBe(0)
    expect((db.raw.prepare('SELECT COUNT(*) AS count FROM team_steering_gate_events').get() as { count: number }).count).toBe(0)
  })

  it('generates bounded operation ids when callers omit opId', async () => {
    const adapter = new TeamP1RuntimeAdapter(db, { sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent' })
    const create = adapter.buildToolDefinitions().find((tool) => tool.name === 'team_handoff_create')!
    const base = { recipientId: 'agent-b', purpose: 'Review', inputs: { file: 'a' }, expectedOutput: 'Notes', acceptanceCriteria: ['done'], sensitivity: 'internal' }
    const first = await create.handler({ id: 'handoff-1', ...base })
    const second = await create.handler({ id: 'handoff-2', ...base })
    expect(first.isError).not.toBe(true)
    expect(second.isError).not.toBe(true)
    expect((db.raw.prepare('SELECT COUNT(DISTINCT op_id) AS count FROM team_handoff_events').get() as { count: number }).count).toBe(2)
  })

  it('rejects an operation id outside the bounded schema', async () => {
    const adapter = new TeamP1RuntimeAdapter(db, { sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent' })
    const create = adapter.buildToolDefinitions().find((tool) => tool.name === 'team_handoff_create')!
    const result = await create.handler({
      id: 'handoff-long-op', opId: 'x'.repeat(161), recipientId: 'agent-b', purpose: 'Review', inputs: {},
      expectedOutput: 'Notes', acceptanceCriteria: [], sensitivity: 'internal',
    })
    expect(result.isError).toBe(true)
    expect((db.raw.prepare('SELECT COUNT(*) AS count FROM team_handoff_events').get() as { count: number }).count).toBe(0)
  })
})
