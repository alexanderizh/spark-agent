/**
 * 会话用量台账（P1-W3-S6 部分迁出，2026-08-20）。
 *
 * 承接 per-turn 用量增量核算：累计基线去重（usageLedgerLastByTurn）与
 * usage_ledger 落库。不参与事件流式路径，与事件漏斗解耦便于独立测试。
 * 原属 SessionService 的私有状态，经此模块持有；SessionService 保留
 * clearUsageLedgerTurnState 公共委托以兼容命令系统等调用方。
 */
import { SessionRepository, UsageLedgerRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { AgentEvent } from '@spark/protocol'

/** 每 turn 的用量累计快照（增量核算基线）。 */
type UsageSnapshot = {
  inputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  cacheHitTokens: number
  cacheWriteTokens: number
  estimatedCostUsd: number
}

export class SessionUsageLedger {
  private readonly lastByTurn = new Map<string, UsageSnapshot>()

  constructor(private readonly db: SparkDatabase) {}

  private key(sessionId: string, turnId: string, sourceKey = 'host'): string {
    return `${sessionId}:${turnId}:${sourceKey}`
  }

  /** 清除某会话（或某 turn）的用量累计基线。 */
  clearTurnState(sessionId: string, turnId?: string): void {
    if (turnId != null) {
      const turnPrefix = `${sessionId}:${turnId}:`
      for (const key of this.lastByTurn.keys()) {
        if (key.startsWith(turnPrefix)) this.lastByTurn.delete(key)
      }
      return
    }
    const prefix = `${sessionId}:`
    for (const key of this.lastByTurn.keys()) {
      if (key.startsWith(prefix)) this.lastByTurn.delete(key)
    }
  }

  /**
   * 记录一次 usage_update：SDK 上报为累计快照，这里按 turn/source 维护基线，
   * 只把增量写入 usage_ledger。全零增量直接跳过。落库失败不阻塞（非致命）。
   */
  recordUpdate(
    sessionId: string,
    turnId: string,
    event: Extract<AgentEvent, { type: 'usage_update' }>,
    options: {
      sourceKey?: string
      providerId?: string
      modelId?: string
    } = {},
  ): void {
    const key = this.key(sessionId, turnId, options.sourceKey)
    const prev = this.lastByTurn.get(key) ?? {
      inputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      cacheHitTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
    }
    const current = {
      inputTokens: Math.max(0, event.inputTokens),
      outputTokens: Math.max(0, event.outputTokens),
      reasoningOutputTokens: Math.max(0, event.reasoningOutputTokens ?? 0),
      cacheHitTokens: Math.max(0, event.cacheHitTokens ?? 0),
      cacheWriteTokens: Math.max(0, event.cacheWriteTokens ?? 0),
      estimatedCostUsd: Math.max(0, event.estimatedCostUsd ?? 0),
    }
    this.lastByTurn.set(key, current)

    const inputTokens = Math.max(0, current.inputTokens - prev.inputTokens)
    const outputTokens = Math.max(0, current.outputTokens - prev.outputTokens)
    const reasoningOutputTokens = Math.max(
      0,
      current.reasoningOutputTokens - prev.reasoningOutputTokens,
    )
    const cacheReadTokens = Math.max(0, current.cacheHitTokens - prev.cacheHitTokens)
    const cacheWriteTokens = Math.max(0, current.cacheWriteTokens - prev.cacheWriteTokens)
    const costUsd = Math.max(0, current.estimatedCostUsd - prev.estimatedCostUsd)
    if (
      inputTokens === 0 &&
      outputTokens === 0 &&
      reasoningOutputTokens === 0 &&
      cacheReadTokens === 0 &&
      cacheWriteTokens === 0 &&
      costUsd === 0
    )
      return

    try {
      const session = new SessionRepository(this.db).get(sessionId)
      const providerId = options.providerId ?? session?.provider_profile_id ?? event.provider
      const modelId = options.modelId ?? (event.model || session?.model_id || 'unknown')
      new UsageLedgerRepository(this.db).record({
        sessionId,
        providerId,
        modelId,
        inputTokens,
        outputTokens,
        reasoningOutputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        costUsd,
        requestTimestamp: event.timestamp,
      })
    } catch {
      // Non-fatal: usage dashboard data must not interrupt chat event streaming.
    }
  }
}
