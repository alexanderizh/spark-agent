/**
 * @module embedding.service.test
 *
 * 单元测试：EmbeddingService
 *
 * 覆盖：
 *   - 未配置 embedding 模型时 embedTexts 返回 null（降级 FTS-only）
 *   - S0 反例固定（E6）：懒回填期间条目文本被更新，晚到向量不得占位
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EmbeddingService, clearQueryVectorCacheForTests } from './embedding.service.js'
import { MemoryRepository, MemorySearchRepository, SparkDatabase } from '@spark/storage'
import type { ModelService, EmbedResult } from '../model.service.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

/** deferred：const 对象持有 resolve，规避闭包内赋值的 TS 控制流 narrow 限制 */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('EmbeddingService', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let searchRepo: MemorySearchRepository
  let embedding: EmbeddingService
  let testDir: string
  let embedFn: ReturnType<typeof vi.fn>
  const settings: Record<string, Record<string, unknown>> = {
    memory: { embeddingProviderId: 'prov-1', embeddingModel: 'embed-model' },
  }

  beforeEach(() => {
    // 测试隔离：上一用例可能清空 settings.memory（未配置分支），每个用例重置；
    // 模块级查询向量缓存同样逐用例清空（跨用例的临时库 generation 从头计数，
    // 同 key 会撞上上一用例的缓存）
    clearQueryVectorCacheForTests()
    settings.memory = { embeddingProviderId: 'prov-1', embeddingModel: 'embed-model' }
    testDir = join(
      tmpdir(),
      `spark-embed-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
    repo = new MemoryRepository(db)
    searchRepo = new MemorySearchRepository(db)

    embedFn = vi.fn()
    const fakeModelService = { embed: embedFn } as unknown as ModelService
    embedding = new EmbeddingService(
      fakeModelService,
      searchRepo,
      (cat: string, key: string) => settings[cat]?.[key] ?? null,
    )
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  function makeEmbedResult(texts: string[], dim = 4): EmbedResult {
    return {
      available: true,
      dimension: dim,
      model: 'embed-model',
      vectors: texts.map((_, i) => {
        const v = new Array<number>(dim).fill(0)
        v[i % dim] = 1
        return v
      }),
    }
  }

  it('未配置 embedding 模型时 embedTexts 返回 null（正确行为固化）', async () => {
    settings.memory = {}
    const result = await embedding.embedTexts(['hello'])
    expect(result).toBeNull()
  })

  // ─── S0 反例（E6）→ S1B.2 已修复（2026-09-27 反转） ─────────────────────
  // 依据 docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S0/S1B.2。
  // 原 fails 用例：backfillMissingVectors 先读 missing 集合再 await embed，
  // 期间条目文本被 update 修改后，晚到的旧文本向量仍被 upsertVec 占位 ——
  // 条目不再 missing，永不重算。S1B.2 修复（请求时捕获输入摘要，upsertVec
  // 完成时比对当前文本摘要，失配拒绝写入）后反转为 it。
  it('回填期间条目文本被更新：晚到向量不得占位，应重新排队重算（E6 反转）', async () => {
    let seq = 0
    // deferred 模式：const 持有 resolve，规避闭包赋值的 CFA narrow 限制
    const firstEmbedGate = createDeferred<void>()
    const embedInputs: string[][] = []
    embedFn.mockImplementation(async (texts: string[]) => {
      embedInputs.push(texts)
      if (embedInputs.length === 1) {
        // 第一次 embed 挂起，制造"读集合 → embed 在途 → 条目被改"交错窗口
        await firstEmbedGate.promise
      }
      return makeEmbedResult(texts)
    })

    seq += 1
    const row = repo.insert({
      id: `usr_e6_${seq}`,
      scope: 'user',
      scope_ref: null,
      type: 'user',
      name: 'e6-late-arrival',
      description: 'embedding input before update',
      file_path: join(testDir, `usr_e6_${seq}.md`),
      confidence: 0.9,
      hit_count: 0,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
    })

    // 启动回填（不 await），等第一次 embed 被调用并挂起
    const backfill = embedding.backfillMissingVectors()
    while (embedInputs.length < 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }

    // embed 在途：条目文本被修改（embedding 输入 = name + description 已变；
    // S1A.3 契约：文本变更必须带 body）
    repo.update(row.id, { description: 'embedding input after mid-flight update' }, '正文内容')

    firstEmbedGate.resolve()
    await backfill

    // 修复后：晚到向量被拒（输入摘要失配），条目仍在回填队列
    expect(searchRepo.listEntriesMissingVec(10).map((e) => e.id)).toEqual([row.id])

    // 再次触发回填：按新文本重算
    await embedding.backfillMissingVectors()

    expect(embedInputs.length).toBeGreaterThanOrEqual(2)
    // embedding 输入是 name + '\n' + description 的拼接串
    expect(embedInputs[1]!.join('\n')).toContain('embedding input after mid-flight update')
    // 新文本向量已建立，条目离开回填队列
    expect(searchRepo.listEntriesMissingVec(10)).toEqual([])
  })

  // ─── S1B.3 异步提交保护：请求时捕获配置 + 代际条件提交 ────────────────────
  it('S1B.3: embed 在途切换配置 → 表按【请求时】配置建立，返回代际与向量所属配置一致', async () => {
    const firstEmbedGate = createDeferred<void>()
    let call = 0
    embedFn.mockImplementation(async (texts: string[]) => {
      call += 1
      if (call === 1) await firstEmbedGate.promise
      return makeEmbedResult(texts)
    })

    const p = embedding.embedTexts(['hello'])
    await new Promise((resolve) => setImmediate(resolve)) // 等 embed 被调用挂起
    // embed 在途：用户把配置切到另一模型
    settings.memory = { embeddingProviderId: 'prov-2', embeddingModel: 'other-model' }
    firstEmbedGate.resolve()
    const embedded = await p

    // 请求时捕获（S1B.3）：向量是请求时模型（embed-model）算的，表必须按
    // 请求时配置记录——否则新代际表混入旧模型向量，且代际口径失真
    expect(embedded).not.toBeNull()
    expect(embedded!.vectors).toHaveLength(1)
    expect(searchRepo.getVecConfig()).toMatchObject({ provider: 'prov-1', model: 'embed-model' })
    expect(embedded!.generation).toBe(searchRepo.getVecConfig()?.generation)
  })

  it('S1B.3: 回填与手动重建并发 → 写入携带期望代际，最终按当前代际收敛', async () => {
    // 预先建表（gen 1）——rebuild 需在已有表的状态下递增代际
    await searchRepo.loadVecExtension()
    searchRepo.ensureVecTable(4, { provider: 'prov-1', model: 'embed-model' })
    expect(searchRepo.getVecConfig()?.generation).toBe(1)

    const firstEmbedGate = createDeferred<void>()
    const embedInputs: string[][] = []
    embedFn.mockImplementation(async (texts: string[]) => {
      embedInputs.push(texts)
      if (embedInputs.length === 1) await firstEmbedGate.promise
      return makeEmbedResult(texts)
    })

    const row = repo.insert({
      id: 'usr_s1b3_gen',
      scope: 'user',
      scope_ref: null,
      type: 'user',
      name: 's1b3-generation-guard',
      description: 'generation guard before rebuild',
      file_path: join(testDir, 'usr_s1b3_gen.md'),
      confidence: 0.9,
      hit_count: 0,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
    })

    const backfill = embedding.backfillMissingVectors()
    while (embedInputs.length < 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }

    // embed 在途：用户手动重建向量表（rebuild 入口）→ 代际递增、旧向量清空。
    // 回填批次的写入期望值取自 embedTexts 返回的当前代际（请求时配置校验后
    // 同步读取），与 upsertVec 事务内代际原子比对——无论中间被拒或直接
    // 通过，条目最终都按当前代际收敛，不留旧代际向量
    searchRepo.rebuildVecTable(4, { provider: 'prov-1', model: 'embed-model' })
    expect(searchRepo.getVecConfig()?.generation).toBeGreaterThan(1)

    firstEmbedGate.resolve()
    await backfill

    // 交错结局有两种，均正确：①在途批次携带的期望代际与当前一致（rebuild
    // 后配置未变）→ 直接写入新表；②期望失配 → 拒绝丢弃。无论哪种，条目
    // 都按【当前代际】收敛：再触发一轮后队列清空、meta 记录当前代际
    await embedding.backfillMissingVectors()
    const stillMissing = searchRepo.listEntriesMissingVec(10)
    expect(stillMissing).toEqual([])
  })

  // ─── embedQuery：单条查询向量的 LRU 缓存（P1-4） ──────────────────────────
  describe('embedQuery 查询向量缓存', () => {
    it('同配置同 query 第二次命中缓存：不再发远程请求，向量与代际一致', async () => {
      embedFn.mockImplementation(async (texts: string[]) => makeEmbedResult(texts))
      const first = await embedding.embedQuery('Eva 的偏好')
      expect(first).not.toBeNull()
      expect(embedFn).toHaveBeenCalledTimes(1)

      const second = await embedding.embedQuery('Eva 的偏好')
      expect(embedFn).toHaveBeenCalledTimes(1) // 未发第二次远程请求
      expect(second).not.toBeNull()
      expect(second!.vectors).toEqual(first!.vectors)
      expect(second!.generation).toBe(first!.generation)
    })

    it('不同 query 不命中（key 含 query 哈希）', async () => {
      embedFn.mockImplementation(async (texts: string[]) => makeEmbedResult(texts))
      await embedding.embedQuery('查询甲')
      await embedding.embedQuery('查询乙')
      expect(embedFn).toHaveBeenCalledTimes(2)
    })

    it('切换 embedding 渠道/模型后同 query 不命中（key 含 provider+model）', async () => {
      embedFn.mockImplementation(async (texts: string[]) => makeEmbedResult(texts))
      await embedding.embedQuery('同一个问题')
      settings.memory = { embeddingProviderId: 'prov-2', embeddingModel: 'embed-model' }
      await embedding.embedQuery('同一个问题')
      expect(embedFn).toHaveBeenCalledTimes(2)
    })

    it('vec 表重建（代际递增）后同 query 不命中，重算并写新代际', async () => {
      embedFn.mockImplementation(async (texts: string[]) => makeEmbedResult(texts))
      const first = await embedding.embedQuery('重建前的问题')
      expect(first).not.toBeNull()

      searchRepo.rebuildVecTable(4, { provider: 'prov-1', model: 'embed-model' })
      const after = await embedding.embedQuery('重建前的问题')
      expect(embedFn).toHaveBeenCalledTimes(2)
      expect(after).not.toBeNull()
      expect(after!.generation).toBeGreaterThan(first!.generation)
      // 新代际条目可再次命中
      await embedding.embedQuery('重建前的问题')
      expect(embedFn).toHaveBeenCalledTimes(2)
    })

    it('provider 负缓存期内：已缓存 query 仍返回向量，新 query 才被拦截', async () => {
      embedFn.mockImplementation(async (texts: string[]) => makeEmbedResult(texts))
      await embedding.embedQuery('缓存过的问题')

      // 渠道故障：新 query 触发失败 → 实例进入 5 分钟负缓存
      embedFn.mockImplementation(async () => ({
        available: false,
        reason: 'HTTP 503',
      }))
      const miss = await embedding.embedQuery('没缓存过的问题')
      expect(miss).toBeNull()

      // 命中不受负缓存拦截（历史事实，不依赖当前可用性）——方案 P1-4 明确语义
      const hit = await embedding.embedQuery('缓存过的问题')
      expect(hit).not.toBeNull()
      expect(hit!.vectors).toHaveLength(1)
    })

    it('回填路径不写查询缓存：backfill 后同文本 embedQuery 仍走远程', async () => {
      embedFn.mockImplementation(async (texts: string[]) => makeEmbedResult(texts))
      repo.insert({
        id: 'usr_p14_backfill',
        scope: 'user',
        scope_ref: null,
        type: 'user',
        name: 'p14-entry',
        description: 'backfill must not seed query cache',
        file_path: join(testDir, 'usr_p14_backfill.md'),
        confidence: 0.9,
        hit_count: 0,
        last_hit_at: null,
        source_session_id: null,
        archived: 0,
      })
      await embedding.backfillMissingVectors()
      expect(searchRepo.listEntriesMissingVec(10)).toEqual([])

      // 用与条目 embedding 输入完全相同的文本查询：若回填写进了查询缓存会直接
      // 命中（embed 不再被调）；断言仍发远程请求
      await embedding.embedQuery('p14-entry\nbackfill must not seed query cache')
      expect(embedFn).toHaveBeenCalledTimes(2)
    })
  })
})
