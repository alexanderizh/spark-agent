import { describe, expect, it, vi } from 'vitest'
import { openWorkflowTestRunSession } from './open-test-run-session'

describe('openWorkflowTestRunSession', () => {
  it('刷新会话列表后再切换视图和活动会话', async () => {
    const calls: string[] = []

    await openWorkflowTestRunSession({
      sessionId: 'session-from-test-run',
      refreshSessionData: async () => {
        calls.push('refresh')
      },
      showChatView: () => calls.push('view'),
      setActiveSession: (sessionId) => calls.push(`session:${sessionId}`),
    })

    expect(calls).toEqual(['refresh', 'view', 'session:session-from-test-run'])
  })

  it('刷新失败时不进入缺少会话数据的 ChatView', async () => {
    const showChatView = vi.fn()
    const setActiveSession = vi.fn()

    await expect(
      openWorkflowTestRunSession({
        sessionId: 'session-from-test-run',
        refreshSessionData: async () => {
          throw new Error('refresh failed')
        },
        showChatView,
        setActiveSession,
      }),
    ).rejects.toThrow('refresh failed')

    expect(showChatView).not.toHaveBeenCalled()
    expect(setActiveSession).not.toHaveBeenCalled()
  })
})
