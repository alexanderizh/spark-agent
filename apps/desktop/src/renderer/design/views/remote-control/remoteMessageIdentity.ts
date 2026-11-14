/**
 * 「谁在说话」的标识只在会话开头出现一次。
 *
 * 远程会话是单一 Agent（顶栏「远程」+ 会话标题已经说明了来源），逐条消息挂
 * 「远程 Agent」小标只会变成刷屏噪声；桌面端主对话区也是同一口径——只有多 Agent
 * 团队模式或消息不是主 Agent 时才渲染身份（见 chat-message-avatar.ts）。
 *
 * 目标端会把一个 turn 拆成多个 segment（文本 / 代码各一条），中间还夹活动段，
 * 旧实现按「相邻同类」判断，结果每段正文前都补一个标签。这里改成「整条时间线
 * 只在第一个助手条目渲染一次」，与折叠无关，纯数据整形便于单测。
 */
import type { RemoteTimelineItem } from './remoteEventMerge'

/** 应该渲染身份标识的条目下标；返回 -1 表示整条时间线没有助手内容 */
export function resolveAgentIdentityIndex(items: RemoteTimelineItem[]): number {
  return items.findIndex((item) => item.kind === 'assistant')
}

export function shouldShowAgentIdentity(items: RemoteTimelineItem[], index: number): boolean {
  return resolveAgentIdentityIndex(items) === index
}
