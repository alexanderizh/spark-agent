/**
 * MCP Client
 *
 * 管理与单个 MCP 服务器的连接生命周期：
 * - 连接并初始化（JSON-RPC initialize 握手）
 * - 获取工具列表（tools/list）
 * - 调用工具（tools/call）
 * - 断开连接
 *
 * MCP 协议核心方法：
 * - initialize：握手，交换能力
 * - tools/list：获取可用工具列表
 * - tools/call：调用指定工具
 */

import { randomUUID } from 'node:crypto'
import type { McpTransport, McpTransportConfig, JsonRpcRequest } from './transport/types.js'
import { StdioTransport } from './transport/stdio-transport.js'
import { SseTransport } from './transport/sse-transport.js'
import { StreamableHttpTransport } from './transport/streamable-http-transport.js'
import { createLogger } from '@spark/shared'

const log = createLogger('mcp:client')

// ─── MCP Protocol Types ──────────────────────────────────────────────────────

export interface McpServerInfo {
  name: string
  version: string
  protocolVersion?: string
}

export interface McpServerCapabilities {
  tools?: { listChanged?: boolean }
  resources?: { subscribe?: boolean; listChanged?: boolean }
  prompts?: { listChanged?: boolean }
}

export interface McpClientCapabilities {
  roots?: { listChanged?: boolean }
  sampling?: Record<string, unknown>
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface McpToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
}

export interface McpConnectionStatus {
  connected: boolean
  serverInfo: McpServerInfo | null
  toolCount: number
  error?: string
}

// ─── MCP Client ──────────────────────────────────────────────────────────────

let nextRequestId = 1

export class McpClient {
  private transport: McpTransport
  private serverInfo: McpServerInfo | null = null
  private serverCapabilities: McpServerCapabilities | {}
  private tools: McpToolDefinition[] = []
  private _connected = false
  private toolsChangedEmitter: ((payload: { serverId: string; serverName: string; toolCount: number }) => void) | null = null

  constructor(
    private readonly serverId: string,
    private readonly serverName: string,
    config: McpTransportConfig,
  ) {
    this.serverCapabilities = {}
    this.transport = this.createTransport(config)
  }

  /**
   * 注入工具列表变更回调。MCP 服务端发送 `notifications/tools/list_changed` 时,
   * 客户端会自动 refreshTools 并触发该回调(由 McpService.startServer 调用方传入)。
   */
  setToolsChangedHandler(handler: (payload: { serverId: string; serverName: string; toolCount: number }) => void): void {
    this.toolsChangedEmitter = handler
  }

  /** 连接并初始化 MCP 服务器 */
  async connect(): Promise<void> {
    log.info(`Connecting to MCP server: ${this.serverName} (${this.serverId})`)

    await this.transport.connect()

    // MCP initialize handshake
    const initResponse = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: true },
      } as McpClientCapabilities,
      clientInfo: {
        name: 'spark-agent',
        version: '1.0.0',
      },
    })

    if (initResponse.error != null) {
      await this.transport.disconnect()
      throw new Error(`MCP initialize failed for ${this.serverName}: ${initResponse.error.message}`)
    }

    const result = initResponse.result as {
      protocolVersion?: string
      capabilities?: McpServerCapabilities
      serverInfo?: McpServerInfo
    } | null

    if (result?.serverInfo != null) {
      this.serverInfo = result.serverInfo
    }
    if (result?.capabilities != null) {
      this.serverCapabilities = result.capabilities
    }

    // Send initialized notification
    await this.sendNotification('notifications/initialized', {})

    // Fetch tool list
    await this.refreshTools()

    // Subscribe to server-initiated tool list changes if the server advertises the capability.
    // Per MCP spec: when `capabilities.tools.listChanged === true`, the server may send
    // `notifications/tools/list_changed` to announce its tool set has changed.
    if ((this.serverCapabilities as McpServerCapabilities).tools?.listChanged === true) {
      this.transport.onNotification((notification) => {
        if (notification.method === 'notifications/tools/list_changed') {
          log.info(`MCP server ${this.serverName} announced tool list change`)
          void this.refreshTools().then(() => {
            this.toolsChangedEmitter?.({
              serverId: this.serverId,
              serverName: this.serverName,
              toolCount: this.tools.length,
            })
          }).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            log.warn(`Failed to refresh tools for ${this.serverName} after list_changed: ${message}`)
          })
        }
      })
    }

    this._connected = true
    log.info(`MCP server connected: ${this.serverName}, tools: ${this.tools.length}`)
  }

  /** 断开连接 */
  async disconnect(): Promise<void> {
    log.info(`Disconnecting MCP server: ${this.serverName} (${this.serverId})`)
    this._connected = false
    await this.transport.disconnect()
    this.tools = []
    this.serverInfo = null
  }

  /** 获取工具列表 */
  listTools(): McpToolDefinition[] {
    return [...this.tools]
  }

  /** 调用指定工具 */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this._connected) {
      throw new Error(`MCP client not connected: ${this.serverName}`)
    }

    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    })

    if (response.error != null) {
      return {
        content: [{ type: 'text', text: `MCP tool error: ${response.error.message}` }],
        isError: true,
      }
    }

    const result = response.result as McpToolResult | null
    if (result == null) {
      return {
        content: [{ type: 'text', text: 'MCP tool returned empty result' }],
        isError: true,
      }
    }

    return result
  }

  /** 刷新工具列表 */
  async refreshTools(): Promise<void> {
    const response = await this.sendRequest('tools/list', {})

    if (response.error != null) {
      log.warn(`Failed to list tools from ${this.serverName}: ${response.error.message}`)
      this.tools = []
      return
    }

    const result = response.result as { tools?: McpToolDefinition[] } | null
    this.tools = result?.tools ?? []
  }

  /** 获取连接状态 */
  getStatus(): McpConnectionStatus {
    return {
      connected: this._connected && this.transport.isConnected(),
      serverInfo: this.serverInfo,
      toolCount: this.tools.length,
    }
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this._connected && this.transport.isConnected()
  }

  /** 获取服务器 ID */
  getServerId(): string {
    return this.serverId
  }

  /** 获取服务器名称 */
  getServerName(): string {
    return this.serverName
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private createTransport(config: McpTransportConfig): McpTransport {
    switch (config.type) {
      case 'stdio':
        return new StdioTransport(config)
      case 'sse':
        return new SseTransport(config)
      case 'http':
        return new StreamableHttpTransport(config)
      default:
        throw new Error(`Unknown MCP transport type: ${(config as { type: string }).type}`)
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: nextRequestId++,
      method,
      params,
    }

    return this.transport.send(request) as Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }>
  }

  private async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
    // Notifications don't have an id and don't expect a response
    const notification = {
      jsonrpc: '2.0' as const,
      method,
      params,
    }

    // Send via transport. All current transports accept a request with a dummy
    // `notification-` id and treat it as fire-and-forget (stdio → stdin,
    // SSE → POST message endpoint, Streamable HTTP → POST returning 202).
    if (
      this.transport instanceof StdioTransport ||
      this.transport instanceof SseTransport ||
      this.transport instanceof StreamableHttpTransport
    ) {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: `notification-${randomUUID()}`,
        method,
        params,
      }
      // Fire and forget - ignore response for notifications
      this.transport.send(request).catch(() => {
        // Notification failures are non-fatal
      })
    }
  }
}
