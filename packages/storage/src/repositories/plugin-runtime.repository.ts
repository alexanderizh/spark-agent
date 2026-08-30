import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface ConnectorAccountRow {
  id: string
  plugin_id: string
  runtime_id: string
  provider: string
  external_account_id: string
  display_name: string
  avatar_url: string | null
  auth_method: string
  status: string
  enabled: number
  granted_scopes_json: string
  enabled_capabilities_json: string
  resource_scope_json: string
  config_json: string
  credential_ref: string | null
  token_expires_at: string | null
  last_health_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface UpsertConnectorAccountParams {
  id: string
  pluginId: string
  runtimeId: string
  provider: string
  externalAccountId: string
  displayName: string
  avatarUrl?: string | null
  authMethod: string
  status: string
  enabled?: boolean
  grantedScopes?: string[]
  enabledCapabilities?: string[]
  resourceScope?: Record<string, unknown>
  config?: Record<string, unknown>
  credentialRef?: string | null
  tokenExpiresAt?: string | null
  lastHealthAt?: string | null
  lastError?: string | null
}

export interface UpdateConnectorAccountParams {
  displayName?: string
  avatarUrl?: string | null
  authMethod?: string
  status?: string
  enabled?: boolean
  grantedScopes?: string[]
  enabledCapabilities?: string[]
  resourceScope?: Record<string, unknown>
  config?: Record<string, unknown>
  credentialRef?: string | null
  tokenExpiresAt?: string | null
  lastHealthAt?: string | null
  lastError?: string | null
}

export interface PluginRuntimeAuditParams {
  id: string
  pluginId: string
  runtimeId: string
  accountId?: string | null
  toolName: string
  risk: string
  effect: string
  outcome: 'success' | 'error' | 'denied'
  durationMs: number
  resourceIds?: string[]
  errorCode?: string | null
}

export class ConnectorAccountRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'connector_accounts')
  }

  upsert(params: UpsertConnectorAccountParams): ConnectorAccountRow {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `
        INSERT INTO connector_accounts (
          id, plugin_id, runtime_id, provider, external_account_id, display_name,
          avatar_url, auth_method, status, enabled, granted_scopes_json,
          enabled_capabilities_json, resource_scope_json, config_json, credential_ref,
          token_expires_at, last_health_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(plugin_id, runtime_id, external_account_id) DO UPDATE SET
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          auth_method = excluded.auth_method,
          status = excluded.status,
          enabled = excluded.enabled,
          granted_scopes_json = excluded.granted_scopes_json,
          enabled_capabilities_json = excluded.enabled_capabilities_json,
          resource_scope_json = excluded.resource_scope_json,
          config_json = excluded.config_json,
          credential_ref = excluded.credential_ref,
          token_expires_at = excluded.token_expires_at,
          last_health_at = excluded.last_health_at,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        params.id,
        params.pluginId,
        params.runtimeId,
        params.provider,
        params.externalAccountId,
        params.displayName,
        params.avatarUrl ?? null,
        params.authMethod,
        params.status,
        params.enabled === false ? 0 : 1,
        this.toJson(params.grantedScopes ?? []),
        this.toJson(params.enabledCapabilities ?? []),
        this.toJson(params.resourceScope ?? {}),
        this.toJson(params.config ?? {}),
        params.credentialRef ?? null,
        params.tokenExpiresAt ?? null,
        params.lastHealthAt ?? null,
        params.lastError ?? null,
        now,
        now,
      )
    return this.getByExternalId(params.pluginId, params.runtimeId, params.externalAccountId)!
  }

  get(id: string): ConnectorAccountRow | null {
    return this.findById<ConnectorAccountRow>(id)
  }

  getByExternalId(
    pluginId: string,
    runtimeId: string,
    externalAccountId: string,
  ): ConnectorAccountRow | null {
    return (
      (this.raw
        .prepare(
          'SELECT * FROM connector_accounts WHERE plugin_id = ? AND runtime_id = ? AND external_account_id = ? LIMIT 1',
        )
        .get(pluginId, runtimeId, externalAccountId) as ConnectorAccountRow | undefined) ?? null
    )
  }

  list(pluginId: string, runtimeId: string): ConnectorAccountRow[] {
    return this.raw
      .prepare(
        'SELECT * FROM connector_accounts WHERE plugin_id = ? AND runtime_id = ? ORDER BY display_name COLLATE NOCASE ASC',
      )
      .all(pluginId, runtimeId) as ConnectorAccountRow[]
  }

  listByPlugin(pluginId: string): ConnectorAccountRow[] {
    return this.raw
      .prepare('SELECT * FROM connector_accounts WHERE plugin_id = ? ORDER BY updated_at DESC')
      .all(pluginId) as ConnectorAccountRow[]
  }

  listAll(): ConnectorAccountRow[] {
    return this.raw
      .prepare('SELECT * FROM connector_accounts ORDER BY updated_at DESC')
      .all() as ConnectorAccountRow[]
  }

  update(id: string, fields: UpdateConnectorAccountParams): ConnectorAccountRow | null {
    const sets: string[] = ['updated_at = ?']
    const values: unknown[] = [new Date().toISOString()]
    const add = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`)
      values.push(value)
    }
    if (fields.displayName !== undefined) add('display_name', fields.displayName)
    if (fields.avatarUrl !== undefined) add('avatar_url', fields.avatarUrl)
    if (fields.authMethod !== undefined) add('auth_method', fields.authMethod)
    if (fields.status !== undefined) add('status', fields.status)
    if (fields.enabled !== undefined) add('enabled', fields.enabled ? 1 : 0)
    if (fields.grantedScopes !== undefined)
      add('granted_scopes_json', this.toJson(fields.grantedScopes))
    if (fields.enabledCapabilities !== undefined)
      add('enabled_capabilities_json', this.toJson(fields.enabledCapabilities))
    if (fields.resourceScope !== undefined)
      add('resource_scope_json', this.toJson(fields.resourceScope))
    if (fields.config !== undefined) add('config_json', this.toJson(fields.config))
    if (fields.credentialRef !== undefined) add('credential_ref', fields.credentialRef)
    if (fields.tokenExpiresAt !== undefined) add('token_expires_at', fields.tokenExpiresAt)
    if (fields.lastHealthAt !== undefined) add('last_health_at', fields.lastHealthAt)
    if (fields.lastError !== undefined) add('last_error', fields.lastError)
    values.push(id)
    this.raw.prepare(`UPDATE connector_accounts SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.get(id)
  }

  delete(id: string): boolean {
    return this.deleteById(id)
  }

  getDefault(pluginId: string, runtimeId: string): string | null {
    const row = this.raw
      .prepare(
        'SELECT account_id FROM connector_account_defaults WHERE plugin_id = ? AND runtime_id = ?',
      )
      .get(pluginId, runtimeId) as { account_id: string } | undefined
    return row?.account_id ?? null
  }

  setDefault(pluginId: string, runtimeId: string, accountId: string): void {
    this.raw
      .prepare(
        `
        INSERT INTO connector_account_defaults (plugin_id, runtime_id, account_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(plugin_id, runtime_id) DO UPDATE SET
          account_id = excluded.account_id,
          updated_at = excluded.updated_at
      `,
      )
      .run(pluginId, runtimeId, accountId, new Date().toISOString())
  }

  clearDefault(pluginId: string, runtimeId: string): boolean {
    const result = this.raw
      .prepare('DELETE FROM connector_account_defaults WHERE plugin_id = ? AND runtime_id = ?')
      .run(pluginId, runtimeId)
    return result.changes > 0
  }
}

export class PluginRuntimeAuditRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'plugin_runtime_audit')
  }

  record(params: PluginRuntimeAuditParams): void {
    this.raw
      .prepare(
        `
        INSERT INTO plugin_runtime_audit (
          id, plugin_id, runtime_id, account_id, tool_name, risk, effect,
          outcome, duration_ms, resource_ids_json, error_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        params.id,
        params.pluginId,
        params.runtimeId,
        params.accountId ?? null,
        params.toolName,
        params.risk,
        params.effect,
        params.outcome,
        Math.max(0, Math.round(params.durationMs)),
        this.toJson(params.resourceIds ?? []),
        params.errorCode ?? null,
      )
  }
}
