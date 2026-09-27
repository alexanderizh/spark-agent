/**
 * @module memory-search.service
 *
 * 记忆混合检索服务 — FTS5(BM25) + sqlite-vec(KNN) 两路并行 → RRF 融合 →
 * 时间衰减 × confidence 重排。
 *
 * 降级链（降级优先于报错，每级降级 log 但不让用户感知为故障）：
 *   1. 向量不可用（未配置 embedding / 调用失败）→ FTS-only，log `vector=disabled`
 *   2. FTS 查询异常 → 返回 null，调用方（memory-reader）退回 V1 全量注入
 *
 * RRF：score = Σ 1/(60 + rank)，两路各取 top20，同一条目双路命中则贡献相加。
 * 重排：finalScore = rrf × exp(-λ · days_since_updated) × confidence，
 *       λ 默认 0.01（settings memory.timeDecayLambda 可调）。
 */

import { createLogger } from '@spark/shared'
import type { MemorySearchRepository, MemoryEntryRow, MemoryScopeFilter } from '@spark/storage'
import type { EmbeddingService } from './embedding.service.js'

const log = createLogger('memory:search')

/** RRF 融合常数（业界标准 k=60） */
const RRF_K = 60
/** 两路各取的候选数 */
const CANDIDATES_PER_CHANNEL = 20
/** 时间衰减 λ 默认值 */
const DEFAULT_TIME_DECAY_LAMBDA = 0.01

export interface MemorySearchOptions {
  /** 限定检索的 scope 组合；不传则由调用方给全三层 */
  scopes?: MemoryScopeFilter[]
  type?: string
  limit?: number
}

export interface MemorySearchHit {
  entry: MemoryEntryRow
  /** 融合 + 重排后的最终分（越大越相关） */
  score: number
  /** 命中来源（调试/log 用） */
  sources: Array<'fts' | 'vector'>
}

/**
 * 【S3.1】查询结果状态（四态，矩阵"相关记忆不存在与服务异常 → 不同结果状态"）：
 *   - matched   ：正常检索且有命中
 *   - empty     ：正常检索（或按设计的 FTS-only）且无命中 —— "不存在"是真实结论
 *   - degraded  ：通道故障下的结果（部分：fts/vec 单侧异常仍服务；全部：两路皆挂
 *                 hits 为空，等价旧 null 语义，调用方退回 V1 全量注入）。
 *                 先区分 degraded 与 empty，才能安全调整空结果 fallback ——
 *                 故障绝不冒充"没有相关记忆"。
 *   - disabled  ：记忆系统整体关闭（memory.enabled=false）
 */
export type MemoryQueryStatus = 'matched' | 'empty' | 'degraded' | 'disabled'

export interface MemoryQueryResult {
  status: MemoryQueryStatus
  hits: MemorySearchHit[]
  /** degraded/disabled 的如实说明（通道级故障原因；empty/matched 不带） */
  note?: string
  /**
   * 【结构化故障标记】FTS 与向量两路皆异常（true = hits 为空是故障所致，
   * 调用方应退回 V1 全量注入而非把空当结论）。兼容层 search() 据此判定
   * 是否返回 null —— 不依赖 note 文案匹配。
   */
  allChannelsFailed?: boolean
}

export class MemorySearchService {
  constructor(
    private readonly searchRepo: MemorySearchRepository,
    private readonly embeddingService: EmbeddingService | null,
    private readonly settingsGet: (category: string, key: string) => unknown | null,
  ) {}

  /**
   * 混合检索（旧签名，兼容既有调用方）。
   *
   * @returns 命中列表；**FTS 与向量两路皆异常时返回 null**（区别于空结果 []），
   *          调用方据此退回 V1 全量注入。四态语义见 searchWithStatus。
   */
  async search(query: string, opts?: MemorySearchOptions): Promise<MemorySearchHit[] | null> {
    const r = await this.searchWithStatus(query, opts)
    // 全通道故障（含禁用？否 —— 禁用对旧调用方按"无结果"处理，与 reader 的
    // enabled 短路语义一致）→ null 触发 V1 fallback；degraded-but-served 正常返回。
    // 判定依据结构化字段 allChannelsFailed，不匹配 note 文案
    if (r.status === 'degraded' && r.allChannelsFailed === true) {
      return null
    }
    return r.hits
  }

  /**
   * 【S3.1】带状态的四态检索接口。
   *
   * 状态判定：
   *   disabled  ← memory.enabled=false（整体关闭，与 reader.loadForSession 短路一致）
   *   degraded  ← 任一通道异常（fts 抛错 / knn 抛错）；两路皆异常时 hits=[] 且
   *               note 标注"两路皆异常"（等价旧 null 语义）
   *   matched   ← 无异常且有命中
   *   empty     ← 无异常且无命中（FTS-only 属按设计运行，不算 degraded）
   */
  async searchWithStatus(query: string, opts?: MemorySearchOptions): Promise<MemoryQueryResult> {
    const enabled = this.settingsGet('memory', 'enabled')
    if (enabled === false || enabled === 0) {
      return { status: 'disabled', hits: [] }
    }
    const limit = opts?.limit ?? 10
    const channelOpts = {
      ...(opts?.scopes != null ? { scopes: opts.scopes } : {}),
      ...(opts?.type != null ? { type: opts.type } : {}),
      limit: CANDIDATES_PER_CHANNEL,
    }

    // ── FTS 路径 ──
    let ftsEntries: MemoryEntryRow[] | null
    const ftsFailures: string[] = []
    try {
      ftsEntries = this.searchRepo.searchBm25(query, channelOpts).map((h) => h.entry)
    } catch (err) {
      log.warn(`FTS search failed: ${err instanceof Error ? err.message : String(err)}`)
      ftsFailures.push(`fts: ${err instanceof Error ? err.message : String(err)}`)
      ftsEntries = null
    }

    // ── 向量路径（不可用自动降级） ──
    let vecEntries: MemoryEntryRow[] = []
    let vectorServed = false
    if (this.embeddingService != null) {
      try {
        // S1B.3：embedTexts 返回 { vectors, generation }，检索路径只用向量
        const embedded = await this.embeddingService.embedTexts([query])
        if (embedded != null && embedded.vectors.length > 0) {
          vecEntries = this.searchRepo
            .searchKnn(embedded.vectors[0]!, channelOpts)
            .map((h) => h.entry)
          vectorServed = true
        }
      } catch (err) {
        log.warn(
          `vector search failed, degrading to FTS-only: ${err instanceof Error ? err.message : String(err)}`,
        )
        ftsFailures.push(`vector: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (!vectorServed) {
      log.debug('memory search: vector=disabled (FTS-only)')
    }

    // 两路皆异常（fts 抛错且向量未服务）→ degraded + 空结果（旧 null 语义：
    // 调用方退回 V1 全量注入）。修复旧实现角落：embed 成功但 knn 抛错时
    // vectorEnabled 已置 true，会漏判为空结果 —— 现按"通道实际服务"判定。
    if (ftsEntries == null && !vectorServed) {
      return {
        status: 'degraded',
        hits: [],
        allChannelsFailed: true,
        note: `两路皆异常（${ftsFailures.join('；') || 'vector 未配置且 FTS 异常'}）`,
      }
    }

    const fused = rrfFuse(ftsEntries ?? [], vecEntries)
    const lambda = this.getTimeDecayLambda()
    const reranked = rerankByDecayAndConfidence(fused, lambda, Date.now())

    log.debug(
      `memory search "${query.slice(0, 40)}": fts=${ftsEntries?.length ?? 'ERR'} vec=${vecEntries.length} fused=${reranked.length} vector=${vectorServed ? 'served' : 'off'}`,
    )
    const hits = reranked.slice(0, limit)
    // 单侧通道异常但另一侧仍在服务 → degraded（结果可用但如实标注）；
    // 无异常 → matched/empty
    if (ftsFailures.length > 0) {
      // 单侧异常但另一侧服务中 → degraded（命中与否都如实标注，不冒充 empty/matched）
      return { status: 'degraded', hits, note: ftsFailures.join('；') }
    }
    return { status: hits.length > 0 ? 'matched' : 'empty', hits }
  }

  private getTimeDecayLambda(): number {
    const val = this.settingsGet('memory', 'timeDecayLambda')
    if (typeof val === 'number' && val >= 0) return val
    return DEFAULT_TIME_DECAY_LAMBDA
  }
}

// ─── 纯函数（导出供单测） ─────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion：score = Σ 1/(60 + rank)，rank 从 1 开始。
 * 同一条目在两路都命中时贡献相加。
 */
export function rrfFuse(
  ftsEntries: MemoryEntryRow[],
  vecEntries: MemoryEntryRow[],
): MemorySearchHit[] {
  const byId = new Map<string, MemorySearchHit>()

  const addChannel = (entries: MemoryEntryRow[], source: 'fts' | 'vector'): void => {
    entries.forEach((entry, i) => {
      const rank = i + 1
      const contribution = 1 / (RRF_K + rank)
      const existing = byId.get(entry.id)
      if (existing != null) {
        existing.score += contribution
        existing.sources.push(source)
      } else {
        byId.set(entry.id, { entry, score: contribution, sources: [source] })
      }
    })
  }

  addChannel(ftsEntries, 'fts')
  addChannel(vecEntries, 'vector')

  return [...byId.values()].sort((a, b) => b.score - a.score)
}

/**
 * 时间衰减 × confidence 重排：
 * finalScore = rrfScore × exp(-λ · daysSinceUpdated) × confidence
 */
export function rerankByDecayAndConfidence(
  hits: MemorySearchHit[],
  lambda: number,
  now: number,
): MemorySearchHit[] {
  const reranked = hits.map((h) => {
    const updatedAt = h.entry.updated_at ?? h.entry.created_at
    const days = Math.max(0, (now - updatedAt) / 86_400_000)
    const decay = Math.exp(-lambda * days)
    const confidence = typeof h.entry.confidence === 'number' ? h.entry.confidence : 1
    return { ...h, score: h.score * decay * confidence }
  })
  return reranked.sort((a, b) => b.score - a.score)
}
