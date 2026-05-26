import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface PermissionProfileRow {
  id: string
  name: string
  sandbox_level: number
  is_builtin: number
  created_at: string
}

export interface PermissionRuleRow {
  id: string
  profile_id: string
  action: string
  scope: string
  mode: string
  sort_order: number
}

export class PermissionProfileRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'permission_profiles')
  }

  ensureSchema(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS permission_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sandbox_level INTEGER NOT NULL DEFAULT 2,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS permission_rules (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES permission_profiles(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        scope TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'ask',
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `)
  }

  listProfiles(): PermissionProfileRow[] {
    return this.raw.prepare(`SELECT * FROM permission_profiles ORDER BY is_builtin DESC, name`).all() as PermissionProfileRow[]
  }

  getProfile(id: string): PermissionProfileRow | null {
    return this.findById<PermissionProfileRow>(id)
  }

  createProfile(params: { id: string; name: string; sandboxLevel?: number; isBuiltin?: boolean }): PermissionProfileRow {
    this.raw.prepare(
      `INSERT INTO permission_profiles (id, name, sandbox_level, is_builtin) VALUES (?, ?, ?, ?)`
    ).run(params.id, params.name, params.sandboxLevel ?? 2, params.isBuiltin ? 1 : 0)
    return this.getProfile(params.id)!
  }

  updateProfile(id: string, fields: { sandboxLevel?: number }): PermissionProfileRow | null {
    if (fields.sandboxLevel !== undefined) {
      this.raw.prepare(`UPDATE permission_profiles SET sandbox_level = ? WHERE id = ?`).run(fields.sandboxLevel, id)
    }
    return this.getProfile(id)
  }

  deleteProfile(id: string): boolean {
    return this.deleteById(id)
  }

  listRules(profileId: string): PermissionRuleRow[] {
    return this.raw.prepare(
      `SELECT * FROM permission_rules WHERE profile_id = ? ORDER BY sort_order`
    ).all(profileId) as PermissionRuleRow[]
  }

  upsertRule(params: { id: string; profileId: string; action: string; scope: string; mode: string; sortOrder?: number }): PermissionRuleRow {
    this.raw.prepare(
      `INSERT INTO permission_rules (id, profile_id, action, scope, mode, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, scope = excluded.scope`
    ).run(params.id, params.profileId, params.action, params.scope, params.mode, params.sortOrder ?? 0)
    return this.raw.prepare(`SELECT * FROM permission_rules WHERE id = ?`).get(params.id) as PermissionRuleRow
  }

  updateRuleMode(id: string, mode: string): void {
    this.raw.prepare(`UPDATE permission_rules SET mode = ? WHERE id = ?`).run(mode, id)
  }

  hasProfiles(): boolean {
    return this.count() > 0
  }
}
