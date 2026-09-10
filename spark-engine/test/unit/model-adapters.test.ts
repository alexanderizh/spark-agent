import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { consumeLlmStream } from '../../src/llm/consume.js'
import { AnthropicMessagesService, toAnthropicRequest } from '../../src/llm/anthropic/messages.js'
import { OpenAiResponsesService, toOpenAiRequest } from '../../src/llm/openai/responses.js'
import type { LlmRequest } from '../../src/llm/types.js'

const context = {
  signal: new AbortController().signal,
  turnId: 'turn-1',
  stepId: 'step-1',
}

describe('real model protocol adapters', () => {
  it('parses Anthropic tool streaming and preserves signed thinking for replay', async () => {
    const fixture = await loadFixture('anthropic-tool.sse')
    const fetcher = vi.fn(async () => sseResponse(fixture))
    const service = new AnthropicMessagesService({
      apiKey: 'secret',
      model: 'claude-test',
      fetch: fetcher,
    })
    const response = await consumeLlmStream(service.stream(baseRequest(), context))

    expect(response.message.thinking).toBe('check file')
    expect(response.message.toolCalls).toEqual([
      { callId: 'call_1', name: 'read', args: { path: 'src/a.ts' } },
    ])
    expect(response.usage).toEqual({
      inputTokens: 11,
      outputTokens: 9,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
      reasoningTokens: 0,
    })
    // Streaming adapters timestamp the call; both must be present and sane.
    expect(response.llmMs).toBeGreaterThanOrEqual(0)
    expect(response.ttftMs).toBeGreaterThanOrEqual(0)
    const followup = toAnthropicRequest(
      {
        ...baseRequest(),
        messages: [
          {
            role: 'assistant',
            content: '',
            ...(response.message.thinking === undefined
              ? {}
              : { thinking: response.message.thinking }),
            toolCalls: response.message.toolCalls,
            ...(response.message.continuation === undefined
              ? {}
              : { continuation: response.message.continuation }),
            sourceSeqs: [1],
          },
          {
            role: 'tool_result',
            callId: 'call_1',
            tool: 'read',
            ok: true,
            content: 'file body',
            sourceSeqs: [2],
          },
        ],
      },
      'claude-test',
      true,
    )
    expect(JSON.stringify(followup)).toContain('signed-state')
    expect(followup).toMatchObject({ cache_control: { type: 'ephemeral' } })
  })

  it('does not duplicate the Anthropic API version in a gateway base URL', async () => {
    const fixture = await loadFixture('anthropic-tool.sse')
    let requestedUrl: Parameters<typeof globalThis.fetch>[0] | undefined
    const fetcher: typeof globalThis.fetch = async (input) => {
      requestedUrl = input
      return sseResponse(fixture)
    }
    const service = new AnthropicMessagesService({
      apiKey: 'secret',
      model: 'claude-test',
      baseUrl: 'https://gateway.example/anthropic/v1/',
      fetch: fetcher,
    })

    await consumeLlmStream(service.stream(baseRequest(), context))

    expect(requestedUrl).toBe('https://gateway.example/anthropic/v1/messages')
  })

  it('parses Responses tool streaming and replays opaque reasoning items', async () => {
    const fixture = await loadFixture('openai-tool.sse')
    const service = new OpenAiResponsesService({
      apiKey: 'secret',
      model: 'gpt-test',
      fetch: async () => sseResponse(fixture),
    })
    const response = await consumeLlmStream(service.stream(baseRequest(), context))

    expect(response.message.thinking).toBe('inspect source')
    expect(response.message.toolCalls).toEqual([
      { callId: 'call_1', name: 'read', args: { path: 'src/a.ts' } },
    ])
    expect(response.usage).toEqual({
      inputTokens: 13,
      outputTokens: 8,
      cacheReadTokens: 4,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    })
    expect(response.llmMs).toBeGreaterThanOrEqual(0)
    expect(response.ttftMs).toBeGreaterThanOrEqual(0)
    const followup = toOpenAiRequest(
      {
        ...baseRequest(),
        messages: [
          {
            role: 'assistant',
            content: '',
            ...(response.message.thinking === undefined
              ? {}
              : { thinking: response.message.thinking }),
            toolCalls: response.message.toolCalls,
            ...(response.message.continuation === undefined
              ? {}
              : { continuation: response.message.continuation }),
            sourceSeqs: [1],
          },
          {
            role: 'tool_result',
            callId: 'call_1',
            tool: 'read',
            ok: true,
            content: 'file body',
            sourceSeqs: [2],
          },
        ],
      },
      'gpt-test',
    )
    expect(JSON.stringify(followup)).toContain('opaque-reasoning')
  })

  it('reports Responses reasoning tokens and call timing from the completed response', async () => {
    const sse = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"r1","status":"in_progress"}}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"hello"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"r1","status":"completed","output":[],"usage":{"input_tokens":10,"output_tokens":30,"input_tokens_details":{"cached_tokens":2},"output_tokens_details":{"reasoning_tokens":21}}}}',
      '',
    ].join('\n')
    const service = new OpenAiResponsesService({
      apiKey: 'secret',
      model: 'gpt-test',
      fetch: async () => sseResponse(sse),
    })
    const response = await consumeLlmStream(service.stream(baseRequest(), context))

    expect(response.usage).toEqual({
      inputTokens: 10,
      outputTokens: 30,
      cacheReadTokens: 2,
      cacheWriteTokens: 0,
      reasoningTokens: 21,
    })
    expect(response.llmMs).toBeGreaterThanOrEqual(0)
    expect(response.ttftMs).toBeGreaterThanOrEqual(0)
  })

  it('recovers Responses final text when the gateway omits text deltas', async () => {
    const sse = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"r2","status":"in_progress"}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"r2","status":"completed","output":[{"id":"msg_r2","type":"message","role":"assistant","content":[{"type":"output_text","text":"gateway final answer","annotations":[]}]}],"usage":{"input_tokens":10,"output_tokens":4}}}',
      '',
    ].join('\n')
    const service = new OpenAiResponsesService({
      apiKey: 'secret',
      model: 'gpt-test',
      fetch: async () => sseResponse(sse),
    })

    const response = await consumeLlmStream(service.stream(baseRequest(), context))

    expect(response.message.text).toBe('gateway final answer')
  })

  it('recovers Anthropic final text supplied on a gateway completion block', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":2,"output_tokens":1}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"gateway final answer"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n')
    const service = new AnthropicMessagesService({
      apiKey: 'secret',
      model: 'claude-test',
      fetch: async () => sseResponse(sse),
    })

    const response = await consumeLlmStream(service.stream(baseRequest(), context))

    expect(response.message.text).toBe('gateway final answer')
  })

  it('diagnoses malformed Anthropic tool arguments without persisting their content', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"random/free-model","usage":{"input_tokens":2}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_bad","name":"write","input":{}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"secret.html\\""}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
    ].join('\n')
    const service = new AnthropicMessagesService({
      apiKey: 'secret',
      model: 'openrouter/free',
      fetch: async () => sseResponse(sse),
    })

    const consume = () => consumeLlmStream(service.stream(baseRequest(), context))
    await expect(consume()).rejects.toMatchObject({
      code: 'llm.anthropic.invalid_tool_json',
      detail: {
        requestId: 'request-1',
        responseModel: 'random/free-model',
        jsonCharacters: 21,
        likelyTruncated: true,
        parseError: expect.any(String),
      },
    })
    await expect(consume()).rejects.not.toThrow(/secret\.html/u)
  })

  it('does not treat reasoning-only output as a successful final answer', async () => {
    const stream = (async function* () {
      yield { type: 'thinking', text: 'I should answer next.' } as const
      yield {
        type: 'usage',
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      } as const
      yield { type: 'done' } as const
    })()

    await expect(consumeLlmStream(stream)).rejects.toMatchObject({
      code: 'llm.no_final_text',
      retryable: true,
    })
  })

  it.each([
    {
      service: () =>
        new AnthropicMessagesService({
          apiKey: 'secret',
          model: 'claude-test',
          fetch: async () =>
            sseResponse(
              'event: error\ndata: {"type":"error","error":{"type":"bridge_stream_error","message":"socket reset","cause":{"code":"ECONNRESET"}}}\n\n',
            ),
        }),
      code: 'llm.anthropic.bridge_stream_error',
    },
    {
      service: () =>
        new OpenAiResponsesService({
          apiKey: 'secret',
          model: 'gpt-test',
          fetch: async () =>
            sseResponse(
              'event: error\ndata: {"type":"error","error":{"code":"bridge_stream_error","message":"socket reset","cause":{"code":"ECONNRESET"}}}\n\n',
            ),
        }),
      code: 'llm.openai.bridge_stream_error',
    },
  ])('preserves structured provider stream errors ($code)', async ({ service, code }) => {
    await expect(consumeLlmStream(service().stream(baseRequest(), context))).rejects.toMatchObject({
      code,
      message: 'socket reset',
      retryable: true,
      detail: {
        providerError: {
          cause: { code: 'ECONNRESET' },
        },
      },
    })
  })

  it.each([
    {
      service: () =>
        new AnthropicMessagesService({
          apiKey: 'secret',
          model: 'claude-test',
          fetch: async () =>
            sseResponse(
              'event: error\ndata: {"type":"error","error":{"type":"invalid_request_error","message":"bad tools"}}\n\n',
            ),
        }),
      code: 'llm.anthropic.invalid_request_error',
    },
    {
      service: () =>
        new OpenAiResponsesService({
          apiKey: 'secret',
          model: 'gpt-test',
          fetch: async () =>
            sseResponse(
              'event: error\ndata: {"type":"error","error":{"code":"context_length_exceeded","message":"too long"}}\n\n',
            ),
        }),
      code: 'llm.openai.context_length_exceeded',
    },
    {
      service: () =>
        new AnthropicMessagesService({
          apiKey: 'secret',
          model: 'claude-test',
          fetch: async () =>
            sseResponse(
              'event: error\ndata: {"type":"error","error":{"type":"REQUEST_TOO_LARGE","message":"too large"}}\n\n',
            ),
        }),
      code: 'llm.anthropic.REQUEST_TOO_LARGE',
    },
    {
      service: () =>
        new OpenAiResponsesService({
          apiKey: 'secret',
          model: 'gpt-test',
          fetch: async () =>
            sseResponse(
              'event: error\ndata: {"type":"error","error":{"code":"INSUFFICIENT_QUOTA","message":"quota exhausted"}}\n\n',
            ),
        }),
      code: 'llm.openai.INSUFFICIENT_QUOTA',
    },
  ])('does not retry permanent provider errors ($code)', async ({ service, code }) => {
    await expect(consumeLlmStream(service().stream(baseRequest(), context))).rejects.toMatchObject({
      code,
      retryable: false,
    })
  })

  it('classifies an HTTP 429 as retryable without exposing credentials', async () => {
    const service = new OpenAiResponsesService({
      apiKey: 'never-print-this',
      model: 'gpt-test',
      fetch: async () =>
        new Response(
          JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' } }),
          {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '2' },
          },
        ),
    })
    const consume = () => consumeLlmStream(service.stream(baseRequest(), context))
    await expect(consume()).rejects.toMatchObject({
      code: 'llm.openai.rate_limit_error',
      retryable: true,
      detail: expect.objectContaining({ status: 429, retryAfterMs: 2_000 }),
    })
    await expect(consume()).rejects.not.toThrow(/never-print-this/u)
  })

  it('retains a bounded bridge message from a top-level HTTP error payload', async () => {
    const service = new OpenAiResponsesService({
      apiKey: 'secret',
      model: 'gpt-test',
      fetch: async () =>
        new Response(JSON.stringify({ error: 'bridge_request_failed' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
    })
    await expect(consumeLlmStream(service.stream(baseRequest(), context))).rejects.toMatchObject({
      code: 'llm.openai.502',
      message: 'bridge_request_failed',
      retryable: true,
    })
  })

  it('preserves a structured bridge cause from an HTTP transport error', async () => {
    const service = new OpenAiResponsesService({
      apiKey: 'secret',
      model: 'gpt-test',
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              type: 'bridge_transport_error',
              message: 'fetch failed → ECONNREFUSED: connection refused',
              cause: { code: 'ECONNREFUSED', message: 'connection refused' },
            },
          }),
          { status: 502, headers: { 'content-type': 'application/json' } },
        ),
    })
    await expect(consumeLlmStream(service.stream(baseRequest(), context))).rejects.toMatchObject({
      code: 'llm.openai.bridge_transport_error',
      retryable: true,
      detail: {
        providerError: {
          cause: { code: 'ECONNREFUSED', message: 'connection refused' },
        },
      },
    })
  })

  it('preserves a safe nested cause when the request transport fails', async () => {
    const service = new OpenAiResponsesService({
      apiKey: 'secret',
      model: 'gpt-test',
      fetch: async () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
        })
      },
    })
    await expect(consumeLlmStream(service.stream(baseRequest(), context))).rejects.toMatchObject({
      code: 'llm.transport_error',
      retryable: true,
      detail: {
        cause: {
          name: 'TypeError',
          message: 'fetch failed',
          cause: { code: 'ECONNRESET', message: 'connection reset' },
        },
      },
    })
  })

  it('omits OpenAI reasoning summaries unless summarized display is requested', () => {
    const omitted = toOpenAiRequest(
      { ...baseRequest(), thinking: { type: 'adaptive', display: 'omitted' } },
      'gpt-test',
    )
    const summarized = toOpenAiRequest(
      { ...baseRequest(), thinking: { type: 'adaptive', display: 'summarized' } },
      'gpt-test',
    )

    expect(omitted).toMatchObject({ reasoning: { effort: 'high' } })
    expect(omitted.reasoning).not.toHaveProperty('summary')
    expect(JSON.stringify(omitted)).not.toContain('"summary":null')
    expect(summarized).toMatchObject({ reasoning: { effort: 'high', summary: 'auto' } })
  })
})

function baseRequest(): LlmRequest {
  return {
    system: [{ id: 'base', content: 'You are Spark.', stability: 'stable' }],
    messages: [{ role: 'user', content: 'Read the file', sourceSeqs: [0] }],
    tools: [
      {
        name: 'read',
        description: 'Read a workspace file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ],
    maxTokens: 4_096,
    metadata: { sessionId: 'session-1' },
  }
}

async function loadFixture(name: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
}

function sseResponse(value: string): Response {
  return new Response(value, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'request-id': 'request-1' },
  })
}
