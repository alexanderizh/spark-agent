import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '../database.js'
import { SessionRepository } from './session.repository.js'
import { GoalRepository } from './goal.repository.js'

function createTestDb(testDir: string): SparkDatabase {
  const dbPath = join(testDir, 'test.db')
  const migrationsDir = join(process.cwd(), 'migrations')
  const db = new SparkDatabase(dbPath)
  db.runMigrations(migrationsDir)
  return db
}

describe('GoalRepository', () => {
  let db: SparkDatabase
  let repo: GoalRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-goal-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    new SessionRepository(db).create({ id: 'sess-goal', kind: 'agent', title: 'Goal', status: 'idle', projectId: 'default' })
    repo = new GoalRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('creates, progresses, pauses, resumes, and clears a current goal', () => {
    const goal = repo.createOrReplaceActiveGoal({
      sessionId: 'sess-goal',
      objective: 'Ship Spark-managed goals',
      successCriteria: ['Goal state is persisted'],
      validation: { commands: ['pnpm test'] },
      budget: { maxIterations: 3 },
    })

    expect(goal.status).toBe('active')
    expect(repo.getCurrent('sess-goal')?.id).toBe(goal.id)

    const progressed = repo.appendProgress(goal.id, {
      iteration: 1,
      phase: 'validate',
      status: 'continue',
      summary: 'Validation started',
    })
    expect(progressed?.progressLog).toHaveLength(1)

    expect(repo.updateStatus(goal.id, 'paused')?.status).toBe('paused')
    expect(repo.updateStatus(goal.id, 'active')?.status).toBe('active')
    expect(repo.clearCurrent('sess-goal')?.status).toBe('cleared')
    expect(repo.getCurrent('sess-goal')).toBeNull()
  })

  it('replaces an existing active goal when a new goal is created', () => {
    const first = repo.createOrReplaceActiveGoal({ sessionId: 'sess-goal', objective: 'first' })
    const second = repo.createOrReplaceActiveGoal({ sessionId: 'sess-goal', objective: 'second' })

    expect(second.id).not.toBe(first.id)
    expect(repo.get(first.id)?.status).toBe('cleared')
    expect(repo.getCurrent('sess-goal')?.objective).toBe('second')
  })

  it('updateContract fills successCriteria/constraints/validation and keeps the same goal id', () => {
    new SessionRepository(db).create({ id: 's1', kind: 'agent', title: 'S1', status: 'idle', projectId: 'default' })
    const goal = repo.createOrReplaceActiveGoal({ sessionId: 's1', objective: 'do X' })
    const updated = repo.updateContract(goal.id, {
      successCriteria: ['X 可运行', 'X 有测试'],
      constraints: ['不改公共 API'],
      validation: { commands: ['pnpm test'] },
    })
    expect(updated?.id).toBe(goal.id)
    expect(updated?.successCriteria).toEqual(['X 可运行', 'X 有测试'])
    expect(updated?.constraints).toEqual(['不改公共 API'])
    expect(updated?.validation.commands).toEqual(['pnpm test'])
  })

  it("supports 'pending_contract' status via updateStatus", () => {
    new SessionRepository(db).create({ id: 's2', kind: 'agent', title: 'S2', status: 'idle', projectId: 'default' })
    const goal = repo.createOrReplaceActiveGoal({ sessionId: 's2', objective: 'do Y' })
    const updated = repo.updateStatus(goal.id, 'pending_contract')
    expect(updated?.status).toBe('pending_contract')
    expect(repo.getCurrent('s2')?.id).toBe(goal.id)
  })
})
