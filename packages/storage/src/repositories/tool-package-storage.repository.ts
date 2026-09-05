import type { SparkDatabase } from '../database.js'
import { BaseRepository } from './base.repository.js'

export interface ToolPackageStorageEntry {
  key: string
  value: unknown
  updatedAt: string
}

export class ToolPackageStorageRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'tool_package_storage_kv')
  }

  get(packageId: string, key: string): ToolPackageStorageEntry | undefined {
    const row = this.raw
      .prepare(
        'SELECT key, value_json, updated_at FROM tool_package_storage_kv WHERE package_id = ? AND key = ?',
      )
      .get(packageId, key) as { key: string; value_json: string; updated_at: string } | undefined
    return row == null
      ? undefined
      : { key: row.key, value: this.fromJson(row.value_json, null), updatedAt: row.updated_at }
  }

  set(packageId: string, key: string, value: unknown): ToolPackageStorageEntry {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO tool_package_storage_kv(package_id, key, value_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(package_id, key) DO UPDATE SET
           value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(packageId, key, this.toJson(value), now)
    return this.get(packageId, key)!
  }

  delete(packageId: string, key: string): boolean {
    return (
      this.raw
        .prepare('DELETE FROM tool_package_storage_kv WHERE package_id = ? AND key = ?')
        .run(packageId, key).changes > 0
    )
  }

  list(packageId: string, prefix = '', limit = 100): ToolPackageStorageEntry[] {
    const rows = this.raw
      .prepare(
        `SELECT key, value_json, updated_at FROM tool_package_storage_kv
         WHERE package_id = ? AND key LIKE ? ESCAPE '\\'
         ORDER BY key ASC LIMIT ?`,
      )
      .all(packageId, `${escapeLike(prefix)}%`, Math.min(500, Math.max(1, limit))) as Array<{
      key: string
      value_json: string
      updated_at: string
    }>
    return rows.map((row) => ({
      key: row.key,
      value: this.fromJson(row.value_json, null),
      updatedAt: row.updated_at,
    }))
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}
