import { describe, expect, it, vi, beforeEach } from 'vitest'

const openAICreateMock = vi.hoisted(() => vi.fn())
const openAIConstructorMock = vi.hoisted(() => vi.fn())

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((options) => {
    openAIConstructorMock(options)
    return {
      chat: {
        completions: {
          create: openAICreateMock,
        },
      },
    }
  }),
}))

import { OpenAIAdapter } from '../../adapters/openai.js'
import type { ChatParams } from '../../adapters/types.js'

async function collect(
  adapter: OpenAIAdapter,
  params: ChatParams,
  signal?: AbortSignal,
) {
  const events = []
  for await (const event of adapter.streamChat(params, 'session-1', 'turn-1', signal)) {
    events.push(event)
  }
  return events
}

function streamFrom(chunks: unknown[]) {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk
    }
  })()
}

describe('OpenAI-compatible adapters', () => {
  const params: ChatParams = {
    apiKey: 'sk-test',
    model: 'gpt-5.1',
    messages: [{ role: 'user', content: 'Hello' }],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps OpenAI text and usage chunks', async () => {
    openAICreateMock.mockResolvedValue(
      streamFrom([
        {
          choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }],
          usage: null,
        },
        {
          choices: [{ index: 0, delta: { content: ' there' }, finish_reason: 'stop' }],
          usage: null,
        },
        {
          choices: [],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        },
      ]),
    )

    const events = await collect(new OpenAIAdapter(), params)

    expect(events.map((event) => event.type)).toEqual([
      'assistant_message',
      'assistant_message',
      'usage_update',
      'assistant_message',
    ])
    expect(events[0]).toMatchObject({ mode: 'delta', content: 'Hi', provider: 'openai' })
    expect(events.at(-1)).toMatchObject({ mode: 'complete', content: 'Hi there', isFinal: true })
    expect(openAICreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.1',
        stream: true,
        stream_options: { include_usage: true },
      }),
      undefined,
    )
  })

  it('accumulates OpenAI tool call chunks', async () => {
    openAICreateMock.mockResolvedValue(
      streamFrom([
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"path":"' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
          usage: null,
        },
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: 'package.json"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: null,
        },
      ]),
    )

    const events = await collect(new OpenAIAdapter(), {
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

  it('uses custom baseURL when an OpenAI-compatible endpoint is configured', async () => {
    openAICreateMock.mockResolvedValue(
      streamFrom([
        {
          choices: [
            {
              index: 0,
              delta: { content: 'Answer' },
              finish_reason: 'stop',
            },
          ],
          usage: null,
        },
      ]),
    )

    const events = await collect(new OpenAIAdapter(), {
      ...params,
      model: 'gpt-4.1',
      apiEndpoint: 'https://api.example.com/v1',
    })

    expect(openAIConstructorMock).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://api.example.com/v1',
    })
    expect(events[0]).toMatchObject({
      type: 'assistant_message',
      mode: 'delta',
      content: 'Answer',
      provider: 'openai',
    })
  })

  it('maps abort errors to non-retryable agent_error', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    openAICreateMock.mockRejectedValue(abortError)

    const events = await collect(new OpenAIAdapter(), params)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'agent_error',
      code: 'ABORTED',
      retryable: false,
    })
  })
})
