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
    expect(repo.getTotalUsage()).toEqual(
      expect.objectContaining({ totalReasoningOutputTokens: 4 }),
    )
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
    ).toEqual([
      expect.objectContaining({ date: '2026-07-11', totalReasoningOutputTokens: 4 }),
    ])
  })
})
