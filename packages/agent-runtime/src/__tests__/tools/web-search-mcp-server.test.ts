import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'

const SERVER = path.resolve('src/tools/web-search-mcp-server.mjs')

describe('spark_search MCP server', () => {
  let server: Server
  let baseUrl = ''
  let requestCounts = new Map<string, number>()
  let lastRequest: {
    url: string | undefined
    headers: Record<string, unknown>
    body: unknown
  } | null = null
  let child: ChildProcessWithoutNullStreams | null = null

  beforeEach(async () => {
    lastRequest = null
    requestCounts = new Map()
    server = createServer((req, res) => {
      const requestKey = req.url ?? ''
      const requestCount = (requestCounts.get(requestKey) ?? 0) + 1
      requestCounts.set(requestKey, requestCount)
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(Buffer.from(c)))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        lastRequest = {
          url: req.url,
          headers: req.headers as Record<string, unknown>,
          body: raw ? JSON.parse(raw) : null,
        }
        // Serper-shaped keyed provider mock
        if (req.url === '/flaky/search') {
          if (requestCount === 1) {
            res.writeHead(503, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'temporarily unavailable' }))
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              organic: [{ title: 'Recovered', link: 'https://example.com/recovered' }],
            }),
          )
          return
        }
        if (req.url === '/rate-limited/search') {
          if (requestCount === 1) {
            res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' })
            res.end(JSON.stringify({ error: 'try again' }))
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              organic: [{ title: 'Recovered after 429', link: 'https://example.com/rate' }],
            }),
          )
          return
        }
        if (req.url === '/forbidden-page') {
          res.writeHead(403, { 'content-type': 'text/plain' })
          res.end('forbidden')
          return
        }
        if (req.url === '/slow-body') {
          res.writeHead(200, { 'content-type': 'text/plain' })
          res.write('partial body')
          setTimeout(() => res.end(' that never arrives in time'), 1_300)
          return
        }
        if (req.url === '/flaky-body/search') {
          if (requestCount === 1) {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.write('{"organic":[')
            setTimeout(() => res.end(''), 1_300)
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              organic: [{ title: 'Recovered body', link: 'https://example.com/body' }],
            }),
          )
          return
        }
        if (
          req.url?.startsWith('/slow-bing?') ||
          req.url?.startsWith('/slow-duckduckgo?') ||
          req.url?.startsWith('/slow-baidu?')
        ) {
          setTimeout(() => {
            res.writeHead(200, { 'content-type': 'text/html' })
            res.end(
              '<ol><li class="b_algo"><h2><a href="https://example.com/late">Late</a></h2></li></ol>',
            )
          }, 1_300)
          return
        }
        if (req.url === '/search') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              organic: [
                { title: 'First Result', link: 'https://example.com/a', snippet: 'snippet a' },
                { title: 'Second Result', link: 'https://example.com/b', snippet: 'snippet b' },
              ],
              answerBox: { answer: '42' },
            }),
          )
          return
        }
        if (req.url?.startsWith('/bing?')) {
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end(`
            <ol>
              <li class="b_algo">
                <h2 class=""><a href="https://example.com/bing-result">Bing Result</a></h2>
                <p class="b_lineclamp">Bing snippet</p>
              </li>
            </ol>
          `)
          return
        }
        // HTML page for fetch_url
        if (req.url === '/page') {
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end(
            '<html><head><title>Hello Title</title></head><body><script>var x=1</script><article><p>Para one.</p><p>Para two.</p></article></body></html>',
          )
          return
        }
        res.writeHead(404)
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Failed to bind test server')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    if (child && !child.killed) child.kill()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function start(env: Record<string, string> = {}): ChildProcessWithoutNullStreams {
    return spawn(process.execPath, [SERVER], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: { ...process.env, ...env },
    })
  }

  it('lists web_search and fetch_url tools', async () => {
    child = start()
    const res = await callMcp(child, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const names = (res.result.tools as Array<{ name: string }>).map((t) => t.name)
    expect(names).toEqual(['web_search', 'fetch_url'])
  })

  it('routes to the keyed provider (serper) and parses results', async () => {
    child = start({
      SPARK_SEARCH_PROVIDER: 'serper',
      SPARK_SEARCH_API_KEY: 'test-key',
      SPARK_SEARCH_BASE_URL: baseUrl,
    })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { query: 'meaning of life', count: 2 } },
    })
    expect(res.error).toBeUndefined()
    const data = res.result.structuredContent
    expect(data.provider).toBe('serper')
    expect(data.answer).toBe('42')
    expect(data.results).toHaveLength(2)
    expect(data.results[0]).toMatchObject({
      title: 'First Result',
      url: 'https://example.com/a',
      snippet: 'snippet a',
    })
    expect(lastRequest?.headers['x-api-key']).toBe('test-key')
    expect(lastRequest?.body).toMatchObject({ q: 'meaning of life', num: 2 })
  })

  it('parses current Bing result markup with attributes on h2', async () => {
    child = start({
      SPARK_SEARCH_PROVIDER: 'bing',
      SPARK_SEARCH_BING_URL: `${baseUrl}/bing`,
    })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { query: 'bing parser', count: 1 } },
    })
    expect(res.error).toBeUndefined()
    expect(res.result.structuredContent).toMatchObject({
      provider: 'bing',
      results: [
        {
          title: 'Bing Result',
          url: 'https://example.com/bing-result',
          snippet: 'Bing snippet',
        },
      ],
    })
  })

  it('falls back to a keyless engine when a configured keyed provider fails', async () => {
    child = start({
      SPARK_SEARCH_PROVIDER: 'serper',
      SPARK_SEARCH_API_KEY: 'invalid-key',
      SPARK_SEARCH_BASE_URL: `${baseUrl}/missing`,
      SPARK_SEARCH_BING_URL: `${baseUrl}/bing`,
    })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { query: 'fallback', count: 1 } },
    })
    expect(res.error).toBeUndefined()
    expect(res.result.structuredContent.provider).toBe('bing')
    expect(res.result.structuredContent.results).toHaveLength(1)
    expect(res.result.structuredContent.warnings[0]).toContain('serper: POST')
    expect(res.result.structuredContent.warnings[0]).toContain('HTTP 404')
  })

  it('retries a transient keyed-provider 5xx once and returns the recovered result', async () => {
    child = start({
      SPARK_SEARCH_PROVIDER: 'serper',
      SPARK_SEARCH_API_KEY: 'test-key',
      SPARK_SEARCH_BASE_URL: `${baseUrl}/flaky`,
      SPARK_SEARCH_RETRY_BACKOFF_MS: '1',
    })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { query: 'retry', count: 1 } },
    })
    expect(res.error).toBeUndefined()
    expect(res.result.structuredContent.results[0].title).toBe('Recovered')
    expect(requestCounts.get('/flaky/search')).toBe(2)
  })

  it('retries HTTP 429 and respects a Retry-After response', async () => {
    child = start({
      SPARK_SEARCH_PROVIDER: 'serper',
      SPARK_SEARCH_API_KEY: 'test-key',
      SPARK_SEARCH_BASE_URL: `${baseUrl}/rate-limited`,
      SPARK_SEARCH_RETRY_BACKOFF_MS: '1',
    })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { query: 'rate limit', count: 1 } },
    })
    expect(res.error).toBeUndefined()
    expect(res.result.structuredContent.results[0].title).toBe('Recovered after 429')
    expect(requestCounts.get('/rate-limited/search')).toBe(2)
  })

  it('does not retry deterministic fetch_url 4xx errors', async () => {
    child = start({ SPARK_SEARCH_RETRY_BACKOFF_MS: '1' })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'fetch_url', arguments: { url: `${baseUrl}/forbidden-page` } },
    })
    expect(res.error.message).toContain('HTTP 403 [http_4xx]')
    expect(requestCounts.get('/forbidden-page')).toBe(1)
  })

  it('times out when fetch_url receives headers but the response body stalls', async () => {
    child = start({
      SPARK_SEARCH_TIMEOUT_MS: '1000',
      SPARK_SEARCH_TOTAL_TIMEOUT_MS: '1100',
      SPARK_SEARCH_MAX_RETRIES: '0',
    })
    const startedAt = Date.now()
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'fetch_url', arguments: { url: `${baseUrl}/slow-body` } },
    })
    expect(res.error.message).toContain('[timeout]')
    expect(Date.now() - startedAt).toBeLessThan(1_600)
  })

  it('retries a transient response-body timeout and returns the recovered result', async () => {
    child = start({
      SPARK_SEARCH_PROVIDER: 'serper',
      SPARK_SEARCH_API_KEY: 'test-key',
      SPARK_SEARCH_BASE_URL: `${baseUrl}/flaky-body`,
      SPARK_SEARCH_TIMEOUT_MS: '1000',
      SPARK_SEARCH_TOTAL_TIMEOUT_MS: '4000',
      SPARK_SEARCH_MAX_RETRIES: '1',
      SPARK_SEARCH_RETRY_BACKOFF_MS: '1',
    })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { query: 'body retry', count: 1 } },
    })
    expect(res.error).toBeUndefined()
    expect(res.result.structuredContent.results[0].title).toBe('Recovered body')
    expect(requestCounts.get('/flaky-body/search')).toBe(2)
  })

  it('bounds the full keyless fallback chain by one total time budget', async () => {
    child = start({
      SPARK_SEARCH_BING_URL: `${baseUrl}/slow-bing`,
      SPARK_SEARCH_DUCKDUCKGO_URL: `${baseUrl}/slow-duckduckgo`,
      SPARK_SEARCH_BAIDU_URL: `${baseUrl}/slow-baidu`,
      SPARK_SEARCH_TIMEOUT_MS: '1000',
      SPARK_SEARCH_TOTAL_TIMEOUT_MS: '1100',
      SPARK_SEARCH_MAX_RETRIES: '0',
    })
    const startedAt = Date.now()
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { query: 'slow', count: 1 } },
    })
    expect(res.error.message).toContain('[budget_exhausted]')
    expect(Date.now() - startedAt).toBeLessThan(1_600)
    expect(Array.from(requestCounts.keys()).some((key) => key.startsWith('/slow-bing?'))).toBe(true)
    expect(
      Array.from(requestCounts.keys()).some((key) => key.startsWith('/slow-duckduckgo?')),
    ).toBe(true)
  })

  it('fetch_url strips HTML to readable text and extracts the title', async () => {
    child = start()
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'fetch_url', arguments: { url: `${baseUrl}/page` } },
    })
    expect(res.error).toBeUndefined()
    const data = res.result.structuredContent
    expect(data.title).toBe('Hello Title')
    expect(data.text).toContain('Para one.')
    expect(data.text).toContain('Para two.')
    expect(data.text).not.toContain('var x=1') // script stripped
  })
})

function callMcp(
  child: ChildProcessWithoutNullStreams,
  request: Record<string, unknown>,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP call timed out')), 8_000)
    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const message = JSON.parse(line)
        if (message.id === request.id) {
          clearTimeout(timer)
          child.stdout.off('data', onData)
          resolve(message)
        }
      }
    }
    child.stdout.on('data', onData)
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.stdin.write(`${JSON.stringify(request)}\n`)
  })
}
