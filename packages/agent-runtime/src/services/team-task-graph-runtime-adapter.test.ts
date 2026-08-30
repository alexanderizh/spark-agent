import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '@spark/storage'
import { TeamTaskGraphRuntimeAdapter } from './team-task-graph-runtime-adapter.js'

describe('TeamTaskGraphRuntimeAdapter', () => {
  let db: SparkDatabase
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `spark-team-task-graph-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('derives team scope from trusted context and never exposes scope arguments', async () => {
    const adapter = new TeamTaskGraphRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'member-a', capability: 'agent',
    })
    const defs = adapter.buildToolDefinitions()
    for (const definition of defs) {
      expect(definition.schema).not.toHaveProperty('sessionId')
      expect(definition.schema).not.toHaveProperty('roomId')
      expect(definition.schema).not.toHaveProperty('discussionId')
    }

    const create = defs.find((definition) => definition.name === 'team_task_graph_create_node')!
    const result = await create.handler({ id: 'node-a', title: 'Scoped task', sessionId: 'other', discussionId: 'other' })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('other')
  })

  it('supports the complete DAG tool slice and propagates dependency state', async () => {
    const adapter = new TeamTaskGraphRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'host', capability: 'system',
    })
    const defs = adapter.buildToolDefinitions()
    expect(defs.map((definition) => definition.name)).toEqual([
      'team_task_graph_read', 'team_task_graph_create_node', 'team_task_graph_add_edge',
      'team_task_graph_start', 'team_task_graph_complete', 'team_task_graph_fail',
      'team_task_graph_retry', 'team_task_graph_reassign',
    ])

    const tool = (name: string) => defs.find((definition) => definition.name === name)!
    await tool('team_task_graph_create_node').handler({ id: 'upstream', title: 'Upstream', maxRetries: 1, opId: 'create-upstream' })
    await tool('team_task_graph_create_node').handler({ id: 'downstream', title: 'Downstream', opId: 'create-downstream' })
    const edge = await tool('team_task_graph_add_edge').handler({ id: 'upstream-downstream', fromNodeId: 'upstream', toNodeId: 'downstream', opId: 'edge-1' })
    expect(edge.isError).not.toBe(true)
    const blocked = await tool('team_task_graph_read').handler({})
    expect(JSON.stringify(blocked)).toContain('"status":"blocked"')

    const started = await tool('team_task_graph_start').handler({ id: 'upstream', expectedVersion: 1, opId: 'start-1' })
    expect(started.isError).not.toBe(true)
    const completed = await tool('team_task_graph_complete').handler({ id: 'upstream', expectedVersion: 2, outputs: { artifact: 'ok' }, opId: 'complete-1' })
    expect(completed.isError).not.toBe(true)
    const released = await tool('team_task_graph_read').handler({})
    expect(JSON.stringify(released)).toContain('"status":"ready"')

    const failed = await tool('team_task_graph_fail').handler({ id: 'downstream', expectedVersion: 2, outputs: { error: 'temporary' }, opId: 'fail-1' })
    expect(failed.isError).toBe(true)
    const read = await tool('team_task_graph_read').handler({})
    expect(read.isError).not.toBe(true)
    expect(JSON.stringify(read)).toContain('"status":"ready"')
  })

  it('keeps mutation idempotency and maps CAS conflicts to MCP errors', async () => {
    const adapter = new TeamTaskGraphRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'host', capability: 'system',
    })
    const defs = adapter.buildToolDefinitions()
    const create = defs.find((definition) => definition.name === 'team_task_graph_create_node')!
    const first = await create.handler({ id: 'node-a', title: 'One', opId: 'same-op' })
    const second = await create.handler({ id: 'node-a', title: 'One', opId: 'same-op' })
    expect(second).toEqual(first)

    const start = defs.find((definition) => definition.name === 'team_task_graph_start')!
    const stale = await start.handler({ id: 'node-a', expectedVersion: 1, opId: 'stale-op' })
    expect(stale.isError).not.toBe(true)
    const conflict = await start.handler({ id: 'node-a', expectedVersion: 1, opId: 'new-op' })
    expect(conflict.isError).toBe(true)
    expect(JSON.stringify(conflict)).toContain('Expected version')
  })

  it('does not expose reassignment to agents and rejects unsafe payloads before persistence', async () => {
    const adapter = new TeamTaskGraphRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'member-a', capability: 'agent',
    })
    const defs = adapter.buildToolDefinitions()
    expect(defs.find((definition) => definition.name === 'team_task_graph_reassign')).toBeUndefined()

    const create = defs.find((definition) => definition.name === 'team_task_graph_create_node')!
    const oversized = await create.handler({ id: 'too-big', title: 'Too big', inputs: 'x'.repeat(20_000) })
    expect(oversized.isError).toBe(true)

    const deep: Record<string, unknown> = {}
    let cursor = deep
    for (let index = 0; index < 12; index += 1) {
      cursor.child = {}
      cursor = cursor.child as Record<string, unknown>
    }
    const deeplyNested = await create.handler({ id: 'too-deep', title: 'Too deep', inputs: deep })
    expect(deeplyNested.isError).toBe(true)
    const unknownField = await create.handler({ id: 'unknown', title: 'Unknown', roomId: 'forged' })
    expect(unknownField.isError).toBe(true)
  })

  it('allows user/system reassignment with CAS and keeps it in the audit-backed service', async () => {
    const adapter = new TeamTaskGraphRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'host', capability: 'user',
    })
    const defs = adapter.buildToolDefinitions()
    const create = defs.find((definition) => definition.name === 'team_task_graph_create_node')!
    await create.handler({ id: 'node-a', title: 'Assignable', opId: 'create-1' })
    const reassign = defs.find((definition) => definition.name === 'team_task_graph_reassign')!
    const result = await reassign.handler({ id: 'node-a', expectedVersion: 1, assigneeId: 'agent-b', opId: 'assign-1' })
    expect(result.isError).not.toBe(true)
    expect(JSON.stringify(result)).toContain('agent-b')
  })
})
