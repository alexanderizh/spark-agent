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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryCommitService } from './memory-commit.service.js'
import {
  MemoryRepository,
  MemorySearchRepository,
  SparkDatabase,
  hashBodyForGuard,
  normalizeBodyForGuard,
} from '@spark/storage'
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

  it('commitUpdate CAS 失配（版本已被推进）：恢复权威正文，DB 不被覆盖', async () => {
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

    // 晚到的第二位仍持 v1 期望 → 失配拒绝，DB 保持第一位的内容；
    // 【审查修复】且被覆盖的权威正文（第一位的 v2）已恢复 —— 文件与行
    // content_hash 一致，条目保持可读（不降级等下次提交）
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
    // 权威正文已恢复：文件是 v2 的内容而非晚到者的覆盖
    const fileContent = readFileSync(row.file_path, 'utf-8')
    expect(fileContent).toContain('第一位写入者的新正文')
    expect(fileContent).not.toContain('晚到者的旧内容')
    // 守卫哈希口径一致（readFile 与写入侧同 normalize 口径）
    const restored = normalizeBodyForGuard(await store.readFile(row.file_path))
    expect(hashBodyForGuard(restored)).toBe(row.content_hash)
  })

  it('【审查修复】CAS 失配（写文件窗口内被归档）：恢复正文且归档状态写回 frontmatter', async () => {
    const created = await commit.commitWrite(baseInput)
    if (!created.ok) throw new Error('setup failed')
    const id = created.row.id

    // 在提交原语写新快照的窗口内，条目被并发归档（版本不变，CAS 因
    // archived=1 失配）——恢复后文件正文回到归档时的权威内容，且
    // frontmatter 如实写回 archived: true（旧 CLI 不复活）
    let armed = true
    const origWrite = store.writeFile.bind(store)
    vi.spyOn(store, 'writeFile').mockImplementation(async (input) => {
      if (armed) {
        armed = false
        repo.archive(id)
      }
      return origWrite(input)
    })

    const r = await commit.commitWrite({
      ...baseInput,
      entryId: id,
      expectedVersion: created.row.version,
      body: '归档窗口内的晚到覆盖',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('version_conflict')

    const row = repo.getById(id)!
    expect(row.archived).toBe(1)
    const fileContent = readFileSync(row.file_path, 'utf-8')
    expect(fileContent).toContain('archived: true')
    expect(fileContent).toContain(baseInput.body)
    expect(fileContent).not.toContain('归档窗口内的晚到覆盖')
  })

  it('【审查修复】CAS 失配（窗口内并发推进为不同内容）：无法安全恢复，保持守卫拒绝态', async () => {
    const created = await commit.commitWrite(baseInput)
    if (!created.ok) throw new Error('setup failed')
    const id = created.row.id

    // A 读到 v1 后在写文件窗口内，并发 B 已提交 v2（不同正文）→ A 的文件
    // 覆盖了 B 的正文，但 A 手里只有 v1 的旧正文（hash 与行 v2 不一致），
    // 无法安全恢复 —— 保持守卫拒绝态，等下次成功提交自愈（边界如实固定）
    let armed = true
    const origWrite = store.writeFile.bind(store)
    vi.spyOn(store, 'writeFile').mockImplementation(async (input) => {
      if (armed) {
        armed = false
        const b = await commit.commitWrite({
          ...baseInput,
          entryId: id,
          expectedVersion: 1,
          body: '并发B的新正文',
          description: '并发B摘要',
        })
        expect(b.ok).toBe(true)
      }
      return origWrite(input)
    })

    const stale = await commit.commitWrite({
      ...baseInput,
      entryId: id,
      expectedVersion: 1,
      body: '晚到A的覆盖内容',
      description: '晚到A摘要',
    })
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.reason).toBe('version_conflict')

    const row = repo.getById(id)!
    expect(row.version).toBe(2)
    expect(row.description).toBe('并发B摘要') // DB 未被晚到者覆盖
    // 文件被 A 覆盖且无法恢复 → 与行 content_hash 失配（守卫拒绝，如实固定边界）
    const fileContent = readFileSync(row.file_path, 'utf-8')
    expect(fileContent).toContain('晚到A的覆盖内容')
    const served = normalizeBodyForGuard(await store.readFile(row.file_path))
    expect(hashBodyForGuard(served)).not.toBe(row.content_hash)
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
