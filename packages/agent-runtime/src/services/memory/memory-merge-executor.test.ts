/**
 * @module memory-merge-executor.test
 *
 * MERGE 执行段的契约单测（mock repo/commit，验证执行段自身的收敛语义）：
 *   - 成功路径：keep 提交 + drops 逐个失效 + 派生边
 *   - 【审查修复】drop 失效写入抛 DB 异常时收敛为结构化 commit_failed，
 *     不向上抛（守住模块头"不抛出"契约）；已完成的 drop 副作用保留
 *     （调用方重试时按现势过滤幂等收敛）
 */

import { describe, it, expect, vi } from 'vitest'
import type { MemoryEntryRow, MemoryRepository, MemoryRevisionRepository } from '@spark/storage'
import type { MemoryCommitService } from './memory-commit.service.js'
import { executeMemoryMerge } from './memory-merge-executor.js'

function makeRow(id: string, overrides: Partial<MemoryEntryRow> = {}): MemoryEntryRow {
  return {
    id,
    scope: 'user',
    scope_ref: null,
    type: 'feedback',
    name: `entry-${id}`,
    description: 'desc',
    file_path: `/tmp/${id}.md`,
    confidence: 0.8,
    hit_count: 0,
    last_hit_at: null,
    source_session_id: null,
    archived: 0,
    invalid_at: null,
    superseded_by: null,
    version: 1,
    created_at: 1000,
    updated_at: 1000,
    evidence_status: 'available',
    author_role: 'assistant',
    extraction_kind: 'turn',
    extraction_model: null,
    source_event_id: null,
    source_turn_id: null,
    author_agent_id: null,
    ...overrides,
  } as MemoryEntryRow
}

function makeCommitService(): { svc: MemoryCommitService; commitWrite: ReturnType<typeof vi.fn> } {
  const commitWrite = vi.fn(async () => ({ ok: true as const }))
  return { svc: { commitWrite } as unknown as MemoryCommitService, commitWrite }
}

describe('executeMemoryMerge', () => {
  it('成功路径：keep 按读取时版本 CAS 提交，drops 逐个失效并记派生边', async () => {
    const { svc, commitWrite } = makeCommitService()
    const update = vi.fn()
    const insertDerivation = vi.fn()
    const memoryRepo = { update } as unknown as MemoryRepository
    const revisionRepo = { insertDerivation } as unknown as MemoryRevisionRepository
    const keep = makeRow('keep-1')
    const drops = [makeRow('drop-1'), makeRow('drop-2')]

    const result = await executeMemoryMerge({
      keep,
      drops,
      mergedDescription: '合并描述',
      mergedBody: '合并正文',
      dropBodies: new Map([['drop-1', '旧正文一'], ['drop-2', '旧正文二']]),
      commitService: svc,
      memoryRepo,
      revisionRepo,
      note: 'test merge',
    })

    expect(result).toEqual({ ok: true })
    // keep：expectedVersion = 读取时版本，合并去重不升置信
    expect(commitWrite).toHaveBeenCalledTimes(1)
    expect(commitWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: 'keep-1',
        expectedVersion: 1,
        confidence: keep.confidence,
        revisionKind: 'merge',
      }),
    )
    // drops 全部失效指向 keep，派生边 drop → keep
    expect(update).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledWith(
      'drop-1',
      expect.objectContaining({ superseded_by: 'keep-1' }),
      undefined,
      expect.objectContaining({ kind: 'supersede', successorId: 'keep-1', note: 'test merge' }),
    )
    expect(insertDerivation).toHaveBeenCalledWith('drop-1', 'keep-1', 'merge')
    expect(insertDerivation).toHaveBeenCalledWith('drop-2', 'keep-1', 'merge')
  })

  it('【审查修复】keep 提交失败 → 结构化返回，drops 不动', async () => {
    const commitWrite = vi.fn(async () => ({
      ok: false as const,
      reason: 'version_conflict' as const,
      message: '并发更新',
    }))
    const update = vi.fn()
    const memoryRepo = { update } as unknown as MemoryRepository

    const result = await executeMemoryMerge({
      keep: makeRow('keep-1'),
      drops: [makeRow('drop-1')],
      mergedDescription: 'd',
      mergedBody: 'b',
      dropBodies: new Map(),
      commitService: { commitWrite } as unknown as MemoryCommitService,
      memoryRepo,
      revisionRepo: null,
      note: 'n',
    })

    expect(result).toEqual({ ok: false, reason: 'version_conflict', message: '并发更新' })
    expect(update).not.toHaveBeenCalled()
  })

  it('【审查修复】drop 失效写入抛 DB 异常 → 收敛为 commit_failed 不上抛，已完成 drops 保留', async () => {
    const { svc } = makeCommitService()
    const update = vi.fn((id: string) => {
      if (id === 'drop-2') throw new Error('database is locked')
    })
    const memoryRepo = { update } as unknown as MemoryRepository
    const insertDerivation = vi.fn()

    const result = await executeMemoryMerge({
      keep: makeRow('keep-1'),
      drops: [makeRow('drop-1'), makeRow('drop-2')],
      mergedDescription: 'd',
      mergedBody: 'b',
      dropBodies: new Map(),
      commitService: svc,
      memoryRepo,
      revisionRepo: { insertDerivation } as unknown as MemoryRevisionRepository,
      note: 'n',
    })

    // 不抛出（契约）；返回结构化失败，message 指明可重试收敛
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('commit_failed')
      expect(result.message).toContain('drop-2')
      expect(result.message).toContain('database is locked')
    }
    // drop-1 的失效已完成（副作用保留，调用方重试按现势过滤幂等收敛）
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('revisionRepo 缺省 null：跳过派生边，失效照常', async () => {
    const { svc } = makeCommitService()
    const update = vi.fn()
    const result = await executeMemoryMerge({
      keep: makeRow('keep-1'),
      drops: [makeRow('drop-1')],
      mergedDescription: 'd',
      mergedBody: 'b',
      dropBodies: new Map(),
      commitService: svc,
      memoryRepo: { update } as unknown as MemoryRepository,
      revisionRepo: null,
      note: 'n',
    })
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledTimes(1)
  })
})
