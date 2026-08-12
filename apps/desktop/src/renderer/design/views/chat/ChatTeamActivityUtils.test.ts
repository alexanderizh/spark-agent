import { describe, expect, it } from 'vitest'
import type { TeamMemberEventContext } from '@spark/protocol'
import type { UIBlock, UIMessage } from '../../services/event-mapper'
import { hasRunningTeamMemberActivity } from './ChatTeamActivityUtils'

function getMemberContext(block: UIBlock): TeamMemberEventContext | undefined {
  return 'teamMemberContext' in block ? block.teamMemberContext : undefined
}

describe('hasRunningTeamMemberActivity', () => {
  it('does not revive a completed dispatch from an unclosed thinking delta', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        blocks: [
          {
            kind: 'team_dispatch',
            dispatchId: 'dispatch-1',
            hostAgentId: 'host-1',
            memberAgentId: 'member-1',
            task: { taskId: 'task-1', memberAgentId: 'member-1', instruction: 'Review' },
            state: 'completed',
          },
          {
            kind: 'thinking',
            content: 'Reviewing',
            isStreaming: true,
            teamMemberContext: { dispatchId: 'dispatch-1', memberAgentId: 'member-1' },
          },
        ],
        eventIds: [],
        timestamp: '2026-08-12T00:00:00.000Z',
        status: 'completed',
      },
    ]

    expect(hasRunningTeamMemberActivity(messages, getMemberContext)).toBe(false)
  })
})
