import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import { StreamTerminalizer } from '../../sdk/stream-terminalizer.js'

function event(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: crypto.randomUUID(),
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: '2026-07-11T00:00:00.000Z',
    seq: 0,
    type: 'agent_status',
    status: 'thinking',
    ...overrides,
  } as AgentEvent
}

describe('StreamTerminalizer', () => {
  it('finalizes each unfinished assistant and thinking segment exactly once', () => {
    const terminalizer = new StreamTerminalizer()
    terminalizer.observe(
      event({
        type: 'assistant_message',
        mode: 'delta',
        content: 'Hel',
        provider: 'claude',
        isFinal: false,
        segmentId: 'text-1',
      }),
    )
    terminalizer.observe(
      event({
        type: 'agent_thinking',
        mode: 'delta',
        content: 'Think',
        segmentId: 'thinking-1',
      }),
    )
    terminalizer.observe(
      event({
        type: 'assistant_message',
        mode: 'delta',
        content: 'lo',
        provider: 'claude',
        isFinal: false,
        segmentId: 'text-1',
      }),
    )

    expect(terminalizer.finalize(() => event({}))).toEqual([
      expect.objectContaining({
        type: 'assistant_message',
        mode: 'complete',
        content: 'Hello',
        isFinal: false,
        segmentId: 'text-1',
      }),
      expect.objectContaining({
        type: 'agent_thinking',
        mode: 'complete',
        content: 'Think',
        segmentId: 'thinking-1',
      }),
    ])
    expect(terminalizer.finalize(() => event({}))).toEqual([])
  })

  it('does not duplicate a segment that already received a complete snapshot', () => {
    const terminalizer = new StreamTerminalizer()
    terminalizer.observe(
      event({
        type: 'assistant_message',
        mode: 'delta',
        content: 'partial',
        provider: 'codex',
        isFinal: false,
        segmentId: 'text-1',
      }),
    )
    terminalizer.observe(
      event({
        type: 'assistant_message',
        mode: 'complete',
        content: 'partial',
        provider: 'codex',
        isFinal: false,
        segmentId: 'text-1',
      }),
    )

    expect(terminalizer.finalize(() => event({}))).toEqual([])
  })

  it('treats a final assistant snapshot as completing earlier assistant segments', () => {
    const terminalizer = new StreamTerminalizer()
    terminalizer.observe(
      event({
        type: 'assistant_message',
        mode: 'delta',
        content: 'partial',
        provider: 'codex',
        isFinal: false,
        segmentId: 'text-1',
      }),
    )
    terminalizer.observe(
      event({
        type: 'assistant_message',
        mode: 'complete',
        content: 'partial',
        provider: 'codex',
        isFinal: true,
      }),
    )

    expect(terminalizer.finalize(() => event({}))).toEqual([])
  })

  it('keeps team-member segments isolated across dispatches', () => {
    const terminalizer = new StreamTerminalizer()
    terminalizer.observe(
      event({
        type: 'team_member_message',
        dispatchId: 'dispatch-1',
        memberAgentId: 'member-1',
        mode: 'delta',
        content: 'first partial',
        isFinal: false,
        segmentId: 'shared-segment',
      }),
    )
    terminalizer.observe(
      event({
        type: 'team_member_message',
        dispatchId: 'dispatch-2',
        memberAgentId: 'member-2',
        mode: 'delta',
        content: 'second partial',
        isFinal: false,
        segmentId: 'shared-segment',
      }),
    )

    expect(terminalizer.finalize(() => event({}))).toEqual([
      expect.objectContaining({
        type: 'team_member_message',
        dispatchId: 'dispatch-1',
        memberAgentId: 'member-1',
        content: 'first partial',
      }),
      expect.objectContaining({
        type: 'team_member_message',
        dispatchId: 'dispatch-2',
        memberAgentId: 'member-2',
        content: 'second partial',
      }),
    ])
  })

  it('finalizes unfinished nested subagent transcript segments', () => {
    const terminalizer = new StreamTerminalizer()
    terminalizer.observe(
      event({
        type: 'subagent_message',
        toolCallId: 'tool-1',
        contentKind: 'text',
        mode: 'delta',
        content: 'Checking ',
        segmentId: 'subagent-text-1',
      }),
    )
    terminalizer.observe(
      event({
        type: 'subagent_message',
        toolCallId: 'tool-1',
        contentKind: 'text',
        mode: 'delta',
        content: 'permissions',
        segmentId: 'subagent-text-1',
      }),
    )

    expect(terminalizer.finalize(() => event({}))).toEqual([
      expect.objectContaining({
        type: 'subagent_message',
        toolCallId: 'tool-1',
        contentKind: 'text',
        mode: 'complete',
        content: 'Checking permissions',
        segmentId: 'subagent-text-1',
      }),
    ])
  })
})
