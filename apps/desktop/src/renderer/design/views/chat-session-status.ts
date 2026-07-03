import type { AgentEvent, AgentStatusValue, SessionListResponse } from '@spark/protocol'

export function isRunningAgentStatus(status: AgentStatusValue | null): boolean {
  return (
    status === 'thinking' ||
    status === 'calling_tool' ||
    status === 'waiting_permission' ||
    status === 'waiting_user'
  )
}

export function getLatestAgentStatus(
  events: AgentEvent[],
  persistedSessionStatus?: SessionListResponse['sessions'][number]['status'],
): AgentStatusValue | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type !== 'agent_status') continue
    // 删除消息后，某些未挂到 message.eventIds 上的瞬态状态事件（例如首个 thinking）
    // 可能仍然留在历史里。只有当会话摘要本身仍是 running 时，才允许它们在重放时
    // 把空会话恢复成「执行中」。
    if (
      isRunningAgentStatus(event.status) &&
      persistedSessionStatus != null &&
      persistedSessionStatus !== 'running'
    ) {
      return null
    }
    return event.status
  }
  return null
}
