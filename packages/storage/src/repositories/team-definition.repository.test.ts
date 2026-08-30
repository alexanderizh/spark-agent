import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { SparkDatabase } from '../database.js'
import { TeamDefinitionRepository } from './team-definition.repository.js'

function createTestDb(testDir: string): SparkDatabase {
  const dbPath = join(testDir, 'test.db')
  const migrationsDir = join(process.cwd(), 'migrations')
  const db = new SparkDatabase(dbPath)
  db.runMigrations(migrationsDir)
  return db
}

describe('TeamDefinitionRepository', () => {
  let db: SparkDatabase
  let repo: TeamDefinitionRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-test-team-definition-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    repo = new TeamDefinitionRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('persists discussion settings with defaults on create', () => {
    const created = repo.create({
      id: 'team-custom',
      name: 'Custom Team',
      hostAgentId: 'dev-agent',
      memberAgentIds: ['qa-agent'],
    })

    expect(created.maxDiscussionRounds).toBe(6)
    expect(created.enablePeerMessaging).toBe(false)

    const stored = repo.get('team-custom')
    expect(stored?.maxDiscussionRounds).toBe(6)
    expect(stored?.enablePeerMessaging).toBe(false)
  })

  it('updates discussion settings and returns them from list/get', () => {
    repo.create({
      id: 'team-custom',
      name: 'Custom Team',
      hostAgentId: 'dev-agent',
      memberAgentIds: ['qa-agent'],
    })

    const updated = repo.update('team-custom', {
      maxDiscussionRounds: 12,
      enablePeerMessaging: true,
    })

    expect(updated?.maxDiscussionRounds).toBe(12)
    expect(updated?.enablePeerMessaging).toBe(true)

    const listed = repo.list({ includeDisabled: true }).find((team) => team.id === 'team-custom')
    expect(listed?.maxDiscussionRounds).toBe(12)
    expect(listed?.enablePeerMessaging).toBe(true)
  })
})
