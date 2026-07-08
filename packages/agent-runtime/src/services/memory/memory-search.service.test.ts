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
})

// ─── 检索路径（有/无向量） ────────────────────────────────────────────────

function makeService(opts: {
  ftsResults?: MemoryEntryRow[] | Error
  vectors?: number[][] | null
  knnResults?: MemoryEntryRow[]
}) {
  const searchRepo = {
    searchBm25: vi.fn(() => {
      if (opts.ftsResults instanceof Error) throw opts.ftsResults
      return (opts.ftsResults ?? []).map((entry) => ({ entry, bm25: -1 }))
    }),
    searchKnn: vi.fn(() => (opts.knnResults ?? []).map((entry) => ({ entry, distance: 0.1 }))),
  }
  const embeddingService = {
    embedTexts: vi.fn(async () => opts.vectors ?? null),
  }
  const svc = new MemorySearchService(
    searchRepo as never,
    embeddingService as never,
    () => null,
  )
  return { svc, searchRepo, embeddingService }
}

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
    const embeddingService = { embedTexts: vi.fn(async () => { throw new Error('provider 500') }) }
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
