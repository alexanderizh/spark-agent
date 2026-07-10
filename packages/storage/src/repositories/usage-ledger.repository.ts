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
         cost_usd, request_timestamp, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
   * Get aggregated usage for a date range (inclusive).
   * Dates should be ISO 8601 strings (e.g., '2024-01-01T00:00:00Z').
   */
  getUsageByDateRange(startDate: string, endDate: string): UsageSummary {
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
    `)
    return stmt.get(startDate, endDate) as UsageSummary
  }

  /**
   * Get usage grouped by provider and model for a date range.
   */
  getModelUsageGrouped(startDate: string, endDate: string): ModelUsageGroup[] {
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
      GROUP BY provider_id, model_id
      ORDER BY totalCostUsd DESC
    `)
    return stmt.all(startDate, endDate) as ModelUsageGroup[]
  }

  /**
   * Get usage grouped by day for a date range.
   */
  getDailyUsageGrouped(startDate: string, endDate: string): DailyUsageGroup[] {
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
      GROUP BY DATE(request_timestamp)
      ORDER BY date DESC
    `)
    return stmt.all(startDate, endDate) as DailyUsageGroup[]
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
   */
  getTotalUsage(): UsageSummary {
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
    `)
    return stmt.get() as UsageSummary
  }

  /**
   * Get usage summary for the current calendar month.
   */
  getCurrentMonthUsage(): UsageSummary {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString()
    return this.getUsageByDateRange(startOfMonth, endOfMonth)
  }

  /**
   * Delete usage records older than a given number of days.
   * Returns the number of deleted records.
   */
  deleteOlderThanDays(days: number): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    const stmt = this.raw.prepare(
      `DELETE FROM ${this.tableName} WHERE request_timestamp < ?`,
    )
    const result = stmt.run(cutoff)
    return result.changes
  }
}
