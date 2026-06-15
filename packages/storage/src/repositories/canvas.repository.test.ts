import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SparkDatabase } from '../database.js'
import { CanvasProjectRepository, CanvasSnapshotRepository } from './canvas.repository.js'

function createTestDb(testDir: string): SparkDatabase {
  const dbPath = join(testDir, 'test.db')
  const migrationsDir = join(process.cwd(), 'migrations')
  const db = new SparkDatabase(dbPath)
  db.runMigrations(migrationsDir)
  return db
}

describe('CanvasSnapshotRepository', () => {
  let db: SparkDatabase
  let projects: CanvasProjectRepository
  let snapshots: CanvasSnapshotRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-canvas-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    projects = new CanvasProjectRepository(db)
    snapshots = new CanvasSnapshotRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('loads snapshot rows by project_id', () => {
    projects.upsert({
      id: 'canvas-project-1',
      title: 'Canvas Project 1',
    })
    snapshots.save('canvas-project-1', 0, '{"project":{"id":"canvas-project-1"}}')

    const row = snapshots.get('canvas-project-1')

    expect(row).not.toBeNull()
    expect(row?.project_id).toBe('canvas-project-1')
    expect(row?.snapshot_json).toContain('canvas-project-1')
  })
})
