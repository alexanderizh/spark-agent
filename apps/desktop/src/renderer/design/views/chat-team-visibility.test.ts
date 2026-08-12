import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

  it('reveals log-only member activity only when the team log preference is enabled', () => {
    const blocks: UIBlock[] = [
      {
        kind: 'thinking',
        content: 'Checking the event stream',
        isStreaming: true,
        teamMemberContext: { dispatchId: 'dispatch-1', memberAgentId: 'agent-1' },
      },
    ]

    expect(hasVisibleTeamMemberActivityBlocks(blocks)).toBe(false)
    expect(hasVisibleTeamMemberActivityBlocks(blocks, true)).toBe(true)
  })

  it('hides assistant thinking and tool logs only while team mode is active', () => {
    const stylesheet = readFileSync(
      fileURLToPath(new URL('./ChatView.less', import.meta.url)),
      'utf8',
    )
    const teamLogRule =
      stylesheet.match(
        /\.team-mode-active:not\(\.team-logs-visible\) \.msg-bubble-agent \.thinking-section,[\s\S]*?\{\s*display:\s*none;\s*\}/,
      )?.[0] ?? ''

    expect(teamLogRule).toContain('.team-mode-active:not(.team-logs-visible) .msg-bubble-agent .thinking-section')
    expect(teamLogRule).toContain('.team-mode-active:not(.team-logs-visible) .msg-bubble-agent .chat-activity-segment')
    expect(teamLogRule).toContain('.team-mode-active:not(.team-logs-visible) .msg-bubble-agent .tool-log-group')
    expect(teamLogRule).toContain('.team-mode-active:not(.team-logs-visible) .msg-bubble-agent .tool-call')
    expect(teamLogRule).toContain('.team-mode-active:not(.team-logs-visible) .msg-bubble-agent .tool-logs-collapsible')
    expect(teamLogRule).toContain('.team-mode-active:not(.team-logs-visible) .msg-bubble-agent .diff.hunk-mode')
    expect(teamLogRule).toContain('.team-mode-active:not(.team-logs-visible) .msg-bubble-agent .parallel-tools-indicator')
    expect(teamLogRule).toContain(
      '.team-mode-active:not(.team-logs-visible) .msg-bubble-agent .msg-content.is-tool-logs-only',
    )
  })
})
