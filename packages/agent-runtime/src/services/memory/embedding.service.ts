/**
 * @module embedding.service
 *
 * 记忆向量化服务 — embed 能力探测、维度管理、懒回填队列、rebuild 入口
 *
 * 设计约束（V2 硬约束继承）：
 *   - embedding 调用必须走 ModelService.embed()，禁止直接 new SDK client
 *   - 全链路 fire-and-forget + try/catch 到底：任何异常只 log，绝不上抛
 *   - 无 embedding 模型配置 / 调用失败 → 不可用，上层降级 FTS-only
 *   - better-sqlite3 同步 API：embed 结果先算好（事务外 await），再进同步写入
 */

import { createLogger } from '@spark/shared'
import type { MemorySearchRepository, MemoryEntryRow, VecIndexSource } from '@spark/storage'
import { hashEmbeddingInput, hashIndexInput } from '@spark/storage'
import type { ModelService, EmbedResult } from '../model.service.js'

const log = createLogger('memory:embedding')

/** 懒回填每批条数 */
const BACKFILL_BATCH_SIZE = 16
/** 探测失败后的负缓存时长（避免每次检索都打一次失败请求） */
const UNAVAILABLE_CACHE_MS = 5 * 60 * 1000
/** 查询向量 LRU 上限（2048 维 number[] 约 16KB/条，100 条约 1.6MB） */
const QUERY_VECTOR_CACHE_LIMIT = 100

/**
 * 查询向量 LRU（模块级）。EmbeddingService 在 session 单例 / search_memory 桥 /
 * IPC rebuild 等多处被独立 new，实例级缓存覆盖不全；key 含 provider + model +
 * 代际 + query 哈希，跨实例共享安全（同名模型不同渠道、vec 表重建后的新代际
 * 都自然隔离，旧代际条目待 LRU 淘汰即可，无失效广播需求）。
 */
const queryVectorCache = new Map<string, number[]>()

function queryCacheKey(
  provider: string | null | undefined,
  model: string | null | undefined,
  generation: number,
  queryHash: string,
): string {
  return `${provider ?? '-'}\n${model ?? '-'}\n${generation}\n${queryHash}`
}

/** 测试隔离用：清空模块级查询向量缓存。生产代码不需要调用。 */
export function clearQueryVectorCacheForTests(): void {
  queryVectorCache.clear()
}

export class EmbeddingService {
  private unavailableUntil = 0
  private backfillRunning = false

  constructor(
    private readonly modelService: ModelService,
    private readonly searchRepo: MemorySearchRepository,
    private readonly settingsGet: (category: string, key: string) => unknown | null,
  ) {}

  /** 当前 embedding 配置的索引来源描述（ensureVecTable 代际比对用） */
  private vecSource(): VecIndexSource {
    const provider = this.settingsGet('memory', 'embeddingProviderId')
    const model = this.settingsGet('memory', 'embeddingModel')
    return {
      provider: typeof provider === 'string' && provider.length > 0 ? provider : null,
      model: typeof model === 'string' && model.length > 0 ? model : null,
    }
  }

  /**
   * 便宜的同步预探测：settings 是否配置了 embedding 模型。
   * 真正可用性（网络/key）在首次 embed 调用时确定。
   */
  isConfigured(): boolean {
    const providerId = this.settingsGet('memory', 'embeddingProviderId')
    const model = this.settingsGet('memory', 'embeddingModel')
    return (
      typeof providerId === 'string' &&
      providerId.length > 0 &&
      typeof model === 'string' &&
      model.length > 0
    )
  }

  /**
   * 批量向量化。不可用（未配置/失败/负缓存期内）返回 null，永不抛异常。
   *
   * 首次成功时确定维度：写 settings + 建/校验 memory_vec 表
   * （维度变化时自动重建，旧向量由懒回填补齐）。
   *
   * 【S1B.3】返回本次向量所属的索引代际（调用方作为条件提交的期望值）。
   * 配置捕获在 embed 请求之前：embed 期间用户切换模型时，本批向量仍按
   * 请求时配置建表/记代际——写入侧比对代际后由下一次配置检测统一重建，
   * 不让新代际表混入旧模型向量。
   */
  async embedTexts(texts: string[]): Promise<{ vectors: number[][]; generation: number } | null> {
    try {
      if (texts.length === 0) return { vectors: [], generation: this.currentGeneration() }
      if (!this.isConfigured()) return null
      if (Date.now() < this.unavailableUntil) return null

      const requestSource = this.vecSource()

      const vecOk = await this.searchRepo.loadVecExtension()
      if (!vecOk) {
        this.unavailableUntil = Date.now() + UNAVAILABLE_CACHE_MS
        return null
      }

      const result: EmbedResult = await this.modelService.embed(texts)
      if (!result.available) {
        log.warn(`embedding unavailable, vector search degraded: ${result.reason}`)
        this.unavailableUntil = Date.now() + UNAVAILABLE_CACHE_MS
        return null
      }

      // 索引配置管理（S1B.2）：首次确定写 settings；provider/model/维度任一
      // 变化（含同维度模型切换）时重建 vec 表并递增代际，旧向量整体失效。
      // 按【请求时】捕获的 source 校验（S1B.3），返回代际供写入侧条件提交
      this.searchRepo.ensureVecTable(result.dimension, requestSource)
      return { vectors: result.vectors, generation: this.currentGeneration() }
    } catch (err) {
      log.warn(`embedTexts failed (degrading): ${err instanceof Error ? err.message : String(err)}`)
      this.unavailableUntil = Date.now() + UNAVAILABLE_CACHE_MS
      return null
    }
  }

  /**
   * 单条查询向量化（带 LRU 缓存）。每轮记忆注入的 seedQuery（agent 名 + 描述 +
   * workspace 名）在会话内稳定，第 2 轮起命中缓存可跳过一次远程 embedding 往返。
   * 批量回填 / rebuild 维度探测继续走 embedTexts（不进缓存，条目向量以
   * upsertVec 事务内的输入摘要比对为准，缓存无参与空间）。
   *
   * 命中后仍执行 loadVecExtension（幂等、首载后有标志位短路）并复核
   * vecSource / 代际：searchKnn 前置依赖扩展已加载，不能因命中跳过；配置切换
   * 或表重建导致的失配条目就地删除并回落网络重算。
   * 可观察行为变化（可接受）：provider 负缓存（探测失败 5 分钟）期内命中仍
   * 返回向量——缓存的是历史事实，不依赖当前网络可用性；负缓存只拦截 miss
   * 路径（embedTexts 内部自查），避免故障窗口把已缓存查询也拖成 FTS-only。
   */
  async embedQuery(query: string): Promise<{ vectors: number[][]; generation: number } | null> {
    try {
      if (query.length === 0) return { vectors: [], generation: this.currentGeneration() }
      if (!this.isConfigured()) return null

      const queryHash = hashIndexInput([query])
      const source = this.vecSource()
      const generation = this.currentGeneration()

      const key = queryCacheKey(source.provider, source.model, generation, queryHash)
      const hit = queryVectorCache.get(key)
      if (hit != null) {
        // LRU 触碰：删除重插保持该条目新鲜
        queryVectorCache.delete(key)
        queryVectorCache.set(key, hit)
        const vecOk = await this.searchRepo.loadVecExtension()
        const current = this.vecSource()
        if (
          vecOk &&
          current.provider === source.provider &&
          current.model === source.model &&
          this.currentGeneration() === generation
        ) {
          return { vectors: [hit], generation }
        }
        // 复核失配（配置/代际在触碰后被改）：删除陈旧条目，落到网络重算
        queryVectorCache.delete(key)
      }

      const embedded = await this.embedTexts([query])
      if (embedded == null) return null
      const vector = embedded.vectors[0]
      if (vector == null) return embedded

      // 写入键用【embed 后】的 source/代际：embedTexts 内部 ensureVecTable 可能
      // 刚建表（0→1）或因维度变化重建表，请求时的 generation 已失真
      const postSource = this.vecSource()
      queryVectorCache.set(
        queryCacheKey(postSource.provider, postSource.model, embedded.generation, queryHash),
        vector,
      )
      if (queryVectorCache.size > QUERY_VECTOR_CACHE_LIMIT) {
        const oldest = queryVectorCache.keys().next().value
        if (oldest != null) queryVectorCache.delete(oldest)
      }
      return embedded
    } catch (err) {
      log.warn(`embedQuery failed (degrading): ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  /** 当前索引代际（表未建时为 0；与 upsertVec 的 expectedGeneration 口径一致） */
  private currentGeneration(): number {
    return this.searchRepo.getVecConfig()?.generation ?? 0
  }

  /**
   * 懒回填队列：后台逐批 embed 尚未向量化的条目并写入 memory_vec。
   *
   * fire-and-forget（调用方不 await 也可）；进程内防重入；
   * 每批之间让出事件循环，避免长时间占用。任何异常只 log 并终止本轮，
   * 下次触发（下一次会话/检索）会继续。
   */
  async backfillMissingVectors(): Promise<void> {
    if (this.backfillRunning) return
    this.backfillRunning = true
    try {
      if (!this.isConfigured()) return
      let total = 0
      // 上限护栏：单轮最多回填 50 批，防御异常情况下的死循环
      for (let batch = 0; batch < 50; batch++) {
        const missing = this.searchRepo.listEntriesMissingVec(BACKFILL_BATCH_SIZE)
        if (missing.length === 0) break

        // 【S1B.2 / E6】请求时捕获每条输入摘要；【S1B.3】同时捕获索引代际：
        // embed 是异步 IO，期间条目文本可能被更新、表可能被重建（模型/维度
        // 切换）；写入时（upsertVec）事务内比对全部期望值，失配丢弃不占位
        const inputHashes = missing.map((e) => hashEmbeddingInput(e.name, e.description))

        // 事务外先算好全部向量（同步事务内禁 await）
        const embedded = await this.embedTexts(missing.map(embeddingTextOf))
        if (embedded == null) {
          log.debug('vector backfill paused: embedding unavailable')
          break
        }
        const { vectors, generation } = embedded

        let written = 0
        let stale = 0
        for (let i = 0; i < missing.length; i++) {
          const ok = this.searchRepo.upsertVec(
            missing[i]!.id,
            vectors[i]!,
            inputHashes[i],
            generation,
          )
          if (ok) written++
          else stale++
        }
        total += written
        log.info(
          `vector backfill progress: +${written} (total ${total})` +
            (stale > 0 ? `, ${stale} discarded (stale input, will re-embed next round)` : ''),
        )

        // 整批全部失配 = 有并发写者在持续更新条目：本轮终止（条目仍留在
        // 回填队列，下轮触发时按新文本重算），避免同批条目反复空转
        if (written === 0 && stale > 0) {
          log.info('vector backfill stopped: whole batch stale (concurrent writes in progress)')
          break
        }

        // 让出事件循环，绝不阻塞主对话
        await new Promise((resolve) => setImmediate(resolve))
      }
      if (total > 0) log.info(`vector backfill complete: ${total} entries embedded`)
    } catch (err) {
      log.warn(
        `vector backfill failed (will retry next trigger): ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      this.backfillRunning = false
    }
  }

  /**
   * 向量重建入口：丢弃全部旧向量（维度变化 / 数据修复），随后触发懒回填。
   * @returns { done, reason } —— 调用方据此区分真重建与跳过（未配置/扩展失败/probe 失败）
   */
  async rebuild(): Promise<{ done: boolean; reason?: string }> {
    log.info('rebuild started')
    try {
      if (!this.isConfigured()) {
        log.warn('rebuild skipped: no embedding model configured')
        return { done: false, reason: 'no embedding model configured' }
      }
      const vecOk = await this.searchRepo.loadVecExtension()
      if (!vecOk) {
        // 把底层真实错误（asar 路径 / 代码签名 / ABI 等）透到 reason，方便 UI 直查根因
        const detail = this.searchRepo.getLastVecLoadError()
        const reason = detail
          ? `sqlite-vec extension load failed: ${detail}`
          : 'sqlite-vec extension load failed'
        log.warn(`rebuild skipped: ${reason}`)
        return { done: false, reason }
      }
      // 用一条探测请求确定当前模型维度
      const probe = await this.modelService.embed(['dimension probe'])
      if (!probe.available) {
        log.warn(`rebuild skipped: embedding unavailable (${probe.reason})`)
        return { done: false, reason: `embedding unavailable: ${probe.reason}` }
      }
      this.searchRepo.rebuildVecTable(probe.dimension, this.vecSource())
      log.info(
        `rebuild succeeded: vec table dropped+recreated with dimension=${probe.dimension}, ` +
          `backfill scheduled`,
      )
      void this.backfillMissingVectors()
      return { done: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn(`rebuild failed: ${msg}`)
      return { done: false, reason: msg }
    }
  }
}

/** 条目用于 embedding 的文本表示（name + description，正文太长不喂） */
export function embeddingTextOf(entry: MemoryEntryRow): string {
  return `${entry.name}\n${entry.description}`
}
