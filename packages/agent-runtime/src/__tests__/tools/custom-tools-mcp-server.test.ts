import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SERVER = path.resolve('src/tools/custom-tools-mcp-server.mjs')

describe('spark_custom_tools MCP server', () => {
  let bridge: Server
  let port = 0
  let child: ChildProcessWithoutNullStreams | null = null
  const token = 'test-bridge-token'
  const requests: Array<{ authorization?: string; method?: string; params?: unknown }> = []

  beforeEach(async () => {
    requests.length = 0
    bridge = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          method?: string
          params?: unknown
        }
        requests.push({
          ...(request.headers.authorization != null
            ? { authorization: request.headers.authorization }
            : {}),
          ...(body.method != null ? { method: body.method } : {}),
          ...(body.params !== undefined ? { params: body.params } : {}),
        })
        response.writeHead(200, { 'Content-Type': 'application/json' })
        if (body.method === 'customTools.list') {
          response.end(
            JSON.stringify({
              ok: true,
              data: {
                tools: [
                  {
                    name: 'weather_lookup',
                    title: '天气查询',
                    description: 'Lookup weather',
                    inputSchema: { type: 'object', properties: {} },
                  },
                ],
              },
            }),
          )
          return
        }
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              text: 'sunny',
              meta: { durationMs: 3, bytes: 5, truncated: false },
            },
          }),
        )
      })
    })
    await new Promise<void>((resolve) => bridge.listen(0, '127.0.0.1', resolve))
    const address = bridge.address()
    if (address == null || typeof address === 'string') throw new Error('Failed to bind bridge')
    port = address.port
  })

  afterEach(async () => {
    if (child != null && !child.killed) child.kill()
    await new Promise<void>((resolve) => bridge.close(() => resolve()))
  })

  function start(): ChildProcessWithoutNullStreams {
    return spawn(process.execPath, [SERVER], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_CUSTOM_TOOLS_BRIDGE_PORT: String(port),
        SPARK_CUSTOM_TOOLS_BRIDGE_TOKEN: token,
        SPARK_CUSTOM_TOOLS_SID: 'session-1',
      },
    })
  }

  it('lists bridge tools and forwards calls with session context', async () => {
    child = start()

    const list = await callMcp(child, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(list.result.tools).toEqual([
      expect.objectContaining({ name: 'weather_lookup', title: '天气查询' }),
    ])

    const call = await callMcp(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'weather_lookup', arguments: { city: 'Shanghai' } },
    })
    expect(call.result).toMatchObject({
      content: [{ type: 'text', text: 'sunny' }],
      structuredContent: { meta: { bytes: 5 } },
    })
    expect(requests).toEqual([
      expect.objectContaining({ authorization: `Bearer ${token}`, method: 'customTools.list' }),
      expect.objectContaining({
        authorization: `Bearer ${token}`,
        method: 'customTools.call',
        params: {
          toolId: 'weather_lookup',
          input: { city: 'Shanghai' },
          sessionId: 'session-1',
        },
      }),
    ])
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
        const message = JSON.parse(line) as { id?: unknown }
        if (message.id === request.id) {
          clearTimeout(timer)
          child.stdout.off('data', onData)
          resolve(message)
        }
      }
    }
    child.stdout.on('data', onData)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.stdin.write(`${JSON.stringify(request)}\n`)
  })
}
