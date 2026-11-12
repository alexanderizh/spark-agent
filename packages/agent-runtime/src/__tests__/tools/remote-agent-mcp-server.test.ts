import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'

const SERVER = path.resolve('src/tools/remote-agent-mcp-server.mjs')

describe('spark_remote MCP server', () => {
  let server: Server
  let child: ChildProcessWithoutNullStreams | null = null
  let port = 0
  let lastRpc: { method: string; params: Record<string, unknown> } | null = null

  beforeEach(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        lastRpc = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          method: string
          params: Record<string, unknown>
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({ ok: true, data: { devices: [{ deviceId: 'device-b', online: true }] } }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('failed to bind bridge')
    port = address.port
  })

  afterEach(async () => {
    child?.kill()
    child = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function start(): ChildProcessWithoutNullStreams {
    child = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        SPARK_PLATFORM_BRIDGE_PORT: String(port),
        SPARK_REMOTE_SID: 'session-current',
      },
    })
    return child
  }

  it('exposes all eight collaboration tools and binds RPC to the current session', async () => {
    const process = start()
    const listed = await callMcp(process, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const result = listed.result as { tools: Array<{ name: string; inputSchema: unknown }> }
    expect(result.tools.map((tool) => tool.name)).toEqual([
      'devices_list',
      'device_inspect',
      'sessions_list',
      'session_open',
      'message_send',
      'events_read',
      'operation_cancel',
      'artifact_transfer',
    ])
    expect(JSON.stringify(result.tools)).not.toContain('sourceSessionId')
    expect(JSON.stringify(result.tools)).not.toContain('remoteSessionId')

    const called = await callMcp(process, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'devices_list', arguments: {} },
    })
    expect(lastRpc).toEqual({
      method: 'remote.devices_list',
      params: { sessionId: 'session-current' },
    })
    expect((called.result as { structuredContent?: unknown }).structuredContent).toEqual({
      devices: [{ deviceId: 'device-b', online: true }],
    })

    await callMcp(process, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'message_send',
        arguments: {
          linkId: 'link-1',
          questionReply: { questionId: 'question-1', answers: { '0': 'confirmed' } },
        },
      },
    })
    expect(lastRpc).toEqual({
      method: 'remote.message_send',
      params: {
        linkId: 'link-1',
        questionReply: { questionId: 'question-1', answers: { '0': 'confirmed' } },
        sessionId: 'session-current',
      },
    })
  })
})

interface McpMessage {
  id?: number
  result?: unknown
  error?: { code: number; message: string }
}

function callMcp(
  process: ChildProcessWithoutNullStreams,
  message: Record<string, unknown>,
): Promise<McpMessage> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timeout = setTimeout(() => reject(new Error('MCP response timed out')), 3_000)
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const response = JSON.parse(line) as McpMessage
        if (response.id !== message.id) continue
        clearTimeout(timeout)
        process.stdout.off('data', onData)
        resolve(response)
      }
    }
    process.stdout.on('data', onData)
    process.stdin.write(`${JSON.stringify(message)}\n`)
  })
}
