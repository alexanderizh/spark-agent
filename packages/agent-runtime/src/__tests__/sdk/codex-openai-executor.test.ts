import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexOpenAIExecutor } from '../../sdk/codex-openai-executor.js'
import type { SDKExecutorConfig } from '../../sdk/types.js'

const openAIConstructor = vi.hoisted(() => vi.fn())
const chatCreate = vi.hoisted(() => vi.fn())

vi.mock('openai', () => ({
  default: openAIConstructor.mockImplementation(() => ({
    chat: { completions: { create: chatCreate } },
  })),
}))

async function* streamFrom(events: unknown[]) {
  for (const event of events) yield event
}

function makeConfig(overrides: Partial<SDKExecutorConfig> = {}): SDKExecutorConfig {
  return {
    apiKey: 'sk-test',
    apiEndpoint: 'https://provider.example.com/v1/',
    model: 'provider-chat-model',
    workspaceRootPath: process.cwd(),
    permissionMode: 'codex-default',
    systemPrompt: 'System context',
    skillSystemPrompt: 'Skill catalog',
    codexApiKind: 'chat',
    ...overrides,
  }
}

describe('CodexOpenAIExecutor', () => {
  beforeEach(() => {
    openAIConstructor.mockClear()
    chatCreate.mockReset()
  })

  it('streams Chat Completions directly without starting the Codex SDK', async () => {
    chatCreate.mockResolvedValue(
      streamFrom([
        { choices: [{ delta: { content: 'A' } }] },
        { choices: [{ delta: { content: 'B' } }] },
        { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
      ]),
    )

    const events: Array<{ type: string; mode?: string; content?: string }> = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        events.push({ type: event.type, mode: event.mode, content: event.content })
      }
    })
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(openAIConstructor).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://provider.example.com/v1',
    })
    expect(chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'provider-chat-model',
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: expect.stringContaining('System context') }],
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(events).toEqual([
      { type: 'assistant_message', mode: 'delta', content: 'A' },
      { type: 'assistant_message', mode: 'delta', content: 'B' },
      { type: 'assistant_message', mode: 'complete', content: 'AB' },
    ])
  })

  it('reports usage from the terminal Chat Completions chunk', async () => {
    chatCreate.mockResolvedValue(
      streamFrom([
        { choices: [{ delta: { content: 'Done' } }] },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } },
      ]),
    )

    const usage: Array<{ inputTokens: number; outputTokens: number }> = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'usage_update') {
        usage.push({ inputTokens: event.inputTokens, outputTokens: event.outputTokens })
      }
    })
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(usage).toEqual([{ inputTokens: 12, outputTokens: 4 }])
  })

  it('captures a redacted direct-chat invocation for diagnostics', async () => {
    chatCreate.mockResolvedValue(streamFrom([{ choices: [{ delta: { content: 'OK' } }] }]))
    const invocationObserver = vi.fn()

    await new CodexOpenAIExecutor().executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({ invocationObserver }),
    )

    expect(invocationObserver).toHaveBeenCalledWith({
      transport: 'openai-chat',
      request: expect.objectContaining({
        endpoint: 'https://provider.example.com/v1/chat/completions',
        credentials: '[redacted]',
      }),
    })
    expect(JSON.stringify(invocationObserver.mock.calls)).not.toContain('sk-test')
  })

  it('accepts a full Chat Completions URL without duplicating the path', async () => {
    chatCreate.mockResolvedValue(streamFrom([{ choices: [{ delta: { content: 'OK' } }] }]))
    const invocationObserver = vi.fn()

    await new CodexOpenAIExecutor().executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({
        apiEndpoint: 'https://provider.example.com/v1/chat/completions',
        invocationObserver,
      }),
    )

    expect(openAIConstructor).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://provider.example.com/v1',
    })
    expect(invocationObserver).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          endpoint: 'https://provider.example.com/v1/chat/completions',
        }),
      }),
    )
  })

  it('cancels the direct Chat request without emitting an uncaught error', async () => {
    chatCreate.mockImplementation(
      async (_body: unknown, options: { signal: AbortSignal }) => {
        await new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      },
    )

    const statuses: string[] = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'agent_status') statuses.push(event.status)
    })
    const turn = executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())
    executor.cancel()
    await expect(turn).resolves.toBeUndefined()

    expect(statuses).toContain('cancelled')
  })
})
