/**
 * @module memory-commit.service.test
 *
 * 单元测试：MemoryCommitService（S1B.1 版本提交原语）
 *
 * 覆盖：
 *   - commitCreate：版本 1 起点、content_hash 落库、文件与 FTS 齐备
 *   - commitUpdate：expectedVersion 命中 → 版本 +1、哈希刷新
 *   - commitUpdate CAS 失配：不覆盖当前状态、返回 version_conflict
 *   - 归档/失效目标拒绝提交（S1B.3 晚到保护前置）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryCommitService } from './memory-commit.service.js'
import { MemoryRepository, MemorySearchRepository, SparkDatabase } from '@spark/storage'
import { MemoryStoreService } from './memory-store.service.js'
import { readFileSync } from 'fs'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('MemoryCommitService（S1B.1）', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let searchRepo: MemorySearchRepository
  let store: MemoryStoreService
  let commit: MemoryCommitService
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-commit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
    repo = new MemoryRepository(db)
    searchRepo = new MemorySearchRepository(db)
    store = new MemoryStoreService(testDir, join(testDir, 'workspace'))
    commit = new MemoryCommitService(repo, store)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  const baseInput = {
    scope: 'user' as const,
    scopeRef: null,
    type: 'feedback' as const,
    name: 'commit-test-mem',
    description: '提交原语测试条目',
    confidence: 0.9,
    body: '正文：提交原语落库测试，含关键词蒲公英书屋。',
  }

  it('commitCreate：版本 1 起点、content_hash 落库、正文文件与 FTS 齐备', async () => {
    const r = await commit.commitWrite(baseInput)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toBe(true)
    expect(r.row.version).toBe(1)
    expect(r.row.content_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(readFileSync(r.row.file_path, 'utf-8')).toContain('蒲公英书屋')
    expect(searchRepo.searchBm25('蒲公英书屋')).toHaveLength(1)
  })

  it('commitUpdate：expectedVersion 命中 → 版本 +1、哈希刷新、FTS 更新', async () => {
    const created = await commit.commitWrite(baseInput)
    if (!created.ok) throw new Error('setup failed')
    const id = created.row.id

    const r = await commit.commitWrite({
      ...baseInput,
      entryId: id,
      expectedVersion: 1,
      description: '第二次提交的新摘要',
      body: '新正文：关键词换成了海边的孤独书局。',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row.version).toBe(2)
    expect(r.row.description).toBe('第二次提交的新摘要')
    expect(searchRepo.searchBm25('蒲公英书屋')).toHaveLength(0)
    expect(searchRepo.searchBm25('孤独书局')).toHaveLength(1)
  })

  it('commitUpdate CAS 失配（版本已被推进）：不覆盖当前状态，返回 version_conflict', async () => {
    const created = await commit.commitWrite(baseInput)
    if (!created.ok) throw new Error('setup failed')
    const id = created.row.id

    // 第一个写入者成功推进到 v2
    const first = await commit.commitWrite({
      ...baseInput,
      entryId: id,
      expectedVersion: 1,
      body: '第一位写入者的新正文',
    })
    expect(first.ok).toBe(true)

    // 晚到的第二位仍持 v1 期望 → 失配拒绝，DB 保持第一位的内容
    const stale = await commit.commitWrite({
      ...baseInput,
      entryId: id,
      expectedVersion: 1,
      body: '晚到者的旧内容',
      description: '晚到的摘要',
    })
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.reason).toBe('version_conflict')
    expect(stale.currentVersion).toBe(2)

    const row = repo.getById(id)!
    expect(row.version).toBe(2)
    expect(row.description).toBe(baseInput.description) // 未被晚到者覆盖
    // 晚到快照成为可识别孤儿：文件内容与 DB content_hash 失配
    const fileContent = readFileSync(row.file_path, 'utf-8')
    expect(fileContent).toContain('晚到者的旧内容')
  })

  it('归档/失效目标拒绝提交（晚到结果不复活已归档条目）', async () => {
    const created = await commit.commitWrite(baseInput)
    if (!created.ok) throw new Error('setup failed')
    const id = created.row.id
    repo.archive(id)

    const r = await commit.commitWrite({
      ...baseInput,
      entryId: id,
      expectedVersion: created.row.version,
      body: '试图更新已归档条目',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('version_conflict')
    expect(repo.getById(id)!.archived).toBe(1)
  })

  it('不存在的条目返回 validation', async () => {
    const r = await commit.commitWrite({ ...baseInput, entryId: 'usr_nope' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('validation')
  })
})
