import { describe, it, expect } from 'vitest'
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from '../../mcp/transport/types.js'

describe('MCP Transport Types', () => {
  it('JsonRpcRequest has correct structure', () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    }
    expect(req.jsonrpc).toBe('2.0')
    expect(req.method).toBe('initialize')
  })

  it('JsonRpcResponse has correct structure for success', () => {
    const res: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [] },
    }
    expect(res.result).toBeDefined()
    expect(res.error).toBeUndefined()
  })

  it('JsonRpcResponse has correct structure for error', () => {
    const res: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32600, message: 'Invalid Request' },
    }
    expect(res.error).toBeDefined()
    expect(res.error?.code).toBe(-32600)
  })

  it('JsonRpcNotification has correct structure', () => {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
      params: {},
    }
    expect(notification.method).toBe('notifications/tools/list_changed')
  })
})
