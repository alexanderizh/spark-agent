/**
 * @module memory-evolution.service.test
 *
 * 单测：MemoryEvolutionService.decide — ADD/UPDATE/DELETE/NOOP 决策 + 降级路径
 *（mock searchRepo + callLLM，不依赖真实 DB / ABI）
 */

import { describe, it, expect, vi } from 'vitest'
import type { MemoryEntryRow, MemorySearchRepository } from '@spark/storage'
import { MemoryEvolutionService } from './memory-evolution.service.js'
import type { MemoryCandidate } from './memory-writer.service.js'

const NOW = Date.now()

function makeEntry(id: string, overrides: Partial<MemoryEntryRow> = {}): MemoryEntryRow {
  return {
    id,
    scope: 'user',
    scope_ref: null,
    type: 'user',
    name: id,
    description: `desc-${id}`,
    file_path: `/tmp/${id}.md`,
    confidence: 1,
    hit_count: 0,
    last_hit_at: null,
    source_session_id: null,
    archived: 0,
    created_at: NOW,
    updated_at: NOW,
    valid_from: NOW,
    invalid_at: null,
    superseded_by: null,
    ...overrides,
  }
}

function makeCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    scope: 'user',
    type: 'user',
    name: 'cand',
    description: 'candidate desc',
    body: 'candidate body',
    confidence: 0.9,
    ...overrides,
  }
}

function makeService(opts: {
  ftsHits?: MemoryEntryRow[] | Error
  llmRaw?: string | Error
}): { svc: MemoryEvolutionService; llmCalls: number } {
  const searchRepo = {
    searchBm25: vi.fn(() => {
      if (opts.ftsHits instanceof Error) throw opts.ftsHits
      return (opts.ftsHits ?? []).map((entry) => ({ entry, bm25: -1 }))
    }),
  } as unknown as MemorySearchRepository
  const llmCalls = { n: 0 }
  const callLLM = vi.fn(async () => {
    llmCalls.n += 1
    if (opts.llmRaw instanceof Error) throw opts.llmRaw
    return opts.llmRaw ?? ''
  })
  return { svc: new MemoryEvolutionService(searchRepo, callLLM), llmCalls: llmCalls.n }
}

describe('MemoryEvolutionService.decide', () => {
  it('no similar entries → ADD without calling LLM', async () => {
    const { svc, llmCalls } = makeService({ ftsHits: [] })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.decision).toBe('ADD')
    expect(v.targetId).toBeNull()
    expect(llmCalls).toBe(0) // 省一次 LLM 调用
  })

  it('LLM returns UPDATE with valid targetId → UPDATE', async () => {
    const existing = makeEntry('usr_a1')
    const { svc } = makeService({
      ftsHits: [existing],
      llmRaw: JSON.stringify({ decision: 'UPDATE', targetId: 'usr_a1', reason: 'refined' }),
    })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.decision).toBe('UPDATE')
    expect(v.targetId).toBe('usr_a1')
    expect(v.reason).toBe('refined')
  })

  it('LLM returns DELETE with valid targetId → DELETE', async () => {
    const existing = makeEntry('usr_b2')
    const { svc } = makeService({
      ftsHits: [existing],
      llmRaw: JSON.stringify({ decision: 'DELETE', targetId: 'usr_b2', reason: '过时' }),
    })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.decision).toBe('DELETE')
    expect(v.targetId).toBe('usr_b2')
  })

  it('LLM returns NOOP → NOOP', async () => {
    const { svc } = makeService({
      ftsHits: [makeEntry('usr_c3')],
      llmRaw: JSON.stringify({ decision: 'NOOP', targetId: null, reason: 'duplicate' }),
    })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.decision).toBe('NOOP')
    expect(v.targetId).toBeNull()
  })

  it('LLM returns ADD → ADD', async () => {
    const { svc } = makeService({
      ftsHits: [makeEntry('usr_d4')],
      llmRaw: JSON.stringify({ decision: 'ADD', targetId: null, reason: 'new fact' }),
    })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.decision).toBe('ADD')
    expect(v.targetId).toBeNull()
  })

  it('UPDATE with targetId not in similar list → conservative ADD', async () => {
    const { svc } = makeService({
      ftsHits: [makeEntry('usr_real')],
      llmRaw: JSON.stringify({ decision: 'UPDATE', targetId: 'usr_fabricated', reason: 'x' }),
    })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.decision).toBe('ADD') // 不安全执行 UPDATE → 退化为 ADD
    expect(v.targetId).toBeNull()
  })

  it('decision in wrong enum value → fallback ADD', async () => {
    const { svc } = makeService({
      ftsHits: [makeEntry('usr_e5')],
      llmRaw: JSON.stringify({ decision: 'MERGE', targetId: null }), // 非法决策
    })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.decision).toBe('ADD')
  })

  it('LLM returns non-JSON → fallback ADD', async () => {
    const { svc } = makeService({
      ftsHits: [makeEntry('usr_e6')],
      llmRaw: 'I think you should add this',
    })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.decision).toBe('ADD')
  })

  it('LLM throws → fallback ADD (never propagates)', async () => {
    const { svc } = makeService({
      ftsHits: [makeEntry('usr_e7')],
      llmRaw: new Error('provider 500'),
    })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.decision).toBe('ADD')
    expect(v.targetId).toBeNull()
  })

  it('FTS recall throws → empty similar → ADD (no LLM call)', async () => {
    const { svc, llmCalls } = makeService({
      ftsHits: new Error('fts corrupted'),
      llmRaw: JSON.stringify({ decision: 'UPDATE', targetId: 'x' }),
    })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.decision).toBe('ADD')
    expect(llmCalls).toBe(0)
  })

  it('decision is case-insensitive', async () => {
    const existing = makeEntry('usr_e8')
    const { svc } = makeService({
      ftsHits: [existing],
      llmRaw: JSON.stringify({ decision: 'update', targetId: 'usr_e8', reason: '' }),
    })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.decision).toBe('UPDATE')
    expect(v.targetId).toBe('usr_e8')
  })

  it('strips ```json wrapper if present', async () => {
    const existing = makeEntry('usr_e9')
    const { svc } = makeService({
      ftsHits: [existing],
      llmRaw: '```json\n{"decision":"DELETE","targetId":"usr_e9","reason":"old"}\n```',
    })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.decision).toBe('DELETE')
    expect(v.targetId).toBe('usr_e9')
  })

  it('reason is truncated to 200 chars', async () => {
    const long = 'x'.repeat(500)
    const { svc } = makeService({
      ftsHits: [makeEntry('usr_e10')],
      llmRaw: JSON.stringify({ decision: 'NOOP', targetId: null, reason: long }),
    })
    const v = await svc.decide(makeCandidate(), 'user', null)
    expect(v.reason.length).toBe(200)
  })
})
