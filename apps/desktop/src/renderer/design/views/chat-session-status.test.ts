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
