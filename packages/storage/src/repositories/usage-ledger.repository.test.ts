import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SparkDatabase } from '../database.js'
import { UsageLedgerRepository } from './usage-ledger.repository.js'

describe('UsageLedgerRepository reasoning usage', () => {
  let db: SparkDatabase
  let repo: UsageLedgerRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-usage-reasoning-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    repo = new UsageLedgerRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('records and aggregates reasoning output tokens independently', () => {
    repo.record({
      sessionId: 'session-1',
      providerId: 'codex',
      modelId: 'gpt-5-codex',
      inputTokens: 20,
      outputTokens: 9,
      reasoningOutputTokens: 4,
      requestTimestamp: '2026-07-11T00:00:00.000Z',
    })

    expect(repo.getRecentRecords()).toEqual([
      expect.objectContaining({ reasoning_output_tokens: 4 }),
    ])
    expect(repo.getSessionUsage('session-1')).toEqual(
      expect.objectContaining({ totalReasoningOutputTokens: 4 }),
    )
    expect(repo.getTotalUsage()).toEqual(expect.objectContaining({ totalReasoningOutputTokens: 4 }))
    expect(
      repo.getUsageByDateRange('2026-07-11T00:00:00.000Z', '2026-07-11T23:59:59.999Z'),
    ).toEqual(expect.objectContaining({ totalReasoningOutputTokens: 4 }))
    expect(
      repo.getModelUsageGrouped('2026-07-11T00:00:00.000Z', '2026-07-11T23:59:59.999Z'),
    ).toEqual([
      expect.objectContaining({
        providerId: 'codex',
        modelId: 'gpt-5-codex',
        totalReasoningOutputTokens: 4,
      }),
    ])
    expect(
      repo.getDailyUsageGrouped('2026-07-11T00:00:00.000Z', '2026-07-11T23:59:59.999Z'),
    ).toEqual([expect.objectContaining({ date: '2026-07-11', totalReasoningOutputTokens: 4 })])
  })

  it('groups usage by day and model for trend charts', () => {
    repo.record({
      sessionId: 'session-1',
      providerId: 'zhipu',
      modelId: 'glm-5.3',
      inputTokens: 100,
      outputTokens: 50,
      requestTimestamp: '2026-08-29T10:00:00.000Z',
    })
    repo.record({
      sessionId: 'session-1',
      providerId: 'zhipu',
      modelId: 'glm-5.3',
      inputTokens: 10,
      outputTokens: 5,
      requestTimestamp: '2026-08-29T18:00:00.000Z',
    })
    repo.record({
      sessionId: 'session-2',
      providerId: 'zhipu',
      modelId: 'glm-5.2',
      inputTokens: 7,
      outputTokens: 3,
      requestTimestamp: '2026-08-29T12:00:00.000Z',
    })
    repo.record({
      sessionId: 'session-3',
      providerId: 'zhipu',
      modelId: 'glm-5.3',
      inputTokens: 1,
      outputTokens: 2,
      requestTimestamp: '2026-08-30T09:00:00.000Z',
    })

    const rows = repo.getModelDailyUsageGrouped(
      '2026-08-29T00:00:00.000Z',
      '2026-08-30T23:59:59.999Z',
    )

    // 同日同模型聚合为一条，跨日/跨模型各自成行（同日内按分组返回序）
    expect(rows).toEqual([
      expect.objectContaining({
        date: '2026-08-30',
        modelId: 'glm-5.3',
        totalInputTokens: 1,
        totalOutputTokens: 2,
        recordCount: 1,
      }),
      expect.objectContaining({
        date: '2026-08-29',
        modelId: 'glm-5.2',
        totalInputTokens: 7,
        totalOutputTokens: 3,
        recordCount: 1,
      }),
      expect.objectContaining({
        date: '2026-08-29',
        modelId: 'glm-5.3',
        totalInputTokens: 110,
        totalOutputTokens: 55,
        recordCount: 2,
      }),
    ])

    // 范围外记录不计入
    expect(
      repo.getModelDailyUsageGrouped('2026-08-30T00:00:00.000Z', '2026-08-30T23:59:59.999Z'),
    ).toEqual([expect.objectContaining({ date: '2026-08-30', recordCount: 1 })])
  })

  it('separates dream usage by source dimension (AutoDream §12-2)', () => {
    // 用户会话（缺省 'api'）与梦境整理会话（'dream'）各记一笔
    repo.record({
      sessionId: 'session-user',
      providerId: 'zhipu',
      modelId: 'glm-5.3',
      inputTokens: 100,
      outputTokens: 50,
      requestTimestamp: '2026-10-10T10:00:00.000Z',
    })
    repo.record({
      sessionId: 'session-dream',
      providerId: 'zhipu',
      modelId: 'glm-5.3',
      inputTokens: 900,
      outputTokens: 500,
      costUsd: 0.25,
      source: 'dream',
      requestTimestamp: '2026-10-10T11:00:00.000Z',
    })

    // 缺省行落 'api'（存量语义零迁移）
    expect(repo.getRecentRecords()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ session_id: 'session-user', source: 'api' }),
        expect.objectContaining({ session_id: 'session-dream', source: 'dream' }),
      ]),
    )

    const range = ['2026-10-10T00:00:00.000Z', '2026-10-10T23:59:59.999Z'] as const
    // source='api'：统计被 dream 消耗排除（缺省分账口径）
    expect(repo.getUsageByDateRange(range[0], range[1], 'api')).toEqual(
      expect.objectContaining({ totalInputTokens: 100, recordCount: 1 }),
    )
    // source='dream'：整理成本可单查
    expect(repo.getUsageByDateRange(range[0], range[1], 'dream')).toEqual(
      expect.objectContaining({ totalInputTokens: 900, totalCostUsd: 0.25, recordCount: 1 }),
    )
    // source='all'/缺省：保持旧全量语义
    expect(repo.getUsageByDateRange(range[0], range[1], 'all')).toEqual(
      expect.objectContaining({ totalInputTokens: 1000, recordCount: 2 }),
    )
    expect(repo.getUsageByDateRange(range[0], range[1])).toEqual(
      expect.objectContaining({ totalInputTokens: 1000, recordCount: 2 }),
    )
    // 模型分组 / 日分组同源过滤
    expect(repo.getModelUsageGrouped(range[0], range[1], 'dream')).toEqual([
      expect.objectContaining({ modelId: 'glm-5.3', totalInputTokens: 900 }),
    ])
    expect(repo.getDailyUsageGrouped(range[0], range[1], 'api')).toEqual([
      expect.objectContaining({ date: '2026-10-10', totalInputTokens: 100 }),
    ])
    // 按源全量聚合（设置页「累计整理消耗」）
    expect(repo.getUsageBySource('dream')).toEqual(
      expect.objectContaining({ totalInputTokens: 900, totalOutputTokens: 500, recordCount: 1 }),
    )
  })

  it('dashboard 聚合（total/currentMonth）按 source 分账，与 date-range 口径一致', () => {
    repo.record({
      sessionId: 'session-user',
      providerId: 'zhipu',
      modelId: 'glm-5.3',
      inputTokens: 100,
      outputTokens: 50,
      requestTimestamp: '2026-10-10T10:00:00.000Z',
    })
    repo.record({
      sessionId: 'session-dream',
      providerId: 'zhipu',
      modelId: 'glm-5.3',
      inputTokens: 900,
      outputTokens: 500,
      costUsd: 0.25,
      source: 'dream',
      requestTimestamp: '2026-10-10T11:00:00.000Z',
    })

    // 'api' 口径：dashboard 的 total 与 currentMonth 都不含 dream 消耗
    expect(repo.getTotalUsage('api')).toEqual(
      expect.objectContaining({ totalInputTokens: 100, recordCount: 1 }),
    )
    expect(repo.getCurrentMonthUsage('api')).toEqual(
      expect.objectContaining({ totalInputTokens: 100, recordCount: 1 }),
    )
    // 'dream' 口径：整理成本单查
    expect(repo.getTotalUsage('dream')).toEqual(
      expect.objectContaining({ totalInputTokens: 900, totalCostUsd: 0.25, recordCount: 1 }),
    )
    // 缺省/'all'：保持旧全量语义（旧调用零迁移）
    expect(repo.getTotalUsage()).toEqual(
      expect.objectContaining({ totalInputTokens: 1000, recordCount: 2 }),
    )
    expect(repo.getTotalUsage('all')).toEqual(
      expect.objectContaining({ totalInputTokens: 1000, recordCount: 2 }),
    )
  })
})
