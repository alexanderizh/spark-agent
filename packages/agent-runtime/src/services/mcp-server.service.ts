import type { McpServerRepository, McpServerRow } from '@spark/storage'
import type { McpServerItem } from '@spark/protocol'

export class McpService {
  constructor(private readonly repo: McpServerRepository) {}

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
    return toMcpServerItem(row)
  }

  deleteServer(id: string): boolean {
    return this.repo.deleteById(id)
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
