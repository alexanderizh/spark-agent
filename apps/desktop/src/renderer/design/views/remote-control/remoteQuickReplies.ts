/**
 * 远程会话的快捷回复（纯函数，便于单测）。
 *
 * 目标端把 `mcp__spark_ui__suggest_replies` 的建议文案塞进 tool_call 事件
 * （见 main/ipc/mobile-bridge-quick-replies.ts），控制端只做两件事：
 *   1. 找到「最近一次还没被消费」的建议 —— 用户只要再发一句话，旧建议就失效；
 *   2. 有待回答的问答卡时不给建议（与桌面端同一条互斥口径：结构化问答优先，
 *      两套提示同时出现会让用户不知道该点哪个）。
 *
 * 注意不能用 buildRemoteTimeline 的结果：时间线把 tool_call 折叠进活动段，
 * 不再保留 quickReplies 字段，所以这里直接扫原始事件。
 */
import type { MobileBridgeEvent } from '@spark/protocol'

export interface PendingRemoteQuickReplies {
  /** 产生建议的那次工具调用（既作 React key，也作「关闭过」的标记） */
  toolCallId: string
  turnId: string
  replies: string[]
}

/**
 * 从事件流末尾往回找最近一次未被消费的快捷回复建议。
 *
 * 遇到 user_message 立即停止：那条消息就是用户对上一轮建议的回应，
 * 更早的建议没有任何价值（继续往前走只会把十天前的建议翻出来）。
 */
export function resolvePendingQuickReplies(
  events: MobileBridgeEvent[],
  options: { hasPendingQuestion?: boolean } = {},
): PendingRemoteQuickReplies | null {
  if (options.hasPendingQuestion === true) return null

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event == null) continue
    if (event.type === 'user_message') return null
    if (event.type !== 'tool_call') continue
    const replies = event.quickReplies
    if (replies == null || replies.length === 0) continue
    const toolCallId = event.toolCallId ?? event.id
    return { toolCallId, turnId: event.turnId, replies }
  }
  return null
}
