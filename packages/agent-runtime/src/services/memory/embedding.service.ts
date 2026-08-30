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
import type { MemorySearchRepository, MemoryEntryRow } from '@spark/storage'
import type { ModelService, EmbedResult } from '../model.service.js'

const log = createLogger('memory:embedding')

/** 懒回填每批条数 */
const BACKFILL_BATCH_SIZE = 16
/** 探测失败后的负缓存时长（避免每次检索都打一次失败请求） */
const UNAVAILABLE_CACHE_MS = 5 * 60 * 1000

export class EmbeddingService {
  private unavailableUntil = 0
  private backfillRunning = false

  constructor(
    private readonly modelService: ModelService,
    private readonly searchRepo: MemorySearchRepository,
    private readonly settingsGet: (category: string, key: string) => unknown | null,
  ) {}

  /**
   * 便宜的同步预探测：settings 是否配置了 embedding 模型。
   * 真正可用性（网络/key）在首次 embed 调用时确定。
   */
  isConfigured(): boolean {
    const providerId = this.settingsGet('memory', 'embeddingProviderId')
    const model = this.settingsGet('memory', 'embeddingModel')
    return typeof providerId === 'string' && providerId.length > 0 && typeof model === 'string' && model.length > 0
  }

  /**
   * 批量向量化。不可用（未配置/失败/负缓存期内）返回 null，永不抛异常。
   *
   * 首次成功时确定维度：写 settings + 建/校验 memory_vec 表
   * （维度变化时自动重建，旧向量由懒回填补齐）。
   */
  async embedTexts(texts: string[]): Promise<number[][] | null> {
    try {
      if (texts.length === 0) return []
      if (!this.isConfigured()) return null
      if (Date.now() < this.unavailableUntil) return null

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

      // 维度管理：首次确定写 settings；模型更换导致维度变化时重建 vec 表
      this.searchRepo.ensureVecTable(result.dimension)
      return result.vectors
    } catch (err) {
      log.warn(`embedTexts failed (degrading): ${err instanceof Error ? err.message : String(err)}`)
      this.unavailableUntil = Date.now() + UNAVAILABLE_CACHE_MS
      return null
    }
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

        // 事务外先算好全部向量（同步事务内禁 await）
        const vectors = await this.embedTexts(missing.map(embeddingTextOf))
        if (vectors == null) {
          log.debug('vector backfill paused: embedding unavailable')
          break
        }

        for (let i = 0; i < missing.length; i++) {
          this.searchRepo.upsertVec(missing[i]!.id, vectors[i]!)
        }
        total += missing.length
        log.info(`vector backfill progress: +${missing.length} (total ${total})`)

        // 让出事件循环，绝不阻塞主对话
        await new Promise((resolve) => setImmediate(resolve))
      }
      if (total > 0) log.info(`vector backfill complete: ${total} entries embedded`)
    } catch (err) {
      log.warn(`vector backfill failed (will retry next trigger): ${err instanceof Error ? err.message : String(err)}`)
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
      this.searchRepo.rebuildVecTable(probe.dimension)
      log.info(
        `rebuild succeeded: vec table dropped+recreated with dimension=${probe.dimension}, `
        + `backfill scheduled`,
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
