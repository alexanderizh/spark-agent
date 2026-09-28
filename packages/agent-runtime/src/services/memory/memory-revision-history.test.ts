/**
 * @module memory-revision-history.test
 *
 * S2.2 revision 历史测试：提交保留旧版本、显式 supersede/retract、
 * 派生边记录、删除物理清理、N10 历史查询与覆盖说明。
 *
 * 设计依据：docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S2 切片 2
 * （"旧历史保留已知部分，不补造"；supersede 保留旧有效区间不原地抹掉历史；
 * retract 停止作为当前事实但显式历史查询可展示"已作废"）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  SparkDatabase,
  MemoryRepository,
  MemoryRevisionRepository,
  MemoryOperationRepository,
  MemoryCandidateRepository,
} from '@spark/storage'
import { MemoryStoreService } from './memory-store.service.js'
import { MemoryCommitService } from './memory-commit.service.js'
import { MemoryLifecycleService } from './memory-lifecycle.service.js'
import { MemoryReaderService } from './memory-reader.service.js'
import { MemoryConsolidationService } from './memory-consolidation.service.js'
import { MemoryCandidateService } from './memory-candidate.service.js'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('S2.2 revision 历史（commit 保留 / supersede / retract / 派生边 / N10 查询）', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let revisionRepo: MemoryRevisionRepository
  let store: MemoryStoreService
  let commit: MemoryCommitService
  let lifecycle: MemoryLifecycleService
  let reader: MemoryReaderService
  let testDir: string
  let settingsMap: Record<string, unknown>

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-revision-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
    repo = new MemoryRepository(db)
    revisionRepo = new MemoryRevisionRepository(db)
    store = new MemoryStoreService(testDir, join(testDir, 'ws'))
    commit = new MemoryCommitService(repo, store)
    lifecycle = new MemoryLifecycleService(
      repo,
      store,
      new MemoryOperationRepository(db),
      revisionRepo,
    )
    reader = new MemoryReaderService(repo, store, () => null, null, revisionRepo)
    settingsMap = { consolidationThreshold: 2, consolidationIntervalDays: 0.01 }
  })

  afterEach(() => {
    MemoryConsolidationService.resetReentrancyForTest()
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  const baseInput = {
    scope: 'user' as const,
    scopeRef: null,
    type: 'feedback' as const,
    name: 'revision-test-mem',
    description: 'revision 历史测试条目',
    confidence: 0.9,
    body: '第一版正文：关键词蒲公英书屋。',
  }

  /** 建条并推进到第二版，返回 id */
  async function seedUpdatedToV2(): Promise<string> {
    const created = await commit.commitWrite(baseInput)
    if (!created.ok) throw new Error('setup failed')
    const r = await commit.commitWrite({
      ...baseInput,
      entryId: created.row.id,
      expectedVersion: 1,
      description: '第二版摘要',
      body: '第二版正文：关键词换成了海边的孤独书局。',
    })
    if (!r.ok) throw new Error('setup v2 failed')
    return created.row.id
  }

  // ─── commit service：更新保留被覆盖版本 ───────────────────────────────

  it('commitUpdate：被覆盖版本进 revision 历史（正文为旧正文，kind=update）', async () => {
    const id = await seedUpdatedToV2()
    const revs = revisionRepo.listRevisions(id)
    expect(revs).toHaveLength(1)
    expect(revs[0]!.version).toBe(1)
    expect(revs[0]!.supersede_kind).toBe('update')
    expect(revs[0]!.body).toBe('第一版正文：关键词蒲公英书屋。')
    expect(revs[0]!.description).toBe('revision 历史测试条目')
    // 当前行是 v2
    expect(repo.getById(id)?.version).toBe(2)
  })

  it('commitUpdate 连续两次：版本链按序累积（v1、v2 均可查）', async () => {
    const created = await commit.commitWrite(baseInput)
    if (!created.ok) throw new Error('setup failed')
    const id = created.row.id
    await commit.commitWrite({
      ...baseInput,
      entryId: id,
      expectedVersion: 1,
      body: '第二版正文',
    })
    await commit.commitWrite({
      ...baseInput,
      entryId: id,
      expectedVersion: 2,
      body: '第三版正文',
    })
    const revs = revisionRepo.listRevisions(id)
    expect(revs.map((r) => r.version)).toEqual([1, 2])
    expect(revs[0]!.body).toBe('第一版正文：关键词蒲公英书屋。')
    expect(revs[1]!.body).toBe('第二版正文')
  })

  it('revision 收录幂等：同版本重复保留静默跳过', async () => {
    const id = await seedUpdatedToV2()
    revisionRepo.insertRevision({
      memoryId: id,
      version: 1,
      type: 'feedback',
      name: baseInput.name,
      description: baseInput.description,
      body: '重复保留尝试',
      contentHash: 'x',
      confidence: 0.9,
      authorRole: null,
      sourceEventId: null,
      validFrom: Date.now(),
      supersededAt: Date.now(),
      kind: 'update',
    })
    expect(revisionRepo.listRevisions(id)).toHaveLength(1)
    expect(revisionRepo.listRevisions(id)[0]!.body).toBe('第一版正文：关键词蒲公英书屋。')
  })

  // ─── lifecycle：supersede / retract / delete ─────────────────────────

  it('supersedeEntry：旧条目当前版本入历史（指向替代者）+ 失效 + 派生边', async () => {
    const oldId = await seedUpdatedToV2()
    const newEntry = await commit.commitWrite({
      ...baseInput,
      name: 'revision-test-successor',
      body: '替代条目正文',
    })
    if (!newEntry.ok) throw new Error('setup successor failed')

    const r = await lifecycle.supersedeEntry(oldId, newEntry.row.id, '用户纠正')
    expect(r.status).toBe('complete')

    const old = repo.getById(oldId)
    expect(old?.invalid_at).not.toBeNull()
    expect(old?.superseded_by).toBe(newEntry.row.id)

    const revs = revisionRepo.listRevisions(oldId)
    // v1（commitUpdate 保留）+ v2（supersede 时的当前版本）
    expect(revs.map((x) => x.version)).toEqual([1, 2])
    expect(revs[1]!.supersede_kind).toBe('supersede')
    expect(revs[1]!.successor_id).toBe(newEntry.row.id)
    expect(revs[1]!.note).toBe('用户纠正')

    const deriv = revisionRepo.listDerivationsFrom(oldId)
    expect(deriv).toHaveLength(1)
    expect(deriv[0]!.derived_id).toBe(newEntry.row.id)
    expect(deriv[0]!.kind).toBe('supersede')
  })

  it('supersedeEntry：替代者不存在时拒绝，不动旧条目', async () => {
    const oldId = await seedUpdatedToV2()
    const r = await lifecycle.supersedeEntry(oldId, 'usr_nonexist')
    expect(r.status).toBe('not_found')
    expect(repo.getById(oldId)?.invalid_at).toBeNull()
  })

  it('【审查修复 C7】supersedeEntry：old === new 自引用拒绝，不产生自指向与自引用派生边', async () => {
    const oldId = await seedUpdatedToV2()
    const r = await lifecycle.supersedeEntry(oldId, oldId)
    expect(r.status).toBe('conflict')
    expect(repo.getById(oldId)?.invalid_at).toBeNull()
    expect(repo.getById(oldId)?.superseded_by).toBeNull()
    expect(revisionRepo.listDerivationsFrom(oldId)).toHaveLength(0)
  })

  it('retractEntry：当前版本入历史（kind=retract）+ 失效不指向替代者 + 幂等', async () => {
    const id = await seedUpdatedToV2()
    const r = await lifecycle.retractEntry(id, '证据撤回')
    expect(r.status).toBe('complete')

    const entry = repo.getById(id)
    expect(entry?.invalid_at).not.toBeNull()
    expect(entry?.superseded_by).toBeNull()

    const revs = revisionRepo.listRevisions(id)
    expect(revs.map((x) => x.version)).toEqual([1, 2])
    expect(revs[1]!.supersede_kind).toBe('retract')
    expect(revs[1]!.successor_id).toBeNull()
    expect(revs[1]!.note).toBe('证据撤回')

    // 幂等：重复撤回仍 complete
    const again = await lifecycle.retractEntry(id)
    expect(again.status).toBe('complete')
    expect(revisionRepo.listRevisions(id)).toHaveLength(2)
  })

  it('deleteEntry：物理清理 revision 历史与派生边（与 supersede 保留历史相对）', async () => {
    const id = await seedUpdatedToV2()
    expect(revisionRepo.listRevisions(id)).toHaveLength(1)
    revisionRepo.insertDerivation('usr_source', id, 'elevate')

    const r = await lifecycle.deleteEntry(id)
    expect(r.status).toBe('complete')
    expect(repo.getById(id)).toBeNull()
    expect(revisionRepo.listRevisions(id)).toHaveLength(0)
    expect(revisionRepo.listDerivationsOf(id)).toHaveLength(0)
  })

  // ─── reader：N10 历史查询 ─────────────────────────────────────────────

  it('getRevisionHistory：返回版本链 + 派生关系 + 如实覆盖说明', async () => {
    const id = await seedUpdatedToV2()
    await lifecycle.retractEntry(id, '验证 N10')

    const r = await reader.getRevisionHistory(id, {
      allowedScopes: [{ scope: 'user', scopeRef: null }],
      caller: 'test',
    })
    expect(r.error).toBeUndefined()
    const h = r.history!
    expect(h.entry.id).toBe(id)
    expect(h.entry.invalidAt).not.toBeNull()
    expect(h.revisions.map((x) => x.version)).toEqual([1, 2])
    expect(h.revisions[1]!.supersede_kind).toBe('retract')
    // 覆盖说明：v1 起连续记录 → complete，note 如实说明
    expect(h.coverage.complete).toBe(true)
    expect(h.coverage.note).toContain('全部历史版本均有记录')
  })

  it('getRevisionHistory：无历史时如实说明记录起点（不伪造完整链）', async () => {
    // 直接 repo.insert 的存量行（未经过 commit 路径，无 revision 记录）
    const id = 'usr_legacy'
    const filePath = store.getFilePath('user', null, id)
    await store.writeFile({
      meta: {
        id,
        scope: 'user',
        scopeRef: null,
        type: 'feedback',
        name: 'legacy-entry',
        description: '存量条目',
        confidence: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hitCount: 0,
        lastHitAt: null,
        sourceSessionId: null,
        links: [],
        archived: false,
      },
      body: '存量正文',
    })
    repo.insert({
      id,
      scope: 'user',
      scope_ref: null,
      type: 'feedback',
      name: 'legacy-entry',
      description: '存量条目',
      file_path: filePath,
      confidence: 0.9,
      hit_count: 0,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
    })

    const r = await reader.getRevisionHistory(id, {
      allowedScopes: [{ scope: 'user', scopeRef: null }],
    })
    const h = r.history!
    expect(h.revisions).toHaveLength(0)
    expect(h.coverage.complete).toBe(false)
    expect(h.coverage.note).toContain('2026-09-27')
    expect(h.coverage.note).toContain('不补造')
  })

  it('getRevisionHistory：缺省拒绝与越范围拒绝（与 recall 同源校验）', async () => {
    const id = await seedUpdatedToV2()
    const noCtx = await reader.getRevisionHistory(id)
    expect(noCtx.error).toContain('access denied')

    const wrongScope = await reader.getRevisionHistory(id, {
      allowedScopes: [{ scope: 'project', scopeRef: 'ws-other' }],
      caller: 'test',
    })
    expect(wrongScope.error).toContain('outside the allowed scopes')
  })

  // ─── consolidation：MERGE/ELEVATE 的历史与派生边 ─────────────────────

  it('consolidation MERGE：keep 被覆盖版本 + drops 当前版本均入历史，派生边 drop→keep', async () => {
    const seedViaStore = async (name: string, description: string): Promise<string> => {
      const id = `usr_${Math.random().toString(36).slice(2, 10)}`
      const filePath = store.getFilePath('user', null, id)
      await store.writeFile({
        meta: {
          id,
          scope: 'user',
          scopeRef: null,
          type: 'feedback',
          name,
          description,
          confidence: 0.9,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          hitCount: 0,
          lastHitAt: null,
          sourceSessionId: null,
          links: [],
          archived: false,
        },
        body: `正文：${description}`,
      })
      repo.insert({
        id,
        scope: 'user',
        scope_ref: null,
        type: 'feedback',
        name,
        description,
        file_path: filePath,
        confidence: 0.9,
        hit_count: 0,
        last_hit_at: null,
        source_session_id: null,
        archived: 0,
      })
      return id
    }

    const a = await seedViaStore('log-rule', '用 console.log 调试')
    const b = await seedViaStore('logger-rule', '用 logger 输出日志')
    const raw = JSON.stringify([
      {
        action: 'MERGE',
        keepId: a,
        dropIds: [b],
        mergedDescription: '日志统一用 logger',
        reason: '语义重复',
      },
    ])

    const service = new MemoryConsolidationService(
      repo,
      store,
      (cat, key) => (cat === 'memory' ? (settingsMap[key] ?? null) : null),
      async () => raw,
      null,
      (cat, key, val) => {
        if (cat === 'memory') settingsMap[key] = val
      },
      revisionRepo,
    )
    await service.maybeConsolidate([{ scope: 'user', scopeRef: null }])

    // keep：被覆盖的 v1 入历史（kind=merge）
    const keepRevs = revisionRepo.listRevisions(a)
    expect(keepRevs).toHaveLength(1)
    expect(keepRevs[0]!.supersede_kind).toBe('merge')
    expect(keepRevs[0]!.body).toBe('正文：用 console.log 调试')

    // drop：当前版本入历史（kind=supersede，指向 keep）+ 失效
    const drop = repo.getById(b)
    expect(drop?.invalid_at).not.toBeNull()
    expect(drop?.superseded_by).toBe(a)
    const dropRevs = revisionRepo.listRevisions(b)
    expect(dropRevs).toHaveLength(1)
    expect(dropRevs[0]!.supersede_kind).toBe('supersede')
    expect(dropRevs[0]!.successor_id).toBe(a)

    // 派生边：drop → keep
    expect(revisionRepo.listDerivationsFrom(b)).toHaveLength(1)
    expect(revisionRepo.listDerivationsFrom(b)[0]!.derived_id).toBe(a)
    expect(revisionRepo.listDerivationsFrom(b)[0]!.kind).toBe('merge')
  })

  it('consolidation ELEVATE：派生边 source→新条目（kind=elevate）', async () => {
    const seedViaStore = async (name: string): Promise<string> => {
      const id = `usr_${Math.random().toString(36).slice(2, 10)}`
      const filePath = store.getFilePath('user', null, id)
      await store.writeFile({
        meta: {
          id,
          scope: 'user',
          scopeRef: null,
          type: 'feedback',
          name,
          description: `${name} 的描述`,
          confidence: 0.9,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          hitCount: 0,
          lastHitAt: null,
          sourceSessionId: null,
          links: [],
          archived: false,
        },
        body: `正文：${name}`,
      })
      repo.insert({
        id,
        scope: 'user',
        scope_ref: null,
        type: 'feedback',
        name,
        description: `${name} 的描述`,
        file_path: filePath,
        confidence: 0.9,
        hit_count: 0,
        last_hit_at: null,
        source_session_id: null,
        archived: 0,
      })
      return id
    }

    const s1 = await seedViaStore('pref-a')
    const s2 = await seedViaStore('pref-b')
    const s3 = await seedViaStore('pref-c')
    const raw = JSON.stringify([
      {
        action: 'ELEVATE',
        sourceIds: [s1, s2, s3],
        newMemory: {
          type: 'feedback',
          name: 'elevated-rule',
          description: '升华出的通用规则',
          confidence: 0.95,
          body: '通用规则正文',
        },
        reason: '多条暗示',
      },
    ])

    const candidateRepo = new MemoryCandidateRepository(db)
    const service = new MemoryConsolidationService(
      repo,
      store,
      (cat, key) => (cat === 'memory' ? (settingsMap[key] ?? null) : null),
      async () => raw,
      null,
      (cat, key, val) => {
        if (cat === 'memory') settingsMap[key] = val
      },
      revisionRepo,
      undefined,
      candidateRepo,
    )
    await service.maybeConsolidate([{ scope: 'user', scopeRef: null }])

    // 【S2.3】ELEVATE 先入候选区，不直接落库
    expect(repo.findByName('user', null, 'elevated-rule')).toBeNull()
    const pending = candidateRepo.listByStatus('pending', { scope: 'user', scopeRef: null })
    expect(pending).toHaveLength(1)

    // 真实用户确认晋级后才创建条目 + 派生边（kind=elevate）
    const candidateService = new MemoryCandidateService(
      candidateRepo,
      new MemoryCommitService(repo, store),
      repo,
      revisionRepo,
      store,
    )
    const confirmed = await candidateService.confirm(pending[0]!.id, pending[0]!.content_digest)
    expect(confirmed.ok).toBe(true)

    const elevated = repo.findByName('user', null, 'elevated-rule')
    expect(elevated).not.toBeNull()
    for (const s of [s1, s2, s3]) {
      const edges = revisionRepo.listDerivationsFrom(s)
      expect(edges).toHaveLength(1)
      const edge = edges[0]
      expect(edge?.derived_id).toBe(elevated!.id)
      expect(edge?.kind).toBe('elevate')
    }
  })
})
