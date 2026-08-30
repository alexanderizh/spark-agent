import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventRepository, SessionRepository, SparkDatabase } from '@spark/storage'
import { getLastRealPromptTokens } from '../../../services/session/session-pure-utils.js'

interface UsageFixture {
  id: string
  seq: number
  provider: string
  inputTokens: number
  cacheHitTokens?: number
  cacheWriteTokens?: number
  /** 仅 claude result 变体携带；出现即视为轮内合计，不可当单次请求规模。 */
  estimatedCostUsd?: number
}

function usageJson(sessionId: string, fixture: UsageFixture): string {
  return JSON.stringify({
    id: fixture.id,
    sessionId,
    turnId: 'turn-1',
    timestamp: '2026-08-31T00:00:00.000Z',
    seq: fixture.seq,
    type: 'usage_update',
    provider: fixture.provider,
    model: 'test-model',
    inputTokens: fixture.inputTokens,
    outputTokens: 100,
    ...(fixture.cacheHitTokens != null ? { cacheHitTokens: fixture.cacheHitTokens } : {}),
    ...(fixture.cacheWriteTokens != null ? { cacheWriteTokens: fixture.cacheWriteTokens } : {}),
    ...(fixture.estimatedCostUsd != null ? { estimatedCostUsd: fixture.estimatedCostUsd } : {}),
  })
}

function insertUsages(
  eventRepo: EventRepository,
  sessionId: string,
  fixtures: UsageFixture[],
): void {
  for (const fixture of fixtures) {
    eventRepo.insert({
      id: fixture.id,
      sessionId,
      turnId: 'turn-1',
      eventType: 'usage_update',
      eventJson: usageJson(sessionId, fixture),
    })
  }
}

describe('getLastRealPromptTokens 适配器口径', () => {
  let db: SparkDatabase
  let directory: string
  let eventRepo: EventRepository
  const sessionId = 'session-last-real-prompt'

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'spark-last-prompt-'))
    db = new SparkDatabase(join(directory, 'test.db'))
    db.runMigrations(resolve(process.cwd(), '../storage/migrations'))
    new SessionRepository(db).create({
      id: sessionId,
      kind: 'chat',
      title: 'Usage metering',
      status: 'idle',
      projectId: '',
      providerProfileId: 'provider-test',
      modelId: 'test-model',
      agentAdapter: 'claude',
    })
    eventRepo = new EventRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('codex 快照直用 input（已含 cached，不重复累加）', () => {
    insertUsages(eventRepo, sessionId, [
      { id: 'u1', seq: 1, provider: 'codex', inputTokens: 84_213, cacheHitTokens: 50_000 },
    ])
    expect(getLastRealPromptTokens(eventRepo, sessionId)).toBe(84_213)
  })

  it('claude per-call 变体按窗口口径回加缓存', () => {
    insertUsages(eventRepo, sessionId, [
      {
        id: 'u1',
        seq: 1,
        provider: 'claude',
        inputTokens: 95_000,
        cacheHitTokens: 120_000,
        cacheWriteTokens: 8_000,
      },
    ])
    expect(getLastRealPromptTokens(eventRepo, sessionId)).toBe(223_000)
  })

  it('claude result 轮内合计被跳过，回退更早的 per-call 变体', () => {
    insertUsages(eventRepo, sessionId, [
      {
        id: 'u1',
        seq: 1,
        provider: 'claude',
        inputTokens: 95_000,
        cacheHitTokens: 120_000,
        cacheWriteTokens: 8_000,
      },
      { id: 'u2', seq: 2, provider: 'claude', inputTokens: 0 },
      {
        id: 'u3',
        seq: 3,
        provider: 'claude',
        inputTokens: 132_034,
        cacheHitTokens: 5_337_728,
        estimatedCostUsd: 3.67,
      },
    ])
    expect(getLastRealPromptTokens(eventRepo, sessionId)).toBe(223_000)
  })

  it('仅剩 claude result 合计时返回 undefined（宁缺毋假）', () => {
    insertUsages(eventRepo, sessionId, [
      {
        id: 'u1',
        seq: 1,
        provider: 'claude',
        inputTokens: 132_034,
        cacheHitTokens: 5_337_728,
        estimatedCostUsd: 3.67,
      },
    ])
    expect(getLastRealPromptTokens(eventRepo, sessionId)).toBeUndefined()
  })

  it('零值占位不可用，取更早的可用快照', () => {
    insertUsages(eventRepo, sessionId, [
      { id: 'u1', seq: 1, provider: 'codex', inputTokens: 84_213 },
      { id: 'u2', seq: 2, provider: 'claude', inputTokens: 0 },
    ])
    expect(getLastRealPromptTokens(eventRepo, sessionId)).toBe(84_213)
  })

  it('全部不可用（零值/空会话）返回 undefined', () => {
    insertUsages(eventRepo, sessionId, [{ id: 'u1', seq: 1, provider: 'claude', inputTokens: 0 }])
    expect(getLastRealPromptTokens(eventRepo, sessionId)).toBeUndefined()
    expect(getLastRealPromptTokens(eventRepo, 'session-without-usage')).toBeUndefined()
  })
})
