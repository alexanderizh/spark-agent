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

  // ─── S0 反例固定（E6）：晚到向量覆盖 ──────────────────────────────────
  // 依据 docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S0/S1B.2/S1B.3：
  // backfillMissingVectors 先读 missing 集合再 await embed，期间条目文本被
  // update 修改后，晚到的旧文本向量仍被 upsertVec 占位 —— 该条目不再
  // missing，永不重算（输入与索引永久不一致）。
  // 当前用 it.fails 固化"反例成立"；S1B 修复（完成时校验输入摘要/版本，
  // 失配丢弃或重排队）后反转为 it。
  it.fails('回填期间条目文本被更新：晚到向量不得占位，应重新排队重算', async () => {
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

    // embed 在途：条目文本被修改（embedding 输入 = name + description 已变）
    repo.update(row.id, { description: 'embedding input after mid-flight update' })

    firstEmbedGate.resolve()
    await backfill

    // 修复目标：晚到的旧输入向量不应占位 —— 再次触发回填时该条目应重算
    await embedding.backfillMissingVectors()

    // 当前行为：第一次 upsertVec 后条目不再 missing，第二次回填不会调用 embed
    //（输入已变但向量已是"旧的"）→ embedInputs.length 停在 1 → 断言失败。
    expect(embedInputs.length).toBeGreaterThanOrEqual(2)
    expect(embedInputs[1]).toContain('embedding input after mid-flight update')
  })
})
