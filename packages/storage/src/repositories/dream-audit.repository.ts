/**
 * @module dream-audit.repository
 *
 * 梦境提案审计表 repository —— dream_audit 表的持久化访问（migration 120）。
 *
 * 语义约定：
 *   - 「每条提案无论去向都记一行」：auto-applied / pending-review /
 *     rejected-invalid / dropped-by-limit 全量留痕，append-only 不改不删。
 *   - payload_json 为提案原文快照（调用方负责超长截断），审计读路径原样展示。
 *   - 与 orchestrator.audit() 的 dream-audit 日志行双写：日志供开发排查，
 *     本表供设置页「提案明细」与历史追溯（报告只存最近一次，本表补齐历史）。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

/** 审计行（camelCase 映射后；与 protocol IPC 的 DreamAuditRecord 结构对齐） */
export interface DreamAuditRow {
  id: number
  runId: string
  track: 'memory' | 'wiki'
  kind: 'memory' | 'wiki'
  op: 'create' | 'update' | 'merge' | 'delete'
  outcome: 'auto-applied' | 'pending-review' | 'rejected-invalid' | 'dropped-by-limit'
  confidence: number
  targetId: string | null
  note: string | null
  payloadJson: string | null
  createdAt: number
}

/** 运行粒度审计摘要（GROUP BY run_id） */
export interface DreamAuditRunSummary {
  runId: string
  track: 'memory' | 'wiki'
  startedAt: number
  endedAt: number
  proposals: number
  autoApplied: number
  pendingReview: number
  rejectedInvalid: number
  droppedByLimit: number
}

/** 追加一行审计（字段语义见 dream-proposals 的 DreamAuditEntry） */
export interface DreamAuditInsert {
  runId: string
  track: 'memory' | 'wiki'
  kind: 'memory' | 'wiki'
  op: 'create' | 'update' | 'merge' | 'delete'
  outcome: 'auto-applied' | 'pending-review' | 'rejected-invalid' | 'dropped-by-limit'
  confidence: number
  targetId?: string
  note?: string
  payloadJson?: string
}

interface DreamAuditDbRow {
  id: number
  run_id: string
  track: string
  kind: string
  op: string
  outcome: string
  confidence: number
  target_id: string | null
  note: string | null
  payload_json: string | null
  created_at: number
}

export class DreamAuditRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'dream_audit')
  }

  /** 追加一行审计（created_at 由本方法落时间戳） */
  append(entry: DreamAuditInsert): void {
    this.raw
      .prepare(
        `INSERT INTO ${this.tableName}
           (run_id, track, kind, op, outcome, confidence, target_id, note, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.runId,
        entry.track,
        entry.kind,
        entry.op,
        entry.outcome,
        entry.confidence,
        entry.targetId ?? null,
        entry.note ?? null,
        entry.payloadJson ?? null,
        Date.now(),
      )
  }

  /** 单次运行的审计明细（按写入顺序） */
  listByRun(runId: string): DreamAuditRow[] {
    const rows = this.raw
      .prepare(`SELECT * FROM ${this.tableName} WHERE run_id = ? ORDER BY id ASC`)
      .all(runId) as DreamAuditDbRow[]
    return rows.map(mapRow)
  }

  /** 最近运行摘要（新→旧）；track 缺省为两轨合计 */
  listRuns(limit: number, track?: 'memory' | 'wiki'): DreamAuditRunSummary[] {
    const filter = track != null ? 'WHERE track = ?' : ''
    const rows = this.raw
      .prepare(
        `SELECT run_id, track,
            MIN(created_at) AS started_at, MAX(created_at) AS ended_at, COUNT(*) AS proposals,
            SUM(outcome = 'auto-applied') AS auto_applied,
            SUM(outcome = 'pending-review') AS pending_review,
            SUM(outcome = 'rejected-invalid') AS rejected_invalid,
            SUM(outcome = 'dropped-by-limit') AS dropped_by_limit
         FROM ${this.tableName} ${filter}
         GROUP BY run_id ORDER BY ended_at DESC LIMIT ?`,
      )
      .all(...(track != null ? [track, limit] : [limit])) as Array<{
      run_id: string
      track: string
      started_at: number
      ended_at: number
      proposals: number
      auto_applied: number
      pending_review: number
      rejected_invalid: number
      dropped_by_limit: number
    }>
    return rows.map((r) => ({
      runId: r.run_id,
      track: r.track as DreamAuditRunSummary['track'],
      startedAt: r.started_at,
      endedAt: r.ended_at,
      proposals: r.proposals,
      autoApplied: r.auto_applied,
      pendingReview: r.pending_review,
      rejectedInvalid: r.rejected_invalid,
      droppedByLimit: r.dropped_by_limit,
    }))
  }
}

function mapRow(r: DreamAuditDbRow): DreamAuditRow {
  return {
    id: r.id,
    runId: r.run_id,
    track: r.track as DreamAuditRow['track'],
    kind: r.kind as DreamAuditRow['kind'],
    op: r.op as DreamAuditRow['op'],
    outcome: r.outcome as DreamAuditRow['outcome'],
    confidence: r.confidence,
    targetId: r.target_id,
    note: r.note,
    payloadJson: r.payload_json,
    createdAt: r.created_at,
  }
}
