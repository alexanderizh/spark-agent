/**
 * @module memory-candidate.service.test
 *
 * 单元测试（真实 DB）：MemoryCandidateService（S2.3 候选确认入口）
 *
 * 覆盖（主计划 S2 验收矩阵 + N1/N2/N12）：
 *   - 确认晋级 happy path：按候选原文创建条目（来源标注 consolidation）+
 *     派生边 + 投影；候选 confirmed 且 entry_id 回填
 *   - 摘要绑定：错误摘要确认拒绝（改写后不能沿用旧确认）；候选行摘要被
 *     改写后旧摘要确认失配
 *   - 一次性：重复确认 → not_pending；拒绝后再确认 → not_pending
 *   - 过期：pending 超时 → expired，确认拒绝
 *   - 容量：超出上限的最早 pending 被淘汰为 expired
 *   - 确认只覆盖指定版本：晋级后条目被更新（v2）→ isConfirmationCurrent
 *     如实报告过时；未更新时为当前
 *   - payload 不可解析：不创建条目（不按不可读内容晋级）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MemoryCandidateRepository,
  MemoryRepository,
  MemoryRevisionRepository,
  MemorySearchRepository,
  SparkDatabase,
  hashCandidateContent,
} from '@spark/storage'
import { MemoryCommitService } from './memory-commit.service.js'
import { MemoryCandidateService } from './memory-candidate.service.js'
import { MemoryStoreService } from './memory-store.service.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

const DAY_MS = 86_400_000

describe('MemoryCandidateService（S2.3 候选确认入口）', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let candidateRepo: MemoryCandidateRepository
  let revisionRepo: MemoryRevisionRepository
  let searchRepo: MemorySearchRepository
  let store: MemoryStoreService
  let service: MemoryCandidateService
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-candidate-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
    repo = new MemoryRepository(db)
    candidateRepo = new MemoryCandidateRepository(db)
    revisionRepo = new MemoryRevisionRepository(db)
    searchRepo = new MemorySearchRepository(db)
    store = new MemoryStoreService(testDir, join(testDir, 'ws'))
    service = new MemoryCandidateService(
      candidateRepo,
      new MemoryCommitService(repo, store),
      repo,
      revisionRepo,
      store,
    )
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  /** 预置两条来源条目（模拟 ELEVATE 的低阶依据） */
  async function seedSource(name: string): Promise<string> {
    const id = `usr_${Math.random().toString(36).slice(2, 10)}`
    const filePath = await store.writeFile({
      meta: {
        id,
        scope: 'user',
        scopeRef: null,
        type: 'feedback',
        name,
        description: `来源条目 ${name}`,
        confidence: 0.7,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hitCount: 0,
        lastHitAt: null,
        sourceSessionId: null,
        links: [],
        archived: false,
      },
      body: `正文：${name} 的细节`,
    })
    repo.insert({
      id,
      scope: 'user',
      scope_ref: null,
      type: 'feedback',
      name,
      description: `来源条目 ${name}`,
      file_path: filePath,
      confidence: 0.7,
      hit_count: 0,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
    })
    return id
  }

  /** 征集一条标准候选，返回 (id, digest) */
  function propose(name = 'code-review-convention', sourceIds: string[] = []) {
    const payload = {
      type: 'feedback' as const,
      name,
      description: '代码评审统一约定：先看测试再看实现',
      body: '**Why:** 降低漏判\n**How to apply:** 评审从测试用例入手',
      confidence: 0.8,
      sourceIds,
    }
    const { row } = candidateRepo.insertPending({ scope: 'user', scopeRef: null, payload })
    return { id: row!.id, digest: row!.content_digest, payload }
  }

  it('确认晋级 happy path：按原文创建条目 + 派生边 + 来源标注', async () => {
    const srcA = await seedSource('fb-review-1')
    const srcB = await seedSource('fb-review-2')
    const { id, digest, payload } = propose('review-convention', [srcA, srcB])

    const r = await service.confirm(id, digest)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const entry = repo.getById(r.entryId)!
    expect(entry).toBeDefined()
    expect(entry.name).toBe(payload.name)
    expect(entry.author_role).toBe('consolidation')
    expect(entry.extraction_kind).toBe('consolidation')
    expect(entry.version).toBe(1)
    // 正文含升华来源段；FTS 可检索候选正文关键词
    const body = await store.readFile(entry.file_path)
    expect(body).toContain('## 升华来源')
    expect(searchRepo.searchBm25('漏判')).toHaveLength(1)
    // 派生边：来源 → 晋级条目（elevate）
    expect(revisionRepo.listDerivationsFrom(srcA)).toHaveLength(1)
    expect(revisionRepo.listDerivationsFrom(srcB)).toHaveLength(1)
    // 候选状态 confirmed 且 entry_id 回填；确认摘要 = 展示摘要
    const cand = candidateRepo.getById(id)!
    expect(cand.status).toBe('confirmed')
    expect(cand.entry_id).toBe(r.entryId)
    expect(cand.decided_via).toBe('user_ipc')
    expect(cand.confirmed_digest).toBe(digest)
  })

  it('错误摘要确认拒绝（digest_mismatch），不创建条目', async () => {
    const { id } = propose()
    const r = await service.confirm(id, '0'.repeat(64))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('digest_mismatch')
    expect(candidateRepo.getById(id)!.status).toBe('pending')
  })

  it('候选内容被改写后旧摘要确认失配拒绝（新内容不能继承旧确认）', async () => {
    const src = await seedSource('fb-src')
    const { id, payload } = propose('rewritten-candidate', [src])
    // 展示时的旧摘要
    const staleDigest = hashCandidateContent(payload.name, payload.description, payload.body)
    // 候选载荷被改写（摘要列未随之维护 —— repo.confirm 按当前载荷重算复核）
    db.raw
      .prepare(`UPDATE memory_candidate SET payload_json = ? WHERE id = ?`)
      .run(JSON.stringify({ ...payload, description: '被改写后的不同描述' }), id)
    const row = candidateRepo.getById(id)!
    const parsed = candidateRepo.parsePayload(row)
    expect(parsed).not.toBeNull()
    const rewrittenDigest = hashCandidateContent(parsed!.name, parsed!.description, parsed!.body)
    expect(rewrittenDigest).not.toBe(staleDigest)

    // 旧摘要确认：行内摘要列虽相同，但与当前载荷重算摘要失配 → 拒绝
    const r = await service.confirm(id, staleDigest)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('digest_mismatch')
  })

  it('一次性：重复确认 → not_pending；拒绝后确认 → not_pending', async () => {
    const a = propose('one-shot-a')
    const r1 = await service.confirm(a.id, a.digest)
    expect(r1.ok).toBe(true)
    const r2 = await service.confirm(a.id, a.digest)
    expect(r2.ok).toBe(false)
    if (r2.ok) return
    expect(r2.reason).toBe('not_pending')

    const b = propose('one-shot-b')
    service.reject(b.id)
    const r3 = await service.confirm(b.id, b.digest)
    expect(r3.ok).toBe(false)
    if (r3.ok) return
    expect(r3.reason).toBe('not_pending')
    expect(candidateRepo.getById(b.id)!.status).toBe('rejected')
  })

  it('过期：pending 超时 → 确认拒绝且状态 expired', async () => {
    const { id, digest } = propose('expired-candidate')
    // 直接把过期时间改到过去（repo.confirm 按行内 expires_at 判定）
    db.raw
      .prepare(`UPDATE memory_candidate SET expires_at = ? WHERE id = ?`)
      .run(Date.now() - 1000, id)

    const r = await service.confirm(id, digest)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('expired')
    expect(candidateRepo.getById(id)!.status).toBe('expired')
  })

  it('容量上限：超出 maxPending 的最早 pending 被淘汰为 expired', () => {
    const now = Date.now()
    for (let i = 0; i < 3; i += 1) {
      candidateRepo.insertPending(
        {
          scope: 'user',
          scopeRef: null,
          payload: {
            type: 'feedback',
            name: `cap-candidate-${i}`,
            description: `容量测试 ${i}`,
            body: `body ${i}`,
            confidence: 0.7,
            sourceIds: [],
          },
        },
        { maxPending: 2, now },
      )
    }
    const pending = candidateRepo.listByStatus('pending', { scope: 'user', scopeRef: null })
    expect(pending).toHaveLength(2)
    const expired = candidateRepo.listByStatus('expired', { scope: 'user', scopeRef: null })
    expect(expired).toHaveLength(1)
    expect(expired[0]!.payload_json).toContain('cap-candidate-0') // 最早者被淘汰
  })

  it('确认只覆盖指定版本：晋级后条目更新（v2）→ 确认过时；未更新 → 当前', async () => {
    const { id, digest } = propose('version-coverage')
    const r = await service.confirm(id, digest)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // 未更新：确认覆盖当前版本
    expect(await service.isConfirmationCurrent(id)).toBe(true)

    // 条目被更新（v2：内容实质变化）→ 新版本不继承旧确认
    await new MemoryCommitService(repo, store).commitWrite({
      entryId: r.entryId,
      scope: 'user',
      scopeRef: null,
      type: 'feedback',
      name: 'version-coverage',
      description: '评审约定（v2 修订：先实现后测试）',
      confidence: 0.8,
      body: '**Why:** 流程调整\n**How to apply:** 顺序反过来',
    })
    expect(repo.getById(r.entryId)!.version).toBe(2)
    expect(await service.isConfirmationCurrent(id)).toBe(false)
  })

  it('【S2.4】确认不豁免敏感闸门：载荷含敏感信息拒绝晋级且保持 pending', async () => {
    const payload = {
      type: 'feedback' as const,
      name: 'sensitive-candidate',
      description: '包含 api_key=sk-abcdefghijklmnopqrstuvwxyz 的提议',
      body: '正文内容',
      confidence: 0.8,
      sourceIds: [],
    }
    const { row } = candidateRepo.insertPending({ scope: 'user', scopeRef: null, payload })
    const r = await service.confirm(row!.id, row!.content_digest)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('sensitive_content')
    // 校验先于状态迁移：候选保持 pending（可拒绝处理），无"已确认无条目"悬状态
    const after = candidateRepo.getById(row!.id)!
    expect(after.status).toBe('pending')
    expect(after.entry_id).toBeNull()
    expect(repo.countByScope('user', null)).toBe(0)
  })

  it('payload 不可解析：不创建条目，返回 payload_unreadable', async () => {
    const { id } = propose()
    db.raw.prepare(`UPDATE memory_candidate SET payload_json = ? WHERE id = ?`).run('{not-json', id)
    // 读取候选行摘要（confirm 前半段仍以行内 digest 为准）
    const digest = candidateRepo.getById(id)!.content_digest

    const before = repo.countByScope('user', null)
    const r = await service.confirm(id, digest)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('payload_unreadable')
    expect(repo.countByScope('user', null)).toBe(before)
  })

  it('【审查修复】条目写入失败 → 候选回滚 pending 可重试，不留"已确认无条目"悬状态', async () => {
    const { id, digest } = propose()
    // 用写入必抛错的 store 构造会失败的 commitService（状态迁移后的 commitWrite 失败路径）
    const badStore = {
      getFilePath: () => '/nonexistent/x.md',
      writeFile: async () => {
        throw new Error('disk full (simulated)')
      },
      readFile: async () => {
        throw new Error('unreadable (simulated)')
      },
      updateIndexFile: async () => {},
    } as unknown as MemoryStoreService
    const failingService = new MemoryCandidateService(
      candidateRepo,
      new MemoryCommitService(repo, badStore),
      repo,
      revisionRepo,
      badStore,
    )

    const r = await failingService.confirm(id, digest)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('commit_failed')

    // 悬状态回滚：候选恢复 pending（非 confirmed+entry_id=NULL）
    const after = candidateRepo.getById(id)!
    expect(after.status).toBe('pending')
    expect(after.entry_id).toBeNull()
    expect(repo.countByScope('user', null)).toBe(0)

    // 恢复正常服务后重试同一候选可成功（用户不被锁死）
    const retry = await service.confirm(id, digest)
    expect(retry.ok).toBe(true)
  })

  it('【审查修复】回滚不误伤已晋级候选：entry_id 已回填的 confirmed 不回滚', async () => {
    const { id, digest } = propose()
    const ok = await service.confirm(id, digest)
    expect(ok.ok).toBe(true)

    // 已成功晋级（entry_id 回填）后，回滚原语必须不动作
    const reverted = candidateRepo.revertToPendingIfUnattached(id)
    expect(reverted).toBe(false)
    expect(candidateRepo.getById(id)!.status).toBe('confirmed')
  })

  it('【审查修复·终审】already_exists 崩溃残留自愈：此前晋级产物直接补 attach，不死锁', async () => {
    // 注：用 project scope（scope_ref 非 NULL）—— SQLite UNIQUE 索引对 NULL
    // 不判重，user scope（scope_ref 恒 NULL）的同名条目从不触发 UNIQUE 冲突
    // （既有边界，去重实际靠 writer 的 findByName 先查，见 BASELINE 记录）
    const payload = {
      type: 'feedback' as const,
      name: 'code-review-convention',
      description: '代码评审统一约定：先看测试再看实现',
      body: '**Why:** 降低漏判\n**How to apply:** 评审从测试用例入手',
      confidence: 0.8,
      sourceIds: [],
    }
    const { row } = candidateRepo.insertPending({ scope: 'project', scopeRef: 'ws-x', payload })
    // 模拟崩溃残留：条目已由此候选创建（如上次 commit 成功但 attach 前中断，
    // 候选被回滚或重试）——库中存在同名有效条目，但候选 entry_id 未回填
    const pre = await new MemoryCommitService(repo, store).commitWrite({
      scope: 'project',
      scopeRef: 'ws-x',
      type: payload.type,
      name: payload.name,
      description: payload.description,
      confidence: payload.confidence,
      body: '**Why:** 降低漏判\n**How to apply:** 评审从测试用例入手',
      sourceSessionId: 'consolidation',
      authorRole: 'consolidation',
      extractionKind: 'consolidation',
    })
    expect(pre.ok).toBe(true)

    // 确认 → commitWrite 必返 already_exists → 自愈路径命中同名条目
    const r = await service.confirm(row!.id, row!.content_digest)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // attach 到既有条目（不新建、不回滚、不死锁）
    expect(r.entryId).toBe(pre.ok ? pre.row.id : '')
    const after = candidateRepo.getById(row!.id)!
    expect(after.status).toBe('confirmed')
    expect(after.entry_id).toBe(pre.ok ? pre.row.id : null)
    expect(repo.countByScope('project', 'ws-x')).toBe(1)
  })

  it('【审查修复·终审】attach 瞬时失败重试成功：异常不传播，晋级完整', async () => {
    const { id, digest } = propose()
    // 第一次 attach 抛瞬时异常，第二次成功（attachSafely 单次重试）
    let calls = 0
    const spy = vi
      .spyOn(candidateRepo, 'attachEntry')
      .mockImplementation((cid: number, eid: string) => {
        calls++
        if (calls === 1) throw new Error('transient db lock (simulated)')
        return MemoryCandidateRepository.prototype.attachEntry.call(candidateRepo, cid, eid)
      })

    const r = await service.confirm(id, digest)
    spy.mockRestore()
    expect(r.ok).toBe(true)
    expect(calls).toBe(2)
    if (!r.ok) return
    const after = candidateRepo.getById(id)!
    expect(after.status).toBe('confirmed')
    expect(after.entry_id).toBe(r.entryId)
  })

  it('【审查修复·终审】commitWrite 的 DB 异常收敛 io_failed：候选回滚不被异常跳过', async () => {
    const { id, digest } = propose()
    // 模拟 DB 提交异常（非 UNIQUE 的瞬时故障）：insert 抛错而非返回业务失败
    const insertSpy = vi.spyOn(repo, 'insert').mockImplementation(() => {
      throw new Error('database is locked (simulated)')
    })

    const r = await service.confirm(id, digest)
    insertSpy.mockRestore()
    // 不向上抛异常，而是结构化失败 + 回滚 pending（可重试）
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('commit_failed')
    const after = candidateRepo.getById(id)!
    expect(after.status).toBe('pending')
    expect(after.entry_id).toBeNull()
  })
})
