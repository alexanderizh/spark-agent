import { randomUUID } from 'crypto'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface McpServerRow {
  id: string
  scope: string
  name: string
  config_json: string
  enabled: number
  /** 所属工作流包 id;null = 用户自建 */
  bundle_id: string | null
  created_at: string
  updated_at: string
}

export class McpServerRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'mcp_servers')
  }

  listAll(): McpServerRow[] {
    return this.raw
      .prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC')
      .all() as McpServerRow[]
  }

  get(id: string): McpServerRow | undefined {
    return this.findById<McpServerRow>(id) ?? undefined
  }

  findByScope(scope: string): McpServerRow[] {
    return this.raw
      .prepare('SELECT * FROM mcp_servers WHERE scope = ? ORDER BY created_at ASC')
      .all(scope) as McpServerRow[]
  }

  findByBundleId(bundleId: string): McpServerRow[] {
    return this.raw
      .prepare('SELECT * FROM mcp_servers WHERE bundle_id = ? ORDER BY created_at ASC')
      .all(bundleId) as McpServerRow[]
  }

  create(params: {
    id?: string
    scope: string
    name: string
    configJson: string
    enabled?: boolean
    bundleId?: string
  }): McpServerRow {
    const id = params.id ?? randomUUID()
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `
      INSERT INTO mcp_servers (id, scope, name, config_json, enabled, bundle_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        params.scope,
        params.name,
        params.configJson,
        params.enabled === false ? 0 : 1,
        params.bundleId ?? null,
        now,
        now,
      )
    return this.get(id)!
  }

  update(
    id: string,
    fields: Partial<{ name: string; configJson: string; enabled: boolean }>,
  ): McpServerRow | undefined {
    const sets: string[] = []
    const vals: unknown[] = []

    if (fields.name !== undefined) {
      sets.push('name = ?')
      vals.push(fields.name)
    }
    if (fields.configJson !== undefined) {
      sets.push('config_json = ?')
      vals.push(fields.configJson)
    }
    if (fields.enabled !== undefined) {
      sets.push('enabled = ?')
      vals.push(fields.enabled ? 1 : 0)
    }

    if (sets.length === 0) return this.get(id)

    sets.push('updated_at = ?')
    vals.push(new Date().toISOString(), id)
    this.raw.prepare(`UPDATE mcp_servers SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return this.get(id)
  }

  override deleteById(id: string): boolean {
    return super.deleteById(id)
  }
}
