import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CodexOpenAIExecutor } from '../../sdk/codex-openai-executor.js'
import type { SDKExecutorConfig } from '../../sdk/types.js'

const openAIConstructor = vi.hoisted(() => vi.fn())
const responsesCreate = vi.hoisted(() => vi.fn())
const chatCreate = vi.hoisted(() => vi.fn())

vi.mock('openai', () => ({
  default: openAIConstructor.mockImplementation(() => ({
    responses: { create: responsesCreate },
    chat: { completions: { create: chatCreate } },
  })),
}))

async function* streamFrom(events: unknown[]) {
  for (const event of events) yield event
}

function makeConfig(overrides: Partial<SDKExecutorConfig> = {}): SDKExecutorConfig {
  return {
    apiKey: 'sk-test',
    model: 'gpt-5-codex',
    workspaceRootPath: process.cwd(),
    permissionMode: 'codex-default',
    systemPrompt: 'System context',
    skillSystemPrompt: 'Skill catalog',
    codexApiKind: 'responses',
    ...overrides,
  }
}

describe('CodexOpenAIExecutor', () => {
  beforeEach(() => {
    openAIConstructor.mockClear()
    responsesCreate.mockReset()
    chatCreate.mockReset()
  })

  it('streams Responses API output as assistant deltas and final complete text', async () => {
    responsesCreate.mockResolvedValue(streamFrom([
      { type: 'response.output_text.delta', delta: 'Hel' },
      { type: 'response.output_text.delta', delta: 'lo' },
      {
        type: 'response.completed',
        response: { usage: { input_tokens: 10, output_tokens: 2 } },
      },
    ]))

    const events: Array<{ type: string; mode?: string; content?: string }> = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        events.push({ type: event.type, mode: event.mode, content: event.content })
      }
    })
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5-codex',
        stream: true,
        input: expect.stringContaining('Skill catalog'),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(events).toEqual([
      { type: 'assistant_message', mode: 'delta', content: 'Hel' },
      { type: 'assistant_message', mode: 'delta', content: 'lo' },
      { type: 'assistant_message', mode: 'complete', content: 'Hello' },
    ])
  })

  it('streams Chat Completions output when codexApiKind is chat', async () => {
    chatCreate.mockResolvedValue(streamFrom([
      { choices: [{ delta: { content: 'A' } }] },
      { choices: [{ delta: { content: 'B' } }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
    ]))

    const events: Array<{ type: string; mode?: string; content?: string }> = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        events.push({ type: event.type, mode: event.mode, content: event.content })
      }
    })
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig({ codexApiKind: 'chat' }))

    expect(chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5-codex',
        stream: true,
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

  it('maps Responses reasoning summary deltas to thinking events', async () => {
    responsesCreate.mockResolvedValue(streamFrom([
      { type: 'response.reasoning_summary_text.delta', delta: 'Checking tools' },
      { type: 'response.output_text.delta', delta: 'Done' },
      { type: 'response.completed', response: { usage: { input_tokens: 4, output_tokens: 1 } } },
    ]))

    const events: Array<{ type: string; mode?: string; content?: string }> = []
    const executor = new CodexOpenAIExecutor()
    executor.onEvent((event) => {
      if (event.type === 'agent_thinking' || event.type === 'assistant_message') {
        events.push({ type: event.type, mode: event.mode, content: event.content })
      }
    })
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      { type: 'agent_thinking', mode: 'delta', content: 'Checking tools' },
      { type: 'assistant_message', mode: 'delta', content: 'Done' },
      { type: 'assistant_message', mode: 'complete', content: 'Done' },
    ])
  })
})
