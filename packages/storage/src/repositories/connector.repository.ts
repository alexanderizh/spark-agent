import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface ConnectorConnectionRow {
  id: string
  provider: string
  name: string
  auth_method: string
  status: string
  enabled: number
  config_json: string
  keystore_ref: string | null
  granted_scopes_json: string
  account_json: string | null
  last_sync_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface CreateConnectorConnectionParams {
  id: string
  provider: string
  name: string
  authMethod: string
  status: string
  enabled?: boolean
  config: Record<string, unknown>
  keystoreRef?: string | null
  grantedScopes?: string[]
  account?: Record<string, unknown> | null
  lastSyncAt?: string | null
  lastError?: string | null
}

export interface UpdateConnectorConnectionParams {
  name?: string
  authMethod?: string
  status?: string
  enabled?: boolean
  config?: Record<string, unknown>
  keystoreRef?: string | null
  grantedScopes?: string[]
  account?: Record<string, unknown> | null
  lastSyncAt?: string | null
  lastError?: string | null
}

export class ConnectorConnectionRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'connector_connections')
  }

  create(params: CreateConnectorConnectionParams): ConnectorConnectionRow {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO connector_connections (
          id, provider, name, auth_method, status, enabled, config_json, keystore_ref,
          granted_scopes_json, account_json, last_sync_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.provider,
        params.name,
        params.authMethod,
        params.status,
        params.enabled === false ? 0 : 1,
        this.toJson(params.config),
        params.keystoreRef ?? null,
        this.toJson(params.grantedScopes ?? []),
        params.account != null ? this.toJson(params.account) : null,
        params.lastSyncAt ?? null,
        params.lastError ?? null,
        now,
        now,
      )
    return this.findById<ConnectorConnectionRow>(params.id)!
  }

  get(id: string): ConnectorConnectionRow | null {
    return this.findById<ConnectorConnectionRow>(id)
  }

  getByProvider(provider: string): ConnectorConnectionRow | null {
    return (
      (this.raw
        .prepare('SELECT * FROM connector_connections WHERE provider = ? LIMIT 1')
        .get(provider) as ConnectorConnectionRow | undefined) ?? null
    )
  }

  listAll(): ConnectorConnectionRow[] {
    return this.findAll<ConnectorConnectionRow>(1000)
  }

  update(id: string, fields: UpdateConnectorConnectionParams): ConnectorConnectionRow | null {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const values: unknown[] = [now]

    if (fields.name !== undefined) { sets.push('name = ?'); values.push(fields.name) }
    if (fields.authMethod !== undefined) { sets.push('auth_method = ?'); values.push(fields.authMethod) }
    if (fields.status !== undefined) { sets.push('status = ?'); values.push(fields.status) }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); values.push(fields.enabled ? 1 : 0) }
    if (fields.config !== undefined) { sets.push('config_json = ?'); values.push(this.toJson(fields.config)) }
    if (fields.keystoreRef !== undefined) { sets.push('keystore_ref = ?'); values.push(fields.keystoreRef) }
    if (fields.grantedScopes !== undefined) {
      sets.push('granted_scopes_json = ?')
      values.push(this.toJson(fields.grantedScopes))
    }
    if (fields.account !== undefined) {
      sets.push('account_json = ?')
      values.push(fields.account != null ? this.toJson(fields.account) : null)
    }
    if (fields.lastSyncAt !== undefined) { sets.push('last_sync_at = ?'); values.push(fields.lastSyncAt) }
    if (fields.lastError !== undefined) { sets.push('last_error = ?'); values.push(fields.lastError) }

    values.push(id)
    this.raw.prepare(`UPDATE connector_connections SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.get(id)
  }

  delete(id: string): boolean {
    return this.deleteById(id)
  }
}
