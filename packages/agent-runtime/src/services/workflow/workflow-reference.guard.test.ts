import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  SessionRepository,
  SessionWorkflowBindingRepository,
  SparkDatabase,
  WorkflowRepository,
  WorkflowRunRepository,
} from '@spark/storage'
import { inspectWorkflowReferences } from './workflow-reference.guard.js'

describe('inspectWorkflowReferences', () => {
  let db: SparkDatabase

  beforeEach(() => {
    db = new SparkDatabase(':memory:')
    db.runMigrations(fileURLToPath(new URL('../../../../storage/migrations', import.meta.url)))
    new SessionRepository(db).create({
      id: 'session-a',
      kind: 'chat',
      title: 'A',
      status: 'idle',
      projectId: 'p',
    })
    new WorkflowRepository(db).create({ id: 'wf-a', name: 'A', status: 'active' })
  })

  afterEach(() => db.close())

  it('reports no blockers for an unreferenced workflow', () => {
    expect(inspectWorkflowReferences(db, 'wf-a')).toEqual([])
    expect(inspectWorkflowReferences(db, 'wf-missing')).toEqual([])
  })

  it('blocks deletion while sessions still bind the workflow', () => {
    new SessionWorkflowBindingRepository(db).create({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: 'wf-a',
    })

    expect(inspectWorkflowReferences(db, 'wf-a')).toEqual([
      { code: 'workflow_referenced_by_bindings', sessionIds: ['session-a'] },
    ])
  })

  it('blocks deletion while a run of the workflow is working, even without bindings', () => {
    const runs = new WorkflowRunRepository(db)
    runs.create({
      id: 'run-working',
      sessionId: 'session-a',
      turnId: 'turn-1',
      workflowId: 'wf-a',
      objective: 'live',
      graph: { nodes: [], edges: [] },
    })

    expect(inspectWorkflowReferences(db, 'wf-a')).toEqual([
      { code: 'workflow_run_working', runIds: ['run-working'] },
    ])

    runs.updateSnapshot('run-working', {
      status: 'completed',
      state: {},
      executions: [],
      atomicExecutions: [],
      completedNodeIds: [],
    })
    expect(inspectWorkflowReferences(db, 'wf-a')).toEqual([])
  })
})
