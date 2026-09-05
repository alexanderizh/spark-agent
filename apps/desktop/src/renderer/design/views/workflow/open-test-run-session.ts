import type { SessionId } from '@spark/protocol'

export async function openWorkflowTestRunSession(options: {
  sessionId: string
  refreshSessionData: () => Promise<unknown>
  showChatView: () => void
  setActiveSession: (sessionId: SessionId) => void
}): Promise<void> {
  // 试跑会话由主进程创建。先刷新 renderer 的共享会话列表，
  // 再切到 ChatView，否则 ChatView 会因找不到 SessionSummary 而显示空白页。
  await options.refreshSessionData()
  options.showChatView()
  options.setActiveSession(options.sessionId as SessionId)
}
