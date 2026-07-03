import { describe, expect, it, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'
import { TeamMcpHttpBridge, type TeamToolDefinition } from '../../services/team-mcp-http-bridge.js'

/** 用 MCP 客户端连桥接端点（带 Bearer token），模拟 codex 消费者。 */
async function connectClient(url: string, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  // MCP SDK 1.29 类型摩擦（与 bridge 端同源）：StreamableHTTPClientTransport 与 Transport 接口在 exactOptional 下不一致，断言绕过。
  await client.connect(transport as unknown as Transport)
  return client
}

const JSONRPC_INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
})

const echoDef: TeamToolDefinition = {
  name: 'echo',
  description: 'echo back the text argument',
  schema: { text: z.string() },
  handler: async (args) => ({
    content: [{ type: 'text', text: String(args.text ?? '') }],
  }),
}

describe('TeamMcpHttpBridge (FR-0b spark_team HTTP 桥接)', () => {
  const bridge = new TeamMcpHttpBridge()

  afterEach(async () => {
    await bridge.dispose()
  })

  it('M-12 工具调用穿透：经桥接 listTools / callTool 命中主进程 handler', async () => {
    const handle = await bridge.serve([echoDef])
    try {
      const client = await connectClient(handle.url, handle.token)
      const tools = await client.listTools()
      expect(tools.tools.map((t) => t.name)).toContain('echo')

      const result = await client.callTool({ name: 'echo', arguments: { text: 'hello-codex' } })
      expect(result.content).toEqual([{ type: 'text', text: 'hello-codex' }])
      await client.close()
    } finally {
      await handle.close()
    }
  })

  it('M-13 缺失 Bearer token → 401', async () => {
    const handle = await bridge.serve([echoDef])
    try {
      const res = await fetch(handle.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSONRPC_INIT,
      })
      expect(res.status).toBe(401)
    } finally {
      await handle.close()
    }
  })

  it('M-13 错误 Bearer token → 401', async () => {
    const handle = await bridge.serve([echoDef])
    try {
      const res = await fetch(handle.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer wrong-token',
        },
        body: JSONRPC_INIT,
      })
      expect(res.status).toBe(401)
    } finally {
      await handle.close()
    }
  })

  it('跨会话隔离：token A 的请求打不到 token B 的 handler', async () => {
    const handleA = await bridge.serve([
      {
        name: 'who',
        description: 'identify',
        schema: {},
        handler: async () => ({ content: [{ type: 'text', text: 'A' }] }),
      },
    ])
    const handleB = await bridge.serve([
      {
        name: 'who',
        description: 'identify',
        schema: {},
        handler: async () => ({ content: [{ type: 'text', text: 'B' }] }),
      },
    ])
    try {
      const clientA = await connectClient(handleA.url, handleA.token)
      const rA = await clientA.callTool({ name: 'who', arguments: {} })
      expect((rA.content as Array<{ text: string }>)[0]!.text).toBe('A')
      await clientA.close()

      const clientB = await connectClient(handleB.url, handleB.token)
      const rB = await clientB.callTool({ name: 'who', arguments: {} })
      expect((rB.content as Array<{ text: string }>)[0]!.text).toBe('B')
      await clientB.close()
    } finally {
      await handleA.close()
      await handleB.close()
    }
  })

  it('handle.close() 吊销 token：后续请求 → 401', async () => {
    const handle = await bridge.serve([echoDef])
    await handle.close()
    const res = await fetch(handle.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${handle.token}`,
      },
      body: JSONRPC_INIT,
    })
    expect(res.status).toBe(401)
  })

  it('abort signal 吊销 token：abort 后请求 → 401', async () => {
    const controller = new AbortController()
    const handle = await bridge.serve([echoDef], { signal: controller.signal })
    controller.abort()
    // abort 监听是异步触发的，给一点时间让 close() 完成
    await new Promise((resolve) => setTimeout(resolve, 50))
    const res = await fetch(handle.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${handle.token}`,
      },
      body: JSONRPC_INIT,
    })
    expect(res.status).toBe(401)
  })

  it('serve() 拒绝空 tool 定义数组', async () => {
    await expect(bridge.serve([])).rejects.toThrow(/at least one tool/)
  })
})
