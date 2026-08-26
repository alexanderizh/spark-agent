import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { consumeLlmStream } from '../../src/llm/consume.js';
import {
  AnthropicMessagesService,
  toAnthropicRequest,
} from '../../src/llm/anthropic/messages.js';
import {
  OpenAiResponsesService,
  toOpenAiRequest,
} from '../../src/llm/openai/responses.js';
import type { LlmRequest } from '../../src/llm/types.js';

const context = {
  signal: new AbortController().signal,
  turnId: 'turn-1',
  stepId: 'step-1',
};

describe('real model protocol adapters', () => {
  it('parses Anthropic tool streaming and preserves signed thinking for replay', async () => {
    const fixture = await loadFixture('anthropic-tool.sse');
    const fetcher = vi.fn(async () => sseResponse(fixture));
    const service = new AnthropicMessagesService({
      apiKey: 'secret',
      model: 'claude-test',
      fetch: fetcher,
    });
    const response = await consumeLlmStream(service.stream(baseRequest(), context));

    expect(response.message.thinking).toBe('check file');
    expect(response.message.toolCalls).toEqual([
      { callId: 'call_1', name: 'read', args: { path: 'src/a.ts' } },
    ]);
    expect(response.usage).toEqual({
      inputTokens: 11,
      outputTokens: 9,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
    });
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
    );
    expect(JSON.stringify(followup)).toContain('signed-state');
    expect(followup).toMatchObject({ cache_control: { type: 'ephemeral' } });
  });

  it('does not duplicate the Anthropic API version in a gateway base URL', async () => {
    const fixture = await loadFixture('anthropic-tool.sse');
    let requestedUrl: Parameters<typeof globalThis.fetch>[0] | undefined;
    const fetcher: typeof globalThis.fetch = async (input) => {
      requestedUrl = input;
      return sseResponse(fixture);
    };
    const service = new AnthropicMessagesService({
      apiKey: 'secret',
      model: 'claude-test',
      baseUrl: 'https://gateway.example/anthropic/v1/',
      fetch: fetcher,
    });

    await consumeLlmStream(service.stream(baseRequest(), context));

    expect(requestedUrl).toBe('https://gateway.example/anthropic/v1/messages');
  });

  it('parses Responses tool streaming and replays opaque reasoning items', async () => {
    const fixture = await loadFixture('openai-tool.sse');
    const service = new OpenAiResponsesService({
      apiKey: 'secret',
      model: 'gpt-test',
      fetch: async () => sseResponse(fixture),
    });
    const response = await consumeLlmStream(service.stream(baseRequest(), context));

    expect(response.message.thinking).toBe('inspect source');
    expect(response.message.toolCalls).toEqual([
      { callId: 'call_1', name: 'read', args: { path: 'src/a.ts' } },
    ]);
    expect(response.usage).toEqual({
      inputTokens: 13,
      outputTokens: 8,
      cacheReadTokens: 4,
      cacheWriteTokens: 0,
    });
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
    );
    expect(JSON.stringify(followup)).toContain('opaque-reasoning');
  });

  it('classifies an HTTP 429 as retryable without exposing credentials', async () => {
    const service = new OpenAiResponsesService({
      apiKey: 'never-print-this',
      model: 'gpt-test',
      fetch: async () =>
        new Response(JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '2' },
        }),
    });
    const consume = () => consumeLlmStream(service.stream(baseRequest(), context));
    await expect(consume()).rejects.toMatchObject({
      code: 'llm.openai.rate_limit_error',
      retryable: true,
      detail: expect.objectContaining({ status: 429, retryAfterMs: 2_000 }),
    });
    await expect(consume()).rejects.not.toThrow(/never-print-this/u);
  });

  it('omits OpenAI reasoning summaries unless summarized display is requested', () => {
    const omitted = toOpenAiRequest(
      { ...baseRequest(), thinking: { type: 'adaptive', display: 'omitted' } },
      'gpt-test',
    );
    const summarized = toOpenAiRequest(
      { ...baseRequest(), thinking: { type: 'adaptive', display: 'summarized' } },
      'gpt-test',
    );

    expect(omitted).toMatchObject({ reasoning: { effort: 'high' } });
    expect(omitted.reasoning).not.toHaveProperty('summary');
    expect(JSON.stringify(omitted)).not.toContain('"summary":null');
    expect(summarized).toMatchObject({ reasoning: { effort: 'high', summary: 'auto' } });
  });
});

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
  };
}

async function loadFixture(name: string): Promise<string> {
  return readFile(
    fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)),
    'utf8',
  );
}

function sseResponse(value: string): Response {
  return new Response(value, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'request-id': 'request-1' },
  });
}
