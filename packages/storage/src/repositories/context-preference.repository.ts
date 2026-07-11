/**
 * @module context-preference.repository
 *
 * Context Governor file pin/exclude preferences persistence.
 *
 * Each row represents a user override for a specific file path within a workspace:
 *   - "pin"    → always include this file in context discovery
 *   - "exclude" → never include this file in context discovery
 *
 * The UNIQUE constraint on (workspace_id, file_path) ensures one action per file.
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface ContextPreferenceRow {
  id: string
  workspace_id: string
  file_path: string
  action: 'pin' | 'exclude'
  enabled: number
  created_at: string
  updated_at: string
}

export interface UpsertContextPreferenceParams {
  id: string
  workspaceId: string
  filePath: string
  action: 'pin' | 'exclude'
  enabled?: boolean
}

export interface ListContextPreferencesParams {
  workspaceId: string
  action?: 'pin' | 'exclude'
  enabledOnly?: boolean
}

export class ContextPreferenceRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'context_preferences')
  }

  list(params: ListContextPreferencesParams): ContextPreferenceRow[] {
    const conditions: string[] = ['workspace_id = ?']
    const values: unknown[] = [params.workspaceId]

    if (params.action !== undefined) {
      conditions.push('action = ?')
      values.push(params.action)
    }
    if (params.enabledOnly === true) {
      conditions.push('enabled = 1')
    }

    const where = `WHERE ${conditions.join(' AND ')}`
    return this.raw
      .prepare(`SELECT * FROM context_preferences ${where} ORDER BY file_path ASC`)
      .all(...values) as ContextPreferenceRow[]
  }

  getById(id: string): ContextPreferenceRow | null {
    return this.findById<ContextPreferenceRow>(id)
  }

  getByPath(workspaceId: string, filePath: string): ContextPreferenceRow | null {
    return (
      (this.raw
        .prepare('SELECT * FROM context_preferences WHERE workspace_id = ? AND file_path = ?')
        .get(workspaceId, filePath) as ContextPreferenceRow | undefined) ?? null
    )
  }

  /**
   * Insert or update a preference (upsert by workspace_id + file_path).
   */
  upsert(params: UpsertContextPreferenceParams): ContextPreferenceRow {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO context_preferences (id, workspace_id, file_path, action, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, file_path) DO UPDATE SET
           action = excluded.action,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run(
        params.id,
        params.workspaceId,
        params.filePath,
        params.action,
        (params.enabled ?? true) ? 1 : 0,
        now,
        now,
      )
    return this.getByPath(params.workspaceId, params.filePath)!
  }

  delete(id: string): boolean {
    return super.deleteById(id)
  }

  /**
   * Delete all preferences for a workspace.
   */
  deleteByWorkspace(workspaceId: string): number {
    const result = this.raw
      .prepare('DELETE FROM context_preferences WHERE workspace_id = ?')
      .run(workspaceId)
    return result.changes
  }

  /**
   * Get the pinned and excluded file paths for a workspace as two sets.
   */
  getOverrides(workspaceId: string): { pinnedPaths: Set<string>; excludedPaths: Set<string> } {
    const rows = this.list({ workspaceId, enabledOnly: true })
    const pinnedPaths = new Set<string>()
    const excludedPaths = new Set<string>()
    for (const row of rows) {
      if (row.action === 'pin') pinnedPaths.add(row.file_path)
      else excludedPaths.add(row.file_path)
    }
    return { pinnedPaths, excludedPaths }
  }
}
