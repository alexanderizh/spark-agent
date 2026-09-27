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
    // S1B.3：static 互斥是进程级状态，测试间必须复位（异常挂起路径防泄漏）
    MemoryConsolidationService.resetReentrancyForTest()
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  /** 用 store 正常建条（写文件 + 插行），返回 id。必须 await（writeFile 是原子 .tmp→rename） */
  async function seed(name: string, description: string, body = ''): Promise<string> {
    const id = `usr_${Math.random().toString(36).slice(2, 10)}`
    const filePath = store.getFilePath('user', null, id)
    await store.writeFile({
      meta: {
        id,
        scope: 'user',
        scopeRef: null,
        type: 'feedback',
        name,
        description,
        confidence: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hitCount: 0,
        lastHitAt: null,
        sourceSessionId: null,
        links: [],
        archived: false,
      },
      body: body || `正文：${description}`,
    })
    repo.insert({
      id,
      scope: 'user',
      scope_ref: null,
      type: 'feedback',
      name,
      description,
      file_path: filePath,
      confidence: 0.9,
      hit_count: 0,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
    })
    return id
  }

  function makeService(llmRaw: string): MemoryConsolidationService {
    return new MemoryConsolidationService(
      repo,
      store,
      (cat, key) => (cat === 'memory' ? (settingsMap[key] ?? null) : null),
      async () => {
        llmCalls += 1
        return llmRaw
      },
      null,
      (cat, key, val) => {
        if (cat === 'memory') settingsMap[key] = val
      },
    )
  }

  it('MERGE: keep updated, drops invalidated + superseded_by=keep', async () => {
    const a = await seed('log-rule', '用 console.log 调试')
    const longDropBody = `开头-${'完整记忆正文'.repeat(120)}-结尾不可丢`
    const b = await seed('logger-rule', '用 logger 输出日志', longDropBody)
    const c = await seed('debug-log', '禁止 console')
    const raw = JSON.stringify([
      {
        action: 'MERGE',
        keepId: a,
        dropIds: [b, c],
        mergedDescription: '日志统一用 logger，禁用 console.log',
        reason: '语义重复',
      },
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
    expect(body).toContain(longDropBody)
    expect(body).toContain('结尾不可丢')
  })

  it('ELEVATE: new high-level feedback with source_session_id=consolidation', async () => {
    const a = await seed('fb1', '别在 views.css 加样式')
    const b = await seed('fb2', '组件样式放 .less')
    const raw = JSON.stringify([
      {
        action: 'ELEVATE',
        sourceIds: [a, b],
        reason: '升华样式规范',
        newMemory: {
          name: 'css-convention',
          description: '样式统一约定：禁全局 css，用组件级 .less',
          body: '**Why:** 避免污染\n**How to apply:** 新样式写 .less',
          type: 'feedback',
          confidence: 0.85,
        },
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
    // 【S2.1】来源绑定：整合产生如实标注角色与提取类别
    expect(elevated.author_role).toBe('consolidation')
    expect(elevated.extraction_kind).toBe('consolidation')
    expect(elevated.evidence_status).toBe('available')
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
        action: 'ELEVATE',
        sourceIds: [a, b],
        reason: '撞名',
        newMemory: {
          name: 'existing-name',
          description: '升华但撞名',
          body: 'b',
          type: 'feedback',
          confidence: 0.8,
        },
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

  // ─── S1B.3 防重入：进程级互斥 + lastConsolidationAt 持久占坑 ──────────────
  // 现状缺陷（docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md §S1 切片3）：
  // 实例每 turn 在 session.service 新建，实例字段的 running 锁跨实例失效；
  // markConsolidated 原在整合完成后才写，LLM 在途窗口（数十秒）内另一实例
  // 触发会重复整合。S1B.3 修复：static 互斥 + 检查通过即占坑。
  it('S1B.3: LLM 在途窗口内另一实例触发 → 持久占坑挡住，不重复调 LLM', async () => {
    await seed('x1', '记忆一')
    await seed('x2', '记忆二')

    // 实例 A（模拟本 turn 新建）：LLM 挂起，制造在途窗口。
    // deferred 模式：const 持有 resolve，规避闭包内赋值的 TS CFA narrow 限制
    let resolveGate!: () => void
    const llmGate = new Promise<void>((r) => {
      resolveGate = r
    })
    let svcALlmCalls = 0
    const svcA = new MemoryConsolidationService(
      repo,
      store,
      (cat, key) => (cat === 'memory' ? (settingsMap[key] ?? null) : null),
      async () => {
        svcALlmCalls += 1
        await llmGate
        return '[]'
      },
      null,
      (cat, key, val) => {
        if (cat === 'memory') settingsMap[key] = val
      },
    )
    const runA = svcA.maybeConsolidate([{ scope: 'user', scopeRef: null }])
    // 等 A 进入 LLM 在途（同步阶段完成：static 锁已置位、占坑已写）
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(svcALlmCalls).toBe(1)

    // 实例 B（模拟下一 turn 新建的实例）：A 在途时触发。
    // static 互斥 → maybeConsolidate 直接返回，连阈值检查都不做
    const svcB = makeService('[]')
    await svcB.maybeConsolidate([{ scope: 'user', scopeRef: null }])
    expect(llmCalls).toBe(0) // B 未调 LLM

    resolveGate()
    await runA

    // A 完成后占坑仍在（持久条件）：新实例 C 触发被 interval 条件挡住
    const svcC = makeService('[]')
    await svcC.maybeConsolidate([{ scope: 'user', scopeRef: null }])
    expect(llmCalls).toBe(0)
    expect(svcALlmCalls).toBe(1)
  })

  it('S1B.3: LLM 失败（抛异常）→ 占坑不回滚，interval 内不重试', async () => {
    await seed('x1', '记忆一')
    await seed('x2', '记忆二')
    const svcFail = new MemoryConsolidationService(
      repo,
      store,
      (cat, key) => (cat === 'memory' ? (settingsMap[key] ?? null) : null),
      async () => {
        throw new Error('LLM down')
      },
      null,
      (cat, key, val) => {
        if (cat === 'memory') settingsMap[key] = val
      },
    )
    await svcFail.maybeConsolidate([{ scope: 'user', scopeRef: null }]) // 不抛（内部 catch）
    // 占坑已写：interval 内再触发（新实例）不重试 LLM
    const svcRetry = makeService('[]')
    await svcRetry.maybeConsolidate([{ scope: 'user', scopeRef: null }])
    expect(llmCalls).toBe(0)
  })
})
