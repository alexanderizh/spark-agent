import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from './database.js'
import { TaskGraphService, TaskGraphConflictError } from './task-graph.service.js'

describe('TaskGraphService', () => {
  let db: SparkDatabase
  let dir: string
  const scope = { sessionId: '11111111-1111-4111-8111-111111111111', roomId: 'team-room:11111111-1111-4111-8111-111111111111', discussionId: 'discussion-1', actorId: 'host' }

  beforeEach(() => {
    dir = join(tmpdir(), `spark-task-graph-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
  })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

  it('creates versioned nodes and dependency edges, then releases dependent work', () => {
    const service = TaskGraphService.forSystem(db, scope)
    service.createNode({ id: 'a', title: 'Collect evidence', opId: 'op-a' })
    service.createNode({ id: 'b', title: 'Write outcome', opId: 'op-b' })
    service.createEdge({ id: 'edge-a-b', fromNodeId: 'a', toNodeId: 'b', type: 'dependency', opId: 'op-edge' })
    expect(service.snapshot().nodes.find((node) => node.id === 'b')?.status).toBe('blocked')
    service.transition({ id: 'a', expectedVersion: 1, status: 'completed', opId: 'op-complete' })
    expect(service.snapshot().nodes.find((node) => node.id === 'b')?.status).toBe('ready')
  })

  it('propagates failed dependencies and supports retry/reassign with CAS', () => {
    const service = TaskGraphService.forUser(db, scope)
    service.createNode({ id: 'a', title: 'Upstream', opId: 'op-a', maxRetries: 2 })
    service.createNode({ id: 'b', title: 'Downstream', opId: 'op-b' })
    service.createEdge({ id: 'edge-a-b', fromNodeId: 'a', toNodeId: 'b', opId: 'op-edge' })
    service.transition({ id: 'a', expectedVersion: 1, status: 'failed', opId: 'op-fail' })
    expect(service.snapshot().nodes.find((node) => node.id === 'b')?.status).toBe('blocked')
    const retried = service.retry({ id: 'a', expectedVersion: 2, opId: 'op-retry' })
    expect(retried.status).toBe('ready')
    const reassigned = service.reassign({ id: 'a', expectedVersion: 3, assigneeId: 'agent-b', opId: 'op-reassign' })
    expect(reassigned.assigneeId).toBe('agent-b')
    expect(() => service.transition({ id: 'a', expectedVersion: 1, status: 'running', opId: 'op-stale' })).toThrow(TaskGraphConflictError)
  })

  it('makes retries idempotent and preserves an audit event', () => {
    const service = TaskGraphService.forSystem(db, scope)
    service.createNode({ id: 'a', title: 'One', opId: 'op-a' })
    const first = service.transition({ id: 'a', expectedVersion: 1, status: 'running', opId: 'op-run' })
    const second = service.transition({ id: 'a', expectedVersion: 1, status: 'running', opId: 'op-run' })
    expect(second).toEqual(first)
    expect(service.listEvents()).toHaveLength(2)
  })

  it('rejects agent reassignment and clears all graph data with the session', () => {
    const agent = TaskGraphService.forAgent(db, scope)
    agent.createNode({ id: 'a', title: 'One', opId: 'op-a' })
    expect(() => agent.reassign({ id: 'a', expectedVersion: 1, assigneeId: 'agent-b', opId: 'op-nope' })).toThrow(TaskGraphConflictError)
    expect(TaskGraphService.deleteBySession(db, scope.sessionId)).toBeGreaterThan(0)
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM task_graph_nodes WHERE session_id = ?').get(scope.sessionId)).toEqual({ count: 0 })
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM task_graph_events WHERE session_id = ?').get(scope.sessionId)).toEqual({ count: 0 })
  })
})
