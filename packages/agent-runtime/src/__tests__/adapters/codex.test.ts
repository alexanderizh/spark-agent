import { beforeEach, describe, expect, it, vi } from 'vitest'

const responsesStreamMock = vi.hoisted(() => vi.fn())
const openAIConstructorMock = vi.hoisted(() => vi.fn())

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((options) => {
    openAIConstructorMock(options)
    return {
      responses: {
        stream: responsesStreamMock,
      },
    }
  }),
}))

import { CodexAdapter } from '../../adapters/codex.js'
import type { ChatParams } from '../../adapters/types.js'

async function collect(
  adapter: CodexAdapter,
  params: ChatParams,
  signal?: AbortSignal,
) {
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

describe('CodexAdapter', () => {
  const params: ChatParams = {
    apiKey: 'sk-test',
    model: 'gpt-5-codex',
    systemPrompt: 'You are a coding agent.',
    messages: [{ role: 'user', content: 'Hello' }],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps Responses text, reasoning, usage, and completion events', async () => {
    responsesStreamMock.mockReturnValue(
      streamFrom([
        { type: 'response.reasoning_summary_text.delta', delta: 'Thinking' },
        { type: 'response.output_text.delta', delta: 'Hi' },
        { type: 'response.output_text.delta', delta: ' there' },
        {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 7,
              output_tokens: 3,
              input_tokens_details: { cached_tokens: 2 },
            },
          },
        },
      ]),
    )

    const events = await collect(new CodexAdapter(), params)

    expect(events.map((event) => event.type)).toEqual([
      'agent_thinking',
      'assistant_message',
      'assistant_message',
      'usage_update',
      'assistant_message',
    ])
    expect(events[0]).toMatchObject({ mode: 'delta', content: 'Thinking' })
    expect(events[1]).toMatchObject({ mode: 'delta', content: 'Hi', provider: 'codex' })
    expect(events[3]).toMatchObject({ inputTokens: 7, outputTokens: 3, cacheHitTokens: 2 })
    expect(events.at(-1)).toMatchObject({ mode: 'complete', content: 'Hi there', isFinal: true })
    expect(responsesStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5-codex',
        instructions: 'You are a coding agent.',
        max_output_tokens: 4096,
      }),
      undefined,
    )
  })

  it('maps completed Responses function calls to agent tool calls', async () => {
    responsesStreamMock.mockReturnValue(
      streamFrom([
        {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            call_id: 'call-1',
            name: 'read_file',
            arguments: '{"path":"package.json"}',
          },
        },
        { type: 'response.completed', response: {} },
      ]),
    )

    const events = await collect(new CodexAdapter(), {
      ...params,
      tools: [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
    })

    expect(events[0]).toMatchObject({
      type: 'tool_call',
      toolCallId: 'call-1',
      toolName: 'read_file',
      toolInput: { path: 'package.json' },
    })
    expect(events.at(-1)).toMatchObject({ type: 'assistant_message', mode: 'complete' })
  })

  it('maps Responses errors to retryable agent errors', async () => {
    responsesStreamMock.mockReturnValue(
      streamFrom([
        { type: 'response.error', error: { message: 'rate limited' } },
      ]),
    )

    const events = await collect(new CodexAdapter(), params)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'agent_error',
      code: 'RUNTIME_ERROR',
      message: 'rate limited',
      retryable: true,
    })
  })
})
