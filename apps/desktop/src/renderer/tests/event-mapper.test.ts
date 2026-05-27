import { describe, expect, it } from 'vitest'

import type { AgentEvent, AgentStatusValue } from '@spark/protocol'
import { MessageBuilder } from '../design/services/event-mapper'

function baseEvent(
  type: AgentEvent['type'],
): Pick<AgentEvent, 'id' | 'type' | 'sessionId' | 'turnId' | 'timestamp' | 'seq'> {
  return {
    id: `${type}-1`,
    type,
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: '2026-05-27T00:00:00.000Z',
    seq: 0,
  }
}

function statusEvent(status: AgentStatusValue): AgentEvent {
  return {
    ...baseEvent('agent_status'),
    type: 'agent_status',
    status,
  }
}

describe('MessageBuilder', () => {
  it('stops thinking block streaming when the turn completes without a thinking complete event', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('agent_thinking'),
      type: 'agent_thinking',
      mode: 'delta',
      content: 'checking...',
    })
    builder.processEvent(statusEvent('completed'))

    const message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    expect(message.status).toBe('completed')
    expect(message.blocks).toMatchObject([
      { kind: 'thinking', content: 'checking...', isStreaming: false },
    ])
  })

  it('stops thinking block streaming when the final assistant message arrives', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('agent_thinking'),
      type: 'agent_thinking',
      mode: 'delta',
      content: 'checking...',
    })
    builder.processEvent({
      ...baseEvent('assistant_message'),
      type: 'assistant_message',
      mode: 'delta',
      content: 'done',
      provider: 'codex',
      isFinal: true,
    })

    const message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    expect(message.status).toBe('completed')
    expect(message.blocks.find((block) => block.kind === 'thinking')).toMatchObject({
      kind: 'thinking',
      isStreaming: false,
    })
  })
})
