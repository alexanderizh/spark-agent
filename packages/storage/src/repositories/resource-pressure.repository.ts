/**
 * @module resource-pressure.repository
 *
 * 资源压力级别变更事件仓库（M1）。只记录 PressureLevel 之间的迁移事件，
 * 供性能页「治理事件」回看与事后归因；高频指标数据走内存环形缓冲不落库。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type ResourcePressureLevelRow = 'nominal' | 'warning' | 'critical' | 'emergency'

export interface ResourcePressureEventRow {
  id: string
  from_level: string
  to_level: string
  occurred_at: string
  /** 触发指标明细 JSON（[{key, level, value, thresholdPct}]），可空。 */
  indicators_json: string | null
  created_at: string
}

export interface InsertResourcePressureEventParams {
  id: string
  fromLevel: ResourcePressureLevelRow
  toLevel: ResourcePressureLevelRow
  occurredAt: string
  indicatorsJson?: string | null
}

export class ResourcePressureRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'resource_pressure_events')
  }

  insert(params: InsertResourcePressureEventParams): ResourcePressureEventRow {
    const stmt = this.raw.prepare(
      `INSERT INTO ${this.tableName} (id, from_level, to_level, occurred_at, indicators_json, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    )
    stmt.run(
      params.id,
      params.fromLevel,
      params.toLevel,
      params.occurredAt,
      params.indicatorsJson ?? null,
    )
    return this.findById<ResourcePressureEventRow>(params.id) as ResourcePressureEventRow
  }

  /** 最近事件（倒序），供设置页治理事件列表。 */
  listRecent(limit = 50, offset = 0): ResourcePressureEventRow[] {
    const stmt = this.raw.prepare(
      `SELECT * FROM ${this.tableName} ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    return stmt.all(limit, offset) as ResourcePressureEventRow[]
  }

  /** 保留窗口外的事件清理（按 occurred_at 早于 cutoff 的删除）。 */
  pruneBefore(cutoffIso: string): number {
    const stmt = this.raw.prepare(`DELETE FROM ${this.tableName} WHERE occurred_at < ?`)
    const result = stmt.run(cutoffIso)
    return result.changes
  }
}
