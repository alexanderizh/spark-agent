import { describe, expect, it } from 'vitest'
import { getLatestAgentStatus, isRunningAgentStatus } from './chat-session-status'

describe('chat session status helpers', () => {
  it('treats transient agent states as running', () => {
    expect(isRunningAgentStatus('thinking')).toBe(true)
    expect(isRunningAgentStatus('waiting_permission')).toBe(true)
    expect(isRunningAgentStatus('completed')).toBe(false)
  })

  it('keeps transient history states when the persisted session is still running', () => {
    expect(
      getLatestAgentStatus(
        [
          {
            id: 'status-1',
            type: 'agent_status',
            sessionId: 'session-1',
            turnId: 'turn-1',
            timestamp: '2026-07-03T00:00:01.000Z',
            seq: 1,
            status: 'thinking',
          },
        ],
        'running',
      ),
    ).toBe('thinking')
  })

  it('restores the running state before the first agent status is persisted', () => {
    expect(
      getLatestAgentStatus(
        [
          {
            id: 'status-previous',
            type: 'agent_status',
            sessionId: 'session-1',
            turnId: 'turn-previous',
            timestamp: '2026-07-03T00:00:00.000Z',
            seq: 1,
            status: 'completed',
          },
          {
            id: 'user-current',
            type: 'user_message',
            sessionId: 'session-1',
            turnId: 'turn-current',
            timestamp: '2026-07-03T00:00:01.000Z',
            seq: 2,
            content: '检查当前代码',
          },
        ],
        'running',
      ),
    ).toBe('thinking')
  })

  it('does not revive a user turn when the persisted session is idle', () => {
    expect(
      getLatestAgentStatus(
        [
          {
            id: 'user-1',
            type: 'user_message',
            sessionId: 'session-1',
            turnId: 'turn-1',
            timestamp: '2026-07-03T00:00:01.000Z',
            seq: 1,
            content: '已经完成的消息',
          },
        ],
        'idle',
      ),
    ).toBeNull()
  })

  it('restores a running session even before its first history event is visible', () => {
    expect(getLatestAgentStatus([], 'running')).toBe('thinking')
  })

  it('ignores stale transient history states when the persisted session is idle', () => {
    expect(
      getLatestAgentStatus(
        [
          {
            id: 'status-1',
            type: 'agent_status',
            sessionId: 'session-1',
            turnId: 'turn-1',
            timestamp: '2026-07-03T00:00:01.000Z',
            seq: 1,
            status: 'thinking',
          },
        ],
        'idle',
      ),
    ).toBeNull()
  })

  it('preserves terminal history states even after the session has gone idle', () => {
    expect(
      getLatestAgentStatus(
        [
          {
            id: 'status-1',
            type: 'agent_status',
            sessionId: 'session-1',
            turnId: 'turn-1',
            timestamp: '2026-07-03T00:00:01.000Z',
            seq: 1,
            status: 'completed',
          },
        ],
        'idle',
      ),
    ).toBe('completed')
  })
})
