import { randomUUID } from 'crypto'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface MediaModelManifestRow {
  id: string
  provider_kind: string
  model_id: string
  display_name: string
  version: string | null
  manifest_json: string
  built_in: number
  enabled: number
  source_urls_json: string
  last_checked_at: string | null
  created_at: string
  updated_at: string
}

export interface MediaProviderModelRow {
  id: string
  provider_profile_id: string
  manifest_id: string
  model_id: string | null
  enabled: number
  defaults_json: string
  created_at: string
  updated_at: string
}

export interface UpsertMediaModelManifestParams {
  id: string
  providerKind: string
  modelId: string
  displayName: string
  version?: string | null
  manifestJson: string
  builtIn?: boolean
  enabled?: boolean
  sourceUrlsJson?: string
  lastCheckedAt?: string | null
}

export interface UpsertMediaProviderModelParams {
  providerProfileId: string
  manifestId: string
  modelId?: string | null
  enabled?: boolean
  defaultsJson?: string
}

export class MediaModelManifestRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'media_model_manifests')
  }

  ensureSchema(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS media_model_manifests (
        id TEXT PRIMARY KEY,
        provider_kind TEXT NOT NULL,
        model_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        version TEXT,
        manifest_json TEXT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        source_urls_json TEXT NOT NULL DEFAULT '[]',
        last_checked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS media_provider_models (
        id TEXT PRIMARY KEY,
        provider_profile_id TEXT NOT NULL,
        manifest_id TEXT NOT NULL,
        model_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        defaults_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(provider_profile_id, manifest_id)
      );
    `)
  }

  list(filters?: { providerKind?: string; enabledOnly?: boolean; builtIn?: boolean }): MediaModelManifestRow[] {
    const where: string[] = []
    const values: unknown[] = []
    if (filters?.providerKind != null) {
      where.push('provider_kind = ?')
      values.push(filters.providerKind)
    }
    if (filters?.enabledOnly === true) {
      where.push('enabled = 1')
    }
    if (filters?.builtIn !== undefined) {
      where.push('built_in = ?')
      values.push(filters.builtIn ? 1 : 0)
    }
    const sql = `SELECT * FROM media_model_manifests${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY provider_kind ASC, display_name ASC`
    return this.raw.prepare(sql).all(...values) as MediaModelManifestRow[]
  }

  getById(id: string): MediaModelManifestRow | null {
    return this.findById<MediaModelManifestRow>(id)
  }

  upsert(params: UpsertMediaModelManifestParams): MediaModelManifestRow {
    const now = new Date().toISOString()
    this.raw.prepare(`
      INSERT INTO media_model_manifests
        (id, provider_kind, model_id, display_name, version, manifest_json, built_in, enabled, source_urls_json, last_checked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_kind = excluded.provider_kind,
        model_id = excluded.model_id,
        display_name = excluded.display_name,
        version = excluded.version,
        manifest_json = excluded.manifest_json,
        built_in = excluded.built_in,
        enabled = excluded.enabled,
        source_urls_json = excluded.source_urls_json,
        last_checked_at = excluded.last_checked_at,
        updated_at = excluded.updated_at
    `).run(
      params.id,
      params.providerKind,
      params.modelId,
      params.displayName,
      params.version ?? null,
      params.manifestJson,
      params.builtIn === true ? 1 : 0,
      params.enabled === false ? 0 : 1,
      params.sourceUrlsJson ?? '[]',
      params.lastCheckedAt ?? null,
      now,
      now,
    )
    return this.getById(params.id)!
  }

  update(id: string, fields: Partial<{
    displayName: string
    manifestJson: string
    enabled: boolean
    lastCheckedAt: string | null
  }>): MediaModelManifestRow | null {
    const sets: string[] = []
    const values: unknown[] = []
    if (fields.displayName !== undefined) {
      sets.push('display_name = ?')
      values.push(fields.displayName)
    }
    if (fields.manifestJson !== undefined) {
      sets.push('manifest_json = ?')
      values.push(fields.manifestJson)
    }
    if (fields.enabled !== undefined) {
      sets.push('enabled = ?')
      values.push(fields.enabled ? 1 : 0)
    }
    if (fields.lastCheckedAt !== undefined) {
      sets.push('last_checked_at = ?')
      values.push(fields.lastCheckedAt)
    }
    if (sets.length === 0) return this.getById(id)
    sets.push('updated_at = ?')
    values.push(new Date().toISOString(), id)
    this.raw.prepare(`UPDATE media_model_manifests SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.getById(id)
  }

  delete(id: string): boolean {
    return this.deleteById(id)
  }

  listProviderModels(providerProfileId: string): MediaProviderModelRow[] {
    return this.raw
      .prepare('SELECT * FROM media_provider_models WHERE provider_profile_id = ? ORDER BY created_at ASC')
      .all(providerProfileId) as MediaProviderModelRow[]
  }

  upsertProviderModel(params: UpsertMediaProviderModelParams): MediaProviderModelRow {
    const existing = this.raw
      .prepare('SELECT * FROM media_provider_models WHERE provider_profile_id = ? AND manifest_id = ?')
      .get(params.providerProfileId, params.manifestId) as MediaProviderModelRow | undefined
    const id = existing?.id ?? randomUUID()
    const now = new Date().toISOString()
    this.raw.prepare(`
      INSERT INTO media_provider_models
        (id, provider_profile_id, manifest_id, model_id, enabled, defaults_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_profile_id, manifest_id) DO UPDATE SET
        model_id = excluded.model_id,
        enabled = excluded.enabled,
        defaults_json = excluded.defaults_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      params.providerProfileId,
      params.manifestId,
      params.modelId ?? null,
      params.enabled === false ? 0 : 1,
      params.defaultsJson ?? '{}',
      now,
      now,
    )
    return this.raw.prepare('SELECT * FROM media_provider_models WHERE id = ?').get(id) as MediaProviderModelRow
  }
}

