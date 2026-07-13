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
  const persistedRunning = persistedSessionStatus === 'running'
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'user_message') {
      // 发送后到 provider 产出首个 agent_status / assistant_message 之间存在一个窗口。
      // 切走再回来时历史里可能只有本轮 user_message；此时会话摘要已是 running，
      // 应恢复等待占位，且不能继续向前误取上一轮的 completed 状态。
      return persistedRunning ? 'thinking' : null
    }
    if (event?.type !== 'agent_status') continue
    // 删除消息后，某些未挂到 message.eventIds 上的瞬态状态事件（例如首个 thinking）
    // 可能仍然留在历史里。只有当会话摘要本身仍是 running 时，才允许它们在重放时
    // 把空会话恢复成「执行中」。
    if (isRunningAgentStatus(event.status) && persistedSessionStatus != null && !persistedRunning) {
      return null
    }
    return event.status
  }
  // 极短的启动窗口内，running 摘要可能先于 user_message 出现在历史查询结果中。
  return persistedRunning ? 'thinking' : null
}
