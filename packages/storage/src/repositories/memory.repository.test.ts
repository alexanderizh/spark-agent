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
import { MemorySearchRepository } from './memory-search.repository.js'
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

      const project = repo.insert(
        makeEntry({
          id: 'prj_001',
          scope: 'project',
          scope_ref: 'ws-123',
          name: 'project-mem',
          file_path: join(testDir, 'prj_001.md'),
        }),
      )
      expect(project.scope).toBe('project')
      expect(project.scope_ref).toBe('ws-123')

      const agent = repo.insert(
        makeEntry({
          id: 'agt_001',
          scope: 'agent',
          scope_ref: 'agent-456',
          name: 'agent-mem',
          file_path: join(testDir, 'agt_001.md'),
        }),
      )
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
      // S1A.3 起：description 变更必须带 body（fail-loud 契约）
      const updated = repo.update(
        'usr_test001',
        { description: 'Updated desc', confidence: 0.7 },
        'Updated body',
      )
      expect(updated.description).toBe('Updated desc')
      expect(updated.confidence).toBe(0.7)
      expect(updated.updated_at).toBeGreaterThanOrEqual(before)
    })

    it('should throw for non-existent id', () => {
      expect(() => repo.update('nonexistent', { description: 'x' })).toThrow(
        'Memory entry not found',
      )
    })
  })

  describe('listByScope', () => {
    beforeEach(() => {
      repo.insert(
        makeEntry({
          id: 'usr_001',
          name: 'mem-1',
          type: 'feedback',
          file_path: join(testDir, 'usr_001.md'),
        }),
      )
      repo.insert(
        makeEntry({
          id: 'usr_002',
          name: 'mem-2',
          type: 'user',
          file_path: join(testDir, 'usr_002.md'),
        }),
      )
      repo.insert(
        makeEntry({
          id: 'prj_001',
          scope: 'project',
          scope_ref: 'ws-123',
          name: 'mem-3',
          file_path: join(testDir, 'prj_001.md'),
        }),
      )
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
      repo.insert(
        makeEntry({
          id: 'prj_002',
          scope: 'project',
          scope_ref: 'ws-456',
          name: 'mem-4',
          file_path: join(testDir, 'prj_002.md'),
        }),
      )

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
      repo.insert(
        makeEntry({ id: 'usr_001', name: 'mem-1', file_path: join(testDir, 'usr_001.md') }),
      )
      repo.insert(
        makeEntry({ id: 'usr_002', name: 'mem-2', file_path: join(testDir, 'usr_002.md') }),
      )
      expect(repo.countByScope('user', null)).toBe(2)
    })

    it('should exclude archived', () => {
      repo.insert(
        makeEntry({ id: 'usr_001', name: 'mem-1', file_path: join(testDir, 'usr_001.md') }),
      )
      repo.insert(
        makeEntry({ id: 'usr_002', name: 'mem-2', file_path: join(testDir, 'usr_002.md') }),
      )
      repo.archive('usr_001')
      expect(repo.countByScope('user', null)).toBe(1)
    })
  })

  describe('findEvictionCandidates', () => {
    it('should return entries ordered by score ASC', () => {
      // Low score: low hit_count, low confidence
      repo.insert(
        makeEntry({
          id: 'usr_001',
          name: 'low-score',
          confidence: 0.6,
          hit_count: 0,
          file_path: join(testDir, 'usr_001.md'),
        }),
      )
      // High score: high hit_count, high confidence
      repo.insert(
        makeEntry({
          id: 'usr_002',
          name: 'high-score',
          confidence: 1.0,
          hit_count: 10,
          file_path: join(testDir, 'usr_002.md'),
        }),
      )

      const candidates = repo.findEvictionCandidates('user', null, 2)
      expect(candidates).toHaveLength(2)
      expect(candidates[0]!.name).toBe('low-score')
    })

    it('should respect limit', () => {
      repo.insert(
        makeEntry({ id: 'usr_001', name: 'mem-1', file_path: join(testDir, 'usr_001.md') }),
      )
      repo.insert(
        makeEntry({ id: 'usr_002', name: 'mem-2', file_path: join(testDir, 'usr_002.md') }),
      )
      repo.insert(
        makeEntry({ id: 'usr_003', name: 'mem-3', file_path: join(testDir, 'usr_003.md') }),
      )

      const candidates = repo.findEvictionCandidates('user', null, 1)
      expect(candidates).toHaveLength(1)
    })
  })

  // ─── S0 反例固定（E4）→ S1A.3 已修复（2026-09-27 反转） ────────────────
  // 依据 docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S0/S1A.3。
  // 原 fails 用例：update 在 textChanged 且 body 缺失时以空串重建 FTS 行，
  // 旧正文关键词检索丢失。S1A.3 修复（repo fail-loud + 全部调用方补传 body）
  // 后反转为 it：文本变更缺 body 直接抛错；带 body 的 description-only 更新
  // 保留旧正文检索。
  describe('S1A.3 已修复（原 S0/E4 反例）：FTS 正文完整性', () => {
    let searchRepo: MemorySearchRepository

    beforeEach(() => {
      searchRepo = new MemorySearchRepository(db)
    })

    it('update 仅改 description 但传入当前正文（调用方修复形态，如 memory:update IPC 读文件）时，旧正文关键词仍可检索', () => {
      const body = '阿那亚图书馆位于秦皇岛北戴河新区，馆藏以建筑设计类图书为特色。'
      const row = repo.insert(
        makeEntry({ id: 'usr_e4a', name: 'e4-body-entry', description: '旧摘要' }),
        body,
      )
      // 前置：insert 带 body，正文关键词已入索引
      expect(searchRepo.searchBm25('阿那亚图书馆')).toHaveLength(1)

      repo.update(row.id, { description: '新摘要：描述已变更' }, body)

      const hits = searchRepo.searchBm25('阿那亚图书馆')
      expect(hits).toHaveLength(1)
      expect(hits[0]!.entry.id).toBe('usr_e4a')
    })

    it('update 在 textChanged 且 body 缺失时明确失败而非静默清空索引（fail-loud）', () => {
      const row = repo.insert(makeEntry({ id: 'usr_e4b' }), '正文内容：独特关键词沙丘咖啡')
      expect(searchRepo.searchBm25('沙丘咖啡')).toHaveLength(1)

      expect(() => repo.update(row.id, { description: '仅元数据更新' })).toThrow(/未提供 body/)
      // 失败后索引不被破坏
      expect(searchRepo.searchBm25('沙丘咖啡')).toHaveLength(1)
    })

    it('update 传 body 时正文检索正常更新（正确行为固化）', () => {
      const row = repo.insert(
        makeEntry({ id: 'usr_e4c', description: '旧摘要' }),
        '旧正文包含关键词候鸟驿站',
      )
      expect(searchRepo.searchBm25('候鸟驿站')).toHaveLength(1)

      repo.update(row.id, { description: '新摘要' }, '新正文包含关键词孤独书局')

      expect(searchRepo.searchBm25('候鸟驿站')).toHaveLength(0)
      expect(searchRepo.searchBm25('孤独书局')).toHaveLength(1)
    })

    it('update 仅改非文本字段（如 confidence/hit_count）不动 FTS（正确行为固化）', () => {
      const row = repo.insert(
        makeEntry({ id: 'usr_e4d', description: '摘要稳定' }),
        '正文关键词礼堂穹顶',
      )
      expect(searchRepo.searchBm25('礼堂穹顶')).toHaveLength(1)

      repo.update(row.id, { confidence: 0.7 })

      expect(searchRepo.searchBm25('礼堂穹顶')).toHaveLength(1)
    })
  })
})
