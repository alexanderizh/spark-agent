import { describe, expect, it } from 'vitest'

import {
  parseRssItems,
  pickProvider,
  WebSearchToolExecutor,
  webSearchToolDefinition,
} from '../../src/tools/web-search.js'
import type { ToolCallContext, ToolExecutor } from '../../src/seams.js'
import type { ResolvedToolCall } from '../../src/tools/contract.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string, contentType = 'text/xml'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType } })
}

function call(args: unknown): ResolvedToolCall {
  return {
    callId: 'search-1',
    name: webSearchToolDefinition.name,
    args,
    definition: webSearchToolDefinition,
  }
}

function context(): ToolCallContext {
  return { signal: new AbortController().signal, timeoutMs: 20_000 }
}

async function run(
  executor: ToolExecutor,
  args: unknown,
): Promise<{ ok: boolean; content: string }> {
  return executor.execute(call(args), context())
}

describe('web_search provider selection', () => {
  it('prefers keyed providers in order and falls back to the keyless feed', () => {
    expect(pickProvider({})).toBe('bing')
    expect(pickProvider({ SERPER_API_KEY: 's' })).toBe('serper')
    expect(pickProvider({ SERPER_API_KEY: 's', TAVILY_API_KEY: 't' })).toBe('tavily')
    expect(pickProvider({ BOCHA_API_KEY: 'b', TAVILY_API_KEY: 't' })).toBe('bocha')
    expect(pickProvider({ BOCHA_API_KEY: '  ' })).toBe('bing')
  })
})

describe('web_search tool', () => {
  it('renders bocha results through the keyed provider', async () => {
    const requests: { url: string; init: RequestInit }[] = []
    const executor = new WebSearchToolExecutor({
      environment: { BOCHA_API_KEY: 'secret-key' },
      fetchImpl: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          code: 200,
          data: {
            webPages: {
              value: [
                { name: 'Spark 官网', url: 'https://example.com/spark', summary: 'Agent 平台主页' },
                { name: 'Docs', url: 'https://example.com/docs', summary: '文档' },
                { name: 'no-snippet', url: 'https://example.com/x', summary: '' },
              ],
            },
          },
        })
      },
    })
    const outcome = await run(executor, { query: 'spark agent', max_results: 2 })
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('Web results for "spark agent" (2)')
    expect(outcome.content).toContain('1. Spark 官网')
    expect(outcome.content).toContain('URL: https://example.com/spark')
    expect(outcome.content).not.toContain('no-snippet')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://api.bochaai.com/v1/web-search')
    // The API key rides in the header, never in the body or the URL.
    expect(requests[0]?.init.body).not.toContain('secret-key')
    expect((requests[0]?.init.headers as Record<string, string>).authorization).toBe(
      'Bearer secret-key',
    )
  })

  it('maps tavily and serper payloads onto the shared result shape', async () => {
    const tavily = new WebSearchToolExecutor({
      environment: { TAVILY_API_KEY: 'tv' },
      fetchImpl: async () =>
        jsonResponse({
          results: [{ title: 'T', url: 'https://t.example', content: 'S' }],
        }),
    })
    const tavilyOutcome = await run(tavily, { query: 'q' })
    expect(tavilyOutcome.ok).toBe(true)
    expect(tavilyOutcome.content).toContain('T\n   URL: https://t.example\n   S')

    const serper = new WebSearchToolExecutor({
      environment: { SERPER_API_KEY: 'sp' },
      fetchImpl: async () =>
        jsonResponse({ organic: [{ title: 'G', link: 'https://g.example', snippet: 'SS' }] }),
    })
    const serperOutcome = await run(serper, { query: 'q' })
    expect(serperOutcome.ok).toBe(true)
    expect(serperOutcome.content).toContain('1. G')
  })

  it('falls back to the keyless bing rss feed without any key', async () => {
    const requests: string[] = []
    const executor = new WebSearchToolExecutor({
      environment: {},
      fetchImpl: async (url) => {
        requests.push(url)
        return textResponse(
          `<rss><channel>` +
            `<item><title><![CDATA[Result &amp; More]]></title><link>https://a.example/x?y=1</link>` +
            `<description><![CDATA[A &lt;b&gt;snippet&lt;/b&gt; here]]></description></item>` +
            `<item><title>Second</title><link>https://b.example</link><description>Another</description></item>` +
            `<item><title>NoLink</title><description>d</description></item>` +
            `</channel></rss>`,
        )
      },
    })
    const outcome = await run(executor, { query: 'hello world', max_results: 3 })
    expect(outcome.ok).toBe(true)
    expect(requests[0]).toContain('https://www.bing.com/search?q=hello%20world&format=rss&count=3')
    expect(outcome.content).toContain('1. Result & More')
    expect(outcome.content).toContain('https://a.example/x?y=1')
    // CDATA + entities decode, embedded tags strip, and the linkless item drops.
    expect(outcome.content).toContain('A snippet here')
    expect(outcome.content).not.toContain('NoLink')
  })

  it('reports provider failures with the api-key hint instead of crashing', async () => {
    const executor = new WebSearchToolExecutor({
      environment: {},
      fetchImpl: async () => new Response('nope', { status: 503 }),
    })
    const outcome = await run(executor, { query: 'q' })
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('HTTP 503')
    expect(outcome.content).toContain('SERPER_API_KEY')
  })

  it('validates query and max_results bounds', async () => {
    const executor = new WebSearchToolExecutor({
      environment: {},
      fetchImpl: async () => {
        throw new Error('unreachable')
      },
    })
    expect((await run(executor, { query: '   ' })).content).toContain('non-empty string')
    expect((await run(executor, { query: 'q', max_results: 0 })).content).toContain(
      'max_results must be an integer from 1 to 10',
    )
    expect((await run(executor, { query: 'q'.repeat(513) })).content).toContain(
      'at most 512 characters',
    )
  })

  it('bounds rss parsing independently of the network layer', () => {
    const items = parseRssItems(
      '<item><title>One</title><link>https://1</link><description>d1</description></item>' +
        '<item><title>Two</title><link>https://2</link><description>d2</description></item>',
      1,
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('One')
  })
})
