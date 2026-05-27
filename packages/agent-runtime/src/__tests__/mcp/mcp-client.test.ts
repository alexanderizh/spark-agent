import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpClient } from '../../mcp/mcp-client.js'
import type { McpTransport, JsonRpcRequest, JsonRpcResponse } from '../../mcp/transport/types.js'

// ─── Mock Transport Factory ──────────────────────────────────────────────────

let mockSendFn: ((req: JsonRpcRequest) => Promise<JsonRpcResponse>) | null = null

function createMockTransport(): McpTransport {
  return {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
    onNotification: vi.fn(),
    send: vi.fn(async (req: JsonRpcRequest) => {
      if (mockSendFn != null) {
        return mockSendFn(req)
      }
      // Default: return empty success for all methods
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {},
      } as JsonRpcResponse
    }),
  }
}

vi.mock('../../mcp/transport/stdio-transport.js', () => ({
  StdioTransport: vi.fn().mockImplementation(() => createMockTransport()),
}))

vi.mock('../../mcp/transport/sse-transport.js', () => ({
  SseTransport: vi.fn().mockImplementation(() => createMockTransport()),
}))

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('McpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendFn = null
  })

  it('exposes serverId and serverName', () => {
    const config = {
      type: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-test'],
    }

    const client = new McpClient('srv-1', 'test-server', config)
    expect(client.getServerId()).toBe('srv-1')
    expect(client.getServerName()).toBe('test-server')
  })

  it('getStatus returns disconnected before connect', () => {
    const config = {
      type: 'stdio' as const,
      command: 'npx',
      args: [],
    }

    const client = new McpClient('srv-2', 'disconnected-server', config)
    const status = client.getStatus()

    expect(status.connected).toBe(false)
    expect(status.serverInfo).toBeNull()
    expect(status.toolCount).toBe(0)
  })

  it('listTools returns empty array before connection', () => {
    const config = {
      type: 'sse' as const,
      url: 'http://localhost:3000/mcp',
    }

    const client = new McpClient('srv-3', 'sse-server', config)
    expect(client.listTools()).toEqual([])
  })

  it('isConnected returns false before connect', () => {
    const config = {
      type: 'stdio' as const,
      command: 'npx',
      args: [],
    }

    const client = new McpClient('srv-4', 'test-server', config)
    expect(client.isConnected()).toBe(false)
  })

  it('connects and fetches tools via mock transport', async () => {
    const config = {
      type: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    }

    // Mock send to handle initialize and tools/list
    mockSendFn = async (req: JsonRpcRequest) => {
      if (req.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: 'filesystem-server', version: '1.0.0' },
          },
        } as JsonRpcResponse
      }
      if (req.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            tools: [
              {
                name: 'read_file',
                description: 'Read a file from the filesystem',
                inputSchema: {
                  type: 'object',
                  properties: { path: { type: 'string' } },
                  required: ['path'],
                },
              },
              {
                name: 'write_file',
                description: 'Write content to a file',
                inputSchema: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    content: { type: 'string' },
                  },
                  required: ['path', 'content'],
                },
              },
            ],
          },
        } as JsonRpcResponse
      }
      return { jsonrpc: '2.0', id: req.id, result: {} } as JsonRpcResponse
    }

    const client = new McpClient('srv-5', 'filesystem-server', config)
    await client.connect()

    expect(client.isConnected()).toBe(true)
    expect(client.listTools()).toHaveLength(2)
    expect(client.listTools()[0]?.name).toBe('read_file')
    expect(client.listTools()[1]?.name).toBe('write_file')

    const status = client.getStatus()
    expect(status.connected).toBe(true)
    expect(status.toolCount).toBe(2)
    expect(status.serverInfo?.name).toBe('filesystem-server')
  })

  it('handles initialize error', async () => {
    const config = {
      type: 'stdio' as const,
      command: 'npx',
      args: [],
    }

    mockSendFn = async (req: JsonRpcRequest) => {
      if (req.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32600, message: 'Invalid protocol version' },
        } as JsonRpcResponse
      }
      return { jsonrpc: '2.0', id: req.id, result: {} } as JsonRpcResponse
    }

    const client = new McpClient('srv-6', 'error-server', config)
    await expect(client.connect()).rejects.toThrow('MCP initialize failed')
    expect(client.isConnected()).toBe(false)
  })

  it('callTool throws when not connected', async () => {
    const config = {
      type: 'stdio' as const,
      command: 'npx',
      args: [],
    }

    const client = new McpClient('srv-7', 'test-server', config)
    await expect(
      client.callTool('test_tool', { query: 'hello' }),
    ).rejects.toThrow('MCP client not connected')
  })

  it('disconnects cleanly', async () => {
    const config = {
      type: 'stdio' as const,
      command: 'npx',
      args: [],
    }

    mockSendFn = async (req: JsonRpcRequest) => {
      if (req.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'test', version: '1.0' },
          },
        } as JsonRpcResponse
      }
      if (req.method === 'tools/list') {
        return { jsonrpc: '2.0', id: req.id, result: { tools: [] } } as JsonRpcResponse
      }
      return { jsonrpc: '2.0', id: req.id, result: {} } as JsonRpcResponse
    }

    const client = new McpClient('srv-8', 'test-server', config)
    await client.connect()
    expect(client.isConnected()).toBe(true)

    await client.disconnect()
    expect(client.isConnected()).toBe(false)
    expect(client.listTools()).toEqual([])
  })

  it('works with SSE config', async () => {
    const config = {
      type: 'sse' as const,
      url: 'http://localhost:3000/mcp',
    }

    mockSendFn = async (req: JsonRpcRequest) => {
      if (req.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'remote-server', version: '2.0' },
          },
        } as JsonRpcResponse
      }
      if (req.method === 'tools/list') {
        return { jsonrpc: '2.0', id: req.id, result: { tools: [] } } as JsonRpcResponse
      }
      return { jsonrpc: '2.0', id: req.id, result: {} } as JsonRpcResponse
    }

    const client = new McpClient('srv-9', 'remote-server', config)
    await client.connect()
    expect(client.isConnected()).toBe(true)
    expect(client.getStatus().serverInfo?.version).toBe('2.0')
  })
})
