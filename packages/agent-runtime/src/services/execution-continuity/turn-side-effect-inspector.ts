/**
 * @module turn-side-effect-inspector
 *
 * Phase 1 副作用证明（方案 §14-Phase 1）：
 *
 * Phase 1 尚无全量 EffectJournal 接入，因此对旧 `running/orphaned` Turn Run
 * 使用「已持久事件流」做保守证明——扫描该 turnId 下的全部 tool_call 事件：
 *   - 无任何 tool_call → 证明未派发任何副作用 → 允许 L1 自动继续
 *   - 只有 sideEffect=none 的查询类工具 → 证明无外部副作用 → 允许 L1 自动继续
 *   - 出现工作区写入/外部副作用工具（或来源不明的 MCP 工具）→ 无法证明 → needs_attention
 *
 * 事件流是已持久化的可信材料（每条 tool_call 在派发前落库），
 * 证明强度等同于「检查 write-ahead 日志」，但不依赖 EffectJournal 的存在。
 */

import { EventRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { ToolCallEvent } from '@spark/protocol'
import { mayHaveExternalSideEffect, getToolRecoveryPolicy } from './tool-recovery-registry.js'

export type SideEffectProof =
  | { kind: 'no_tools_dispatched' }
  | { kind: 'query_tools_only'; toolNames: string[] }
  | { kind: 'unknown'; toolNames: string[]; riskyTools: string[] }

/** 检查到指定 seq（含）为止的事件；默认检查全部（恢复场景即崩溃前全部落库事件）。 */
export function inspectTurnSideEffects(input: {
  db: SparkDatabase
  sessionId: string
  turnId: string
  upToSeq?: number
}): SideEffectProof {
  const eventRepo = new EventRepository(input.db)
  // 分页拉全该 turn 的 tool_call 事件（恢复中心场景 turn 内工具数量有限）。
  const toolNames: string[] = []
  const riskyTools: string[] = []
  let beforeSeq = input.upToSeq
  for (;;) {
    const page = eventRepo.queryBySession({
      sessionId: input.sessionId,
      turnId: input.turnId,
      eventType: 'tool_call',
      limit: 200,
      ...(beforeSeq != null ? { beforeSeq } : {}),
    })
    if (page.events.length === 0) break
    for (const row of page.events) {
      let event: ToolCallEvent
      try {
        event = JSON.parse(row.event_json) as ToolCallEvent
      } catch {
        // 事件体损坏：无法证明，按 unknown 处理。
        riskyTools.push('<unparsable>')
        continue
      }
      toolNames.push(event.toolName)
      const policy = getToolRecoveryPolicy(event.toolName, event.source)
      if (policy.sideEffect !== 'none') {
        riskyTools.push(event.toolName)
      }
    }
    const oldestSeq = page.events[0]?.seq
    if (oldestSeq == null || !page.hasMore) break
    beforeSeq = oldestSeq
  }
  if (toolNames.length === 0) return { kind: 'no_tools_dispatched' }
  if (riskyTools.length === 0) return { kind: 'query_tools_only', toolNames }
  return { kind: 'unknown', toolNames, riskyTools }
}

/** 旁路检查 mayHaveExternalSideEffect（导出便于测试）。 */
export const sideEffectClassifier = { mayHaveExternalSideEffect, getToolRecoveryPolicy }
