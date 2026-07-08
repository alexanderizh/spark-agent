/**
 * @module usage-ledger.service
 *
 * Usage Ledger Service
 *
 * Business logic layer for token usage tracking and analytics.
 * Delegates persistence to UsageLedgerRepository and provides
 * high-level query methods for the UI dashboard.
 */

import { UsageLedgerRepository } from '@spark/storage'
import type { RecordUsageParams, UsageSummary, ModelUsageGroup, DailyUsageGroup, UsageLedgerRow } from '@spark/storage'

export type { RecordUsageParams, UsageSummary, ModelUsageGroup, DailyUsageGroup, UsageLedgerRow }

export class UsageLedgerService {
  constructor(private readonly repo: UsageLedgerRepository) {}

  /**
   * Record a new usage entry.
   * Returns the auto-generated record ID.
   */
  record(params: RecordUsageParams): string {
    return this.repo.record(params)
  }

  /**
   * Get aggregated usage for a specific session.
   */
  getSessionUsage(sessionId: string): UsageSummary {
    return this.repo.getSessionUsage(sessionId)
  }

  /**
   * Get aggregated usage for a date range.
   */
  getUsageByDateRange(startDate: string, endDate: string): UsageSummary {
    return this.repo.getUsageByDateRange(startDate, endDate)
  }

  /**
   * Get usage grouped by model for a date range.
   */
  getModelUsageGrouped(startDate: string, endDate: string): ModelUsageGroup[] {
    return this.repo.getModelUsageGrouped(startDate, endDate)
  }

  /**
   * Get usage grouped by day for a date range.
   */
  getDailyUsageGrouped(startDate: string, endDate: string): DailyUsageGroup[] {
    return this.repo.getDailyUsageGrouped(startDate, endDate)
  }

  /**
   * Get recent usage records (paginated).
   */
  getRecentRecords(limit = 50, offset = 0): UsageLedgerRow[] {
    return this.repo.getRecentRecords(limit, offset)
  }

  /**
   * Get overall usage summary (all time).
   */
  getTotalUsage(): UsageSummary {
    return this.repo.getTotalUsage()
  }

  /**
   * Get usage summary for the current calendar month.
   */
  getCurrentMonthUsage(): UsageSummary {
    return this.repo.getCurrentMonthUsage()
  }

  /**
   * Get the full dashboard data: total, current month, model breakdown, recent records.
   */
  getDashboard(): {
    total: UsageSummary
    currentMonth: UsageSummary
    topModels: ModelUsageGroup[]
    recentRecords: UsageLedgerRow[]
  } {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString()

    return {
      total: this.repo.getTotalUsage(),
      currentMonth: this.repo.getCurrentMonthUsage(),
      topModels: this.repo.getModelUsageGrouped(startOfMonth, endOfMonth),
      recentRecords: this.repo.getRecentRecords(20, 0),
    }
  }

  /**
   * Delete usage records older than a given number of days.
   * Returns the number of deleted records.
   */
  purgeOldRecords(days: number): number {
    return this.repo.deleteOlderThanDays(days)
  }
}
