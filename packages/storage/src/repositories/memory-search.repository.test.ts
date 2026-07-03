/**
 * @module memory-search.repository.test
 *
 * 单元测试：FTS5 同步维护 + BM25 查询 + sqlite-vec 向量表管理/KNN
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '../database.js'
import { MemoryRepository } from './memory.repository.js'
import type { MemoryEntryInsert } from './memory.repository.js'
import { MemorySearchRepository } from './memory-search.repository.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('MemorySearchRepository', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let searchRepo: MemorySearchRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-memsearch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    repo = new MemoryRepository(db)
    searchRepo = new MemorySearchRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  let seq = 0
  function makeEntry(overrides: Partial<MemoryEntryInsert> = {}): MemoryEntryInsert {
    seq += 1
    return {
      id: `usr_t${seq.toString().padStart(4, '0')}`,
      scope: 'user',
      scope_ref: null,
      type: 'user',
      name: `entry-${seq}`,
      description: 'placeholder description',
      file_path: join(testDir, `usr_t${seq}.md`),
      confidence: 0.9,
      hit_count: 0,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
      ...overrides,
    }
  }

  // ─── temporal 列 ────────────────────────────────────────────────────────

  it('insert sets valid_from to created_at by default', () => {
    const row = repo.insert(makeEntry())
    expect(row.valid_from).toBe(row.created_at)
    expect(row.invalid_at).toBeNull()
    expect(row.superseded_by).toBeNull()
  })

  it('update can set invalid_at and superseded_by', () => {
    const row = repo.insert(makeEntry())
    const other = repo.insert(makeEntry())
    const updated = repo.update(row.id, { invalid_at: Date.now(), superseded_by: other.id })
    expect(updated.invalid_at).not.toBeNull()
    expect(updated.superseded_by).toBe(other.id)
  })

  // ─── FTS 同步维护 + BM25 ────────────────────────────────────────────────

  it('insert indexes entry into FTS — Chinese two-char word searchable', () => {
    repo.insert(makeEntry({ name: '构建迁移', description: '项目已迁移到 vite 构建' }))
    const hits = searchRepo.searchBm25('迁移')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.entry.description).toContain('迁移')
  })

  it('English and mixed-language queries work', () => {
    repo.insert(makeEntry({ name: 'ui-pref', description: '用户偏好 Arco Design 组件库，禁止引入 radix' }))
    repo.insert(makeEntry({ name: 'pkg-pref', description: 'prefers pnpm over npm for monorepo' }))
    expect(searchRepo.searchBm25('arco')).toHaveLength(1)
    expect(searchRepo.searchBm25('pnpm')).toHaveLength(1)
    expect(searchRepo.searchBm25('组件库')).toHaveLength(1)
  })

  it('body passed on insert is searchable', () => {
    repo.insert(
      makeEntry({ name: 'with-body', description: 'short desc' }),
      '正文里提到了甲骨文数据库的连接方式',
    )
    expect(searchRepo.searchBm25('甲骨文')).toHaveLength(1)
  })

  it('update re-indexes changed description', () => {
    const row = repo.insert(makeEntry({ description: '旧的描述内容' }))
    repo.update(row.id, { description: '全新关键词内容' })
    expect(searchRepo.searchBm25('旧的')).toHaveLength(0)
    expect(searchRepo.searchBm25('全新关键词')).toHaveLength(1)
  })

  it('archive removes entry from FTS', () => {
    const row = repo.insert(makeEntry({ description: '归档测试条目' }))
    expect(searchRepo.searchBm25('归档测试')).toHaveLength(1)
    repo.archive(row.id)
    expect(searchRepo.searchBm25('归档测试')).toHaveLength(0)
  })

  it('invalidated entries (invalid_at set) are excluded from search', () => {
    const row = repo.insert(makeEntry({ description: '失效测试条目' }))
    repo.update(row.id, { invalid_at: Date.now() })
    expect(searchRepo.searchBm25('失效测试')).toHaveLength(0)
  })

  it('delete removes entry from FTS', () => {
    const row = repo.insert(makeEntry({ description: '删除测试条目' }))
    repo.delete(row.id)
    expect(searchRepo.searchBm25('删除测试')).toHaveLength(0)
  })

  it('scope and type filters apply', () => {
    repo.insert(makeEntry({ scope: 'user', scope_ref: null, type: 'feedback', description: '过滤目标条目' }))
    repo.insert(makeEntry({ scope: 'project', scope_ref: 'ws1', type: 'project', description: '过滤目标条目' }))
    const userOnly = searchRepo.searchBm25('过滤目标', { scopes: [{ scope: 'user', scopeRef: null }] })
    expect(userOnly).toHaveLength(1)
    expect(userOnly[0]!.entry.scope).toBe('user')
    const feedbackOnly = searchRepo.searchBm25('过滤目标', { type: 'feedback' })
    expect(feedbackOnly).toHaveLength(1)
  })

  it('empty query returns []', () => {
    expect(searchRepo.searchBm25('')).toHaveLength(0)
    expect(searchRepo.searchBm25('   ')).toHaveLength(0)
  })

  // ─── 存量回填 ───────────────────────────────────────────────────────────

  it('backfillFtsIfNeeded indexes pre-existing rows and is idempotent', () => {
    // 绕过 repository 直插模拟"存量行"（无 FTS 索引）
    db.raw
      .prepare(
        `INSERT INTO memory_entry
         (id, scope, scope_ref, type, name, description, file_path, confidence,
          hit_count, last_hit_at, source_session_id, archived, created_at, updated_at, valid_from)
         VALUES ('usr_old1', 'user', NULL, 'user', '存量条目', '这是升级前就存在的记忆', '/tmp/x.md', 0.9,
          0, NULL, NULL, 0, 1000, 1000, 1000)`,
      )
      .run()
    expect(searchRepo.searchBm25('升级前')).toHaveLength(0)

    const count = searchRepo.backfillFtsIfNeeded()
    expect(count).toBe(1)
    expect(searchRepo.searchBm25('升级前')).toHaveLength(1)

    // 幂等：第二次不重复回填
    expect(searchRepo.backfillFtsIfNeeded()).toBe(0)
  })

  // ─── sqlite-vec ─────────────────────────────────────────────────────────

  it('loads sqlite-vec, creates vec table, KNN search with filters', async () => {
    const loaded = await searchRepo.loadVecExtension()
    expect(loaded).toBe(true)

    searchRepo.ensureVecTable(4)
    expect(searchRepo.vecTableExists()).toBe(true)
    expect(searchRepo.getVecDimension()).toBe(4)

    const a = repo.insert(makeEntry({ description: 'vector entry A' }))
    const b = repo.insert(makeEntry({ description: 'vector entry B' }))
    searchRepo.upsertVec(a.id, [1, 0, 0, 0])
    searchRepo.upsertVec(b.id, [0, 1, 0, 0])

    const hits = searchRepo.searchKnn([0.9, 0.1, 0, 0], { limit: 2 })
    expect(hits).toHaveLength(2)
    expect(hits[0]!.entry.id).toBe(a.id)
    expect(hits[0]!.distance).toBeLessThan(hits[1]!.distance)
  })

  it('KNN excludes archived entries', async () => {
    await searchRepo.loadVecExtension()
    searchRepo.ensureVecTable(4)
    const a = repo.insert(makeEntry())
    searchRepo.upsertVec(a.id, [1, 0, 0, 0])
    repo.archive(a.id)
    expect(searchRepo.searchKnn([1, 0, 0, 0], { limit: 5 })).toHaveLength(0)
  })

  it('listEntriesMissingVec returns un-embedded entries; upsertVec clears them', async () => {
    await searchRepo.loadVecExtension()
    searchRepo.ensureVecTable(4)
    const a = repo.insert(makeEntry())
    const b = repo.insert(makeEntry())
    expect(searchRepo.listEntriesMissingVec(10).map((e) => e.id).sort()).toEqual([a.id, b.id].sort())
    searchRepo.upsertVec(a.id, [0, 0, 0, 1])
    expect(searchRepo.listEntriesMissingVec(10).map((e) => e.id)).toEqual([b.id])
  })

  it('rebuildVecTable drops old vectors and records new dimension', async () => {
    await searchRepo.loadVecExtension()
    searchRepo.ensureVecTable(4)
    const a = repo.insert(makeEntry())
    searchRepo.upsertVec(a.id, [1, 0, 0, 0])
    searchRepo.rebuildVecTable(8)
    expect(searchRepo.getVecDimension()).toBe(8)
    expect(searchRepo.listEntriesMissingVec(10).map((e) => e.id)).toEqual([a.id])
  })

  it('ensureVecTable rebuilds when dimension changes', async () => {
    await searchRepo.loadVecExtension()
    searchRepo.ensureVecTable(4)
    searchRepo.ensureVecTable(16)
    expect(searchRepo.getVecDimension()).toBe(16)
  })
})
