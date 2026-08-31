import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolPackageManifest } from '@spark/protocol'
import {
  invokeMcpImportTool,
  invokeRemoteHttpTool,
  type McpToolInvoker,
} from './tool-package-remote-executors.js'
import type { McpToolResult } from '../../mcp/index.js'

const servers: Server[] = []

function remoteManifest(baseUrl: string): ToolPackageManifest {
  return {
    schemaVersion: 1,
    id: 'acme.remote-suite',
    version: '1.0.0',
    name: 'Acme Remote Suite',
    description: 'Remote tool package fixture',
    runtime: {
      adapter: 'remote-http',
      protocol: 'spark-tool-process-v1',
      baseUrl,
      headers: { Authorization: 'Bearer ${ACME_API_TOKEN}' },
      timeoutMs: 5_000,
    },
    tools: [
      {
        name: 'lookup_price',
        title: 'Lookup price',
        description: 'Look up a price',
        inputSchema: {
          type: 'object',
          properties: { sku: { type: 'string' } },
          required: ['sku'],
        },
        risk: 'read',
        effect: 'read',
        idempotency: 'safe',
      },
    ],
    environment: [
      {
        name: 'ACME_API_TOKEN',
        title: 'Acme API token',
        type: 'string',
        required: true,
        secret: true,
        agentConfigurable: false,
      },
    ],
    permissions: {
      declaredOsEffects: ['network'],
      requiredSparkCapabilities: [],
      optionalSparkCapabilities: [],
    },
  }
}

function mcpManifest(): ToolPackageManifest {
  return {
    schemaVersion: 1,
    id: 'acme.mcp-bridge',
    version: '1.0.0',
    name: 'Acme MCP bridge',
    description: 'MCP import fixture',
    runtime: { adapter: 'mcp-import', serverId: 'srv-1' },
    tools: [
      {
        name: 'search_docs',
        title: 'Search docs',
        description: 'Search documentation',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        risk: 'read',
        effect: 'read',
        idempotency: 'safe',
      },
    ],
    environment: [],
    permissions: {
      declaredOsEffects: [],
      requiredSparkCapabilities: [],
      optionalSparkCapabilities: [],
    },
  }
}

/** 启动本地帧协议服务器；handler 返回给客户端的响应体（或抛错返回 500）。 */
async function frameServer(
  respond: (frame: Record<string, unknown>, seen: { authorization?: string }) => unknown,
): Promise<{ baseUrl: string; seen: { authorization?: string }; close(): Promise<void> }> {
  const seen: { authorization?: string } = {}
  const server = createServer((req, res) => {
    const authorization = req.headers.authorization
    if (authorization != null) seen.authorization = authorization
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => {
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(body) as Record<string, unknown>
      } catch {
        res.writeHead(400).end('bad json')
        return
      }
      try {
        const payload = respond(frame, seen)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      } catch (error) {
        res.writeHead(500).end(error instanceof Error ? error.message : 'server error')
      }
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    seen,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error == null ? resolve() : reject(error))),
      ),
  }
}

function okResult(frame: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'result',
    protocolVersion: frame.protocolVersion,
    requestId: frame.requestId,
    sequence: 0,
    invocationId: frame.invocationId,
    result: { price: 1999 },
  }
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (server.listening) server.close(() => resolve())
          else resolve()
        }),
    ),
  )
})

describe('invokeRemoteHttpTool', () => {
  it('posts a schema-valid invoke frame and returns the echoed result frame', async () => {
    let received: Record<string, unknown> = {}
    const server = await frameServer((frame) => {
      received = frame
      return okResult(frame)
    })
    const result = await invokeRemoteHttpTool({
      manifest: remoteManifest(server.baseUrl),
      toolName: 'lookup_price',
      input: { sku: 'A-1' },
      environment: { ACME_API_TOKEN: 'secret-token' },
    })
    expect(result).toMatchObject({ price: 1999 })
    expect(received).toMatchObject({
      type: 'invoke',
      toolName: 'lookup_price',
      input: { sku: 'A-1' },
    })
    expect(received.protocolVersion).toBe('spark-tool-process-v1')
    expect(typeof received.requestId).toBe('string')
    expect(server.seen.authorization).toBe('Bearer secret-token')
    await server.close()
  })

  it('refuses to send headers referencing unconfigured environment variables', async () => {
    const server = await frameServer((frame) => okResult(frame))
    await expect(
      invokeRemoteHttpTool({
        manifest: remoteManifest(server.baseUrl),
        toolName: 'lookup_price',
        input: { sku: 'A-1' },
        environment: {},
      }),
    ).rejects.toThrow(/unconfigured environment variable ACME_API_TOKEN/)
    await server.close()
  })

  it('rejects HTTP error statuses with an excerpt', async () => {
    const server = await frameServer(() => {
      throw new Error('upstream exploded')
    })
    await expect(
      invokeRemoteHttpTool({
        manifest: remoteManifest(server.baseUrl),
        toolName: 'lookup_price',
        input: { sku: 'A-1' },
        environment: { ACME_API_TOKEN: 't' },
      }),
    ).rejects.toThrow(/HTTP 500/)
    await server.close()
  })

  it('rejects responses that are not protocol frames', async () => {
    const server = await frameServer(() => ({ hello: 'world' }))
    await expect(
      invokeRemoteHttpTool({
        manifest: remoteManifest(server.baseUrl),
        toolName: 'lookup_price',
        input: { sku: 'A-1' },
        environment: { ACME_API_TOKEN: 't' },
      }),
    ).rejects.toThrow(/not a spark-tool-process-v1 frame/)
    await server.close()
  })

  it('rejects mismatched requestId and invocationId echoes', async () => {
    const swappedId = await frameServer((frame) => ({
      ...okResult(frame),
      requestId: 'not-the-request-id',
    }))
    await expect(
      invokeRemoteHttpTool({
        manifest: remoteManifest(swappedId.baseUrl),
        toolName: 'lookup_price',
        input: { sku: 'A-1' },
        environment: { ACME_API_TOKEN: 't' },
      }),
    ).rejects.toThrow(/requestId does not match/)
    await swappedId.close()

    const swappedInvocation = await frameServer((frame) => ({
      ...okResult(frame),
      invocationId: 'not-the-invocation-id',
    }))
    await expect(
      invokeRemoteHttpTool({
        manifest: remoteManifest(swappedInvocation.baseUrl),
        toolName: 'lookup_price',
        input: { sku: 'A-1' },
        environment: { ACME_API_TOKEN: 't' },
      }),
    ).rejects.toThrow(/invocationId does not match/)
    await swappedInvocation.close()
  })

  it('surfaces remote error frames as failures', async () => {
    const server = await frameServer((frame) => ({
      type: 'error',
      protocolVersion: frame.protocolVersion,
      requestId: frame.requestId,
      sequence: 0,
      code: 'RATE_LIMITED',
      message: 'Quota exhausted',
    }))
    await expect(
      invokeRemoteHttpTool({
        manifest: remoteManifest(server.baseUrl),
        toolName: 'lookup_price',
        input: { sku: 'A-1' },
        environment: { ACME_API_TOKEN: 't' },
      }),
    ).rejects.toThrow(/RATE_LIMITED: Quota exhausted/)
    await server.close()
  })

  it('validates input against the manifest schema before any request', async () => {
    const server = await frameServer((frame) => okResult(frame))
    await expect(
      invokeRemoteHttpTool({
        manifest: remoteManifest(server.baseUrl),
        toolName: 'lookup_price',
        input: {},
        environment: { ACME_API_TOKEN: 't' },
      }),
    ).rejects.toThrow(/Invalid Tool Package input/)
    await server.close()
  })

  it('times out slow remote services', async () => {
    const server = await new Promise<Awaited<ReturnType<typeof frameServer>>>((resolve) => {
      const raw = createServer((_req, res) => {
        // 永不响应，触发调用侧超时。
        void res
      })
      servers.push(raw)
      raw.listen(0, '127.0.0.1', () => {
        const { port } = raw.address() as AddressInfo
        resolve({
          baseUrl: `http://127.0.0.1:${String(port)}`,
          seen: {},
          close: () => Promise.resolve(),
        })
      })
    })
    await expect(
      invokeRemoteHttpTool({
        manifest: remoteManifest(server.baseUrl),
        toolName: 'lookup_price',
        input: { sku: 'A-1' },
        environment: { ACME_API_TOKEN: 't' },
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/timed out/)
  })
})

describe('invokeMcpImportTool', () => {
  function invoker(
    result: McpToolResult,
  ): McpToolInvoker & { calls: Array<Record<string, unknown>> } {
    const calls: Array<Record<string, unknown>> = []
    return {
      calls,
      async callTool(serverId, toolName, args) {
        calls.push({ serverId, toolName, args })
        return result
      },
    }
  }

  it('proxies validated input and preserves MCP content structure', async () => {
    const fake = invoker({ content: [{ type: 'text', text: 'found 3 docs' }] })
    const result = await invokeMcpImportTool({
      manifest: mcpManifest(),
      toolName: 'search_docs',
      input: { query: 'tool packages' },
      invoker: fake,
    })
    expect(result).toEqual({ content: [{ type: 'text', text: 'found 3 docs' }] })
    expect(fake.calls).toEqual([
      { serverId: 'srv-1', toolName: 'search_docs', args: { query: 'tool packages' } },
    ])
  })

  it('throws with the remote message when the MCP tool reports isError', async () => {
    const fake = invoker({
      content: [{ type: 'text', text: 'index unavailable' }],
      isError: true,
    })
    await expect(
      invokeMcpImportTool({
        manifest: mcpManifest(),
        toolName: 'search_docs',
        input: { query: 'x' },
        invoker: fake,
      }),
    ).rejects.toThrow(/search_docs failed: index unavailable/)
  })

  it('validates input before contacting the MCP server', async () => {
    const fake = invoker({ content: [] })
    await expect(
      invokeMcpImportTool({
        manifest: mcpManifest(),
        toolName: 'search_docs',
        input: {},
        invoker: fake,
      }),
    ).rejects.toThrow(/Invalid Tool Package input/)
    expect(fake.calls).toEqual([])
  })

  it('rejects undeclared tools and mismatched adapters', async () => {
    const fake = invoker({ content: [] })
    await expect(
      invokeMcpImportTool({
        manifest: mcpManifest(),
        toolName: 'not_declared',
        input: { query: 'x' },
        invoker: fake,
      }),
    ).rejects.toThrow(/does not define tool/)

    await expect(
      invokeMcpImportTool({
        manifest: remoteManifest('https://tools.acme.example/v1'),
        toolName: 'lookup_price',
        input: { sku: 'A-1' },
        invoker: fake,
      }),
    ).rejects.toThrow(/cannot execute remote-http adapter/)
  })
})
