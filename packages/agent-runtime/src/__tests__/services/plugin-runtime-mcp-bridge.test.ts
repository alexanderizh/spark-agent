import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { PluginRuntimeMcpBridge } from '../../services/plugin-runtime/plugin-runtime-mcp-bridge.js'
import type { RuntimeBroker } from '../../services/plugin-runtime/runtime-broker.js'
import type { CustomToolRuntimeCatalog } from '../../services/custom-tools/custom-tool-runtime-catalog.js'

function createBroker(): RuntimeBroker {
  return {
    listRuntimeStatus: () => [{ enabled: true, runtime: { id: 'demo-runtime' } }],
    listRuntimeDescriptors: () => [{ id: 'demo-runtime', toolNamespace: 'demo' }],
    listAccounts: () => [{ id: 'account-1' }],
    listAvailableTools: async () => [
      {
        name: 'echo',
        description: 'Echo text',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ],
    invoke: vi.fn(async ({ input }: { input: Record<string, unknown> }) => ({
      echoed: input.text,
    })),
  } as unknown as RuntimeBroker
}

async function connectClient(config: {
  url: string
  headers?: Record<string, string>
}): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers != null ? { headers: config.headers } : {},
  })
  const client = new Client({ name: 'plugin-test-client', version: '0.0.0' })
  await client.connect(transport as unknown as Transport)
  return client
}

describe('PluginRuntimeMcpBridge runtime lease', () => {
  const bridge = new PluginRuntimeMcpBridge(createBroker())

  afterEach(async () => {
    await bridge.dispose()
  })

  it('跨 turn 复用 bearer 与 MCP 连接，并在 runtime 释放时吊销', async () => {
    const first = await bridge.serve({ runtimeLeaseKey: 'host:session-1' })
    expect(first).not.toBeNull()
    expect(first?.runtimeResource).toBeDefined()
    expect(first?.runtimeResource?.id).not.toContain('session-1')
    first?.runtimeResource?.onAttached?.()
    const client = await connectClient(
      first!.config as { url: string; headers?: Record<string, string> },
    )
    const firstResult = await client.callTool({ name: 'demo_echo', arguments: { text: 'one' } })
    expect(firstResult.structuredContent).toEqual({ echoed: 'one' })
    await first?.close()

    const second = await bridge.serve({ runtimeLeaseKey: 'host:session-1' })
    expect(second).not.toBeNull()
    expect(second?.config).toEqual(first?.config)
    expect(second?.runtimeResource).toBe(first?.runtimeResource)
    const secondResult = await client.callTool({ name: 'demo_echo', arguments: { text: 'two' } })
    expect(secondResult.structuredContent).toEqual({ echoed: 'two' })

    await second?.close()
    await client.close()
    await second?.runtimeResource?.dispose()
    const response = await fetch((second!.config as { url: string }).url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...((second!.config as { headers?: Record<string, string> }).headers ?? {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'raw', version: '0' },
        },
      }),
    })
    expect(response.status).toBe(401)
  })
})

describe('PluginRuntimeMcpBridge native custom tool engine adapter', () => {
  it('adapts the native catalog for the model without requiring an MCP project per tool', async () => {
    const broker = {
      listRuntimeStatus: () => [],
      listRuntimeDescriptors: () => [],
    } as unknown as RuntimeBroker
    const invokeRead = vi.fn(async (input: Record<string, unknown>) => ({ echoed: input.text }))
    const invokeWrite = vi.fn(async () => ({ ok: true }))
    const customTools = {
      list: () => [
        {
          qualifiedName: 'custom_echo',
          toolId: 'echo',
          tool: {
            name: 'echo',
            title: 'Echo',
            description: 'Echo text from a native custom tool',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
            requiredCapabilities: [],
            risk: 'read',
            effect: 'read',
            idempotency: 'safe',
          },
          invoke: invokeRead,
        },
        {
          qualifiedName: 'custom_publish',
          toolId: 'publish',
          tool: {
            name: 'publish',
            title: 'Publish',
            description: 'Publish through a native custom tool',
            inputSchema: { type: 'object', properties: {} },
            requiredCapabilities: [],
            risk: 'high-write',
            effect: 'publish',
            idempotency: 'unsafe',
          },
          invoke: invokeWrite,
        },
      ],
    } as unknown as CustomToolRuntimeCatalog
    const bridge = new PluginRuntimeMcpBridge(broker, customTools)

    try {
      const handle = await bridge.serve()
      expect(handle?.toolNames).toEqual(['mcp__spark_plugins__custom_echo'])
      const client = await connectClient(
        handle!.config as { url: string; headers?: Record<string, string> },
      )
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual(['custom_echo', 'custom_publish'])
      expect(
        tools.tools.find((tool) => tool.name === 'custom_echo')?.inputSchema,
      ).not.toHaveProperty('properties.accountId')
      const result = await client.callTool({ name: 'custom_echo', arguments: { text: 'native' } })
      expect(result.structuredContent).toEqual({ echoed: 'native' })
      expect(invokeRead).toHaveBeenCalledWith({ text: 'native' })
      await client.close()
      await handle?.close()
    } finally {
      await bridge.dispose()
    }
  })

  it('preserves nested JSON Schema validation instead of coercing objects to strings', async () => {
    const broker = {
      listRuntimeStatus: () => [],
      listRuntimeDescriptors: () => [],
    } as unknown as RuntimeBroker
    const invoke = vi.fn(async (input: Record<string, unknown>) => ({ received: input }))
    const customTools = {
      list: () => [
        {
          qualifiedName: 'custom_nested',
          toolId: 'nested',
          tool: {
            name: 'nested',
            title: 'Nested input',
            description: 'Accept nested objects and integer arrays',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                options: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { retries: { type: 'integer', minimum: 0 } },
                  required: ['retries'],
                },
                values: { type: 'array', items: { type: 'integer' } },
              },
              required: ['options', 'values'],
            },
            requiredCapabilities: [],
            risk: 'read',
            effect: 'read',
            idempotency: 'safe',
          },
          invoke,
        },
      ],
    } as unknown as CustomToolRuntimeCatalog
    const bridge = new PluginRuntimeMcpBridge(broker, customTools)

    try {
      const handle = await bridge.serve()
      const client = await connectClient(
        handle!.config as { url: string; headers?: Record<string, string> },
      )
      const listed = await client.listTools()
      expect(listed.tools[0]?.inputSchema).toMatchObject({
        type: 'object',
        properties: {
          options: { type: 'object', properties: { retries: { type: 'integer' } } },
          values: { type: 'array', items: { type: 'integer' } },
        },
      })
      const valid = await client.callTool({
        name: 'custom_nested',
        arguments: { options: { retries: 2 }, values: [1, 2] },
      })
      expect(valid.structuredContent).toEqual({
        received: { options: { retries: 2 }, values: [1, 2] },
      })
      const invalid = await client.callTool({
        name: 'custom_nested',
        arguments: { options: { retries: 2 }, values: [1, 'invalid'] },
      })
      expect(invalid).toMatchObject({ isError: true })
      expect(JSON.stringify(invalid.content)).toContain('expected number')
      expect(invoke).toHaveBeenCalledTimes(1)
      await client.close()
      await handle?.close()
    } finally {
      await bridge.dispose()
    }
  })

  it('bounds large object results without retaining an unbounded structured copy', async () => {
    const broker = {
      listRuntimeStatus: () => [],
      listRuntimeDescriptors: () => [],
    } as unknown as RuntimeBroker
    const customTools = {
      list: () => [
        {
          qualifiedName: 'custom_large_result',
          toolId: 'large-result',
          tool: {
            name: 'large_result',
            title: 'Large result',
            description: 'Return a result larger than the bridge limit',
            inputSchema: { type: 'object', properties: {} },
            requiredCapabilities: [],
            risk: 'read',
            effect: 'read',
            idempotency: 'safe',
          },
          invoke: async () => ({ payload: '你'.repeat(800_000) }),
        },
      ],
    } as unknown as CustomToolRuntimeCatalog
    const bridge = new PluginRuntimeMcpBridge(broker, customTools)

    try {
      const handle = await bridge.serve()
      const client = await connectClient(
        handle!.config as { url: string; headers?: Record<string, string> },
      )
      const result = await client.callTool({ name: 'custom_large_result', arguments: {} })
      const content = result.content as Array<{ type: string; text?: string }>
      const text = content.find((item) => item.type === 'text')
      const outputText = text?.text ?? ''
      expect(outputText).toContain('[truncated by Spark runtime]')
      expect(Buffer.byteLength(outputText, 'utf8')).toBeLessThanOrEqual(2 * 1024 * 1024)
      expect(result.structuredContent).toBeUndefined()
      await client.close()
      await handle?.close()
    } finally {
      await bridge.dispose()
    }
  })
})
