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
    testDir = join(
      tmpdir(),
      `spark-test-workflow-run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    sessions = new SessionRepository(db)
    repo = new WorkflowRunRepository(db)
    sessions.create({
      id: 'sess-1',
      kind: 'chat',
      title: 'Workflow Session',
      status: 'idle',
      projectId: 'proj-1',
    })
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
      executions: [
        {
          nodeId: 'plan',
          agentId: 'planner',
          instruction: 'plan',
          inputs: {},
          attempt: 1,
          state: 'completed',
          content: 'ready',
        },
      ],
      atomicExecutions: [],
      completedNodeIds: ['plan'],
      skippedNodeIds: ['quick-path'],
    })
    expect(working?.status).toBe('working')
    expect(working?.completed_node_ids_json).toBe(JSON.stringify(['plan']))
    expect(working?.skipped_node_ids_json).toBe(JSON.stringify(['quick-path']))
    expect(JSON.parse(working!.state_json)).toEqual({ plan: 'ready' })

    const completed = repo.updateSnapshot('run-1', {
      status: 'completed',
      state: { plan: 'ready' },
      executions: [],
      atomicExecutions: [],
      completedNodeIds: ['plan'],
      skippedNodeIds: ['quick-path'],
      endedAt: '2026-06-30T00:00:00.000Z',
    })
    expect(completed?.status).toBe('completed')
    expect(completed?.ended_at).toBe('2026-06-30T00:00:00.000Z')
    expect(repo.findLatestResumable('sess-1', 'workflow-1')).toBeNull()
  })

  it('lists run summaries by workflow, newest first, without heavy JSON columns', () => {
    for (const id of ['run-old', 'run-new', 'run-other-workflow']) {
      const workflowId = id === 'run-other-workflow' ? 'workflow-2' : 'workflow-1'
      repo.create({
        id,
        sessionId: 'sess-1',
        turnId: `turn-${id}`,
        workflowId,
        objective: `objective ${id}`,
        graph: { nodes: [{ id: 'n1', kind: 'agent', title: 'n1', config: {} }], edges: [] },
      })
    }
    repo.updateSnapshot('run-new', {
      status: 'failed',
      state: {},
      executions: [],
      atomicExecutions: [],
      completedNodeIds: ['n1'],
      failedNode: {
        nodeId: 'n2',
        agentId: 'worker',
        attempt: 2,
        error: { code: 'boom', message: 'exploded' },
      },
    })

    const rows = repo.listByWorkflow('workflow-1')
    expect(rows.map((row) => row.id)).toEqual(['run-new', 'run-old'])
    const newest = rows[0]!
    expect(newest.status).toBe('failed')
    expect(newest.failed_node_json).toContain('n2')
    // 轻量行不含四个重负载 JSON 列（graph/state/executions/atomic）。
    expect(newest).not.toHaveProperty('graph_json')
    expect(newest).not.toHaveProperty('state_json')
    expect(newest).not.toHaveProperty('executions_json')
    expect(newest).not.toHaveProperty('atomic_executions_json')
    // limit 生效：只取最新 1 条。
    expect(repo.listByWorkflow('workflow-1', 1).map((row) => row.id)).toEqual(['run-new'])
    // 其他工作流隔离。
    expect(repo.listByWorkflow('workflow-2').map((row) => row.id)).toEqual(['run-other-workflow'])
    expect(repo.listByWorkflow('workflow-unknown')).toEqual([])
  })

  it('finds a working run without depending on the bounded history list', () => {
    repo.create({
      id: 'run-working-old',
      sessionId: 'sess-1',
      turnId: 'turn-working-old',
      workflowId: 'workflow-crowded',
      objective: 'still running',
      graph: { nodes: [], edges: [] },
    })
    for (let index = 0; index < 31; index += 1) {
      const id = `run-completed-${index}`
      repo.create({
        id,
        sessionId: 'sess-1',
        turnId: `turn-completed-${index}`,
        workflowId: 'workflow-crowded',
        objective: `completed ${index}`,
        graph: { nodes: [], edges: [] },
      })
      repo.updateSnapshot(id, {
        status: 'completed',
        state: {},
        executions: [],
        atomicExecutions: [],
        completedNodeIds: [],
      })
    }

    expect(repo.listByWorkflow('workflow-crowded', 30)).not.toContainEqual(
      expect.objectContaining({ id: 'run-working-old' }),
    )
    expect(repo.findWorkingByWorkflow('workflow-crowded')?.id).toBe('run-working-old')
    expect(repo.findWorkingByWorkflow('workflow-unknown')).toBeNull()
  })
})
