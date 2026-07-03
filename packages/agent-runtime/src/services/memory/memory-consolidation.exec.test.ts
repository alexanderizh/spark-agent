/**
 * @module memory-consolidation.exec.test
 *
 * 真实 DB 测试：consolidation 执行路径（MERGE/ELEVATE 落库）+ 触发门控。
 * 需 better-sqlite3 Node ABI（见 storage-tests-better-sqlite3-abi 记忆）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase, MemoryRepository, MemorySearchRepository } from '@spark/storage'
import { MemoryStoreService } from './memory-store.service.js'
import { MemoryConsolidationService } from './memory-consolidation.service.js'
import { join } from 'path'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

describe('MemoryConsolidationService execution (real DB)', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let store: MemoryStoreService
  let testDir: string
  let settingsMap: Record<string, unknown>
  let llmCalls: number

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-conso-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
    repo = new MemoryRepository(db)
    store = new MemoryStoreService(testDir, join(testDir, 'ws'))
    settingsMap = { consolidationThreshold: 2, consolidationIntervalDays: 0.01 }
    llmCalls = 0
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  /** 用 store 正常建条（写文件 + 插行），返回 id。必须 await（writeFile 是原子 .tmp→rename） */
  async function seed(name: string, description: string, body = ''): Promise<string> {
    const id = `usr_${Math.random().toString(36).slice(2, 10)}`
    const filePath = store.getFilePath('user', null, id)
    await store.writeFile({
      meta: {
        id, scope: 'user', scopeRef: null, type: 'feedback', name, description, confidence: 0.9,
        createdAt: Date.now(), updatedAt: Date.now(), hitCount: 0, lastHitAt: null,
        sourceSessionId: null, links: [], archived: false,
      },
      body: body || `正文：${description}`,
    })
    repo.insert({
      id, scope: 'user', scope_ref: null, type: 'feedback', name, description,
      file_path: filePath, confidence: 0.9, hit_count: 0, last_hit_at: null,
      source_session_id: null, archived: 0,
    })
    return id
  }

  function makeService(llmRaw: string): MemoryConsolidationService {
    return new MemoryConsolidationService(
      repo,
      store,
      (cat, key) => (cat === 'memory' ? settingsMap[key] ?? null : null),
      async () => { llmCalls += 1; return llmRaw },
      null,
      (cat, key, val) => { if (cat === 'memory') settingsMap[key] = val },
    )
  }

  it('MERGE: keep updated, drops invalidated + superseded_by=keep', async () => {
    const a = await seed('log-rule', '用 console.log 调试')
    const b = await seed('logger-rule', '用 logger 输出日志')
    const c = await seed('debug-log', '禁止 console')
    const raw = JSON.stringify([
      { action: 'MERGE', keepId: a, dropIds: [b, c], mergedDescription: '日志统一用 logger，禁用 console.log', reason: '语义重复' },
    ])
    const svc = makeService(raw)
    await svc.maybeConsolidate([{ scope: 'user', scopeRef: null }])

    expect(llmCalls).toBe(1)
    const keepRow = repo.getById(a)!
    expect(keepRow.description).toBe('日志统一用 logger，禁用 console.log')
    for (const dropId of [b, c]) {
      const d = repo.getById(dropId)!
      expect(d.invalid_at).not.toBeNull()
      expect(d.superseded_by).toBe(a)
    }
    // keep 文件含合并段
    const body = await store.readFile(keepRow.file_path)
    expect(body).toContain('合并自')
  })

  it('ELEVATE: new high-level feedback with source_session_id=consolidation', async () => {
    const a = await seed('fb1', '别在 views.css 加样式')
    const b = await seed('fb2', '组件样式放 .less')
    const raw = JSON.stringify([
      {
        action: 'ELEVATE', sourceIds: [a, b], reason: '升华样式规范',
        newMemory: { name: 'css-convention', description: '样式统一约定：禁全局 css，用组件级 .less', body: '**Why:** 避免污染\n**How to apply:** 新样式写 .less', type: 'feedback', confidence: 0.85 },
      },
    ])
    const svc = makeService(raw)
    const before = repo.countByScope('user', null)
    await svc.maybeConsolidate([{ scope: 'user', scopeRef: null }])

    expect(repo.countByScope('user', null)).toBe(before + 1)
    const elevated = repo.listByScope('user', null).find((e) => e.name === 'css-convention')!
    expect(elevated).toBeDefined()
    expect(elevated.source_session_id).toBe('consolidation')
    expect(elevated.confidence).toBe(0.85)
    // 源条目未被失效（ELEVATE 不动源）
    expect(repo.getById(a)!.invalid_at).toBeNull()
    expect(repo.getById(b)!.invalid_at).toBeNull()
  })

  it('ELEVATE 撞名保护：newMemory.name 与现有有效条目撞 → 跳过，不抛 UNIQUE', async () => {
    const a = await seed('fb1', '反馈一')
    const b = await seed('fb2', '反馈二')
    await seed('existing-name', '已存在的同名条目') // 占用 name
    const raw = JSON.stringify([
      {
        action: 'ELEVATE', sourceIds: [a, b], reason: '撞名',
        newMemory: { name: 'existing-name', description: '升华但撞名', body: 'b', type: 'feedback', confidence: 0.8 },
      },
    ])
    const svc = makeService(raw)
    const before = repo.countByScope('user', null)
    // 不应抛错
    await svc.maybeConsolidate([{ scope: 'user', scopeRef: null }])
    // 撞名 → 跳过，条目数不变
    expect(repo.countByScope('user', null)).toBe(before)
  })

  it('below threshold → no LLM call', async () => {
    await seed('only-one', '单条记忆')
    const svc = makeService('[]')
    await svc.maybeConsolidate([{ scope: 'user', scopeRef: null }])
    expect(llmCalls).toBe(0) // 阈值 2，仅 1 条 → 不触发
  })

  it('idempotent within interval: second call does not re-run', async () => {
    await seed('x1', '记忆一')
    await seed('x2', '记忆二')
    const svc = makeService('[]')
    await svc.maybeConsolidate([{ scope: 'user', scopeRef: null }])
    expect(llmCalls).toBe(1)
    // 第二次：上次刚整合（intervalMs 内）→ 跳过
    await svc.maybeConsolidate([{ scope: 'user', scopeRef: null }])
    expect(llmCalls).toBe(1)
  })

  it('unparseable LLM output → no crash, marks consolidated', async () => {
    await seed('x1', '记忆一')
    await seed('x2', '记忆二')
    const svc = makeService('I cannot help with that')
    await svc.maybeConsolidate([{ scope: 'user', scopeRef: null }])
    expect(llmCalls).toBe(1)
    // 不抛错即通过；且标记了整合时间（下次 interval 内不重跑）
    await svc.maybeConsolidate([{ scope: 'user', scopeRef: null }])
    expect(llmCalls).toBe(1)
  })

  it('LLM fabricated ids → action dropped (no invalidation of innocent entries)', async () => {
    const a = await seed('real', '真实记忆')
    const b = await seed('real2', '第二条')
    const raw = JSON.stringify([
      { action: 'MERGE', keepId: 'usr_fabricated', dropIds: [b], mergedDescription: 'x' },
    ])
    const svc = makeService(raw)
    await svc.maybeConsolidate([{ scope: 'user', scopeRef: null }])
    // 编造 keepId → 整个动作丢弃，b 未被失效
    expect(repo.getById(b)!.invalid_at).toBeNull()
    expect(repo.getById(a)!.invalid_at).toBeNull()
  })
})
