/**
 * @module execution-outbox.repository
 *
 * execution_outbox 仓储 — durable outbox。
 *
 * 状态变化与恢复通知先落库，再由消费方发布；避免依赖 Renderer 在线
 * （方案 §5.1 DurableOutbox）。
 */

import { BaseRepository } from '../base.repository.js'
import type { SparkDatabase } from '../../database.js'
import type { ExecutionOutboxEventRow, ExecutionOutboxEventType } from '@spark/protocol'

export class ExecutionOutboxRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'execution_outbox')
  }

  /** 追加事件（应在 Run/Step/Checkpoint 同一事务内调用）。 */
  enqueue(params: {
    id: string
    runId: string
    eventType: ExecutionOutboxEventType
    payload?: unknown
  }): void {
    this.raw
      .prepare(
        `
      INSERT INTO execution_outbox (id, run_id, event_type, payload_json, published_at, created_at)
      VALUES (?, ?, ?, ?, NULL, ?)
    `,
      )
      .run(
        params.id,
        params.runId,
        params.eventType,
        JSON.stringify(params.payload ?? {}),
        new Date().toISOString(),
      )
  }

  /** 取一批未发布事件（按创建顺序）。 */
  takePending(limit = 50): ExecutionOutboxEventRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM execution_outbox WHERE published_at IS NULL ORDER BY created_at ASC, id ASC LIMIT ?`,
      )
      .all(limit) as ExecutionOutboxEventRow[]
  }

  /** 消费成功后标记发布。 */
  markPublished(ids: string[]): number {
    if (ids.length === 0) return 0
    const placeholders = ids.map(() => '?').join(',')
    const result = this.raw
      .prepare(`UPDATE execution_outbox SET published_at = ? WHERE id IN (${placeholders})`)
      .run(new Date().toISOString(), ...ids)
    return result.changes
  }

  /** 清理基线：删除已发布且早于 beforeIso 的事件。 */
  deletePublishedBefore(beforeIso: string, batchSize = 1000): number {
    const rows = this.raw
      .prepare(
        `SELECT id FROM execution_outbox WHERE published_at IS NOT NULL AND created_at < ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(beforeIso, batchSize) as Array<{ id: string }>
    if (rows.length === 0) return 0
    const placeholders = rows.map(() => '?').join(',')
    const result = this.raw
      .prepare(`DELETE FROM execution_outbox WHERE id IN (${placeholders})`)
      .run(...rows.map((row) => row.id))
    return result.changes
  }
}
