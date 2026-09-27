/**
 * @module memory-lifecycle.contract.test
 *
 * 记忆生命周期服务测试（S1B.4；原 S0 反例 E3/F4/E1 已全部反转，2026-09-27）。
 *
 * 依据 docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S0/S1B.4：
 * S0 时期桌面 `memory:delete` / `memory:archive` handler 是纯 repository 调用
 * （delete 清 DB+FTS+vec；archive 只置 archived=1），不清理磁盘 markdown、
 * 不刷新 MEMORY.md 投影、归档不写回文件 frontmatter（旧 CLI 跨端复活），
 * 4 条 it.fails 固定反例。S1B.4 引入 MemoryLifecycleService（删除/归档唯一
 * 收敛入口，memory_operation 状态机 + 重启恢复）后全部反转；本文件同时
 * 覆盖状态机、幂等与中断恢复。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryRepository, MemoryOperationRepository, SparkDatabase } from '@spark/storage'
import { MemoryStoreService } from './memory-store.service.js'
import { MemoryLifecycleService } from './memory-lifecycle.service.js'
import { readFile } from 'fs/promises'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('memory lifecycle service（S1B.4：E3/F4/E1 反转 + 状态机）', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let opRepo: MemoryOperationRepository
  let store: MemoryStoreService
  let lifecycle: MemoryLifecycleService
  let testDir: string
  let workspaceDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-lifecycle-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    workspaceDir = join(testDir, 'workspace')
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
    repo = new MemoryRepository(db)
    opRepo = new MemoryOperationRepository(db)
    store = new MemoryStoreService(testDir, workspaceDir)
    lifecycle = new MemoryLifecycleService(repo, store, opRepo)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  /** 建一条 user scope 记忆：文件 + DB + MEMORY.md 投影齐备 */
  async function seedEntry(id: string): Promise<ReturnType<MemoryRepository['getById']>> {
    const filePath = store.getFilePath('user', null, id)
    await store.writeFile({
      meta: {
        id,
        scope: 'user',
        scopeRef: null,
        type: 'feedback',
        name: `name-${id}`,
        description: `desc-${id}`,
        confidence: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hitCount: 0,
        lastHitAt: null,
        sourceSessionId: null,
        links: [],
        archived: false,
      },
      body: `正文：${id} 的完整内容。`,
    })
    const row = repo.insert(
      {
        id,
        scope: 'user',
        scope_ref: null,
        type: 'feedback',
        name: `name-${id}`,
        description: `desc-${id}`,
        file_path: filePath,
        confidence: 0.9,
        hit_count: 0,
        last_hit_at: null,
        source_session_id: null,
        archived: 0,
      },
      `正文：${id} 的完整内容。`,
    )
    // writer.refreshIndex 的等价投影维护（基于有效条目）
    await store.updateIndexFile(
      'user',
      null,
      repo
        .listByScope('user', null)
        .map((e) => ({ name: e.name, description: e.description, id: e.id })),
    )
    return row
  }

  function readIndex(): Promise<string> {
    const indexPath = join(store.getScopeDir('user', null), 'MEMORY.md')
    return existsSync(indexPath) ? readFile(indexPath, 'utf-8') : Promise.resolve('')
  }

  // ─── S0 反例反转（E3/F4/E1）：lifecycle 收敛后全部为 it ────────────────

  it('delete 后磁盘 markdown 被清理（E3 反转）', async () => {
    const row = (await seedEntry('usr_lc001'))!
    expect(existsSync(row.file_path)).toBe(true)

    const result = await lifecycle.deleteEntry(row.id)

    expect(result.status).toBe('complete')
    expect(existsSync(row.file_path)).toBe(false)
  })

  it('delete 后 MEMORY.md 投影同步移除（F4 反转）', async () => {
    const row = (await seedEntry('usr_lc002'))!

    await lifecycle.deleteEntry(row.id)

    expect(await readIndex()).not.toContain('name-usr_lc002')
  })

  it('archive 后 MEMORY.md 投影同步移除（F4 反转）', async () => {
    const row = (await seedEntry('usr_lc003'))!

    await lifecycle.archiveEntry(row.id)

    expect(await readIndex()).not.toContain('name-usr_lc003')
  })

  it('archive 后归档状态写回文件 frontmatter，旧 CLI 不再跨端复活（E1 反转）', async () => {
    const row = (await seedEntry('usr_lc004'))!

    await lifecycle.archiveEntry(row.id)

    const content = existsSync(row.file_path) ? await readFile(row.file_path, 'utf-8') : ''
    expect(content).toMatch(/^archived:\s*true$/m)
  })

  // ─── 正确行为固化（S0 既有，修复不得回归） ─────────────────────────────

  it('delete 后 DB 与 FTS 即时不可查', async () => {
    const row = (await seedEntry('usr_lc101'))!
    await lifecycle.deleteEntry(row.id)
    expect(repo.getById(row.id)).toBeNull()
  })

  it('archive 后普通检索不返回、DB 行保留可恢复', async () => {
    const row = (await seedEntry('usr_lc102'))!
    await lifecycle.archiveEntry(row.id)
    expect(repo.listByScope('user', null).map((e) => e.id)).not.toContain(row.id)
    expect(repo.getById(row.id)).not.toBeNull()
  })

  // ─── S1B.4 状态机 / 幂等 / 中断恢复 ────────────────────────────────────

  it('delete 成功路径：operation 走完 pending→barrier_set→cleaning→local_purge_complete', async () => {
    const row = (await seedEntry('usr_lc201'))!
    const result = await lifecycle.deleteEntry(row.id)

    expect(result.status).toBe('complete')
    const op = opRepo.getById(result.operationId!)!
    expect(op.kind).toBe('delete')
    expect(op.target_id).toBe(row.id)
    expect(op.status).toBe('local_purge_complete')
    expect(op.last_error).toBeNull()
  })

  it('delete 幂等：不存在的 id 返回 not_found，不产生操作记录', async () => {
    const result = await lifecycle.deleteEntry('usr_nonexistent')
    expect(result.status).toBe('not_found')
    expect(opRepo.listUnfinished()).toEqual([])
    expect(opRepo.listFailed()).toEqual([])
  })

  it('archive 幂等：已归档条目重复归档补齐文件写回与投影后仍 complete', async () => {
    const row = (await seedEntry('usr_lc202'))!
    await lifecycle.archiveEntry(row.id)
    const again = await lifecycle.archiveEntry(row.id)
    expect(again.status).toBe('complete')
    const content = await readFile(row.file_path, 'utf-8')
    expect(content).toMatch(/^archived:\s*true$/m)
  })

  it('清理失败：状态置 failed 并保留目标，listUnfinished/listFailed 可见（可重试）', async () => {
    const row = (await seedEntry('usr_lc203'))!
    // 注入文件清理失败（cleaning 阶段第一步：deleteFile 抛错，文件与投影均残留）
    vi.spyOn(store, 'deleteFile').mockImplementation(async () => {
      throw new Error('EACCES: file delete denied')
    })

    const result = await lifecycle.deleteEntry(row.id)

    expect(result.status).toBe('blocked_locally')
    expect(result.error).toContain('file delete denied')
    const op = opRepo.getById(result.operationId!)!
    expect(op.status).toBe('failed')
    expect(op.last_error).toContain('file delete denied')
    // DB 屏障已生效（行已删）；文件与投影残留 = 待清理，由重试收敛
    expect(repo.getById(row.id)).toBeNull()
    expect(existsSync(row.file_path)).toBe(true)
    expect(await readIndex()).toContain('name-usr_lc203')

    // 重试收敛：failed 是终态（重启不自动重试），显式 retryFailed 至终态
    vi.restoreAllMocks()
    expect(await lifecycle.resumeUnfinished()).toBe(0) // failed 不在未终态集合
    await lifecycle.retryFailed()
    expect(opRepo.getById(op.id)!.status).toBe('local_purge_complete')
    expect(existsSync(row.file_path)).toBe(false)
    expect(await readIndex()).not.toContain('name-usr_lc203')
  })

  it('重启恢复：cleaning 中断的 delete 操作幂等重试至 local_purge_complete', async () => {
    const row = (await seedEntry('usr_lc204'))!
    // 模拟进程中断：屏障已设（行已删）、cleaning 未开始（文件残留）
    repo.delete(row.id)
    opRepo.insert({
      id: 'op_test_interrupted',
      kind: 'delete',
      targetId: row.id,
      targetVersion: row.version,
      targetsJson: JSON.stringify({
        filePath: row.file_path,
        scope: row.scope,
        scopeRef: row.scope_ref,
      }),
    })
    opRepo.updateStatus('op_test_interrupted', 'barrier_set')
    opRepo.updateStatus('op_test_interrupted', 'cleaning')
    expect(opRepo.listUnfinished()).toHaveLength(1)

    const handled = await lifecycle.resumeUnfinished()

    expect(handled).toBe(1)
    expect(opRepo.listUnfinished()).toEqual([])
    expect(opRepo.getById('op_test_interrupted')!.status).toBe('local_purge_complete')
    expect(existsSync(row.file_path)).toBe(false)
    expect(await readIndex()).not.toContain('name-usr_lc204')
  })

  it('重启恢复：屏障未设完即中断（行仍在）→ 补设屏障后完成', async () => {
    const row = (await seedEntry('usr_lc205'))!
    opRepo.insert({
      id: 'op_test_no_barrier',
      kind: 'delete',
      targetId: row.id,
      targetVersion: row.version,
      targetsJson: JSON.stringify({
        filePath: row.file_path,
        scope: row.scope,
        scopeRef: row.scope_ref,
      }),
    })
    // status 停留在 pending：屏障与清理均未做
    expect(repo.getById(row.id)).not.toBeNull()

    await lifecycle.resumeUnfinished()

    expect(repo.getById(row.id)).toBeNull()
    expect(existsSync(row.file_path)).toBe(false)
    expect(opRepo.getById('op_test_no_barrier')!.status).toBe('local_purge_complete')
  })
})
