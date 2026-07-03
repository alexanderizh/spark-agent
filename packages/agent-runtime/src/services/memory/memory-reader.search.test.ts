/**
 * @module memory-reader.search.test
 *
 * V2 注入策略单测（mock，不依赖真实 DB / ABI）：
 *   - feedback 始终全量注入（即便 search 召回里没有）
 *   - searchService + seedQuery：非 feedback 按 search 排序注入
 *   - search 返回 null / 空 / 抛错：回退 V1 优先级排序
 *   - token 预算：feedback 优先，余量给非 feedback
 */

import { describe, it, expect } from 'vitest'
import type { MemoryEntryRow, MemoryScopeFilter } from '@spark/storage'
import { MemoryReaderService } from './memory-reader.service.js'
import type { MemorySearchService, MemorySearchHit } from './memory-search.service.js'

const NOW = Date.now()

function makeEntry(
  id: string,
  overrides: Partial<MemoryEntryRow> = {},
): MemoryEntryRow {
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

/** 把 listByScope 的返回值按 (scope, scopeRef) 组织，支持 type 过滤 */
function makeRepo(
  byScope: Record<string, MemoryEntryRow[]>,
): never {
  const listByScope = (
    scope: string,
    scopeRef: string | null,
    opts?: { type?: string },
  ): MemoryEntryRow[] => {
    const key = `${scope}:${scopeRef ?? ''}`
    const rows = byScope[key] ?? []
    return opts?.type != null ? rows.filter((r) => r.type === opts.type) : rows
  }
  return { listByScope } as never
}

function makeSearch(hitsByQuery: Map<string, MemoryEntryRow[]>): {
  svc: MemorySearchService
  calls: string[]
} {
  const calls: string[] = []
  const svc = {
    search: async (query: string, _opts?: { scopes?: MemoryScopeFilter[]; limit?: number }):
      Promise<MemorySearchHit[] | null> => {
      calls.push(query)
      const hits = hitsByQuery.get(query) ?? []
      return hits.map((entry, i) => ({ entry, score: 10 - i, sources: ['fts'] as Array<'fts' | 'vector'> }))
    },
  } as never as MemorySearchService
  return { svc, calls }
}

describe('MemoryReaderService V2 injection (search-driven)', () => {
  it('feedback always injected even when search returns nothing for it', async () => {
    const feedback = makeEntry('fb1', { type: 'feedback', hit_count: 5, description: '别用 console.log' })
    const repo = makeRepo({ 'user:': [feedback] })
    const { svc } = makeSearch(new Map([['seed', []]])) // search returns nothing
    const reader = new MemoryReaderService(repo, {} as never, () => null, svc)
    const res = await reader.loadForSession({ workspaceId: 'ws', agentId: 'a1', seedQuery: 'seed' })
    expect(res.injectedIds).toContain('fb1')
  })

  it('non-feedback ordered by search ranking when search hits', async () => {
    const feedback = makeEntry('fb', { type: 'feedback' })
    const u1 = makeEntry('u1', { type: 'user' })
    const u2 = makeEntry('u2', { type: 'user' })
    const u3 = makeEntry('u3', { type: 'user' })
    const repo = makeRepo({ 'user:': [feedback, u1, u2, u3] })
    // search 返回顺序 u3, u1（u2 不在召回里 → 不应注入，因为 V2 只注入召回子集）
    const { svc } = makeSearch(new Map([['seed', [u3, u1]]]))
    const reader = new MemoryReaderService(repo, {} as never, () => null, svc)
    const res = await reader.loadForSession({ workspaceId: 'ws', agentId: 'a1', seedQuery: 'seed' })
    // feedback 在前，其余按 search 排序
    expect(res.injectedIds).toEqual(['fb', 'u3', 'u1'])
  })

  it('search returns null → fallback to V1 priority sort (all non-feedback injected)', async () => {
    const feedback = makeEntry('fb', { type: 'feedback' })
    const u1 = makeEntry('u1', { type: 'user', hit_count: 1 })
    const p1 = makeEntry('p1', { type: 'project', hit_count: 9 })
    const repo = makeRepo({ 'user:': [feedback, u1], 'project:ws': [p1] })
    const nullSearch = { search: async () => null } as never as MemorySearchService
    const reader = new MemoryReaderService(repo, {} as never, () => null, nullSearch)
    const res = await reader.loadForSession({ workspaceId: 'ws', agentId: 'a1', seedQuery: 'seed' })
    // 回退 V1：feedback(user-prio 0) → user → project；全部注入（不只召回子集）
    expect(res.injectedIds).toEqual(['fb', 'u1', 'p1'])
  })

  it('search throws → fallback to V1 without propagating error', async () => {
    const u1 = makeEntry('u1', { type: 'user' })
    const repo = makeRepo({ 'user:': [u1] })
    const throwingSearch = {
      search: async () => { throw new Error('boom') },
    } as never as MemorySearchService
    const reader = new MemoryReaderService(repo, {} as never, () => null, throwingSearch)
    const res = await reader.loadForSession({ workspaceId: 'ws', agentId: 'a1', seedQuery: 'seed' })
    expect(res.injectedIds).toContain('u1')
  })

  it('no searchService (V1 mode): feedback-first then user/project/reference', async () => {
    const feedback = makeEntry('fb', { type: 'feedback' })
    const ref = makeEntry('r1', { type: 'reference' })
    const usr = makeEntry('u1', { type: 'user' })
    const proj = makeEntry('p1', { type: 'project' })
    const repo = makeRepo({ 'user:': [feedback, ref, usr], 'project:ws': [proj] })
    const reader = new MemoryReaderService(repo, {} as never, () => null, null)
    const res = await reader.loadForSession({ workspaceId: 'ws', agentId: 'a1' })
    // feedback(user-prio0) → user(1) → project(2) → reference(3)
    expect(res.injectedIds).toEqual(['fb', 'u1', 'p1', 'r1'])
  })

  it('token budget: feedback gets priority, non-feedback trimmed first', async () => {
    const feedback = makeEntry('fb', { type: 'feedback', description: 'short' })
    const big1 = makeEntry('b1', { type: 'user', description: 'X'.repeat(2000) })
    const big2 = makeEntry('b2', { type: 'user', description: 'Y'.repeat(2000) })
    const repo = makeRepo({ 'user:': [feedback, big1, big2] })
    const { svc } = makeSearch(new Map([['seed', [big1, big2]]]))
    const getTokens = (cat: string, key: string): unknown | null =>
      cat === 'memory' && key === 'maxInjectTokens' ? 1500 : null
    const reader = new MemoryReaderService(repo, {} as never, getTokens, svc)
    const res = await reader.loadForSession({ workspaceId: 'ws', agentId: 'a1', seedQuery: 'seed' })
    expect(res.injectedIds).toContain('fb') // feedback 必入
    expect(res.injectedIds).toHaveLength(1) // 预算只够 feedback，两个大条目被裁
    expect(res.droppedCount).toBe(2)
  })

  it('memory.enabled=false → empty block regardless of search', async () => {
    const feedback = makeEntry('fb', { type: 'feedback' })
    const repo = makeRepo({ 'user:': [feedback] })
    const { svc, calls } = makeSearch(new Map([['seed', [feedback]]]))
    const getEnabled = (cat: string, key: string): unknown | null =>
      cat === 'memory' && key === 'enabled' ? false : null
    const reader = new MemoryReaderService(repo, {} as never, getEnabled, svc)
    const res = await reader.loadForSession({ workspaceId: 'ws', agentId: 'a1', seedQuery: 'seed' })
    expect(res.block).toBe('')
    expect(res.injectedIds).toEqual([])
    expect(calls).toHaveLength(0) // 关闭时不触发检索
  })
})
