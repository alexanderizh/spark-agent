/**
 * @module memory-lifecycle.contract.test
 *
 * S0 反例固定（E3/F4）：删除/归档与文件系统、MEMORY.md 投影的同步契约。
 *
 * 依据 docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S0/S1B.4：
 * 桌面端 `memory:delete` / `memory:archive` handler
 * （apps/desktop/src/main/ipc/index.ts:9269/:9275）当前为纯 repository 调用
 * （delete 清 DB+FTS+vec；archive 只置 archived=1），不清理磁盘 markdown，
 * 也不刷新 MEMORY.md 投影 —— UI（MemoryPanel）却承诺"含 markdown 文件与索引"。
 *
 * 本文件用真实 MemoryRepository + MemoryStoreService 组合复现该序列并固化
 * "反例成立"（it.fails）。S1B.4 引入 memory-lifecycle.service.ts 后，本文件
 * 演进为生命周期服务的正式测试，fails 用例反转为 it。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRepository, SparkDatabase } from '@spark/storage'
import { MemoryStoreService } from './memory-store.service.js'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('memory lifecycle contract（S0：E3/F4 反例固定）', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let store: MemoryStoreService
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
    store = new MemoryStoreService(testDir, workspaceDir)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  /** 建一条 user scope 记忆：文件 + DB + MEMORY.md 投影齐备 */
  async function seedEntry(id: string): Promise<{ row: ReturnType<MemoryRepository['getById']> }> {
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
    return { row }
  }

  it.fails('repo.delete 后磁盘 markdown 应被清理（当前残留 — memory:delete 同序列）', async () => {
    const { row } = await seedEntry('usr_lc001')
    expect(existsSync(row!.file_path)).toBe(true)

    // 等价于 ipc/index.ts:9275 memory:delete 的全部动作
    repo.delete(row!.id)

    expect(existsSync(row!.file_path)).toBe(false)
  })

  it.fails('repo.delete 后 MEMORY.md 投影应同步移除（当前残留）', async () => {
    const { row } = await seedEntry('usr_lc002')

    repo.delete(row!.id)

    const indexPath = join(store.getScopeDir('user', null), 'MEMORY.md')
    const content = existsSync(indexPath) ? await readFile(indexPath, 'utf-8') : ''
    expect(content).not.toContain('name-usr_lc002')
  })

  it.fails(
    'repo.archive 后 MEMORY.md 投影应同步移除（当前残留 — memory:archive 同序列）',
    async () => {
      const { row } = await seedEntry('usr_lc003')

      // 等价于 ipc/index.ts:9269 memory:archive 的全部动作
      repo.archive(row!.id)

      const indexPath = join(store.getScopeDir('user', null), 'MEMORY.md')
      const content = existsSync(indexPath) ? await readFile(indexPath, 'utf-8') : ''
      expect(content).not.toContain('name-usr_lc003')
    },
  )

  // ─── S0 反例固定（E1/E2 根因·桌面侧）：跨端复活 ──────────────────────
  // 独立 CLI（spark-engine FileMemoryStore）与桌面零共享代码，只扫共享目录
  // 文件、以 frontmatter archived 为唯一归档信号（见 spark-engine
  // src/memory/store.ts list() 的 entries.filter(!archived)）。桌面归档只改
  // DB 不写回文件 → 残留文件的 frontmatter 仍是 archived:false → 旧 CLI 照常
  // 加载注入（跨端复活）。S1B（归档状态写回或托管目录隔离）后反转。
  it.fails(
    'repo.archive 后归档状态应写回文件 frontmatter（当前仍为 archived:false，旧 CLI 跨端复活）',
    async () => {
      const { row } = await seedEntry('usr_lc004')

      repo.archive(row!.id)

      const content = existsSync(row!.file_path) ? await readFile(row!.file_path, 'utf-8') : ''
      expect(content).toMatch(/^archived:\s*true$/m)
    },
  )

  // ─── 正确行为固化（当前已正确，修复不得回归） ──────────────────────────

  it('repo.delete 后 DB 与 FTS 即时不可查（正确行为固化）', async () => {
    const { row } = await seedEntry('usr_lc101')
    repo.delete(row!.id)
    expect(repo.getById(row!.id)).toBeNull()
  })

  it('repo.archive 后普通检索不返回、DB 行保留可恢复（正确行为固化）', async () => {
    const { row } = await seedEntry('usr_lc102')
    repo.archive(row!.id)
    expect(repo.listByScope('user', null).map((e) => e.id)).not.toContain(row!.id)
    expect(repo.getById(row!.id)).not.toBeNull()
  })
})
