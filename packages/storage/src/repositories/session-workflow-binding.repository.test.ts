import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '../database.js'
import { SessionRepository } from './session.repository.js'
import {
  SessionWorkflowBindingConflictError,
  SessionWorkflowBindingRepository,
} from './session-workflow-binding.repository.js'
import { WorkflowRepository } from './workflow.repository.js'
import { WorkflowRunRepository } from './workflow-run.repository.js'

describe('SessionWorkflowBindingRepository', () => {
  let db: SparkDatabase
  let dir: string
  let sessions: SessionRepository
  let workflows: WorkflowRepository
  let bindings: SessionWorkflowBindingRepository

  beforeEach(() => {
    dir = join(tmpdir(), `spark-session-binding-${Date.now()}-${Math.random()}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    sessions = new SessionRepository(db)
    workflows = new WorkflowRepository(db)
    bindings = new SessionWorkflowBindingRepository(db)
    sessions.create({ id: 'session-a', kind: 'chat', title: 'A', status: 'idle', projectId: 'p' })
    sessions.create({ id: 'session-b', kind: 'chat', title: 'B', status: 'idle', projectId: 'p' })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps a missing row as the legacy compatibility sentinel', () => {
    expect(bindings.get('session-a')).toBeNull()
    expect(bindings.listByWorkflow('missing')).toEqual([])
  })

  it('supports three modes and idempotent generation updates', () => {
    const workflow = workflows.create({ id: 'wf-a', name: 'A', status: 'active' })
    const first = bindings.set({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: `  ${workflow.id}  `,
    })
    expect(first.changed).toBe(true)
    expect(first.binding).toMatchObject({ mode: 'override', workflowId: 'wf-a' })

    const same = bindings.set({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: workflow.id,
      expectedBindingInstanceId: first.binding.bindingInstanceId,
    })
    expect(same.changed).toBe(false)
    expect(same.binding.bindingInstanceId).toBe(first.binding.bindingInstanceId)

    const disabled = bindings.set({
      sessionId: 'session-a',
      mode: 'disabled',
      expectedBindingInstanceId: first.binding.bindingInstanceId,
    })
    expect(disabled.changed).toBe(true)
    expect(disabled.binding.workflowId).toBeNull()
    expect(disabled.binding.bindingInstanceId).not.toBe(first.binding.bindingInstanceId)
  })

  it('rejects stale optimistic updates and invalid mode payloads', () => {
    expect(() =>
      bindings.set({ sessionId: 'session-a', mode: 'inherit', expectedBindingInstanceId: 'stale' }),
    ).toThrow(SessionWorkflowBindingConflictError)
    expect(() => bindings.set({ sessionId: 'session-a', mode: 'override' })).toThrow(
      'override binding requires a non-empty workflowId',
    )
    expect(() =>
      bindings.set({ sessionId: 'session-a', mode: 'override', workflowId: '   ' }),
    ).toThrow('override binding requires a non-empty workflowId')
    expect(() =>
      bindings.set({ sessionId: 'session-a', mode: 'disabled', workflowId: 'wf' }),
    ).toThrow('disabled binding cannot specify workflowId')
  })

  it('copies only binding configuration for a fork with a new generation', () => {
    const workflow = workflows.create({ id: 'wf-a', name: 'A', status: 'active' })
    const source = bindings.create({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: workflow.id,
    })
    const runs = new WorkflowRunRepository(db)
    runs.create({
      id: 'run-source',
      sessionId: 'session-a',
      turnId: 'turn-source',
      workflowId: workflow.id,
      objective: 'must stay with the source session',
      graph: { nodes: [], edges: [] },
      workflowBindingInstanceId: source.bindingInstanceId,
    })
    const copy = bindings.copyForFork('session-a', 'session-b')
    expect(copy).not.toBeNull()
    if (copy == null) throw new Error('expected copied binding')
    expect(copy).toMatchObject({ mode: 'override', workflowId: workflow.id })
    expect(copy.bindingInstanceId).not.toBe(source.bindingInstanceId)
    expect(runs.listBySession('session-b')).toEqual([])
    expect(
      bindings
        .listByWorkflow(workflow.id)
        .map((row) => row.sessionId)
        .sort(),
    ).toEqual(['session-a', 'session-b'])
  })

  it('does not create a binding while preparing a fork of a legacy session', () => {
    expect(bindings.copyForFork('session-a', 'session-b')).toBeNull()
    expect(bindings.get('session-b')).toBeNull()
  })

  it('adds nullable run audit columns and isolates resumable runs by generation', () => {
    const workflow = workflows.create({ id: 'wf-a', name: 'A', status: 'active' })
    const source = bindings.create({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: workflow.id,
    })
    const runs = new WorkflowRunRepository(db)
    runs.create({
      id: 'run-a',
      sessionId: 'session-a',
      turnId: 'turn-a',
      workflowId: workflow.id,
      objective: 'test',
      graph: { nodes: [] },
      workflowBindingInstanceId: source.bindingInstanceId,
      workflowGraphDigest: 'digest',
      workflowNameSnapshot: 'A',
      workflowVersionSnapshot: '1.0.0',
      bindingSource: 'session-override',
    })
    expect(runs.get('run-a')).toMatchObject({
      workflow_binding_instance_id: source.bindingInstanceId,
      workflow_graph_digest: 'digest',
      binding_source: 'session-override',
    })
    expect(runs.findLatestResumableByBinding('session-a', source.bindingInstanceId)?.id).toBe(
      'run-a',
    )
    expect(runs.findLatestResumableByBinding('session-a', 'other-generation')).toBeNull()
  })

  it('cascades binding rows when a session is deleted', () => {
    bindings.create({ sessionId: 'session-a', mode: 'inherit' })
    expect(sessions.deleteWithRelatedData('session-a')).toBe(true)
    expect(bindings.get('session-a')).toBeNull()
  })

  it('rotateGeneration keeps mode and workflow while rotating the instance id', () => {
    const workflow = workflows.create({ id: 'wf-rotate', name: 'R', status: 'active' })
    const created = bindings.create({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: workflow.id,
    })

    const rotated = bindings.rotateGeneration('session-a', created.bindingInstanceId)
    expect(rotated.bindingInstanceId).not.toBe(created.bindingInstanceId)
    expect(rotated).toMatchObject({ mode: 'override', workflowId: workflow.id })

    // 乐观锁：旧代次再次轮换必须冲突，不覆盖并发写入。
    expect(() => bindings.rotateGeneration('session-a', created.bindingInstanceId)).toThrow(
      /changed concurrently/,
    )
    // 无 Binding 行的旧路径会话同样按冲突处理，不凭空造行。
    expect(() => bindings.rotateGeneration('session-b', 'whatever')).toThrow(/changed concurrently/)
    expect(bindings.get('session-b')).toBeNull()
  })

  it('enforces session, workflow, and mode constraints in SQLite', () => {
    const workflow = workflows.create({ id: 'wf-a', name: 'A', status: 'active' })
    bindings.create({ sessionId: 'session-a', mode: 'override', workflowId: workflow.id })

    expect(() => workflows.delete(workflow.id)).toThrow()
    expect(() => bindings.create({ sessionId: 'missing', mode: 'inherit' })).toThrow()
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO session_workflow_bindings
           (session_id, binding_instance_id, mode, workflow_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('session-b', 'invalid-mode', 'disabled', workflow.id, 'now', 'now'),
    ).toThrow()
  })
})
