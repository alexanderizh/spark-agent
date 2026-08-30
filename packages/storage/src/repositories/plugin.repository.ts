import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type PluginSource = 'bundled' | 'local' | 'marketplace'
export type PluginState = 'installed' | 'blocked' | 'error'
export type PluginTrust = 'bundled' | 'verified' | 'unverified' | 'blocked'

export interface PluginRow {
  id: string
  version: string
  display_name: string
  description: string
  author_name: string
  manifest_json: string
  install_path: string
  source: PluginSource
  enabled: number
  state: PluginState
  trust: PluginTrust
  integrity_sha256: string
  installed_at: string
  updated_at: string
}

export interface PluginPermissionRow {
  plugin_id: string
  permission: string
  state: 'granted' | 'denied' | 'pending'
  granted_at: string | null
  updated_at: string
}

export interface PluginResourceRow {
  id: string
  plugin_id: string
  resource_type: 'skill' | 'mcp-server' | 'connector' | 'runtime'
  resource_id: string
  source_path: string | null
  enabled: number
  metadata_json: string
}

export interface PluginRegistryRow {
  id: string
  name: string
  description: string
  api_base_url: string
  enabled: number
  trusted_key_fingerprints_json: string
  config_json: string
  last_sync_at: string | null
  created_at: string
  updated_at: string
}

export class PluginRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'plugins')
  }

  list(includeDisabled = true): PluginRow[] {
    const sql = includeDisabled
      ? 'SELECT * FROM plugins ORDER BY display_name COLLATE NOCASE ASC'
      : 'SELECT * FROM plugins WHERE enabled = 1 ORDER BY display_name COLLATE NOCASE ASC'
    return this.raw.prepare(sql).all() as PluginRow[]
  }

  get(id: string): PluginRow | undefined {
    return this.findById<PluginRow>(id) ?? undefined
  }

  upsert(params: {
    id: string
    version: string
    displayName: string
    description: string
    authorName: string
    manifestJson: string
    installPath: string
    source: PluginSource
    enabled: boolean
    state: PluginState
    trust: PluginTrust
    integritySha256: string
  }): PluginRow {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `
      INSERT INTO plugins (
        id, version, display_name, description, author_name, manifest_json,
        install_path, source, enabled, state, trust, integrity_sha256,
        installed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        display_name = excluded.display_name,
        description = excluded.description,
        author_name = excluded.author_name,
        manifest_json = excluded.manifest_json,
        install_path = excluded.install_path,
        source = excluded.source,
        enabled = excluded.enabled,
        state = excluded.state,
        trust = excluded.trust,
        integrity_sha256 = excluded.integrity_sha256,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        params.id,
        params.version,
        params.displayName,
        params.description,
        params.authorName,
        params.manifestJson,
        params.installPath,
        params.source,
        params.enabled ? 1 : 0,
        params.state,
        params.trust,
        params.integritySha256,
        now,
        now,
      )
    return this.get(params.id)!
  }

  update(
    id: string,
    fields: Partial<{ enabled: boolean; state: PluginState; trust: PluginTrust }>,
  ): PluginRow | undefined {
    const sets: string[] = []
    const values: unknown[] = []
    if (fields.enabled !== undefined) {
      sets.push('enabled = ?')
      values.push(fields.enabled ? 1 : 0)
    }
    if (fields.state !== undefined) {
      sets.push('state = ?')
      values.push(fields.state)
    }
    if (fields.trust !== undefined) {
      sets.push('trust = ?')
      values.push(fields.trust)
    }
    if (sets.length === 0) return this.get(id)
    sets.push('updated_at = ?')
    values.push(new Date().toISOString(), id)
    this.raw.prepare(`UPDATE plugins SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.get(id)
  }

  listPermissions(pluginId: string): PluginPermissionRow[] {
    return this.raw
      .prepare('SELECT * FROM plugin_permissions WHERE plugin_id = ? ORDER BY permission ASC')
      .all(pluginId) as PluginPermissionRow[]
  }

  setPermission(pluginId: string, permission: string, state: PluginPermissionRow['state']): void {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `
      INSERT INTO plugin_permissions (plugin_id, permission, state, granted_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(plugin_id, permission) DO UPDATE SET
        state = excluded.state,
        granted_at = excluded.granted_at,
        updated_at = excluded.updated_at
    `,
      )
      .run(pluginId, permission, state, state === 'granted' ? now : null, now)
  }

  replaceResources(
    pluginId: string,
    resources: Array<{
      id: string
      type: PluginResourceRow['resource_type']
      resourceId: string
      sourcePath?: string
      enabled: boolean
      metadataJson?: string
    }>,
  ): void {
    const transaction = this.raw.transaction(() => {
      this.raw.prepare('DELETE FROM plugin_resources WHERE plugin_id = ?').run(pluginId)
      const insert = this.raw.prepare(`
        INSERT INTO plugin_resources (id, plugin_id, resource_type, resource_id, source_path, enabled, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const resource of resources) {
        insert.run(
          resource.id,
          pluginId,
          resource.type,
          resource.resourceId,
          resource.sourcePath ?? null,
          resource.enabled ? 1 : 0,
          resource.metadataJson ?? '{}',
        )
      }
    })
    transaction()
  }

  listResources(pluginId: string): PluginResourceRow[] {
    return this.raw
      .prepare(
        'SELECT * FROM plugin_resources WHERE plugin_id = ? ORDER BY resource_type, resource_id',
      )
      .all(pluginId) as PluginResourceRow[]
  }

  deletePlugin(id: string): boolean {
    return this.deleteById(id)
  }

  listRegistries(): PluginRegistryRow[] {
    return this.raw
      .prepare('SELECT * FROM plugin_registries ORDER BY name COLLATE NOCASE ASC')
      .all() as PluginRegistryRow[]
  }

  getRegistry(id: string): PluginRegistryRow | undefined {
    return this.raw.prepare('SELECT * FROM plugin_registries WHERE id = ?').get(id) as
      | PluginRegistryRow
      | undefined
  }

  updateRegistry(
    id: string,
    fields: Partial<{
      enabled: boolean
      apiBaseUrl: string
      trustedKeyFingerprintsJson: string
      lastSyncAt: string
    }>,
  ): PluginRegistryRow | undefined {
    const sets: string[] = []
    const values: unknown[] = []
    if (fields.enabled !== undefined) {
      sets.push('enabled = ?')
      values.push(fields.enabled ? 1 : 0)
    }
    if (fields.apiBaseUrl !== undefined) {
      sets.push('api_base_url = ?')
      values.push(fields.apiBaseUrl)
    }
    if (fields.trustedKeyFingerprintsJson !== undefined) {
      sets.push('trusted_key_fingerprints_json = ?')
      values.push(fields.trustedKeyFingerprintsJson)
    }
    if (fields.lastSyncAt !== undefined) {
      sets.push('last_sync_at = ?')
      values.push(fields.lastSyncAt)
    }
    if (sets.length === 0) return this.getRegistry(id)
    sets.push('updated_at = ?')
    values.push(new Date().toISOString(), id)
    this.raw.prepare(`UPDATE plugin_registries SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.getRegistry(id)
  }
}
