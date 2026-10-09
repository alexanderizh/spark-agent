/**
 * @module usage-ledger.repository
 *
 * Usage Ledger Repository
 *
 * Records and queries token usage data per session turn.
 * Supports session-level, date-range, and provider/model-grouped queries.
 * All monetary values are stored in USD.
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

// ─── Types ──────────────────────────────────────────────────────────────

/** A single usage record row from the database */
export interface UsageLedgerRow {
  id: string
  session_id: string
  provider_id: string
  model_id: string
  input_tokens: number
  output_tokens: number
  reasoning_output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_usd: number
  request_timestamp: string
  created_at: string
  /** 用量来源维度（migration 117）：'api'=用户会话，'dream'=梦境整理会话 */
  source: string
}

/** Parameters for recording a new usage entry */
export interface RecordUsageParams {
  sessionId: string
  providerId: string
  modelId: string
  inputTokens: number
  outputTokens: number
  reasoningOutputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  costUsd?: number
  requestTimestamp?: string
  /** 用量来源（缺省 'api'；梦境整理会话传 'dream'） */
  source?: string
}

/** Aggregated usage summary */
export interface UsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalReasoningOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalCostUsd: number
  recordCount: number
}

/** Usage grouped by model */
export interface ModelUsageGroup {
  modelId: string
  providerId: string
  totalInputTokens: number
  totalOutputTokens: number
  totalReasoningOutputTokens: number
  totalCostUsd: number
  recordCount: number
}

/** Usage grouped by date */
export interface DailyUsageGroup {
  date: string
  totalInputTokens: number
  totalOutputTokens: number
  totalReasoningOutputTokens: number
  totalCostUsd: number
  recordCount: number
}

/** Usage grouped by date and model (for per-model daily trend charts) */
export interface ModelDailyUsageGroup {
  date: string
  modelId: string
  providerId: string
  totalInputTokens: number
  totalOutputTokens: number
  totalReasoningOutputTokens: number
  totalCostUsd: number
  recordCount: number
}

// ─── Repository ─────────────────────────────────────────────────────────

export class UsageLedgerRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'usage_ledger')
  }

  /**
   * Record a new usage entry.
   * Returns the auto-generated ID.
   */
  record(params: RecordUsageParams): string {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const stmt = this.raw.prepare(`
      INSERT INTO ${this.tableName}
        (id, session_id, provider_id, model_id,
         input_tokens, output_tokens, reasoning_output_tokens, cache_read_tokens, cache_write_tokens,
         cost_usd, request_timestamp, created_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      id,
      params.sessionId,
      params.providerId,
      params.modelId,
      params.inputTokens,
      params.outputTokens,
      params.reasoningOutputTokens ?? 0,
      params.cacheReadTokens ?? 0,
      params.cacheWriteTokens ?? 0,
      params.costUsd ?? 0,
      params.requestTimestamp ?? now,
      now,
      params.source ?? 'api',
    )
    return id
  }

  /**
   * Get aggregated usage for a specific session.
   */
  getSessionUsage(sessionId: string): UsageSummary {
    const stmt = this.raw.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0)       AS totalInputTokens,
        COALESCE(SUM(output_tokens), 0)      AS totalOutputTokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS totalReasoningOutputTokens,
        COALESCE(SUM(cache_read_tokens), 0)  AS totalCacheReadTokens,
        COALESCE(SUM(cache_write_tokens), 0) AS totalCacheWriteTokens,
        COALESCE(SUM(cost_usd), 0)           AS totalCostUsd,
        COUNT(*)                              AS recordCount
      FROM ${this.tableName}
      WHERE session_id = ?
    `)
    return stmt.get(sessionId) as UsageSummary
  }

  /**
   * Get aggregated usage for a session since a given ISO timestamp (inclusive).
   * Used for scoped budget accounting (e.g. a goal's own spend, excluding prior chat).
   */
  getSessionUsageSince(sessionId: string, sinceIso: string): UsageSummary {
    const stmt = this.raw.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0)       AS totalInputTokens,
        COALESCE(SUM(output_tokens), 0)      AS totalOutputTokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS totalReasoningOutputTokens,
        COALESCE(SUM(cache_read_tokens), 0)  AS totalCacheReadTokens,
        COALESCE(SUM(cache_write_tokens), 0) AS totalCacheWriteTokens,
        COALESCE(SUM(cost_usd), 0)           AS totalCostUsd,
        COUNT(*)                              AS recordCount
      FROM ${this.tableName}
      WHERE session_id = ? AND request_timestamp >= ?
    `)
    return stmt.get(sessionId, sinceIso) as UsageSummary
  }

  /**
   * Get aggregated usage for a date range (inclusive).
   * Dates should be ISO 8601 strings (e.g., '2024-01-01T00:00:00Z').
   * source: 指定 'api'/'dream' 只统计该维度；'all'/undefined 统计全部。
   */
  getUsageByDateRange(startDate: string, endDate: string, source?: string): UsageSummary {
    const stmt = this.raw.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0)       AS totalInputTokens,
        COALESCE(SUM(output_tokens), 0)      AS totalOutputTokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS totalReasoningOutputTokens,
        COALESCE(SUM(cache_read_tokens), 0)  AS totalCacheReadTokens,
        COALESCE(SUM(cache_write_tokens), 0) AS totalCacheWriteTokens,
        COALESCE(SUM(cost_usd), 0)           AS totalCostUsd,
        COUNT(*)                              AS recordCount
      FROM ${this.tableName}
      WHERE request_timestamp >= ? AND request_timestamp <= ?
      ${source != null && source !== 'all' ? 'AND source = ?' : ''}
    `)
    const args =
      source != null && source !== 'all' ? [startDate, endDate, source] : [startDate, endDate]
    return stmt.get(...args) as UsageSummary
  }

  /**
   * Get usage grouped by provider and model for a date range.
   * source 语义同 getUsageByDateRange（缺省全部，与旧行为兼容）。
   */
  getModelUsageGrouped(startDate: string, endDate: string, source?: string): ModelUsageGroup[] {
    const stmt = this.raw.prepare(`
      SELECT
        model_id                              AS modelId,
        provider_id                           AS providerId,
        COALESCE(SUM(input_tokens), 0)       AS totalInputTokens,
        COALESCE(SUM(output_tokens), 0)      AS totalOutputTokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS totalReasoningOutputTokens,
        COALESCE(SUM(cost_usd), 0)           AS totalCostUsd,
        COUNT(*)                              AS recordCount
      FROM ${this.tableName}
      WHERE request_timestamp >= ? AND request_timestamp <= ?
      ${source != null && source !== 'all' ? 'AND source = ?' : ''}
      GROUP BY provider_id, model_id
      ORDER BY totalCostUsd DESC
    `)
    const args =
      source != null && source !== 'all' ? [startDate, endDate, source] : [startDate, endDate]
    return stmt.all(...args) as ModelUsageGroup[]
  }

  /**
   * 【AutoDream】按来源维度聚合全部历史用量（设置页「累计整理消耗」数据源）。
   */
  getUsageBySource(source: string): UsageSummary {
    const stmt = this.raw.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0)       AS totalInputTokens,
        COALESCE(SUM(output_tokens), 0)      AS totalOutputTokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS totalReasoningOutputTokens,
        COALESCE(SUM(cache_read_tokens), 0)  AS totalCacheReadTokens,
        COALESCE(SUM(cache_write_tokens), 0) AS totalCacheWriteTokens,
        COALESCE(SUM(cost_usd), 0)           AS totalCostUsd,
        COUNT(*)                              AS recordCount
      FROM ${this.tableName}
      WHERE source = ?
    `)
    return stmt.get(source) as UsageSummary
  }

  /**
   * Get usage grouped by day for a date range.
   */
  getDailyUsageGrouped(startDate: string, endDate: string, source?: string): DailyUsageGroup[] {
    const stmt = this.raw.prepare(`
      SELECT
        DATE(request_timestamp)               AS date,
        COALESCE(SUM(input_tokens), 0)       AS totalInputTokens,
        COALESCE(SUM(output_tokens), 0)      AS totalOutputTokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS totalReasoningOutputTokens,
        COALESCE(SUM(cost_usd), 0)           AS totalCostUsd,
        COUNT(*)                              AS recordCount
      FROM ${this.tableName}
      WHERE request_timestamp >= ? AND request_timestamp <= ?
      ${source != null && source !== 'all' ? 'AND source = ?' : ''}
      GROUP BY DATE(request_timestamp)
      ORDER BY date DESC
    `)
    const args =
      source != null && source !== 'all' ? [startDate, endDate, source] : [startDate, endDate]
    return stmt.all(...args) as DailyUsageGroup[]
  }

  /**
   * Get usage grouped by day and model for a date range.
   * Powers per-model daily trend charts (top-N model comparison).
   * source 语义同 getUsageByDateRange（缺省全部，与旧行为兼容）。
   */
  getModelDailyUsageGrouped(
    startDate: string,
    endDate: string,
    source?: string,
  ): ModelDailyUsageGroup[] {
    const stmt = this.raw.prepare(`
      SELECT
        DATE(request_timestamp)               AS date,
        model_id                              AS modelId,
        provider_id                           AS providerId,
        COALESCE(SUM(input_tokens), 0)       AS totalInputTokens,
        COALESCE(SUM(output_tokens), 0)      AS totalOutputTokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS totalReasoningOutputTokens,
        COALESCE(SUM(cost_usd), 0)           AS totalCostUsd,
        COUNT(*)                              AS recordCount
      FROM ${this.tableName}
      WHERE request_timestamp >= ? AND request_timestamp <= ?
      ${source != null && source !== 'all' ? 'AND source = ?' : ''}
      GROUP BY DATE(request_timestamp), provider_id, model_id
      ORDER BY date DESC
    `)
    const args =
      source != null && source !== 'all' ? [startDate, endDate, source] : [startDate, endDate]
    return stmt.all(...args) as ModelDailyUsageGroup[]
  }

  /**
   * Get recent usage records (paginated).
   */
  getRecentRecords(limit = 50, offset = 0): UsageLedgerRow[] {
    const stmt = this.raw.prepare(`
      SELECT * FROM ${this.tableName}
      ORDER BY request_timestamp DESC
      LIMIT ? OFFSET ?
    `)
    return stmt.all(limit, offset) as UsageLedgerRow[]
  }

  /**
   * Get overall usage summary (all time).
   * source 语义同 getUsageByDateRange（缺省全部，与旧行为兼容）。
   */
  getTotalUsage(source?: string): UsageSummary {
    const stmt = this.raw.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0)       AS totalInputTokens,
        COALESCE(SUM(output_tokens), 0)      AS totalOutputTokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS totalReasoningOutputTokens,
        COALESCE(SUM(cache_read_tokens), 0)  AS totalCacheReadTokens,
        COALESCE(SUM(cache_write_tokens), 0) AS totalCacheWriteTokens,
        COALESCE(SUM(cost_usd), 0)           AS totalCostUsd,
        COUNT(*)                              AS recordCount
      FROM ${this.tableName}
      ${source != null && source !== 'all' ? 'WHERE source = ?' : ''}
    `)
    const args = source != null && source !== 'all' ? [source] : []
    return stmt.get(...args) as UsageSummary
  }

  /**
   * Get usage summary for the current calendar month.
   * source 语义同 getUsageByDateRange（缺省全部，与旧行为兼容）。
   */
  getCurrentMonthUsage(source?: string): UsageSummary {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    ).toISOString()
    return this.getUsageByDateRange(startOfMonth, endOfMonth, source)
  }

  /**
   * Delete usage records older than a given number of days.
   * Returns the number of deleted records.
   */
  deleteOlderThanDays(days: number): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    const stmt = this.raw.prepare(`DELETE FROM ${this.tableName} WHERE request_timestamp < ?`)
    const result = stmt.run(cutoff)
    return result.changes
  }

  /**
   * Delete all usage records for a given session.
   *
   * 三轮功能逻辑审查修复：session 删除时必须清理 usage_ledger，否则：
   * - 用户隐私期望"删除 session"= "清除所有相关数据"被违背
   * - usage_ledger 表长期累积导致膨胀
   * Returns the number of deleted records.
   */
  deleteBySession(sessionId: string): number {
    const stmt = this.raw.prepare(`DELETE FROM ${this.tableName} WHERE session_id = ?`)
    const result = stmt.run(sessionId)
    return result.changes
  }
}
