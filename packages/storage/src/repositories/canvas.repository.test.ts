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

describe('CanvasProjectRepository.cover_url', () => {
  let db: SparkDatabase
  let projects: CanvasProjectRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-canvas-cover-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    projects = new CanvasProjectRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('defaults to null when coverUrl not provided', () => {
    projects.upsert({ id: 'cover-default', title: 'no cover' })
    const row = projects.get('cover-default')
    expect(row?.cover_url).toBeNull()
  })

  it('persists coverUrl on upsert', () => {
    projects.upsert({
      id: 'cover-set',
      title: 'with cover',
      coverUrl: 'safe-file://x/abc',
    })
    const row = projects.get('cover-set')
    expect(row?.cover_url).toBe('safe-file://x/abc')
  })

  it('updates coverUrl when upsert provides a new value', () => {
    projects.upsert({ id: 'cover-update', title: 't', coverUrl: 'safe-file://x/a' })
    projects.upsert({ id: 'cover-update', title: 't', coverUrl: 'safe-file://x/b' })
    const row = projects.get('cover-update')
    expect(row?.cover_url).toBe('safe-file://x/b')
  })

  it('clears coverUrl when upsert passes null', () => {
    projects.upsert({ id: 'cover-clear', title: 't', coverUrl: 'safe-file://x/a' })
    projects.upsert({ id: 'cover-clear', title: 't', coverUrl: null })
    const row = projects.get('cover-clear')
    expect(row?.cover_url).toBeNull()
  })

  it('preserves existing coverUrl when upsert omits the field', () => {
    projects.upsert({ id: 'cover-keep', title: 't', coverUrl: 'safe-file://x/a' })
    projects.upsert({ id: 'cover-keep', title: 't2' })
    const row = projects.get('cover-keep')
    expect(row?.title).toBe('t2')
    expect(row?.cover_url).toBe('safe-file://x/a')
  })

  it('list returns cover_url for each row', () => {
    projects.upsert({ id: 'list-a', title: 'A', coverUrl: 'safe-file://x/a' })
    projects.upsert({ id: 'list-b', title: 'B' })
    const rows = projects.list(0)
    const map = new Map(rows.map((r) => [r.id, r]))
    expect(map.get('list-a')?.cover_url).toBe('safe-file://x/a')
    expect(map.get('list-b')?.cover_url).toBeNull()
  })
})

describe('CanvasProjectRepository.pinned', () => {
  let db: SparkDatabase
  let projects: CanvasProjectRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-test-canvas-pin-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    projects = new CanvasProjectRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('defaults to unpinned (pinned=0, pinned_at=null) when not provided', () => {
    projects.upsert({ id: 'pin-default', title: 'no pin' })
    const row = projects.get('pin-default')
    expect(row?.pinned).toBe(0)
    expect(row?.pinned_at).toBeNull()
  })

  it('sets pinned=1 and pinned_at when pinned=true', () => {
    projects.upsert({ id: 'pin-set', title: 't', pinned: true })
    const row = projects.get('pin-set')
    expect(row?.pinned).toBe(1)
    expect(row?.pinned_at).not.toBeNull()
  })

  it('clears pinned_at when pinned=false after being pinned', () => {
    projects.upsert({ id: 'pin-toggle', title: 't', pinned: true, pinnedAt: '2026-01-01T00:00:00Z' })
    projects.upsert({ id: 'pin-toggle', title: 't', pinned: false })
    const row = projects.get('pin-toggle')
    expect(row?.pinned).toBe(0)
    expect(row?.pinned_at).toBeNull()
  })

  it('preserves pinned state when upsert omits the field', () => {
    projects.upsert({ id: 'pin-keep', title: 't', pinned: true, pinnedAt: '2026-01-01T00:00:00Z' })
    projects.upsert({ id: 'pin-keep', title: 't2' })
    const row = projects.get('pin-keep')
    expect(row?.title).toBe('t2')
    expect(row?.pinned).toBe(1)
    expect(row?.pinned_at).toBe('2026-01-01T00:00:00Z')
  })

  it('orders pinned projects before unpinned ones in list()', () => {
    projects.upsert({ id: 'a', title: 'A' })
    projects.upsert({ id: 'b', title: 'B', pinned: true })
    projects.upsert({ id: 'c', title: 'C' })
    const rows = projects.list(0)
    const ids = rows.map((r) => r.id)
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('a'))
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'))
  })
})
