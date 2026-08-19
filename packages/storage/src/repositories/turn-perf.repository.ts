/**
 * @module turn-perf.repository
 *
 * Turn Perf Metrics Repository
 *
 * 每轮性能指标（吞吐 / TTFT / 轮次时长）的落库与查询。
 * 写入点：SessionService 在 TurnRuntimeMetricsTracker 终态回调里 upsert 一行。
 * 查询点：检查器「性能」区块（perf:get-session）与跨会话模型聚合（perf:get-model-aggregates）。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

// ─── Types ──────────────────────────────────────────────────────────────

/** 单轮性能指标行（perf:get-session 返回给渲染层） */
export interface TurnPerfRow {
  turnId: string
  providerId: string
  modelId: string
  terminalStatus: 'completed' | 'cancelled' | 'error'
  ttftMs: number | null
  streamActiveMs: number | null
  turnDurationMs: number | null
  outputTokens: number | null
  outputTokensPerSecond: number | null
  requestTimestamp: string
}

/**
 * 终态落库参数（缺测字段保持 null，不冒充为 0）。
 * 可选数值字段显式带 `| undefined`：调用方直接透传 tracker 摘要的可选字段
 * （exactOptionalPropertyTypes 下裸 `?: number` 拒绝显式 undefined）。
 */
export interface RecordTurnPerfParams {
  sessionId: string
  turnId: string
  providerId: string
  modelId: string
  terminalStatus: 'completed' | 'cancelled' | 'error'
  ttftMs?: number | undefined
  streamActiveMs?: number | undefined
  turnDurationMs?: number | undefined
  outputTokens?: number | undefined
  outputTokensPerSecond?: number | undefined
  requestTimestamp?: string | undefined
}

/** 跨会话按 provider/model 聚合的性能画像 */
export interface ModelPerfAggregate {
  providerId: string
  modelId: string
  turnCount: number
  completedTurnCount: number
  avgTokensPerSecond: number | null
  avgTtftMs: number | null
  totalStreamMs: number
  totalOutputTokens: number
}

// ─── Repository ─────────────────────────────────────────────────────────

export class TurnPerfRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'turn_perf_metrics')
  }

  /** 终态 upsert：同 (session_id, turn_id) 重复终态时后值覆盖（僵尸恢复/重放安全）。 */
  recordFinal(params: RecordTurnPerfParams): void {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `
        INSERT INTO ${this.tableName}
          (id, session_id, turn_id, provider_id, model_id, terminal_status,
           ttft_ms, stream_active_ms, turn_duration_ms, output_tokens,
           output_tokens_per_second, request_timestamp, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, turn_id) DO UPDATE SET
          provider_id = excluded.provider_id,
          model_id = excluded.model_id,
          terminal_status = excluded.terminal_status,
          ttft_ms = excluded.ttft_ms,
          stream_active_ms = excluded.stream_active_ms,
          turn_duration_ms = excluded.turn_duration_ms,
          output_tokens = excluded.output_tokens,
          output_tokens_per_second = excluded.output_tokens_per_second,
          request_timestamp = excluded.request_timestamp
      `,
      )
      .run(
        crypto.randomUUID(),
        params.sessionId,
        params.turnId,
        params.providerId,
        params.modelId,
        params.terminalStatus,
        params.ttftMs ?? null,
        params.streamActiveMs ?? null,
        params.turnDurationMs ?? null,
        params.outputTokens ?? null,
        params.outputTokensPerSecond ?? null,
        params.requestTimestamp ?? now,
        now,
      )
  }

  /** 某会话全部轮次指标（时间升序）；供渲染层做中位数 / p95 / 慢轮标记。 */
  listBySession(sessionId: string): TurnPerfRow[] {
    const stmt = this.raw.prepare(`
      SELECT
        turn_id                AS turnId,
        provider_id            AS providerId,
        model_id               AS modelId,
        terminal_status        AS terminalStatus,
        ttft_ms                AS ttftMs,
        stream_active_ms       AS streamActiveMs,
        turn_duration_ms       AS turnDurationMs,
        output_tokens          AS outputTokens,
        output_tokens_per_second AS outputTokensPerSecond,
        request_timestamp      AS requestTimestamp
      FROM ${this.tableName}
      WHERE session_id = ?
      ORDER BY request_timestamp ASC
    `)
    return stmt.all(sessionId) as TurnPerfRow[]
  }

  /** 跨会话按 provider/model 聚合：中位数在渲染层按会话算，这里给 AVG/COUNT 级画像。 */
  getModelAggregates(limitDays = 30): ModelPerfAggregate[] {
    const cutoff = new Date(Date.now() - limitDays * 86_400_000).toISOString()
    const stmt = this.raw.prepare(`
      SELECT
        provider_id                                          AS providerId,
        model_id                                             AS modelId,
        COUNT(*)                                             AS turnCount,
        SUM(CASE WHEN terminal_status = 'completed' THEN 1 ELSE 0 END) AS completedTurnCount,
        AVG(output_tokens_per_second)                        AS avgTokensPerSecond,
        AVG(ttft_ms)                                         AS avgTtftMs,
        COALESCE(SUM(stream_active_ms), 0)                   AS totalStreamMs,
        COALESCE(SUM(output_tokens), 0)                      AS totalOutputTokens
      FROM ${this.tableName}
      WHERE request_timestamp >= ?
      GROUP BY provider_id, model_id
      ORDER BY turnCount DESC
    `)
    return stmt.all(cutoff) as ModelPerfAggregate[]
  }

  /** 会话删除级联（session.repository.deleteWithRelatedData 调用）。 */
  deleteBySession(sessionId: string): number {
    const result = this.raw
      .prepare(`DELETE FROM ${this.tableName} WHERE session_id = ?`)
      .run(sessionId)
    return result.changes
  }
}
