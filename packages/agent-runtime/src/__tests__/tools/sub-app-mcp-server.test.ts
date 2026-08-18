import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'

const SERVER = path.resolve('src/tools/sub-app-mcp-server.mjs')

describe('spark_app MCP server', () => {
  let server: Server
  let child: ChildProcessWithoutNullStreams | null = null
  let port = 0
  let lastRpc: { method: string; params: Record<string, unknown> } | null = null

  beforeEach(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          method: string
          params: Record<string, unknown>
        }
        lastRpc = body
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            ok: true,
            data: { id: 'app-1', draft: { revision: 1 }, items: [], total: 0 },
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('failed to bind bridge')
    port = address.port
    lastRpc = null
  })

  afterEach(async () => {
    child?.kill()
    child = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function start(): ChildProcessWithoutNullStreams {
    child = spawn(process.execPath, [SERVER], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: { ...process.env, SPARK_PLATFORM_BRIDGE_PORT: String(port) },
    })
    return child
  }

  it('exposes the persistence contract to the agent', async () => {
    const response = await callMcp(start(), { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const result = response.result as {
      tools?: Array<{
        name: string
        description: string
        inputSchema?: { properties?: Record<string, { default?: unknown }> }
      }>
    }
    const tools = result.tools ?? []
    const create = tools.find((tool) => tool.name === 'spark_app_create')
    const dataSet = tools.find((tool) => tool.name === 'spark_app_data_set')
    expect(create?.description).toContain('sparkApp.data')
    expect(create?.description).toContain('localStorage')
    expect(create?.description).toContain('默认不要给应用根容器')
    // 防误用约束：未明确要求内置子应用时，默认外部项目开发，不得默认创建子应用
    expect(create?.description).toContain('何时不要调用')
    expect(create?.description).toContain('外部项目开发')
    expect(create?.inputSchema?.properties?.permissions?.default).toEqual(['data'])
    expect(dataSet?.description).toContain('expectedRevision')
  })

  it('maps draftHtml to source and leaves omitted permissions for the durable default', async () => {
    const response = await callMcp(start(), {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'spark_app_create',
        arguments: { name: 'Todo', draftHtml: '<main>todo</main>' },
      },
    })
    expect(response.error).toBeUndefined()
    expect(lastRpc).toEqual({
      method: 'subapp.create',
      params: { name: 'Todo', source: '<main>todo</main>' },
    })
  })
})

function callMcp(
  child: ChildProcessWithoutNullStreams,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const line = buffer.slice(0, newline)
      child.stdout.off('data', onData)
      try {
        resolve(JSON.parse(line) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    }
    child.stdout.on('data', onData)
    child.once('error', reject)
    child.stdin.write(`${JSON.stringify(request)}\n`)
  })
}
