import { describe, expect, it, vi, beforeEach } from 'vitest'

const anthropicStreamMock = vi.hoisted(() => vi.fn())
const anthropicConstructorMock = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation((options) => {
    anthropicConstructorMock(options)
    return {
      messages: {
        stream: anthropicStreamMock,
      },
    }
  }),
}))

import { AnthropicAdapter } from '../../adapters/anthropic.js'
import type { ChatParams } from '../../adapters/types.js'

async function collect(adapter: AnthropicAdapter, params: ChatParams, signal?: AbortSignal) {
  const events = []
  for await (const event of adapter.streamChat(params, 'session-1', 'turn-1', signal)) {
    events.push(event)
  }
  return events
}

function streamFrom(events: unknown[]) {
  return (async function* () {
    for (const event of events) {
      yield event
    }
  })()
}

describe('AnthropicAdapter', () => {
  const params: ChatParams = {
    apiKey: 'sk-ant-test',
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'Hello' }],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps text and usage stream events', async () => {
    anthropicStreamMock.mockReturnValue(
      streamFrom([
        {
          type: 'message_start',
          message: { usage: { input_tokens: 4, output_tokens: 0, cache_read_input_tokens: 2 } },
        },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: ' there' } },
        { type: 'message_delta', usage: { output_tokens: 2, cache_read_input_tokens: null } },
        { type: 'message_stop' },
      ]),
    )

    const events = await collect(new AnthropicAdapter(), params)

    expect(events.map((event) => event.type)).toEqual([
      'usage_update',
      'assistant_message',
      'assistant_message',
      'usage_update',
      'assistant_message',
    ])
    expect(events[1]).toMatchObject({ mode: 'delta', content: 'Hi', provider: 'anthropic' })
    expect(events.at(-1)).toMatchObject({ mode: 'complete', content: 'Hi there', isFinal: true })
    expect(anthropicConstructorMock).toHaveBeenCalledWith({ apiKey: 'sk-ant-test' })
  })

  it('maps tool_use content blocks to tool_call events', async () => {
    anthropicStreamMock.mockReturnValue(
      streamFrom([
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool-1',
            name: 'read_file',
            input: {},
          },
        },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'package.json"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]),
    )

    const events = await collect(new AnthropicAdapter(), {
      ...params,
      tools: [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
    })

    expect(events[0]).toMatchObject({
      type: 'tool_call',
      toolCallId: 'tool-1',
      toolName: 'read_file',
      toolInput: { path: 'package.json' },
      source: 'builtin',
    })
  })

  it('maps thinking deltas', async () => {
    anthropicStreamMock.mockReturnValue(
      streamFrom([
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Considering' } },
        { type: 'message_stop' },
      ]),
    )

    const events = await collect(new AnthropicAdapter(), params)

    expect(events[0]).toMatchObject({
      type: 'agent_thinking',
      mode: 'delta',
      content: 'Considering',
    })
    expect(events[1]).toMatchObject({
      type: 'agent_thinking',
      mode: 'complete',
      content: 'Considering',
    })
  })

  it('maps abort errors to non-retryable agent_error', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    anthropicStreamMock.mockImplementation(async function* () {
      yield* streamFrom([])
      throw abortError
    })

    const events = await collect(new AnthropicAdapter(), params)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'agent_error',
      code: 'ABORTED',
      retryable: false,
    })
  })
})
