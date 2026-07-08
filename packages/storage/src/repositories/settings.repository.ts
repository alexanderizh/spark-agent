/**
 * @module settings.repository
 *
 * Application Settings Repository
 *
 * Key-value store for user settings grouped by category.
 * Each setting is stored as a JSON string in the `value` column.
 * Uses composite primary key (category, key) for efficient lookups.
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface SettingsRow {
  category: string
  key: string
  value: string
  updated_at: string
}

export class SettingsRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'app_settings')
  }

  /**
   * Get a single setting value by category and key.
   * Returns the parsed JSON value, or null if not found.
   */
  get(category: string, key: string): unknown | null {
    const stmt = this.raw.prepare(
      `SELECT value FROM ${this.tableName} WHERE category = ? AND key = ?`,
    )
    const row = stmt.get(category, key) as { value: string } | undefined
    if (row == null) return null
    return this.fromJson(row.value, null)
  }

  /**
   * Set a setting value (upsert).
   * If the setting already exists, it is updated; otherwise, a new row is inserted.
   */
  set(category: string, key: string, value: unknown): void {
    const now = new Date().toISOString()
    const json = this.toJson(value)
    const stmt = this.raw.prepare(`
      INSERT INTO ${this.tableName} (category, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(category, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    stmt.run(category, key, json, now)
  }

  /**
   * Get all settings for a given category.
   * Returns an object mapping key -> parsed value.
   */
  getByCategory(category: string): Record<string, unknown> {
    const stmt = this.raw.prepare(
      `SELECT key, value FROM ${this.tableName} WHERE category = ?`,
    )
    const rows = stmt.all(category) as Array<{ key: string; value: string }>
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      result[row.key] = this.fromJson(row.value, null)
    }
    return result
  }

  /**
   * Get all settings across all categories.
   * Returns a nested object: { [category]: { [key]: value } }
   */
  getAll(): Record<string, Record<string, unknown>> {
    const stmt = this.raw.prepare(
      `SELECT category, key, value FROM ${this.tableName}`,
    )
    const rows = stmt.all() as Array<{ category: string; key: string; value: string }>
    const result: Record<string, Record<string, unknown>> = {}
    for (const row of rows) {
      if (result[row.category] == null) {
        result[row.category] = {}
      }
      result[row.category]![row.key] = this.fromJson(row.value, null)
    }
    return result
  }

  /**
   * Delete a single setting by category and key.
   */
  delete(category: string, key: string): boolean {
    const stmt = this.raw.prepare(
      `DELETE FROM ${this.tableName} WHERE category = ? AND key = ?`,
    )
    const result = stmt.run(category, key)
    return result.changes > 0
  }

  /**
   * Delete all settings in a category.
   */
  deleteByCategory(category: string): number {
    const stmt = this.raw.prepare(
      `DELETE FROM ${this.tableName} WHERE category = ?`,
    )
    const result = stmt.run(category)
    return result.changes
  }
}
