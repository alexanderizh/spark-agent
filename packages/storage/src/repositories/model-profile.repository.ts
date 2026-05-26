import { randomUUID } from 'crypto'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface ModelProfileRow {
  id: string
  provider_id: string
  name: string
  config_json: string
  enabled: number
  created_at: string
  updated_at: string
}

export class ModelProfileRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'model_profiles')
  }

  ensureSchema(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS model_profiles (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(provider_id, name)
      )
    `)
  }

  list(filters?: { providerId?: string }): ModelProfileRow[] {
    if (filters?.providerId) {
      return this.raw.prepare('SELECT * FROM model_profiles WHERE provider_id = ? ORDER BY created_at ASC').all(filters.providerId) as ModelProfileRow[]
    }
    return this.raw.prepare('SELECT * FROM model_profiles ORDER BY created_at ASC').all() as ModelProfileRow[]
  }

  getById(id: string): ModelProfileRow | null {
    return this.findById<ModelProfileRow>(id)
  }

  findByProviderAndName(providerId: string, name: string): ModelProfileRow | null {
    return (this.raw.prepare('SELECT * FROM model_profiles WHERE provider_id = ? AND name = ?').get(providerId, name) as ModelProfileRow) ?? null
  }

  create(params: { providerId: string; name: string; configJson?: string }): ModelProfileRow {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.raw.prepare(
      'INSERT INTO model_profiles (id, provider_id, name, config_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    ).run(id, params.providerId, params.name, params.configJson ?? '{}', now, now)
    return this.getById(id)!
  }

  update(id: string, fields: { name?: string; configJson?: string; enabled?: boolean }): ModelProfileRow | null {
    const sets: string[] = []
    const vals: unknown[] = []
    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name) }
    if (fields.configJson !== undefined) { sets.push('config_json = ?'); vals.push(fields.configJson) }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); vals.push(fields.enabled ? 1 : 0) }
    if (!sets.length) return this.getById(id)
    sets.push('updated_at = ?'); vals.push(new Date().toISOString())
    vals.push(id)
    this.raw.prepare(`UPDATE model_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return this.getById(id)
  }

  override deleteById(id: string): boolean {
    return super.deleteById(id)
  }

  hasModels(): boolean {
    return this.count() > 0
  }
}
