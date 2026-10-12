/**
 * @module dream-audit.repository.test
 *
 * 梦境提案审计表仓储测试（migration 120）。
 *
 * 断言重点是**审计口径**：append-only 全量留痕（含被拒/超限丢弃）、按运行
 * 聚合的统计与报告 stats 对账、track 过滤与排序稳定性。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '@spark/storage'
import { DreamAuditRepository, type DreamAuditInsert } from '@spark/storage'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

function entry(overrides: Partial<DreamAuditInsert> = {}): DreamAuditInsert {
  return {
    runId: 'run_1',
    track: 'wiki',
    kind: 'wiki',
    op: 'create',
    outcome: 'rejected-invalid',
    confidence: 0,
    note: '第 0 条提案未通过校验：wiki create 提案必须携带 spaceId（目标空间）',
    payloadJson: '{"kind":"wiki","op":"create","title":"会话调试技巧"}',
    ...overrides,
  }
}

describe('DreamAuditRepository', () => {
  let db: SparkDatabase
  let repo: DreamAuditRepository
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `spark-dream-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))
    repo = new DreamAuditRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('追加行全量留痕：字段往返映射（snake_case ↔ camelCase）保持一致', () => {
    repo.append(entry())
    const rows = repo.listByRun('run_1')
    expect(rows).toHaveLength(1)
    const r = rows[0]
    if (r == null) throw new Error('expected one audit row')
    expect(r.runId).toBe('run_1')
    expect(r.track).toBe('wiki')
    expect(r.kind).toBe('wiki')
    expect(r.op).toBe('create')
    expect(r.outcome).toBe('rejected-invalid')
    expect(r.confidence).toBe(0)
    expect(r.targetId).toBeNull()
    expect(r.note).toContain('spaceId')
    expect(r.payloadJson).toContain('会话调试技巧')
    expect(r.createdAt).toBeGreaterThan(0)
  })

  it('可选字段缺省落 NULL，不写 undefined 字符串', () => {
    const { note: _n, payloadJson: _p, targetId: _t, ...bare } = entry()
    repo.append(bare)
    const rows = repo.listByRun('run_1')
    const r = rows[0]
    if (r == null) throw new Error('expected one audit row')
    expect(r.note).toBeNull()
    expect(r.payloadJson).toBeNull()
    expect(r.targetId).toBeNull()
  })

  it('按运行明细保持写入顺序，跨运行互不混入', () => {
    repo.append(entry({ runId: 'run_a', outcome: 'pending-review', confidence: 0.9 }))
    repo.append(entry({ runId: 'run_b', op: 'delete', outcome: 'auto-applied', confidence: 0.95 }))
    repo.append(entry({ runId: 'run_a', outcome: 'dropped-by-limit', confidence: 0.7 }))
    const a = repo.listByRun('run_a')
    expect(a.map((x) => x.outcome)).toEqual(['pending-review', 'dropped-by-limit'])
    const b = repo.listByRun('run_b')
    expect(b).toHaveLength(1)
    if (b[0] != null) expect(b[0].op).toBe('delete')
  })

  it('运行摘要按 runId 聚合统计（与报告 stats 口径对账），新→旧排序', () => {
    repo.append(entry({ runId: 'run_old', outcome: 'auto-applied', confidence: 0.9 }))
    repo.append(entry({ runId: 'run_new', outcome: 'rejected-invalid' }))
    repo.append(entry({ runId: 'run_new', outcome: 'pending-review', confidence: 0.8 }))
    repo.append(entry({ runId: 'run_new', outcome: 'dropped-by-limit', confidence: 0.6 }))
    const runs = repo.listRuns(10)
    expect(runs.map((x) => x.runId)).toEqual(['run_new', 'run_old'])
    const [n, old] = runs
    if (n == null || old == null) throw new Error('expected two runs')
    expect(n.track).toBe('wiki')
    expect(n.proposals).toBe(3)
    expect(n.autoApplied).toBe(0)
    expect(n.pendingReview).toBe(1)
    expect(n.rejectedInvalid).toBe(1)
    expect(n.droppedByLimit).toBe(1)
    expect(n.startedAt).toBeLessThanOrEqual(n.endedAt)
    expect(old.autoApplied).toBe(1)
  })

  it('track 过滤只看本轨运行；limit 截断最近 N 次', () => {
    repo.append(entry({ runId: 'run_m', track: 'memory', kind: 'memory', op: 'create' }))
    repo.append(entry({ runId: 'run_w1' }))
    repo.append(entry({ runId: 'run_w2', outcome: 'auto-applied', confidence: 0.9 }))
    const wikiRuns = repo.listRuns(10, 'wiki')
    expect(wikiRuns.map((x) => x.runId).sort()).toEqual(['run_w1', 'run_w2'])
    expect(repo.listRuns(1, 'wiki')).toHaveLength(1)
    const memRuns = repo.listRuns(10, 'memory')
    expect(memRuns.map((x) => x.runId)).toEqual(['run_m'])
    if (memRuns[0] != null) expect(memRuns[0].track).toBe('memory')
  })
})
