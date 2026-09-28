/**
 * @module ledger-recovery
 *
 * Spark Engine 账本事件 → Effect 三态调和证据（执行连续性 Phase 2 深化 / L3）。
 *
 * 引擎内核的 write-ahead 顺序（spark-engine kernel/tool-runner）：
 *   tool.call（完整参数，#prepare 开头）→ tool.intent（派发前最后一道）→ 执行
 *   → tool.result（收口，携带显式 ok 标志）。
 * 据此对崩溃窗口做三态判定：
 *   - 有 tool.result(ok)          → 副作用已发生且成功收口（可精确 confirm）
 *   - 有 tool.intent 无成功 result → 已越过派发边界、结果未知（真 unknown；
 *                                    含超时 ok:false「Outcome is not confirmed」）
 *   - 仅 tool.call（无 intent）    → 从未派发（含 #deny 拒绝的 ok:false；
 *                                    可安全跳过，不重放）
 */

export interface LedgerReconciliationEvidence {
  /** 有成功 tool.result（ok=true）的 callId → 证据确认为已发生且已收口。 */
  resultCallIds: ReadonlySet<string>
  /** 孤儿意图（tool.intent 已写入、无成功 result）的 callId。 */
  orphanIntentCallIds: ReadonlySet<string>
  /** 账本中出现过 tool.call 但未到达 intent 的 callId（未派发/被拒绝）。 */
  undeliveredCallIds: ReadonlySet<string>
}

type LedgerToolEvent = { type: string; callId?: unknown; ok?: unknown }

/** 扫描账本事件流构建三态证据集合（O(n)；只在 openSession 续跑路径调用一次）。 */
export function buildLedgerReconciliationEvidence(
  events: readonly LedgerToolEvent[],
): LedgerReconciliationEvidence {
  const callSeen = new Set<string>()
  const intentSeen = new Set<string>()
  const resultCallIds = new Set<string>()
  for (const event of events) {
    const callId = typeof event.callId === 'string' ? event.callId : null
    if (callId == null) continue
    if (event.type === 'tool.call') callSeen.add(callId)
    else if (event.type === 'tool.intent') intentSeen.add(callId)
    else if (event.type === 'tool.result' && event.ok === true) resultCallIds.add(callId)
  }
  const orphanIntentCallIds = new Set<string>()
  for (const callId of intentSeen) {
    if (!resultCallIds.has(callId)) orphanIntentCallIds.add(callId)
  }
  const undeliveredCallIds = new Set<string>()
  for (const callId of callSeen) {
    if (!intentSeen.has(callId) && !resultCallIds.has(callId)) undeliveredCallIds.add(callId)
  }
  return { resultCallIds, orphanIntentCallIds, undeliveredCallIds }
}
