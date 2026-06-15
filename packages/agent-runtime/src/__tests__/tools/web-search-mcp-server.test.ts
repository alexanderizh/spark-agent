import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'

const SERVER = path.resolve('src/tools/web-search-mcp-server.mjs')

describe('spark_search MCP server', () => {
  let server: Server
  let baseUrl = ''
  let lastRequest: { url: string | undefined; headers: Record<string, unknown>; body: unknown } | null = null
  let child: ChildProcessWithoutNullStreams | null = null

  beforeEach(async () => {
    lastRequest = null
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(Buffer.from(c)))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        lastRequest = { url: req.url, headers: req.headers as Record<string, unknown>, body: raw ? JSON.parse(raw) : null }
        // Serper-shaped keyed provider mock
        if (req.url === '/search') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            organic: [
              { title: 'First Result', link: 'https://example.com/a', snippet: 'snippet a' },
              { title: 'Second Result', link: 'https://example.com/b', snippet: 'snippet b' },
            ],
            answerBox: { answer: '42' },
          }))
          return
        }
        // HTML page for fetch_url
        if (req.url === '/page') {
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end('<html><head><title>Hello Title</title></head><body><script>var x=1</script><article><p>Para one.</p><p>Para two.</p></article></body></html>')
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
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'web_search', arguments: { query: 'meaning of life', count: 2 } },
    })
    expect(res.error).toBeUndefined()
    const data = res.result.structuredContent
    expect(data.provider).toBe('serper')
    expect(data.answer).toBe('42')
    expect(data.results).toHaveLength(2)
    expect(data.results[0]).toMatchObject({ title: 'First Result', url: 'https://example.com/a', snippet: 'snippet a' })
    expect(lastRequest?.headers['x-api-key']).toBe('test-key')
    expect(lastRequest?.body).toMatchObject({ q: 'meaning of life', num: 2 })
  })

  it('fetch_url strips HTML to readable text and extracts the title', async () => {
    child = start()
    const res = await callMcp(child, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
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

function callMcp(child: ChildProcessWithoutNullStreams, request: Record<string, unknown>): Promise<any> {
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
