import { describe, expect, it } from 'vitest'
import type { UIBlock } from '../services/event-mapper'
import { hasVisibleTeamMemberActivityBlocks } from './chat-team-visibility'

describe('hasVisibleTeamMemberActivityBlocks', () => {
  it('returns false when member activity only contains blank message content and logs', () => {
    const blocks: UIBlock[] = [
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'shell',
        toolInput: {},
        status: 'success',
        output: '',
        error: undefined,
        durationMs: 12,
      },
      {
        kind: 'team_member_message',
        dispatchId: 'dispatch-1',
        memberAgentId: 'agent-1',
        content: '   ',
        isStreaming: true,
      },
      {
        kind: 'terminal',
        toolCallId: 'tool-1',
        stdout: '',
        stderr: '',
        isStreaming: false,
        exitCode: 0,
      },
    ]

    expect(hasVisibleTeamMemberActivityBlocks(blocks)).toBe(false)
  })

  it('returns true when member activity contains visible message content', () => {
    const blocks: UIBlock[] = [
      {
        kind: 'team_member_message',
        dispatchId: 'dispatch-1',
        memberAgentId: 'agent-1',
        content: 'Ship it.',
        isStreaming: false,
      },
    ]

    expect(hasVisibleTeamMemberActivityBlocks(blocks)).toBe(true)
  })
})
