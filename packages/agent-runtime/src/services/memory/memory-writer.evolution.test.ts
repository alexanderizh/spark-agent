/**
 * @module memory-writer.evolution.test
 *
 * 真实 DB 测试：writer 演化执行路径（UPDATE/DELETE/NOOP/ADD 落库）。
 * 用 mock MemoryEvolutionService 注入预设 verdict，验证 writer 的 invalidateEntry/updateEntry
 * 对 SQLite + 文件的实际效果（含 FTS 同步、bi-temporal 失效、## History 追加）。
 *
 * 需 better-sqlite3 Node ABI（见 storage-tests-better-sqlite3-abi 记忆）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase, MemoryRepository, MemorySearchRepository } from '@spark/storage'
import type { MemoryEntryInsert } from '@spark/storage'
import { MemoryStoreService } from './memory-store.service.js'
import { MemoryWriterService } from './memory-writer.service.js'
import type { MemoryCandidate } from './memory-writer.service.js'
import type { MemoryEvolutionService, EvolutionVerdict } from './memory-evolution.service.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

/** 造一个返回固定 verdict 的 mock evolution service */
function mockEvolution(verdict: EvolutionVerdict): MemoryEvolutionService {
  return {
    decide: async () => verdict,
  } as unknown as MemoryEvolutionService
}

describe('MemoryWriterService evolution execution (real DB)', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let searchRepo: MemorySearchRepository
  let store: MemoryStoreService
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-writer-evo-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
    repo = new MemoryRepository(db)
    searchRepo = new MemorySearchRepository(db)
    store = new MemoryStoreService(testDir, join(testDir, 'workspace'))
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  function seedEntry(overrides: Partial<MemoryEntryInsert> = {}): MemoryEntryInsert {
    return {
      id: `usr_${Math.random().toString(36).slice(2, 10)}`,
      scope: 'user',
      scope_ref: null,
      type: 'user',
      name: 'seed-entry',
      description: 'seed description',
      file_path: '',
      confidence: 0.9,
      hit_count: 3,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
      ...overrides,
    }
  }

  function makeWriter(verdict: EvolutionVerdict): MemoryWriterService {
    return new MemoryWriterService(
      repo,
      store,
      () => null, // settings 默认启用
      async () => '[]', // callLLM 不用（maybeWriteFromTurn 不走，直接调 processCandidate）
      mockEvolution(verdict),
    )
  }

  it('NOOP verdict → nothing written', async () => {
    const writer = makeWriter({ decision: 'NOOP', targetId: null, reason: 'dup' })
    // 直接测 processCandidate（绕过抽取）：用类型断言访问 private 方法
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'user',
      name: 'noop-cand',
      description: 'a noop candidate',
      body: 'body',
      confidence: 0.9,
    }
    await (writer as unknown as { processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void> })
      .processCandidate(candidate, null, 'sess')
    expect(repo.countByScope('user', null)).toBe(0)
  })

  it('DELETE verdict → target invalidated (invalid_at set), excluded from search', async () => {
    const target = repo.insert(seedEntry({ name: 'old-stack', description: '项目用 webpack 构建' }), '项目用 webpack 构建的正文')
    expect(searchRepo.searchBm25('webpack')).toHaveLength(1)

    const writer = makeWriter({ decision: 'DELETE', targetId: target.id, reason: '已迁到 vite' })
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'user',
      name: 'migration-note',
      description: '我们已从 webpack 迁到 vite',
      body: 'body',
      confidence: 0.9,
    }
    await (writer as unknown as { processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void> })
      .processCandidate(candidate, null, 'sess')

    // target 失效（不物理删除），FTS 移除
    const updated = repo.getById(target.id)!
    expect(updated.invalid_at).not.toBeNull()
    expect(updated.archived).toBe(0) // 失效 ≠ 归档
    expect(searchRepo.searchBm25('webpack')).toHaveLength(0)
    // 候选本身未写入（DELETE 不留存候选）；target 失效后不再计入"有效"配额
    expect(repo.countByScope('user', null)).toBe(0)
    // 但行仍在（含失效），可通过 includeInvalid 查看
    expect(repo.listByScope('user', null, { includeInvalid: true })).toHaveLength(1)
  })

  it('UPDATE verdict → target description/body updated, hit_count preserved, History appended, FTS re-indexed', async () => {
    // 经 store 正常建条（file_path 指向真实文件，模拟生产 ADD 后的 UPDATE）
    const targetId = `usr_${Math.random().toString(36).slice(2, 10)}`
    const targetPath = store.getFilePath('user', null, targetId)
    await store.writeFile({
      meta: {
        id: targetId, scope: 'user', scopeRef: null, type: 'user',
        name: 'stack', description: '旧的描述 webpack', confidence: 0.9,
        createdAt: Date.now(), updatedAt: Date.now(), hitCount: 7, lastHitAt: null,
        sourceSessionId: null, links: [], archived: false,
      },
      body: '旧的正文内容 webpack',
    })
    const target = repo.insert(
      seedEntry({ id: targetId, name: 'stack', description: '旧的描述 webpack', hit_count: 7, file_path: targetPath }),
    )
    expect(searchRepo.searchBm25('webpack')).toHaveLength(1)

    const writer = makeWriter({ decision: 'UPDATE', targetId: target.id, reason: 'refined' })
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'user',
      name: 'stack-v2',
      description: '全新的描述 vite',
      body: '全新正文 vite',
      confidence: 0.95,
    }
    await (writer as unknown as { processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void> })
      .processCandidate(candidate, null, 'sess')

    // 同 id，描述更新，hit_count/created_at 保留
    const updated = repo.getById(target.id)!
    expect(updated.id).toBe(target.id)
    expect(updated.description).toBe('全新的描述 vite')
    expect(updated.hit_count).toBe(7) // 保留
    expect(updated.created_at).toBe(target.created_at)
    expect(updated.updated_at).toBeGreaterThanOrEqual(target.updated_at)

    // FTS 重建：新描述 'vite' 可搜（注：旧文本仍出现在 ## History 区段，故 'webpack' 也命中——这是预期）
    expect(searchRepo.searchBm25('vite')).toHaveLength(1)
    const viteHit = searchRepo.searchBm25('vite')[0]!
    expect(viteHit.entry.description).toBe('全新的描述 vite') // 描述字段已更新

    // 文件 ## History 区段追加了旧正文
    const fileBody = await store.readFile(updated.file_path)
    expect(fileBody).toContain('## History')
    expect(fileBody).toContain('旧的正文内容 webpack')
    expect(fileBody).toContain('全新正文 vite')
  })

  it('ADD verdict → new entry written', async () => {
    const writer = makeWriter({ decision: 'ADD', targetId: null, reason: 'new fact' })
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'feedback',
      name: 'new-fb',
      description: '一条全新反馈',
      body: 'body',
      confidence: 0.9,
    }
    await (writer as unknown as { processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void> })
      .processCandidate(candidate, null, 'sess')
    expect(repo.countByScope('user', null)).toBe(1)
    expect(repo.listByScope('user', null)[0]!.name).toBe('new-fb')
  })

  it('DELETE on already-invalidated target → idempotent (no error)', async () => {
    const target = repo.insert(seedEntry({ name: 'tgt' }))
    repo.update(target.id, { invalid_at: Date.now() })
    const writer = makeWriter({ decision: 'DELETE', targetId: target.id, reason: 'x' })
    const candidate: MemoryCandidate = {
      scope: 'user',
      type: 'user',
      name: 'c',
      description: 'd',
      body: 'b',
      confidence: 0.9,
    }
    // 不应抛错
    await (writer as unknown as { processCandidate: (c: MemoryCandidate, r: string | null, s: string) => Promise<void> })
      .processCandidate(candidate, null, 'sess')
  })
})
