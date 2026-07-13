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
import { EventEmitter } from 'node:events'
import { McpClient, resolveMcpConfig, validateMcpConfigJson } from '../mcp/index.js'
import type { McpTransportConfig } from '../mcp/index.js'
import { createLogger } from '@spark/shared'

const log = createLogger('mcp:service')

export interface McpOAuthTokenProvider {
  getAccessToken(serverId: string): Promise<string | null>
  getAuthStatus?(serverId: string): Promise<'unconfigured' | 'needs-auth' | 'authorizing' | 'authorized' | 'failed'>
}

export type McpChangeAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'start'
  | 'stop'
  | 'tools-changed'

export interface McpChangeEvent {
  action: McpChangeAction
  id: string
  serverName?: string
}

/**
 * Scope reserved for internally-managed MCP servers (auto-registered by the app).
 *
 * Servers with this scope cannot be deleted or renamed through the public API —
 * users can only enable/disable them or update their config. This prevents
 * accidental removal of critical integrations like Playwright.
 */
export const MANAGED_MCP_SCOPE = 'managed'

/** Stable identifier used for the auto-registered Playwright MCP server. */
export const PLAYWRIGHT_MCP_NAME = 'playwright'

export class McpService {
  private clients = new Map<string, McpClient>()
  private changeEmitter = new EventEmitter()

  constructor(
    private readonly repo: McpServerRepository,
    private readonly oauthProvider?: McpOAuthTokenProvider,
  ) {}

  // ─── Change Events ────────────────────────────────────────────────────────

  /**
   * 订阅 MCP 生命周期事件(create/update/delete/start/stop/tools-changed)。
   * SessionService 用此维护 mcpVersion 计数器,以便 MCP 变化时让下次 turn 走新配置。
   */
  onChange(handler: (event: McpChangeEvent) => void): () => void {
    this.changeEmitter.on('change', handler)
    return () => {
      this.changeEmitter.off('change', handler)
    }
  }

  private emitChange(action: McpChangeAction, id: string, serverName?: string): void {
    this.changeEmitter.emit('change', { action, id, ...(serverName != null ? { serverName } : {}) })
  }

  // ─── CRUD Operations ─────────────────────────────────────────────────────

  listServers(params?: { scope?: string }): McpServerItem[] {
    const rows = params?.scope != null ? this.repo.findByScope(params.scope) : this.repo.listAll()
    return rows.map(toMcpServerItem)
  }

  createServer(params: { scope: string; name: string; configJson: string; enabled?: boolean }): McpServerItem {
    const configError = validateMcpConfigJson(params.configJson)
    if (configError != null) {
      throw new Error(`MCP 配置无效：${configError}`)
    }
    const row = this.repo.create(params)
    this.emitChange('create', row.id, row.name)

    // Auto-start when enabled is not explicitly false. Fire-and-forget so the IPC
    // response isn't blocked on the connection handshake; start failures are logged
    // and surface via getServerStatus without rolling back the DB row.
    if (params.enabled !== false && !isOAuthMcpConfig(params.configJson)) {
      void this.startServer(row.id).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        log.warn(`Auto-start failed for newly created MCP server ${row.name}: ${message}`)
      })
    }

    return toMcpServerItem(row)
  }

  updateServer(id: string, fields: { name?: string; configJson?: string; enabled?: boolean }): McpServerItem {
    const existing = this.repo.get(id)
    if (existing == null) throw new Error(`MCP server not found: ${id}`)

    if (fields.configJson != null) {
      const configError = validateMcpConfigJson(fields.configJson)
      if (configError != null) {
        throw new Error(`MCP 配置无效：${configError}`)
      }
    }

    // Managed servers cannot be renamed (their name is a stable key)
    if (existing.scope === MANAGED_MCP_SCOPE && fields.name !== undefined && fields.name !== existing.name) {
      throw new Error(`Cannot rename managed MCP server "${existing.name}"`)
    }

    const row = this.repo.update(id, fields)
    if (row == null) throw new Error(`MCP server not found: ${id}`)

    this.emitChange('update', id, row.name)

    // If the server is currently connected, reconnect it
    if (this.clients.has(id)) {
      void this.stopServer(id).then(() => {
        if (row.enabled === 1) {
          void this.startServer(id)
        }
      })
    } else if (row.enabled === 1 && fields.enabled === true && !isOAuthMcpConfig(row.config_json)) {
      // Toggling from disabled → enabled on an unconnected non-OAuth server: start it.
      void this.startServer(id).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        log.warn(`Failed to start MCP server ${row.name} after enable: ${message}`)
      })
    }

    return toMcpServerItem(row)
  }

  deleteServer(id: string): boolean {
    const existing = this.repo.get(id)
    if (existing == null) return false

    // Managed servers cannot be deleted through the public API — disable instead.
    if (existing.scope === MANAGED_MCP_SCOPE) {
      throw new Error(
        `Cannot delete managed MCP server "${existing.name}". Disable it from settings instead.`,
      )
    }

    // Stop the server first if running
    if (this.clients.has(id)) {
      void this.stopServer(id)
    }
    const deleted = this.repo.deleteById(id)
    if (deleted) this.emitChange('delete', id, existing.name)
    return deleted
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

    const config = await this.parseConfig(row.config_json, row.id, row.name)
    const client = new McpClient(row.id, row.name, config)
    client.setToolsChangedHandler((payload) => {
      this.emitChange('tools-changed', payload.serverId, payload.serverName)
    })

    try {
      await client.connect()
      this.clients.set(serverId, client)
      this.emitChange('start', serverId, row.name)
      log.info(`MCP server started: ${row.name} (${serverId})`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`Failed to start MCP server ${row.name}: ${message}`)
      throw new Error(`Failed to start MCP server ${row.name}: ${message}`, { cause: err })
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

    const row = this.repo.get(serverId)

    try {
      await client.disconnect()
      this.clients.delete(serverId)
      this.emitChange('stop', serverId, row?.name)
      log.info(`MCP server stopped: ${row?.name ?? serverId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`Error stopping MCP server ${serverId}: ${message}`)
      this.clients.delete(serverId)
      this.emitChange('stop', serverId, row?.name)
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
  private async parseConfig(configJson: string, serverId: string, serverName: string): Promise<McpTransportConfig> {
    let config: Record<string, unknown>
    try {
      config = JSON.parse(configJson) as Record<string, unknown>
    } catch {
      throw new Error(`Invalid MCP server config JSON`)
    }

    // 归一化：兼容 `transport`/`type` 字段名，支持 http(Streamable HTTP)/sse/stdio。
    const resolved = resolveMcpConfig(config)
    if (resolved == null) {
      throw new Error(`MCP server "${serverName}" 配置缺少有效传输（url 或 command）`)
    }
    if (resolved.type === 'http' || resolved.type === 'sse') {
      const auth = (config.auth as { type?: string } | undefined)
      if (auth?.type === 'oauth2') {
        const token = await this.oauthProvider?.getAccessToken(serverId)
        if (token == null) throw new Error(`MCP server "${serverName}" requires OAuth authorization`)
        return { ...resolved, headers: { ...(resolved.headers ?? {}), Authorization: `Bearer ${token}` } }
      }
    }
    return resolved
  }

  async getServerAuthStatus(serverId: string): Promise<'unconfigured' | 'needs-auth' | 'authorizing' | 'authorized' | 'failed'> {
    return await this.oauthProvider?.getAuthStatus?.(serverId) ?? 'unconfigured'
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


function isOAuthMcpConfig(configJson: string): boolean {
  try {
    const config = JSON.parse(configJson) as { auth?: { type?: unknown } }
    return config.auth?.type === 'oauth2'
  } catch {
    return false
  }
}
