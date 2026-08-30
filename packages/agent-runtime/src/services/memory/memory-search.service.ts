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

export class MemorySearchService {
  constructor(
    private readonly searchRepo: MemorySearchRepository,
    private readonly embeddingService: EmbeddingService | null,
    private readonly settingsGet: (category: string, key: string) => unknown | null,
  ) {}

  /**
   * 混合检索。
   *
   * @returns 命中列表；**FTS 路径本身异常时返回 null**（区别于空结果 []），
   *          调用方据此退回 V1 全量注入。
   */
  async search(query: string, opts?: MemorySearchOptions): Promise<MemorySearchHit[] | null> {
    const limit = opts?.limit ?? 10
    const channelOpts = {
      ...(opts?.scopes != null ? { scopes: opts.scopes } : {}),
      ...(opts?.type != null ? { type: opts.type } : {}),
      limit: CANDIDATES_PER_CHANNEL,
    }

    // ── FTS 路径 ──
    let ftsEntries: MemoryEntryRow[] | null
    try {
      ftsEntries = this.searchRepo.searchBm25(query, channelOpts).map((h) => h.entry)
    } catch (err) {
      log.warn(`FTS search failed: ${err instanceof Error ? err.message : String(err)}`)
      ftsEntries = null
    }

    // ── 向量路径（不可用自动降级） ──
    let vecEntries: MemoryEntryRow[] = []
    let vectorEnabled = false
    if (this.embeddingService != null) {
      try {
        const vectors = await this.embeddingService.embedTexts([query])
        if (vectors != null && vectors.length > 0) {
          vectorEnabled = true
          vecEntries = this.searchRepo.searchKnn(vectors[0]!, channelOpts).map((h) => h.entry)
        }
      } catch (err) {
        log.warn(`vector search failed, degrading to FTS-only: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (!vectorEnabled) {
      log.debug('memory search: vector=disabled (FTS-only)')
    }

    // FTS 挂了且向量也没有 → 通知调用方退回 V1 全量注入
    if (ftsEntries == null && !vectorEnabled) return null

    const fused = rrfFuse(ftsEntries ?? [], vecEntries)
    const lambda = this.getTimeDecayLambda()
    const reranked = rerankByDecayAndConfidence(fused, lambda, Date.now())

    log.debug(
      `memory search "${query.slice(0, 40)}": fts=${ftsEntries?.length ?? 'ERR'} vec=${vecEntries.length} fused=${reranked.length} vector=${vectorEnabled ? 'enabled' : 'disabled'}`,
    )
    return reranked.slice(0, limit)
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
