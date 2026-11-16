// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UIBlock } from '../../../services/event-mapper'
import { translate } from '../../../i18n'
import { RemoteAgentInspectorSection, RemoteAgentToolCallCard } from './RemoteAgentToolCallCard'
import {
  extractRemoteAgentToolCalls,
  projectRemoteAgentTimelineMessages,
} from './remote-agent-tool-call'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const messageSend: Extract<UIBlock, { kind: 'tool_call' }> = {
  kind: 'tool_call',
  toolCallId: 'remote-send-1',
  toolName: 'mcp__spark_remote__message_send',
  toolInput: { linkId: 'link-1', operationId: 'operation-1', text: 'Run the test suite' },
  status: 'success',
  output: JSON.stringify({
    operationId: 'operation-1',
    status: 'queued',
    targetStatus: 'accepted',
  }),
  error: undefined,
  durationMs: 25,
}

const eventsRead: Extract<UIBlock, { kind: 'tool_call' }> = {
  kind: 'tool_call',
  toolCallId: 'remote-read-1',
  toolName: 'mcp__spark_remote__events_read',
  toolInput: { linkId: 'link-1', operationId: 'operation-1' },
  status: 'success',
  output: JSON.stringify({
    linkId: 'link-1',
    operationId: 'operation-1',
    operationStatus: 'completed',
    events: [
      {
        id: 'reply-1',
        seq: 1,
        turnId: 'remote-turn',
        type: 'assistant_message',
        timestamp: '2026-11-16T03:00:00.000Z',
        mode: 'complete',
        content: 'All tests passed on the remote device.',
      },
    ],
  }),
  error: undefined,
  durationMs: 30,
}

describe('RemoteAgentToolCallCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows the remote request and result in the dedicated timeline card', () => {
    act(() => {
      root.render(<RemoteAgentToolCallCard block={eventsRead} />)
    })

    expect(container.querySelector('[data-testid="remote-agent-call-card"]')).not.toBeNull()
    expect(container.textContent).toContain(translate('remoteAgent.call.action.read'))
    expect(container.textContent).toContain(translate('remoteAgent.call.request.eventsRead'))
    expect(container.textContent).toContain('All tests passed on the remote device.')
  })

  it('lists the same calls in history order in a dedicated inspector module', () => {
    const messages = projectRemoteAgentTimelineMessages([
      {
        id: 'assistant-1',
        role: 'assistant',
        status: 'completed',
        blocks: [messageSend, eventsRead],
        usage: null,
        eventIds: [],
      },
    ])
    const entries = extractRemoteAgentToolCalls(messages)

    act(() => {
      root.render(<RemoteAgentInspectorSection entries={entries} />)
    })

    const moduleToggle = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(translate('remoteAgent.call.inspectorTitle')),
    )
    expect(moduleToggle).toBeDefined()
    expect(container.querySelectorAll('[data-testid="remote-agent-call-card"]')).toHaveLength(0)

    act(() => moduleToggle?.click())

    const cards = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="remote-agent-call-card"]'),
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]?.textContent).toContain(translate('remoteAgent.call.action.send'))
    expect(cards[0]?.textContent).toContain('Run the test suite')
    expect(cards[0]?.textContent).toContain('All tests passed on the remote device.')
  })
})
