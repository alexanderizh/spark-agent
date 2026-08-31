import { beforeEach, describe, expect, it } from 'vitest'
import type {
  AgentEventRow,
  EventRepository,
  InsertEventParams,
  QueryEventsParams,
} from '@spark/storage'
import {
  getLastCodexRuntimeContextSnapshot,
  getLastRealPromptTokens,
} from '../../../services/session/session-pure-utils.js'

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
  let eventRepo: EventRepository
  let rows: AgentEventRow[]
  const sessionId = 'session-last-real-prompt'

  beforeEach(() => {
    rows = []
    eventRepo = {
      insert: (params: InsertEventParams) => {
        rows.push({
          id: params.id,
          session_id: params.sessionId,
          run_id: null,
          turn_id: params.turnId ?? null,
          event_type: params.eventType,
          event_json: params.eventJson,
          created_at: '2026-09-01T00:00:00.000Z',
          seq: (JSON.parse(params.eventJson) as { seq?: number }).seq ?? null,
        })
      },
      queryBySession: (params: QueryEventsParams) => {
        const matching = rows.filter(
          (row) =>
            row.session_id === params.sessionId &&
            (params.eventType == null || row.event_type === params.eventType),
        )
        const limit = params.limit ?? matching.length
        return {
          events: matching.slice(Math.max(0, matching.length - limit)),
          hasMore: matching.length > limit,
        }
      },
    } as unknown as EventRepository
  })

  it('codex usage_update 即使带 cached 也不再冒充单次请求快照', () => {
    insertUsages(eventRepo, sessionId, [
      { id: 'u1', seq: 1, provider: 'codex', inputTokens: 84_213, cacheHitTokens: 50_000 },
    ])
    expect(getLastRealPromptTokens(eventRepo, sessionId)).toBeUndefined()
  })

  it('只从 Codex app-server 独立事件读取最近请求和 runtime 窗口', () => {
    insertUsages(eventRepo, sessionId, [
      { id: 'paired-usage', seq: 1, provider: 'codex', inputTokens: 84_213 },
    ])
    eventRepo.insert({
      id: 'runtime-context-1',
      sessionId,
      turnId: 'turn-1',
      eventType: 'runtime_context_snapshot',
      eventJson: JSON.stringify({
        id: 'runtime-context-1',
        sessionId,
        turnId: 'turn-1',
        timestamp: '2026-09-01T00:00:00.000Z',
        seq: 2,
        type: 'runtime_context_snapshot',
        provider: 'codex',
        model: 'gpt-test',
        source: 'codex_app_server',
        usedTokens: 84_213,
        cachedInputTokens: 50_000,
        contextWindowTokens: 1_000_000,
      }),
    })

    expect(getLastCodexRuntimeContextSnapshot(eventRepo, sessionId)).toEqual({
      usedTokens: 84_213,
      contextWindowTokens: 1_000_000,
    })

    insertUsages(eventRepo, sessionId, [
      { id: 'fallback-sdk-usage', seq: 3, provider: 'codex', inputTokens: 5_063_372 },
    ])
    expect(getLastCodexRuntimeContextSnapshot(eventRepo, sessionId)).toBeUndefined()
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
      { id: 'u1', seq: 1, provider: 'claude', inputTokens: 84_213 },
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
