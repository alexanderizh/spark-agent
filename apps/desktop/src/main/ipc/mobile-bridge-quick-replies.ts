/**
 * 快捷回复建议（`mcp__spark_ui__suggest_replies`）的透出规则。
 *
 * 桌面端在聊天流里把该工具调用的入参解析成「快捷回复 chip」（见
 * renderer/design/services/quick-reply-suggestions.ts）。远程端拿不到工具入参
 * （`MobileBridgeEvent` 刻意不透传 toolInput：入参可能是整段文件内容），
 * 所以在**目标端**就把建议文案挑出来放进事件，控制端只负责渲染与发送。
 *
 * 两端共用同一套上限（4 条 × 40 字）与去重口径：控制端展示的必须是目标端
 * 真正接受的那几条，否则会出现「点了却没发出去」的错觉。
 */

/** 产出快捷回复建议的工具名（spark_ui MCP） */
export const QUICK_REPLY_TOOL_NAME = 'mcp__spark_ui__suggest_replies'

export const MAX_QUICK_REPLIES = 4
export const MAX_QUICK_REPLY_LENGTH = 40

export function isQuickReplyTool(toolName: string): boolean {
  return toolName.trim().toLowerCase() === QUICK_REPLY_TOOL_NAME
}

/**
 * 工具入参 → 建议文案。
 *
 * 入参形状是 `{ replies: string[] }`；脏数据（非对象、replies 非数组、元素非字符串）
 * 一律静默丢弃 —— 这条链路只影响输入区的小提示，不值得让一次 turn 失败。
 */
export function parseQuickReplies(toolInput: unknown): string[] {
  if (toolInput == null || typeof toolInput !== 'object' || Array.isArray(toolInput)) return []
  const raw = (toolInput as Record<string, unknown>).replies
  if (!Array.isArray(raw)) return []

  const replies: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    // 按码点截断，避免把代理对切一半产生乱码
    const reply = [...item.trim()].slice(0, MAX_QUICK_REPLY_LENGTH).join('')
    if (!reply || seen.has(reply)) continue
    seen.add(reply)
    replies.push(reply)
    if (replies.length >= MAX_QUICK_REPLIES) break
  }
  return replies
}
