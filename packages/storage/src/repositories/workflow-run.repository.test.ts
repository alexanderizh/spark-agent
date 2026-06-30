import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '../database.js'
import { SessionRepository } from './session.repository.js'
import { WorkflowRunRepository } from './workflow-run.repository.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

function createTestDb(testDir: string): SparkDatabase {
  const dbPath = join(testDir, 'test.db')
  const migrationsDir = join(process.cwd(), 'migrations')
  const db = new SparkDatabase(dbPath)
  db.runMigrations(migrationsDir)
  return db
}

describe('WorkflowRunRepository', () => {
  let db: SparkDatabase
  let sessions: SessionRepository
  let repo: WorkflowRunRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-workflow-run-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    sessions = new SessionRepository(db)
    repo = new WorkflowRunRepository(db)
    sessions.create({ id: 'sess-1', kind: 'chat', title: 'Workflow Session', status: 'idle', projectId: 'proj-1' })
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('creates a working run and finds it as the latest resumable run', () => {
    const row = repo.create({
      id: 'run-1',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      workflowId: 'workflow-1',
      objective: 'ship the orchestration workflow',
      graph: { nodes: [], edges: [] },
    })

    expect(row.id).toBe('run-1')
    expect(row.status).toBe('working')
    expect(row.objective).toBe('ship the orchestration workflow')
    expect(repo.findLatestResumable('sess-1', 'workflow-1')?.id).toBe('run-1')
  })

  it('persists progress snapshots and hides terminal runs from resume lookup', () => {
    repo.create({
      id: 'run-1',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      workflowId: 'workflow-1',
      objective: 'ship',
      graph: { nodes: [], edges: [] },
    })

    const working = repo.updateSnapshot('run-1', {
      status: 'working',
      state: { plan: 'ready' },
      executions: [{
        nodeId: 'plan',
        agentId: 'planner',
        instruction: 'plan',
        inputs: {},
        attempt: 1,
        state: 'completed',
        content: 'ready',
      }],
      atomicExecutions: [],
      completedNodeIds: ['plan'],
    })
    expect(working?.status).toBe('working')
    expect(working?.completed_node_ids_json).toBe(JSON.stringify(['plan']))
    expect(JSON.parse(working!.state_json)).toEqual({ plan: 'ready' })

    const completed = repo.updateSnapshot('run-1', {
      status: 'completed',
      state: { plan: 'ready' },
      executions: [],
      atomicExecutions: [],
      completedNodeIds: ['plan'],
      endedAt: '2026-06-30T00:00:00.000Z',
    })
    expect(completed?.status).toBe('completed')
    expect(completed?.ended_at).toBe('2026-06-30T00:00:00.000Z')
    expect(repo.findLatestResumable('sess-1', 'workflow-1')).toBeNull()
  })
})
