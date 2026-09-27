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
import { EmbeddingService } from './embedding.service.js'
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
    // 测试隔离：上一用例可能清空 settings.memory（未配置分支），每个用例重置
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
})
