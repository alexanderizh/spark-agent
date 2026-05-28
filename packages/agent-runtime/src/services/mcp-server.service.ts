/**
 * MCP Server Service
 *
 * 管理 MCP 服务器的完整生命周期：
 * - CRUD 操作（服务器配置管理）
 * - 启动/停止 MCP 服务器连接
 * - SDK MCP 配置读取
 * - 连接状态跟踪
 */

import type { McpServerRepository, McpServerRow } from '@spark/storage'
import type { McpServerItem } from '@spark/protocol'
import { McpClient } from '../mcp/index.js'
import type { McpTransportConfig } from '../mcp/index.js'
import { createLogger } from '@spark/shared'

const log = createLogger('mcp:service')

export class McpService {
  private clients = new Map<string, McpClient>()

  constructor(private readonly repo: McpServerRepository) {}

  // ─── CRUD Operations ─────────────────────────────────────────────────────

  listServers(params?: { scope?: string }): McpServerItem[] {
    const rows = params?.scope != null ? this.repo.findByScope(params.scope) : this.repo.listAll()
    return rows.map(toMcpServerItem)
  }

  createServer(params: { scope: string; name: string; configJson: string; enabled?: boolean }): McpServerItem {
    const row = this.repo.create(params)
    return toMcpServerItem(row)
  }

  updateServer(id: string, fields: { name?: string; configJson?: string; enabled?: boolean }): McpServerItem {
    const row = this.repo.update(id, fields)
    if (row == null) throw new Error(`MCP server not found: ${id}`)

    // If the server is currently connected, reconnect it
    if (this.clients.has(id)) {
      void this.stopServer(id).then(() => {
        if (row.enabled === 1) {
          void this.startServer(id)
        }
      })
    }

    return toMcpServerItem(row)
  }

  deleteServer(id: string): boolean {
    // Stop the server first if running
    if (this.clients.has(id)) {
      void this.stopServer(id)
    }
    return this.repo.deleteById(id)
  }

  // ─── Lifecycle Management ────────────────────────────────────────────────

  /**
   * 启动指定 MCP 服务器连接
   */
  async startServer(serverId: string): Promise<void> {
    if (this.clients.has(serverId)) {
      log.info(`MCP server ${serverId} is already running`)
      return
    }

    const row = this.repo.get(serverId)
    if (row == null) {
      throw new Error(`MCP server not found: ${serverId}`)
    }
    if (row.enabled === 0) {
      throw new Error(`MCP server ${serverId} is disabled`)
    }

    const config = this.parseConfig(row.config_json, row.id, row.name)
    const client = new McpClient(row.id, row.name, config)

    try {
      await client.connect()
      this.clients.set(serverId, client)
      log.info(`MCP server started: ${row.name} (${serverId})`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`Failed to start MCP server ${row.name}: ${message}`)
      throw new Error(`Failed to start MCP server ${row.name}: ${message}`)
    }
  }

  /**
   * 停止指定 MCP 服务器连接
   */
  async stopServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (client == null) {
      log.info(`MCP server ${serverId} is not running`)
      return
    }

    try {
      await client.disconnect()
      this.clients.delete(serverId)
      log.info(`MCP server stopped: ${serverId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`Error stopping MCP server ${serverId}: ${message}`)
      this.clients.delete(serverId)
    }
  }

  /**
   * 启动所有已启用的 MCP 服务器
   */
  async startAllEnabled(): Promise<void> {
    const servers = this.repo.listAll().filter((row) => row.enabled === 1)
    const results = await Promise.allSettled(
      servers.map((row) => this.startServer(row.id)),
    )

    let started = 0
    let failed = 0
    for (const result of results) {
      if (result.status === 'fulfilled') {
        started++
      } else {
        failed++
        log.error(`Failed to start MCP server: ${result.reason}`)
      }
    }

    log.info(`MCP servers started: ${started} succeeded, ${failed} failed`)
  }

  /**
   * 停止所有 MCP 服务器连接
   */
  async stopAll(): Promise<void> {
    const ids = Array.from(this.clients.keys())
    await Promise.allSettled(ids.map((id) => this.stopServer(id)))
    log.info('All MCP servers stopped')
  }

  // ─── Tool Registration ───────────────────────────────────────────────────

  /**
   * 获取所有已连接 MCP 服务器的工具列表
   */
  getAllMcpTools(): Array<{ serverId: string; serverName: string; toolName: string; toolDescription: string }> {
    const result: Array<{ serverId: string; serverName: string; toolName: string; toolDescription: string }> = []

    for (const [serverId, client] of this.clients) {
      for (const tool of client.listTools()) {
        result.push({
          serverId,
          serverName: client.getServerName(),
          toolName: tool.name,
          toolDescription: tool.description,
        })
      }
    }

    return result
  }

  // ─── Status ──────────────────────────────────────────────────────────────

  /**
   * 获取指定服务器的连接状态
   */
  getServerStatus(serverId: string): { connected: boolean; toolCount: number; error?: string } {
    const client = this.clients.get(serverId)
    if (client == null) {
      return { connected: false, toolCount: 0 }
    }
    return client.getStatus()
  }

  /**
   * 获取指定服务器的工具列表
   */
  getServerTools(serverId: string): Array<{ name: string; description: string }> {
    const client = this.clients.get(serverId)
    if (client == null) {
      return []
    }
    return client.listTools().map((t) => ({ name: t.name, description: t.description }))
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * 解析 MCP 服务器配置 JSON 为 TransportConfig
   */
  private parseConfig(configJson: string, _serverId: string, _serverName: string): McpTransportConfig {
    try {
      const config = JSON.parse(configJson) as Record<string, unknown>

      if (config.type === 'sse' && typeof config.url === 'string') {
        return {
          type: 'sse',
          url: config.url,
          ...(config.headers != null && typeof config.headers === 'object' ? { headers: config.headers as Record<string, string> } : {}),
        }
      }

      // Default to stdio transport
      return {
        type: 'stdio',
        command: String(config.command ?? 'npx'),
        args: Array.isArray(config.args) ? config.args.map(String) : [],
        ...(config.env != null && typeof config.env === 'object' ? { env: config.env as Record<string, string> } : {}),
        ...(config.cwd != null && typeof config.cwd === 'string' ? { cwd: config.cwd } : {}),
      }
    } catch {
      throw new Error(`Invalid MCP server config JSON`)
    }
  }
}

function toMcpServerItem(row: McpServerRow): McpServerItem {
  return {
    id: row.id,
    scope: row.scope,
    name: row.name,
    configJson: row.config_json,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
