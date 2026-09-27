/**
 * @module memory-search.service.test
 *
 * 单元测试：RRF 融合、时间衰减重排、有/无向量两条检索路径、降级链
 */

import { describe, it, expect, vi } from 'vitest'
import type { MemoryEntryRow } from '@spark/storage'
import {
  MemorySearchService,
  rrfFuse,
  rerankByDecayAndConfidence,
} from './memory-search.service.js'
import type { MemorySearchHit } from './memory-search.service.js'

function makeEntry(id: string, overrides: Partial<MemoryEntryRow> = {}): MemoryEntryRow {
  const now = Date.now()
  return {
    id,
    scope: 'user',
    scope_ref: null,
    type: 'user',
    name: `entry-${id}`,
    description: `description of ${id}`,
    file_path: `/tmp/${id}.md`,
    confidence: 1,
    hit_count: 0,
    last_hit_at: null,
    source_session_id: null,
    archived: 0,
    version: 1,
    content_hash: null,
    source_event_id: null,
    source_turn_id: null,
    author_role: null,
    author_agent_id: null,
    extraction_kind: null,
    extraction_model: null,
    evidence_status: 'available',
    valid_until: null,
    valid_until_meta: null,
    created_at: now,
    updated_at: now,
    valid_from: now,
    invalid_at: null,
    superseded_by: null,
    ...overrides,
  }
}

// ─── RRF ──────────────────────────────────────────────────────────────────

describe('rrfFuse', () => {
  it('entry hit by both channels outranks single-channel hits', () => {
    const shared = makeEntry('both')
    const ftsOnly = makeEntry('fts-only')
    const vecOnly = makeEntry('vec-only')
    // shared 在两路都排第 2，单路条目各排第 1
    const fused = rrfFuse([ftsOnly, shared], [vecOnly, shared])
    expect(fused[0]!.entry.id).toBe('both')
    // 1/(60+2)+1/(60+2) > 1/(60+1)
    expect(fused[0]!.score).toBeCloseTo(2 / 62, 10)
    expect(fused[0]!.sources).toEqual(['fts', 'vector'])
  })

  it('channel-exclusive hits keep correct relative order', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const c = makeEntry('c')
    const d = makeEntry('d')
    const fused = rrfFuse([a, b], [c, d])
    // 两路 rank1 (a, c) 并列在前，rank2 (b, d) 在后
    const scores = fused.map((h) => h.score)
    expect(scores[0]).toBeCloseTo(1 / 61, 10)
    expect(scores[1]).toBeCloseTo(1 / 61, 10)
    expect(scores[2]).toBeCloseTo(1 / 62, 10)
    expect(scores[3]).toBeCloseTo(1 / 62, 10)
    expect(new Set(fused.slice(0, 2).map((h) => h.entry.id))).toEqual(new Set(['a', 'c']))
  })

  it('handles empty channels', () => {
    expect(rrfFuse([], [])).toEqual([])
    const only = rrfFuse([makeEntry('x')], [])
    expect(only).toHaveLength(1)
    expect(only[0]!.sources).toEqual(['fts'])
  })
})

// ─── 时间衰减 ─────────────────────────────────────────────────────────────

describe('rerankByDecayAndConfidence', () => {
  const now = Date.now()

  function hit(id: string, overrides: Partial<MemoryEntryRow>, score: number): MemorySearchHit {
    return { entry: makeEntry(id, overrides), score, sources: ['fts'] }
  }

  it('same RRF score: newer entry ranks first', () => {
    const fresh = hit('fresh', { updated_at: now }, 0.5)
    const stale = hit('stale', { updated_at: now - 100 * 86_400_000 }, 0.5)
    const out = rerankByDecayAndConfidence([stale, fresh], 0.01, now)
    expect(out[0]!.entry.id).toBe('fresh')
    expect(out[0]!.score).toBeCloseTo(0.5, 5)
    expect(out[1]!.score).toBeCloseTo(0.5 * Math.exp(-1), 5) // 100 天 × 0.01
  })

  it('confidence multiplies into the final score', () => {
    const confident = hit('hi', { updated_at: now, confidence: 1.0 }, 0.5)
    const doubtful = hit('lo', { updated_at: now, confidence: 0.6 }, 0.5)
    const out = rerankByDecayAndConfidence([doubtful, confident], 0.01, now)
    expect(out[0]!.entry.id).toBe('hi')
    expect(out[1]!.score).toBeCloseTo(0.3, 5)
  })

  it('lambda=0 disables decay', () => {
    const old = hit('old', { updated_at: now - 365 * 86_400_000 }, 0.5)
    const out = rerankByDecayAndConfidence([old], 0, now)
    expect(out[0]!.score).toBeCloseTo(0.5, 5)
  })

  // ─── S0（E8）：新旧竞争口径固化（S3 校正基线，非缺陷） ────────────────
  // 依据 docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S0/E8 与
  // docs/plans/2026-09-26-memory-evidence-and-temporal-semantics.md §4：
  // 本用例把"等龄排序不变"之外的新旧竞争现状口径固定下来 —— 默认
  // lambda=0.01 下时间衰减主导（365 天 → exp(-3.65) ≈ 2.6%），置信度
  // 乘子（0.6~1.0）的差异被完全掩盖。S3 分类型衰减/复核实验若调整口径，
  // 应更新本断言并注明实验依据。
  it('新旧竞争口径（S3 校正基线）：一年前高置信 vs 今天低置信，时间衰减主导、新条目胜出', () => {
    const aged = hit('aged', { updated_at: now - 365 * 86_400_000, confidence: 1.0 }, 0.5)
    const fresh = hit('fresh', { updated_at: now, confidence: 0.6 }, 0.5)
    const out = rerankByDecayAndConfidence([aged, fresh], 0.01, now)
    expect(out[0]!.entry.id).toBe('fresh')
    // 口径记录：旧条目得分 0.5 × exp(-3.65) × 1.0 ≈ 0.0129，
    // 置信度 1.0 不足以弥补一年时间衰减。
    expect(out[1]!.score).toBeCloseTo(0.5 * Math.exp(-3.65), 5)
  })
})

// ─── 检索路径（有/无向量） ────────────────────────────────────────────────

function makeService(opts: {
  ftsResults?: MemoryEntryRow[] | Error
  vectors?: number[][] | null
  knnResults?: MemoryEntryRow[]
  knnThrows?: Error
  enabled?: unknown
}) {
  const searchRepo = {
    searchBm25: vi.fn(() => {
      if (opts.ftsResults instanceof Error) throw opts.ftsResults
      return (opts.ftsResults ?? []).map((entry) => ({ entry, bm25: -1 }))
    }),
    searchKnn: vi.fn(() => {
      if (opts.knnThrows != null) throw opts.knnThrows
      return (opts.knnResults ?? []).map((entry) => ({ entry, distance: 0.1 }))
    }),
  }
  const embeddingService = {
    // S1B.3：embedTexts 返回 { vectors, generation }，检索路径只用向量
    embedTexts: vi.fn(async () =>
      opts.vectors != null ? { vectors: opts.vectors, generation: 1 } : null,
    ),
  }
  const settings: Record<string, unknown> = {
    enabled: opts.enabled === undefined ? null : opts.enabled,
  }
  const svc = new MemorySearchService(
    searchRepo as never,
    embeddingService as never,
    (cat: string, key: string) => (cat === 'memory' ? (settings[key] ?? null) : null),
  )
  return { svc, searchRepo, embeddingService }
}

describe('MemorySearchService.searchWithStatus（S3.1 四态接口）', () => {
  it('matched：正常检索有命中', async () => {
    const a = makeEntry('hit-1')
    const { svc } = makeService({ ftsResults: [a], vectors: null })
    const r = await svc.searchWithStatus('query')
    expect(r.status).toBe('matched')
    expect(r.hits.map((h) => h.entry.id)).toEqual(['hit-1'])
    expect(r.note).toBeUndefined()
  })

  it('empty：正常检索无命中（FTS-only 属按设计运行，不算 degraded）', async () => {
    const { svc } = makeService({ ftsResults: [], vectors: null })
    const r = await svc.searchWithStatus('query')
    expect(r.status).toBe('empty')
    expect(r.hits).toEqual([])
  })

  it('degraded（单侧）：FTS 异常但向量服务中 → 结果可用但如实标注，不冒充 empty', async () => {
    const a = makeEntry('vec-only-hit')
    const { svc } = makeService({
      ftsResults: new Error('fts5 table corrupted'),
      vectors: [[0.1, 0.2]],
      knnResults: [a],
    })
    const r = await svc.searchWithStatus('query')
    expect(r.status).toBe('degraded')
    expect(r.hits.map((h) => h.entry.id)).toEqual(['vec-only-hit'])
    expect(r.note).toContain('fts')
  })

  it('degraded（单侧）：knn 异常但 FTS 服务中 → degraded（旧实现角落：此处曾误报为正常空/命中）', async () => {
    const a = makeEntry('fts-only-hit')
    const { svc } = makeService({
      ftsResults: [a],
      vectors: [[0.1, 0.2]],
      knnThrows: new Error('vec0 virtual table error'),
    })
    const r = await svc.searchWithStatus('query')
    expect(r.status).toBe('degraded')
    expect(r.note).toContain('vector')
  })

  it('degraded（两路皆异常）：hits 空 + note 标注；旧签名 search() 映射为 null（V1 fallback 独立可测）', async () => {
    const { svc } = makeService({
      ftsResults: new Error('fts boom'),
      vectors: [[0.1, 0.2]],
      knnThrows: new Error('knn boom'),
    })
    const r = await svc.searchWithStatus('query')
    expect(r.status).toBe('degraded')
    expect(r.hits).toEqual([])
    expect(r.note).toContain('两路皆异常')
    // 故障 ≠ 空结果：旧签名 null 触发调用方退回 V1 全量注入
    expect(await svc.search('query')).toBeNull()
  })

  it('disabled：memory.enabled=false → 不触碰检索通道', async () => {
    const { svc, searchRepo, embeddingService } = makeService({
      ftsResults: [makeEntry('x')],
      vectors: [[0.1]],
      enabled: false,
    })
    const r = await svc.searchWithStatus('query')
    expect(r.status).toBe('disabled')
    expect(r.hits).toEqual([])
    expect(searchRepo.searchBm25).not.toHaveBeenCalled()
    expect(embeddingService.embedTexts).not.toHaveBeenCalled()
  })

  it('旧签名兼容：matched/empty/degraded-served 均返回 hits 数组（不触发 null fallback）', async () => {
    const a = makeEntry('ok')
    const m = makeService({ ftsResults: [a], vectors: null })
    const matched = await m.svc.search('query')
    expect(matched).not.toBeNull()
    expect(matched!.map((h) => h.entry.id)).toEqual(['ok'])
    const e = makeService({ ftsResults: [], vectors: null })
    expect(await e.svc.search('query')).toEqual([])
    const d = makeService({
      ftsResults: new Error('fts down'),
      vectors: [[0.1]],
      knnResults: [a],
    })
    const served = await d.svc.search('query')
    expect(served).not.toBeNull()
    expect(served!.map((h) => h.entry.id)).toEqual(['ok'])
  })
})

describe('MemorySearchService.search', () => {
  it('no vector capability: FTS-only path returns results', async () => {
    const a = makeEntry('a')
    const { svc, searchRepo, embeddingService } = makeService({ ftsResults: [a], vectors: null })
    const hits = await svc.search('query')
    expect(hits).not.toBeNull()
    expect(hits!.map((h) => h.entry.id)).toEqual(['a'])
    expect(hits![0]!.sources).toEqual(['fts'])
    expect(embeddingService.embedTexts).toHaveBeenCalled()
    expect(searchRepo.searchKnn).not.toHaveBeenCalled()
  })

  it('with vector capability: fuses both channels, dual-hit ranks first', async () => {
    const shared = makeEntry('shared')
    const ftsOnly = makeEntry('fts-only')
    const vecOnly = makeEntry('vec-only')
    const { svc } = makeService({
      ftsResults: [ftsOnly, shared],
      vectors: [[0.1, 0.2]],
      knnResults: [vecOnly, shared],
    })
    const hits = await svc.search('query')
    expect(hits).not.toBeNull()
    expect(hits![0]!.entry.id).toBe('shared')
    expect(hits![0]!.sources).toContain('fts')
    expect(hits![0]!.sources).toContain('vector')
  })

  it('vector channel can recall entries FTS misses (semantic query)', async () => {
    const semantic = makeEntry('semantic')
    const { svc } = makeService({ ftsResults: [], vectors: [[0.5]], knnResults: [semantic] })
    const hits = await svc.search('UI 组件库怎么选')
    expect(hits!.map((h) => h.entry.id)).toEqual(['semantic'])
    expect(hits![0]!.sources).toEqual(['vector'])
  })

  it('embedding throws mid-flight: degrades to FTS-only without throwing', async () => {
    const a = makeEntry('a')
    const searchRepo = {
      searchBm25: vi.fn(() => [{ entry: a, bm25: -1 }]),
      searchKnn: vi.fn(),
    }
    const embeddingService = {
      embedTexts: vi.fn(async () => {
        throw new Error('provider 500')
      }),
    }
    const svc = new MemorySearchService(searchRepo as never, embeddingService as never, () => null)
    const hits = await svc.search('query')
    expect(hits).not.toBeNull()
    expect(hits!.map((h) => h.entry.id)).toEqual(['a'])
  })

  it('FTS throws and vector unavailable: returns null (caller falls back to V1 injection)', async () => {
    const { svc } = makeService({ ftsResults: new Error('fts corrupted'), vectors: null })
    const hits = await svc.search('query')
    expect(hits).toBeNull()
  })

  it('FTS throws but vector works: vector-only results, not null', async () => {
    const v = makeEntry('v')
    const { svc } = makeService({ ftsResults: new Error('boom'), vectors: [[1]], knnResults: [v] })
    const hits = await svc.search('query')
    expect(hits).not.toBeNull()
    expect(hits!.map((h) => h.entry.id)).toEqual(['v'])
  })

  it('respects limit', async () => {
    const entries = Array.from({ length: 15 }, (_, i) => makeEntry(`e${i}`))
    const { svc } = makeService({ ftsResults: entries, vectors: null })
    const hits = await svc.search('query', { limit: 5 })
    expect(hits).toHaveLength(5)
  })

  it('works without an embedding service (null)', async () => {
    const a = makeEntry('a')
    const searchRepo = {
      searchBm25: vi.fn(() => [{ entry: a, bm25: -1 }]),
      searchKnn: vi.fn(),
    }
    const svc = new MemorySearchService(searchRepo as never, null, () => null)
    const hits = await svc.search('query')
    expect(hits!.map((h) => h.entry.id)).toEqual(['a'])
  })
})
