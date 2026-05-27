import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface SkillRow {
  id: string
  scope: string
  name: string
  version: string
  root_path: string
  manifest_json: string
  enabled: number
  created_at: string
  updated_at: string
  // Extended fields (migration 008)
  registry_id: string | null
  remote_id: string | null
  author: string
  category: string
  tags_json: string
  rating: number
  download_count: number
  homepage_url: string | null
  icon_url: string | null
}

export class SkillRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'skills')
  }

  list(filters?: { scope?: string }): SkillRow[] {
    if (filters?.scope !== undefined) {
      return this.raw.prepare('SELECT * FROM skills WHERE scope = ? ORDER BY created_at ASC').all(filters.scope) as SkillRow[]
    }
    return this.raw.prepare('SELECT * FROM skills ORDER BY created_at ASC').all() as SkillRow[]
  }

  get(id: string): SkillRow | undefined {
    return this.findById<SkillRow>(id) ?? undefined
  }

  create(params: { id: string; scope: string; name: string; version: string; rootPath: string; manifestJson: string; enabled?: boolean }): SkillRow {
    const now = new Date().toISOString()
    this.raw.prepare(`
      INSERT INTO skills (id, scope, name, version, root_path, manifest_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(params.id, params.scope, params.name, params.version, params.rootPath, params.manifestJson, params.enabled === false ? 0 : 1, now, now)
    return this.get(params.id)!
  }

  update(id: string, fields: Partial<{ name: string; version: string; rootPath: string; manifestJson: string; enabled: boolean }>): SkillRow | undefined {
    const sets: string[] = []
    const vals: unknown[] = []

    if (fields.name !== undefined) {
      sets.push('name = ?')
      vals.push(fields.name)
    }
    if (fields.version !== undefined) {
      sets.push('version = ?')
      vals.push(fields.version)
    }
    if (fields.rootPath !== undefined) {
      sets.push('root_path = ?')
      vals.push(fields.rootPath)
    }
    if (fields.manifestJson !== undefined) {
      sets.push('manifest_json = ?')
      vals.push(fields.manifestJson)
    }
    if (fields.enabled !== undefined) {
      sets.push('enabled = ?')
      vals.push(fields.enabled ? 1 : 0)
    }

    if (sets.length === 0) return this.get(id)

    sets.push('updated_at = ?')
    vals.push(new Date().toISOString(), id)
    this.raw.prepare(`UPDATE skills SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return this.get(id)
  }

  /**
   * 更新扩展字段（由 migration 008 新增的列）
   */
  updateExtendedFields(id: string, fields: {
    registryId?: string | null
    remoteId?: string | null
    author?: string
    category?: string
    tagsJson?: string
    rating?: number
    downloadCount?: number
    homepageUrl?: string | null
    iconUrl?: string | null
  }): SkillRow | undefined {
    const sets: string[] = []
    const vals: unknown[] = []

    if (fields.registryId !== undefined) { sets.push('registry_id = ?'); vals.push(fields.registryId) }
    if (fields.remoteId !== undefined) { sets.push('remote_id = ?'); vals.push(fields.remoteId) }
    if (fields.author !== undefined) { sets.push('author = ?'); vals.push(fields.author) }
    if (fields.category !== undefined) { sets.push('category = ?'); vals.push(fields.category) }
    if (fields.tagsJson !== undefined) { sets.push('tags_json = ?'); vals.push(fields.tagsJson) }
    if (fields.rating !== undefined) { sets.push('rating = ?'); vals.push(fields.rating) }
    if (fields.downloadCount !== undefined) { sets.push('download_count = ?'); vals.push(fields.downloadCount) }
    if (fields.homepageUrl !== undefined) { sets.push('homepage_url = ?'); vals.push(fields.homepageUrl) }
    if (fields.iconUrl !== undefined) { sets.push('icon_url = ?'); vals.push(fields.iconUrl) }

    if (sets.length === 0) return this.get(id)

    sets.push('updated_at = ?')
    vals.push(new Date().toISOString(), id)
    this.raw.prepare(`UPDATE skills SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return this.get(id)
  }

  override deleteById(id: string): boolean {
    return super.deleteById(id)
  }
}
