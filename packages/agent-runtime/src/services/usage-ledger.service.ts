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
import type {
  RecordUsageParams,
  UsageSummary,
  ModelUsageGroup,
  DailyUsageGroup,
  ModelDailyUsageGroup,
  UsageLedgerRow,
} from '@spark/storage'

export type {
  RecordUsageParams,
  UsageSummary,
  ModelUsageGroup,
  DailyUsageGroup,
  ModelDailyUsageGroup,
  UsageLedgerRow,
}

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
   * source: 'api'/'dream' 只统计该维度；'all'/undefined 统计全部（旧行为）。
   */
  getUsageByDateRange(startDate: string, endDate: string, source?: string): UsageSummary {
    return this.repo.getUsageByDateRange(startDate, endDate, source)
  }

  /**
   * Get usage grouped by model for a date range.
   * source 语义同 getUsageByDateRange。
   */
  getModelUsageGrouped(startDate: string, endDate: string, source?: string): ModelUsageGroup[] {
    return this.repo.getModelUsageGrouped(startDate, endDate, source)
  }

  /**
   * Get usage grouped by day for a date range.
   * source 语义同 getUsageByDateRange。
   */
  getDailyUsageGrouped(startDate: string, endDate: string, source?: string): DailyUsageGroup[] {
    return this.repo.getDailyUsageGrouped(startDate, endDate, source)
  }

  /**
   * Get usage grouped by day and model for a date range.
   * source 语义同 getUsageByDateRange。
   */
  getModelDailyUsageGrouped(
    startDate: string,
    endDate: string,
    source?: string,
  ): ModelDailyUsageGroup[] {
    return this.repo.getModelDailyUsageGrouped(startDate, endDate, source)
  }

  /**
   * 【AutoDream】按来源维度聚合全部历史用量（设置页「累计整理消耗」）。
   */
  getUsageBySource(source: string): UsageSummary {
    return this.repo.getUsageBySource(source)
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
   * source 语义同 getUsageByDateRange：'api'/'dream' 只统计该维度；'all'/undefined
   * 统计全部（旧行为）。缺省 'api' 由 IPC handler 决定，保证与 date-range 口径一致。
   */
  getDashboard(source?: string): {
    total: UsageSummary
    currentMonth: UsageSummary
    topModels: ModelUsageGroup[]
    recentRecords: UsageLedgerRow[]
  } {
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

    return {
      total: this.repo.getTotalUsage(source),
      currentMonth: this.repo.getCurrentMonthUsage(source),
      topModels: this.repo.getModelUsageGrouped(startOfMonth, endOfMonth, source),
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
