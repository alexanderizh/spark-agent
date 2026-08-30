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
})
