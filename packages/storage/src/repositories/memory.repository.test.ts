/**
 * @module memory.repository.test
 *
 * 单元测试：MemoryRepository CRUD 操作
 * 使用内存数据库 + 临时目录
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '../database.js'
import { MemoryRepository } from './memory.repository.js'
import type { MemoryEntryRow, MemoryEntryInsert } from './memory.repository.js'
import { join } from 'path'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

describe('MemoryRepository', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-memory-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')
    db = new SparkDatabase(dbPath)
    db.runMigrations(migrationsDir)
    repo = new MemoryRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  function makeEntry(overrides: Partial<MemoryEntryRow> = {}): MemoryEntryInsert {
    return {
      id: 'usr_test001',
      scope: 'user',
      scope_ref: null,
      type: 'feedback',
      name: 'test-memory',
      description: 'Test memory entry',
      file_path: join(testDir, 'usr_test001.md'),
      confidence: 0.9,
      hit_count: 0,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
      ...overrides,
    }
  }

  describe('insert', () => {
    it('should insert a new memory entry with auto-set timestamps', () => {
      const before = Date.now()
      const row = repo.insert(makeEntry())
      const after = Date.now()

      expect(row.id).toBe('usr_test001')
      expect(row.scope).toBe('user')
      expect(row.type).toBe('feedback')
      expect(row.created_at).toBeGreaterThanOrEqual(before)
      expect(row.created_at).toBeLessThanOrEqual(after)
      expect(row.updated_at).toBe(row.created_at)
    })

    it('should insert entries for all scope types', () => {
      const user = repo.insert(makeEntry({ id: 'usr_001', scope: 'user', scope_ref: null }))
      expect(user.scope).toBe('user')
      expect(user.scope_ref).toBeNull()

      const project = repo.insert(makeEntry({
        id: 'prj_001', scope: 'project', scope_ref: 'ws-123',
        name: 'project-mem', file_path: join(testDir, 'prj_001.md'),
      }))
      expect(project.scope).toBe('project')
      expect(project.scope_ref).toBe('ws-123')

      const agent = repo.insert(makeEntry({
        id: 'agt_001', scope: 'agent', scope_ref: 'agent-456',
        name: 'agent-mem', file_path: join(testDir, 'agt_001.md'),
      }))
      expect(agent.scope).toBe('agent')
      expect(agent.scope_ref).toBe('agent-456')
    })
  })

  describe('getById', () => {
    it('should return entry by id', () => {
      repo.insert(makeEntry())
      const row = repo.getById('usr_test001')
      expect(row).not.toBeNull()
      expect(row!.name).toBe('test-memory')
    })

    it('should return null for non-existent id', () => {
      expect(repo.getById('nonexistent')).toBeNull()
    })
  })

  describe('findByName', () => {
    it('should find non-archived entry by scope + name', () => {
      repo.insert(makeEntry())
      const row = repo.findByName('user', null, 'test-memory')
      expect(row).not.toBeNull()
      expect(row!.id).toBe('usr_test001')
    })

    it('should return null for archived entries', () => {
      repo.insert(makeEntry())
      repo.archive('usr_test001')
      expect(repo.findByName('user', null, 'test-memory')).toBeNull()
    })

    it('should return null for wrong scope_ref', () => {
      repo.insert(makeEntry({ scope_ref: 'ws-123' }))
      expect(repo.findByName('user', null, 'test-memory')).toBeNull()
    })
  })

  describe('update', () => {
    it('should update specified fields and refresh updated_at', () => {
      repo.insert(makeEntry())
      const before = Date.now()
      const updated = repo.update('usr_test001', { description: 'Updated desc', confidence: 0.7 })
      expect(updated.description).toBe('Updated desc')
      expect(updated.confidence).toBe(0.7)
      expect(updated.updated_at).toBeGreaterThanOrEqual(before)
    })

    it('should throw for non-existent id', () => {
      expect(() => repo.update('nonexistent', { description: 'x' })).toThrow('Memory entry not found')
    })
  })

  describe('listByScope', () => {
    beforeEach(() => {
      repo.insert(makeEntry({ id: 'usr_001', name: 'mem-1', type: 'feedback', file_path: join(testDir, 'usr_001.md') }))
      repo.insert(makeEntry({ id: 'usr_002', name: 'mem-2', type: 'user', file_path: join(testDir, 'usr_002.md') }))
      repo.insert(makeEntry({
        id: 'prj_001', scope: 'project', scope_ref: 'ws-123',
        name: 'mem-3', file_path: join(testDir, 'prj_001.md'),
      }))
    })

    it('should list entries by scope', () => {
      const userEntries = repo.listByScope('user', null)
      expect(userEntries).toHaveLength(2)
    })

    it('should filter by type', () => {
      const feedback = repo.listByScope('user', null, { type: 'feedback' })
      expect(feedback).toHaveLength(1)
      expect(feedback[0]!.type).toBe('feedback')
    })

    it('should exclude archived by default', () => {
      repo.archive('usr_001')
      const entries = repo.listByScope('user', null)
      expect(entries).toHaveLength(1)
      expect(entries[0]!.id).toBe('usr_002')
    })

    it('should include archived when requested', () => {
      repo.archive('usr_001')
      const entries = repo.listByScope('user', null, { includeArchived: true })
      expect(entries).toHaveLength(2)
    })

    it('should return empty for different scope_ref', () => {
      const entries = repo.listByScope('project', 'ws-456')
      expect(entries).toHaveLength(0)
    })

    it('should list all project entries when requested without a scope_ref filter', () => {
      repo.insert(makeEntry({
        id: 'prj_002', scope: 'project', scope_ref: 'ws-456',
        name: 'mem-4', file_path: join(testDir, 'prj_002.md'),
      }))

      const entries = repo.listByScope('project', null, { matchAnyScopeRef: true })
      // 不依赖顺序（同毫秒插入时 updated_at 相同，ORDER BY DESC 顺序不稳定），只验证都返回
      expect(entries.map((entry) => entry.id).sort()).toEqual(['prj_001', 'prj_002'])
    })

    it('should keep exact user scope semantics even when all-refs browsing is requested', () => {
      const entries = repo.listByScope('user', null, { matchAnyScopeRef: true })
      expect(entries).toHaveLength(2)
      expect(entries.every((entry) => entry.scope_ref === null)).toBe(true)
    })
  })

  describe('bumpHit', () => {
    it('should increment hit_count and update last_hit_at', () => {
      repo.insert(makeEntry())
      const before = Date.now()
      repo.bumpHit('usr_test001')
      const row = repo.getById('usr_test001')!
      expect(row.hit_count).toBe(1)
      expect(row.last_hit_at).toBeGreaterThanOrEqual(before)
    })

    it('should increment multiple times', () => {
      repo.insert(makeEntry())
      repo.bumpHit('usr_test001')
      repo.bumpHit('usr_test001')
      repo.bumpHit('usr_test001')
      expect(repo.getById('usr_test001')!.hit_count).toBe(3)
    })
  })

  describe('archive', () => {
    it('should soft-delete an entry', () => {
      repo.insert(makeEntry())
      repo.archive('usr_test001')
      const row = repo.getById('usr_test001')!
      expect(row.archived).toBe(1)
    })
  })

  describe('delete', () => {
    it('should permanently remove an entry', () => {
      repo.insert(makeEntry())
      repo.delete('usr_test001')
      expect(repo.getById('usr_test001')).toBeNull()
    })
  })

  describe('countByScope', () => {
    it('should count non-archived entries', () => {
      repo.insert(makeEntry({ id: 'usr_001', name: 'mem-1', file_path: join(testDir, 'usr_001.md') }))
      repo.insert(makeEntry({ id: 'usr_002', name: 'mem-2', file_path: join(testDir, 'usr_002.md') }))
      expect(repo.countByScope('user', null)).toBe(2)
    })

    it('should exclude archived', () => {
      repo.insert(makeEntry({ id: 'usr_001', name: 'mem-1', file_path: join(testDir, 'usr_001.md') }))
      repo.insert(makeEntry({ id: 'usr_002', name: 'mem-2', file_path: join(testDir, 'usr_002.md') }))
      repo.archive('usr_001')
      expect(repo.countByScope('user', null)).toBe(1)
    })
  })

  describe('findEvictionCandidates', () => {
    it('should return entries ordered by score ASC', () => {
      // Low score: low hit_count, low confidence
      repo.insert(makeEntry({
        id: 'usr_001', name: 'low-score',
        confidence: 0.6, hit_count: 0, file_path: join(testDir, 'usr_001.md'),
      }))
      // High score: high hit_count, high confidence
      repo.insert(makeEntry({
        id: 'usr_002', name: 'high-score',
        confidence: 1.0, hit_count: 10, file_path: join(testDir, 'usr_002.md'),
      }))

      const candidates = repo.findEvictionCandidates('user', null, 2)
      expect(candidates).toHaveLength(2)
      expect(candidates[0]!.name).toBe('low-score')
    })

    it('should respect limit', () => {
      repo.insert(makeEntry({ id: 'usr_001', name: 'mem-1', file_path: join(testDir, 'usr_001.md') }))
      repo.insert(makeEntry({ id: 'usr_002', name: 'mem-2', file_path: join(testDir, 'usr_002.md') }))
      repo.insert(makeEntry({ id: 'usr_003', name: 'mem-3', file_path: join(testDir, 'usr_003.md') }))

      const candidates = repo.findEvictionCandidates('user', null, 1)
      expect(candidates).toHaveLength(1)
    })
  })
})
