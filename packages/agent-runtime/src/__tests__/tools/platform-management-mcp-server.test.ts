import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PLATFORM_TOOL_NAMES } from '../../services/session-mcp-tooling-helpers.js'

const SERVER = path.resolve('src/tools/platform-management-mcp-server.mjs')

describe('spark_platform MCP server', () => {
  let child: ChildProcessWithoutNullStreams | null = null
  let bridge: Server | null = null

  afterEach(async () => {
    if (child && !child.killed) child.kill()
    if (bridge) {
      await new Promise<void>((resolve) => bridge?.close(() => resolve()))
      bridge = null
    }
  })

  function start(env: Record<string, string> = {}): ChildProcessWithoutNullStreams {
    const node = existsSync(process.execPath) ? process.execPath : 'node'
    return spawn(node, [SERVER], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: { ...process.env, SPARK_PLATFORM_BRIDGE_PORT: '0', ...env },
    })
  }

  it('exposes the compact gateway in sync with the SDK allow-list', async () => {
    child = start()
    const res = await callMcp(child, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const toolNames = (res.result.tools as Array<{ name: string }>).map((t) => t.name)
    const allowedNames = readPlatformAllowedToolNames()

    expect(toolNames).toEqual(['platform_methods_search', 'platform_invoke'])
    expect(allowedNames).toHaveLength(2)
    expect([...allowedNames].sort()).toEqual(
      toolNames.map((name) => `mcp__spark_platform__${name}`).sort(),
    )
  })

  it('keeps every discoverable method inside the fixed handler allow-list', () => {
    const source = readFileSync(SERVER, 'utf8')
    const definitions = source.match(/function platformMethodDefinitions\(\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
    const methodMap = source.match(/const methodMap = \{([\s\S]*?)\n {2}\}/)?.[1] ?? ''
    const definitionNames = [...definitions.matchAll(/name: '([a-z][a-z0-9_]+)'/g)]
      .map((match) => match[1])
      .filter((name): name is string => typeof name === 'string')
    const mappedNames = new Set([...methodMap.matchAll(/^\s+([a-z][a-z0-9_]+): '/gm)].map((match) => match[1]))

    expect(definitionNames.length).toBeGreaterThan(100)
    expect(definitionNames.filter((name) => !mappedNames.has(name))).toEqual([])
  })

  it('returns a matching full method schema only when searched', async () => {
    child = start()
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'platform_methods_search', arguments: { query: 'providers_media_configure', limit: 1 } },
    })
    const payload = JSON.parse(res.result.content[0].text)
    expect(payload.methods).toHaveLength(1)
    expect(payload.methods[0]).toMatchObject({
      name: 'providers_media_configure',
      inputSchema: { required: expect.arrayContaining(['apiEndpoint', 'defaultModel', 'models']) },
    })
    expect(payload.methods[0].inputSchema.properties).toHaveProperty('apiKey')
  })

  it('discovers provider configuration methods from a Chinese management request', async () => {
    child = start()
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'platform_methods_search',
        arguments: { query: '配置渠道模型' },
      },
    })
    const payload = JSON.parse(res.result.content[0].text)
    const methodNames = payload.methods.map((method: { name: string }) => method.name)

    expect(payload.returned).toBeGreaterThan(0)
    expect(methodNames).toContain('providers_media_configure')
    expect(methodNames).toContain('providers_create')
    expect(methodNames).toContain('providers_update')
  })

  it('rejects unknown methods and invalid required arguments before bridge dispatch', async () => {
    child = start()
    const unknown = await callMcp(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'platform_invoke', arguments: { method: 'arbitrary.rpc', arguments: {} } },
    })
    const invalid = await callMcp(child, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'platform_invoke', arguments: { method: 'providers_get', arguments: {} } },
    })

    expect(unknown.result.isError).toBe(true)
    expect(unknown.result.content[0].text).toContain('Unknown platform method')
    expect(invalid.result.isError).toBe(true)
    expect(invalid.result.content[0].text).toContain('arguments.id is required')
  })

  it('validates nullable union schemas before bridge dispatch', async () => {
    child = start()
    const invalid = await callMcp(child, {
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'platform_invoke',
        arguments: {
          method: 'providers_update',
          arguments: { id: 'provider-1', apiEndpoint: { url: 'https://invalid.example' } },
        },
      },
    })
    const validNull = await callMcp(child, {
      jsonrpc: '2.0',
      id: 23,
      method: 'tools/call',
      params: {
        name: 'platform_invoke',
        arguments: {
          method: 'providers_update',
          arguments: { id: 'provider-1', apiEndpoint: null },
        },
      },
    })

    expect(invalid.result.isError).toBe(true)
    expect(invalid.result.content[0].text).toContain(
      'arguments.apiEndpoint must match one of the allowed schemas',
    )
    expect(validNull.result.content[0].text).not.toContain('Invalid arguments')
  })

  it('responds to optional MCP resource and prompt list methods without hanging', async () => {
    child = start()

    await expect(
      callMcp(child, {
        jsonrpc: '2.0',
        id: 10,
        method: 'resources/list',
      }),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 10,
      result: { resources: [] },
    })
    await expect(
      callMcp(child, {
        jsonrpc: '2.0',
        id: 11,
        method: 'resources/templates/list',
      }),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 11,
      result: { resourceTemplates: [] },
    })
    await expect(
      callMcp(child, {
        jsonrpc: '2.0',
        id: 12,
        method: 'prompts/list',
      }),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 12,
      result: { prompts: [] },
    })
  })

  it('routes team tool calls to the platform bridge', async () => {
    let lastRpc: { method?: string; params?: unknown } | null = null
    bridge = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        lastRpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              team: {
                id: 'team-1',
                name: '研发协作团队',
                hostAgentId: 'platform-manager-agent',
                memberAgentIds: ['fullstack-coding-agent'],
              },
            },
          }),
        )
      })
    })
    const port = await new Promise<number>((resolve) => {
      bridge?.listen(0, '127.0.0.1', () => {
        const address = bridge?.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind bridge')
        resolve(address.port)
      })
    })

    child = start({ SPARK_PLATFORM_BRIDGE_PORT: String(port) })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'platform_invoke',
        arguments: {
          method: 'teams_create',
          arguments: {
            name: '研发协作团队',
            hostAgentId: 'platform-manager-agent',
            memberAgentIds: ['fullstack-coding-agent'],
          },
        },
      },
    })

    expect(res.error).toBeUndefined()
    expect(lastRpc).toMatchObject({
      method: 'teams.create',
      params: {
        name: '研发协作团队',
        hostAgentId: 'platform-manager-agent',
        memberAgentIds: ['fullstack-coding-agent'],
      },
    })
  })

  it('routes custom tool draft creation to the production bridge method', async () => {
    let lastRpc: { method?: string; params?: unknown } | null = null
    bridge = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        lastRpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, data: { workspace: { tool: { enabled: false } } } }))
      })
    })
    const port = await new Promise<number>((resolve) => {
      bridge?.listen(0, '127.0.0.1', () => {
        const address = bridge?.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind bridge')
        resolve(address.port)
      })
    })
    const spec = {
      id: 'weather_lookup',
      title: '天气查询',
      description: '根据城市名称查询当前天气，仅在用户询问实时天气时调用。',
      type: 'http',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      spec: {
        request: {
          method: 'GET',
          urlTemplate: 'https://api.example.com/weather?city={{city}}',
        },
        response: { format: 'text' },
      },
      risk: 'read',
      effect: 'read',
      idempotency: 'safe',
      timeoutMs: 30_000,
    }

    child = start({ SPARK_PLATFORM_BRIDGE_PORT: String(port) })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'platform_invoke',
        arguments: { method: 'custom_tools_create_draft', arguments: { spec } },
      },
    })

    expect(res.error).toBeUndefined()
    expect(lastRpc).toEqual({ method: 'custom_tools.create_draft', params: { spec } })
  })

  it('routes artifact lookup tool calls to the platform bridge', async () => {
    let lastRpc: { method?: string; params?: unknown } | null = null
    bridge = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        lastRpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              artifact: {
                id: 'runtime.python-3.11.9.win32-x64',
                type: 'runtime',
                url: 'https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/runtimes/python/python-3.11.9-amd64.exe',
              },
            },
          }),
        )
      })
    })
    const port = await new Promise<number>((resolve) => {
      bridge?.listen(0, '127.0.0.1', () => {
        const address = bridge?.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind bridge')
        resolve(address.port)
      })
    })

    child = start({ SPARK_PLATFORM_BRIDGE_PORT: String(port) })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'platform_invoke',
        arguments: {
          method: 'artifacts_resolve',
          arguments: { artifactId: 'runtime.python-3.11.9.win32-x64' },
        },
      },
    })

    expect(res.error).toBeUndefined()
    expect(lastRpc).toMatchObject({
      method: 'artifacts.resolve',
      params: {
        artifactId: 'runtime.python-3.11.9.win32-x64',
      },
    })
  })

  it('routes custom media provider configuration to the production bridge method', async () => {
    let lastRpc: { method?: string; params?: unknown } | null = null
    bridge = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        lastRpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            ok: true,
            data: { created: true, provider: { id: 'provider-custom', hasApiKey: true } },
          }),
        )
      })
    })
    const port = await new Promise<number>((resolve) => {
      bridge?.listen(0, '127.0.0.1', () => {
        const address = bridge?.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind bridge')
        resolve(address.port)
      })
    })

    child = start({ SPARK_PLATFORM_BRIDGE_PORT: String(port) })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: {
        name: 'platform_invoke',
        arguments: {
          method: 'providers_media_configure',
          arguments: {
          name: '自定义图片渠道',
          apiEndpoint: 'https://media.example/v1',
          defaultModel: 'image-model',
          models: [{ modelId: 'image-model', manifest: { id: 'manifest-placeholder' } }],
            apiKey: 'secret-forwarded-only-to-bridge',
          },
        },
      },
    })

    expect(res.error).toBeUndefined()
    expect(lastRpc).toMatchObject({
      method: 'providers.media_configure',
      params: {
        name: '自定义图片渠道',
        apiEndpoint: 'https://media.example/v1',
        defaultModel: 'image-model',
        apiKey: 'secret-forwarded-only-to-bridge',
      },
    })
    expect(JSON.stringify(res)).not.toContain('secret-forwarded-only-to-bridge')
  })

  it('routes schedule calls with the trusted current session id', async () => {
    let lastRpc: { method?: string; params?: unknown } | null = null
    bridge = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        lastRpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, data: { task: { id: 'schedule-1' } } }))
      })
    })
    const port = await new Promise<number>((resolve) => {
      bridge?.listen(0, '127.0.0.1', () => {
        const address = bridge?.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind bridge')
        resolve(address.port)
      })
    })

    child = start({
      SPARK_PLATFORM_BRIDGE_PORT: String(port),
      SPARK_SESSION_ID: 'trusted-session',
    })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'platform_invoke',
        arguments: {
          method: 'session_schedule_create',
          arguments: {
          sessionId: 'model-supplied-session',
          name: 'Check third-party job',
          triggerType: 'interval',
          intervalSeconds: 60,
            promptTemplate: 'Check the job and delete this schedule when complete.',
          },
        },
      },
    })

    expect(res.error).toBeUndefined()
    expect(lastRpc).toMatchObject({
      method: 'session_schedule.create',
      params: {
        sessionId: 'trusted-session',
        name: 'Check third-party job',
        triggerType: 'interval',
      },
    })
  })

  it('routes session history retrieval with the trusted current session id', async () => {
    const rpcCalls: Array<{ method?: string; params?: Record<string, unknown> }> = []
    bridge = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          method?: string
          params?: Record<string, unknown>
        }
        rpcCalls.push(rpc)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, data: { hits: [] } }))
      })
    })
    const port = await new Promise<number>((resolve) => {
      bridge?.listen(0, '127.0.0.1', () => {
        const address = bridge?.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind bridge')
        resolve(address.port)
      })
    })

    child = start({
      SPARK_PLATFORM_BRIDGE_PORT: String(port),
      SPARK_SESSION_ID: 'trusted-history-session',
    })
    const search = await callMcp(child, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'platform_invoke',
        arguments: {
          method: 'session_history_search',
          arguments: {
          sessionId: 'model-supplied-session',
          query: 'Router.tsx',
            limit: 10,
          },
        },
      },
    })
    const read = await callMcp(child, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'platform_invoke',
        arguments: {
          method: 'session_history_read',
          arguments: {
          sessionId: 'model-supplied-session',
          mode: 'event',
          turnId: 'turn-1',
            seq: 3,
          },
        },
      },
    })

    expect(search.error).toBeUndefined()
    expect(read.error).toBeUndefined()
    expect(rpcCalls).toHaveLength(2)
    expect(rpcCalls[0]).toMatchObject({
      method: 'session_history.search',
      params: { sessionId: 'trusted-history-session', query: 'Router.tsx', limit: 10 },
    })
    expect(rpcCalls[1]).toMatchObject({
      method: 'session_history.read',
      params: {
        sessionId: 'trusted-history-session',
        mode: 'event',
        turnId: 'turn-1',
        seq: 3,
      },
    })
  })
})

function readPlatformAllowedToolNames(): string[] {
  return [...PLATFORM_TOOL_NAMES]
}

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
