/**
 * @module wiki-candidate.repository.test
 *
 * 候选确认区仓储测试（S2 §9.4 人审门 / §9.3 去重与容量）。
 *
 * 断言重点是**闸门语义**：同摘要不重复征集、确认是一次性状态迁移、摘要
 * 绑定（所见即所存）、payload 损坏不采信、确认后可条件回滚。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '@spark/storage'
import {
  WikiCandidateRepository,
  hashWikiCandidateContent,
  WIKI_DEFAULT_MAX_PENDING,
  WIKI_DEFAULT_TTL_MS,
  type WikiCandidatePayload,
} from '@spark/storage'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

function payload(overrides: Partial<WikiCandidatePayload> = {}): WikiCandidatePayload {
  return {
    kind: 'experience',
    title: 'FTS5 contentless 增量更新必须显式 DELETE',
    summary: 'contentless 表不存原文，增量更新要显式清理旧行。',
    body: '## 是什么\n…\n## 为什么\n…',
    tags: ['sqlite'],
    confidence: 0.82,
    sources: [{ sessionId: 'sess_1', turnIndex: 3, excerpt: 'contentless 不会自动清旧行' }],
    ...overrides,
  }
}

describe('WikiCandidateRepository', () => {
  let db: SparkDatabase
  let repo: WikiCandidateRepository
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `spark-wiki-cand-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))
    repo = new WikiCandidateRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('插入 pending 并带上 TTL 与摘要', () => {
    const result = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    expect(result.inserted).toBe(true)
    const row = result.row!
    expect(row.status).toBe('pending')
    expect(row.expires_at - row.created_at).toBe(WIKI_DEFAULT_TTL_MS)
    expect(row.content_digest).toBe(hashWikiCandidateContent(payload()))
  })

  it('同 scope 同摘要不重复征集（含已拒绝的）', () => {
    const first = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    expect(first.inserted).toBe(true)
    repo.reject(first.row!.id)

    const second = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    expect(second.inserted).toBe(false)
    expect(second.row!.id).toBe(first.row!.id)
  })

  it('【AutoDream】同内容不同 action/targetId 是不同提案（不被旧候选吞掉）', () => {
    const create = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    expect(create.inserted).toBe(true)
    repo.reject(create.row!.id)

    // 梦境轨：同页面的 update/delete 提案与已拒绝的 create 内容相近，
    // 但语义完全不同——判重摘要必须区分（action/targetId 纳入哈希）。
    const update = repo.insertPending({
      scope: 'user',
      scopeRef: null,
      payload: payload({ action: 'update', targetId: 'wp-1' }),
    })
    expect(update.inserted).toBe(true)
    expect(update.row!.id).not.toBe(create.row!.id)

    const del = repo.insertPending({
      scope: 'user',
      scopeRef: null,
      payload: payload({ action: 'delete', targetId: 'wp-1' }),
    })
    expect(del.inserted).toBe(true)

    // 相同 action+targetId 的重复提案仍被吞（防同结论刷屏）
    const dup = repo.insertPending({
      scope: 'user',
      scopeRef: null,
      payload: payload({ action: 'update', targetId: 'wp-1' }),
    })
    expect(dup.inserted).toBe(false)
  })

  it('不同 scope 的同摘要各自征集', () => {
    const a = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    const b = repo.insertPending({
      scope: 'project',
      scopeRef: 'ws_1',
      payload: payload(),
    })
    expect(a.inserted).toBe(true)
    expect(b.inserted).toBe(true)
    expect(a.row!.id).not.toBe(b.row!.id)
  })

  it('过期 pending 在下次插入时被清扫', () => {
    const now = 1_000_000
    repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() }, { now, ttlMs: 10 })
    expect(repo.countPending('user', null)).toBe(1)

    repo.insertPending(
      { scope: 'user', scopeRef: null, payload: payload({ title: '另一条知识' }) },
      { now: now + 100 },
    )
    expect(repo.countPending('user', null)).toBe(1)
    expect(repo.listByStatus('expired', { scope: 'user', scopeRef: null })).toHaveLength(1)
  })

  it('容量上限：溢出淘汰最早的 pending', () => {
    const maxPending = 3
    for (let index = 0; index < 5; index += 1) {
      repo.insertPending(
        { scope: 'user', scopeRef: null, payload: payload({ title: `知识 ${index}` }) },
        { maxPending, ttlMs: WIKI_DEFAULT_TTL_MS },
      )
    }
    expect(repo.countPending('user', null)).toBe(maxPending)
    const titles = repo
      .listByStatus('pending', { scope: 'user', scopeRef: null })
      .map((row) => repo.parsePayload(row)!.title)
    expect(titles).toEqual(['知识 4', '知识 3', '知识 2'])
  })

  it('默认容量上限与方案 §9.6 一致（200）', () => {
    expect(WIKI_DEFAULT_MAX_PENDING).toBe(200)
  })

  it('payload 损坏返回 null（不采信不可解析内容）', () => {
    const result = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    const row = result.row!
    db.raw
      .prepare(`UPDATE wiki_candidate SET payload_json = ? WHERE id = ?`)
      .run('{ not json', row.id)
    expect(repo.parsePayload(repo.getById(row.id)!)).toBeNull()
  })

  it('payload 缺来源被拒（强制溯源）', () => {
    const result = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    const row = result.row!
    db.raw
      .prepare(`UPDATE wiki_candidate SET payload_json = ? WHERE id = ?`)
      .run(JSON.stringify({ ...payload(), sources: [] }), row.id)
    expect(repo.parsePayload(repo.getById(row.id)!)).toBeNull()
  })

  // ─── 确认闸门 ──────────────────────────────────────────────────────

  it('确认：一次性状态迁移 + decided_via 固定 user_ipc', () => {
    const { row } = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    const digest = row!.content_digest
    const confirmed = repo.confirm(row!.id, digest)
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(confirmed.candidate.status).toBe('confirmed')
    expect(confirmed.candidate.decided_via).toBe('user_ipc')

    // 重复确认失败（一次性）
    const again = repo.confirm(row!.id, digest)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.reason).toBe('not_pending')
  })

  it('确认摘要失配拒绝（所见即所存，新内容不能继承旧确认）', () => {
    const { row } = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    const result = repo.confirm(row!.id, 'deadbeefdeadbeefdeadbeefdeadbeef')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('digest_mismatch')
  })

  it('载荷被改写后旧摘要确认失配（摘要列未同步的场景）', () => {
    const { row } = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    const digest = row!.content_digest
    db.raw
      .prepare(`UPDATE wiki_candidate SET payload_json = ? WHERE id = ?`)
      .run(JSON.stringify(payload({ body: '被改写过的正文' })), row!.id)
    const result = repo.confirm(row!.id, digest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('digest_mismatch')
  })

  it('过期候选确认被拒绝并标记 expired', () => {
    const { row } = repo.insertPending(
      { scope: 'user', scopeRef: null, payload: payload() },
      { now: 1_000, ttlMs: 10 },
    )
    const result = repo.confirm(row!.id, row!.content_digest, 10_000)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('expired')
    expect(repo.getById(row!.id)!.status).toBe('expired')
  })

  it('payload 损坏时确认拒绝（不把损坏内容晋级）', () => {
    const { row } = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    db.raw
      .prepare(`UPDATE wiki_candidate SET payload_json = ? WHERE id = ?`)
      .run('{ not json', row!.id)
    const result = repo.confirm(row!.id, row!.content_digest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('payload_unreadable')
  })

  // ─── 回滚 / 拒绝 / 回填 ────────────────────────────────────────────

  it('确认后未晋级可条件回滚为 pending；已回填页面后不回滚', () => {
    const { row } = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    repo.confirm(row!.id, row!.content_digest)
    expect(repo.revertToPendingIfUnattached(row!.id)).toBe(true)
    expect(repo.getById(row!.id)!.status).toBe('pending')

    repo.confirm(row!.id, row!.content_digest)
    repo.attachPage(row!.id, 'wp_abc')
    expect(repo.revertToPendingIfUnattached(row!.id)).toBe(false)
    expect(repo.getById(row!.id)!.status).toBe('confirmed')
  })

  it('拒绝：pending → rejected；非 pending 幂等', () => {
    const { row } = repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    expect(repo.reject(row!.id).ok).toBe(true)
    expect(repo.getById(row!.id)!.status).toBe('rejected')
    expect(repo.reject(row!.id).ok).toBe(false)
  })

  it('expireStale 幂等清扫', () => {
    repo.insertPending(
      { scope: 'user', scopeRef: null, payload: payload() },
      { now: 1_000, ttlMs: 10 },
    )
    expect(repo.expireStale(5_000)).toBe(1)
    expect(repo.expireStale(6_000)).toBe(0)
  })

  it('countPendingByScope 按作用域聚合', () => {
    repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    repo.insertPending({
      scope: 'project',
      scopeRef: 'ws_1',
      payload: payload({ title: '另一条' }),
    })
    const counts = repo.countPendingByScope()
    expect(counts).toHaveLength(2)
    expect(counts.find((c) => c.scope === 'user')!.n).toBe(1)
    expect(counts.find((c) => c.scope === 'project')!.scope_ref).toBe('ws_1')
  })

  it('scope_ref 为 NULL 时去重与计数仍按作用域隔离', () => {
    repo.insertPending({ scope: 'user', scopeRef: null, payload: payload() })
    // 同 scope 但不同 scopeRef：不是同一条候选
    const other = repo.insertPending({ scope: 'user', scopeRef: 'ws_x', payload: payload() })
    expect(other.inserted).toBe(true)
    expect(repo.countPending('user', null)).toBe(1)
    expect(repo.countPending('user', 'ws_x')).toBe(1)
  })
})
