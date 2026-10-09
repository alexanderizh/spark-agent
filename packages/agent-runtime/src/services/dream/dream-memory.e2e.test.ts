/**
 * @module dream-memory.e2e.test
 *
 * AutoDream 记忆轨端到端聚焦测试（真实 DB + 真实候选管线，不联网）：
 *   - merge 方向翻译（审查修复核心回归）：dream 提案 targetId=被并方、
 *     mergeTargetId=保留方 → 候选管线 targetId=keep、sourceIds=drops——
 *     确认后保留方拿到合并正文、被并方失效，方向颠倒会直接损坏记忆库；
 *   - merge 无 payload.body 前置拒绝（防 rationale 摘要覆盖保留方正文）；
 *   - 幻觉 targetId / mergeTargetId 前置拒收；
 *   - create 提案 pending（低置信人审）/ auto-applied（高置信代确认）两路；
 *   - 同内容提案 digest 去重。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  MemoryCandidateRepository,
  MemoryRepository,
  MemoryRevisionRepository,
  MemorySearchRepository,
  SparkDatabase,
} from '@spark/storage'
import { MemoryCommitService } from '../memory/memory-commit.service.js'
import { MemoryCandidateService } from '../memory/memory-candidate.service.js'
import { MemoryStoreService } from '../memory/memory-store.service.js'
import { DreamMemoryProposalSink } from './dream-memory-sink.js'
import type { DreamMemoryProposal } from '@spark/protocol'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('Dream memory 轨 e2e（merge 方向翻译 / sink 分流）', () => {
  let db: SparkDatabase
  let repo: MemoryRepository
  let candidateRepo: MemoryCandidateRepository
  let store: MemoryStoreService
  let service: MemoryCandidateService
  let sink: DreamMemoryProposalSink
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `spark-dream-mem-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))
    repo = new MemoryRepository(db)
    candidateRepo = new MemoryCandidateRepository(db)
    store = new MemoryStoreService(dir, join(dir, 'ws'))
    service = new MemoryCandidateService(
      candidateRepo,
      new MemoryCommitService(repo, store),
      repo,
      new MemoryRevisionRepository(db),
      store,
    )
    sink = new DreamMemoryProposalSink({
      candidateRepo,
      candidateService: service,
      memoryRepo: repo,
    })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function seedEntry(name: string): Promise<string> {
    const id = `usr_${Math.random().toString(36).slice(2, 10)}`
    const filePath = await store.writeFile({
      meta: {
        id,
        scope: 'user',
        scopeRef: null,
        type: 'feedback',
        name,
        description: `条目 ${name}`,
        confidence: 0.7,
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
      description: `条目 ${name}`,
      file_path: filePath,
      confidence: 0.7,
      hit_count: 0,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
    })
    return id
  }

  function memoryProposal(overrides: Partial<DreamMemoryProposal> = {}): DreamMemoryProposal {
    return {
      kind: 'memory',
      op: 'create',
      confidence: 0.9,
      rationale: '会话中多次出现该偏好',
      sourceRefs: [{ kind: 'session', id: 'sess-1', note: '用户明确要求' }],
      payload: {
        type: 'user',
        name: '不吃辣',
        description: '饮食偏好',
        body: '不吃辣，爱甜食',
      },
      ...overrides,
    }
  }

  it('merge 方向翻译：确认后保留方拿合并正文、被并方失效（审查修复核心回归）', async () => {
    const dropId = await seedEntry('重复条目A')
    const keepId = await seedEntry('保留条目B')
    const proposal = memoryProposal({
      op: 'merge',
      confidence: 0.95,
      targetId: dropId,
      mergeTargetId: keepId,
      sourceRefs: [
        { kind: 'memory', id: dropId, note: '内容重复' },
        { kind: 'memory', id: keepId, note: '保留方' },
      ],
      payload: {
        type: 'feedback',
        name: '合并后条目',
        description: '两条重复记忆的合并',
        body: '合并后的完整正文：不吃辣，爱甜食',
      },
    })

    const r = await sink.apply(proposal, 'auto-applied')
    expect(r.outcome).toBe('auto-applied')

    // 方向断言：keep 存活且拿到合并正文；drop 失效
    const keep = repo.getById(keepId)!
    const drop = repo.getById(dropId)!
    expect(keep.invalid_at).toBeNull()
    expect(drop.invalid_at).not.toBeNull()
    const mergedBody = await store.readFile(keep.file_path)
    expect(mergedBody).toContain('合并后的完整正文')
  })

  it('merge 无 payload.body 前置拒绝（防摘要覆盖保留方正文）', async () => {
    const dropId = await seedEntry('重复条目C')
    const keepId = await seedEntry('保留条目D')
    const r = await sink.apply(
      memoryProposal({
        op: 'merge',
        targetId: dropId,
        mergeTargetId: keepId,
        sourceRefs: [{ kind: 'memory', id: dropId }],
      }),
      'auto-applied',
    )
    expect(r.outcome).toBe('rejected-invalid')
    expect(r.note).toContain('payload.body')
    // 两条原条目都不受影响
    expect(repo.getById(keepId)!.invalid_at).toBeNull()
    expect(repo.getById(dropId)!.invalid_at).toBeNull()
  })

  it('幻觉 targetId / mergeTargetId 前置拒收', async () => {
    const update = await sink.apply(
      memoryProposal({ op: 'update', targetId: 'usr_ghost' }),
      'auto-applied',
    )
    expect(update.outcome).toBe('rejected-invalid')
    expect(update.note).toContain('不存在')

    const dropId = await seedEntry('真实条目E')
    const merge = await sink.apply(
      memoryProposal({
        op: 'merge',
        targetId: dropId,
        mergeTargetId: 'usr_ghost_keep',
        payload: {
          type: 'feedback',
          name: 'n',
          description: 'd',
          body: 'b',
        },
      }),
      'auto-applied',
    )
    expect(merge.outcome).toBe('rejected-invalid')
  })

  it('create 低置信进 pending 人审；高置信 auto-applied 直接落库', async () => {
    const pending = await sink.apply(memoryProposal({ confidence: 0.3 }), 'pending-review')
    expect(pending.outcome).toBe('pending-review')
    const pendingRow = candidateRepo.getById(Number(pending.refId?.split(':')[1]))
    expect(pendingRow?.status).toBe('pending')

    const auto = await sink.apply(
      memoryProposal({
        confidence: 0.95,
        payload: { type: 'user', name: '爱甜食', description: '口味', body: '爱吃甜' },
      }),
      'auto-applied',
    )
    expect(auto.outcome).toBe('auto-applied')
    const autoRow = candidateRepo.getById(Number(auto.refId?.split(':')[1]))
    expect(autoRow?.status).toBe('confirmed')
    // 晋级条目来源标注 consolidation（非冒充用户）
    const entryId = autoRow?.entry_id
    expect(entryId).toBeTruthy()
    expect(repo.getById(entryId!)?.author_role).toBe('consolidation')
  })

  it('同内容提案 digest 去重：第二次不再征集', async () => {
    const first = await sink.apply(memoryProposal(), 'pending-review')
    expect(first.outcome).toBe('pending-review')
    const second = await sink.apply(memoryProposal(), 'pending-review')
    expect(second.outcome).toBe('rejected-invalid')
    expect(second.note).toContain('去重')
  })
})
