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

export interface PermissionDecisionRow {
  id: string
  scope: 'project' | 'global'
  project_id: string | null
  workspace_ids_json: string | null
  action: string
  tool_name: string
  decision: 'allow' | 'deny'
  created_at: string
  updated_at: string
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
      CREATE TABLE IF NOT EXISTS permission_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS permission_decisions (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
        project_id TEXT,
        workspace_ids_json TEXT,
        action TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_permission_decisions_lookup
        ON permission_decisions(scope, project_id, action, tool_name, updated_at);
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

  getSetting(key: string): string | null {
    const row = this.raw.prepare(`SELECT value FROM permission_settings WHERE key = ?`).get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.raw.prepare(`
      INSERT INTO permission_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value)
  }

  upsertDecision(params: {
    id: string
    scope: 'project' | 'global'
    projectId?: string
    workspaceIds?: string[]
    action: string
    toolName: string
    decision: 'allow' | 'deny'
  }): PermissionDecisionRow {
    const workspaceIdsJson = params.workspaceIds != null ? this.toJson(params.workspaceIds) : null
    this.raw.prepare(`
      DELETE FROM permission_decisions
      WHERE scope = ?
        AND COALESCE(project_id, '') = COALESCE(?, '')
        AND action = ?
        AND tool_name = ?
    `).run(params.scope, params.projectId ?? null, params.action, params.toolName)

    this.raw.prepare(`
      INSERT INTO permission_decisions
        (id, scope, project_id, workspace_ids_json, action, tool_name, decision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(params.id, params.scope, params.projectId ?? null, workspaceIdsJson, params.action, params.toolName, params.decision)

    return this.raw.prepare(`SELECT * FROM permission_decisions WHERE id = ?`).get(params.id) as PermissionDecisionRow
  }

  findDecision(params: { projectId?: string; action: string; toolName: string }): PermissionDecisionRow | null {
    const rows = this.raw.prepare(`
      SELECT * FROM permission_decisions
      WHERE action = ?
        AND tool_name = ?
        AND (
          scope = 'global'
          OR (scope = 'project' AND project_id = ?)
        )
      ORDER BY
        CASE scope WHEN 'project' THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT 1
    `).all(params.action, params.toolName, params.projectId ?? null) as PermissionDecisionRow[]
    return rows[0] ?? null
  }

  hasProfiles(): boolean {
    return this.count() > 0
  }
}
