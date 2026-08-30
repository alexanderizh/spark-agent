/**
 * @module settings.service
 *
 * Application Settings Service
 *
 * Business logic layer for reading/writing application settings.
 * Uses SettingsRepository for persistence with type-safe get/set operations.
 *
 * Settings are organized by category (e.g., "general", "appearance", "telemetry", "updates").
 * Each category has a single "data" key that stores the entire settings object as JSON.
 */

import { SettingsRepository } from '@spark/storage'

export class SettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  /**
   * Get a single setting value by category and key.
   * Returns null if the setting does not exist.
   */
  get(category: string, key: string): unknown | null {
    return this.repo.get(category, key)
  }

  /**
   * Set a setting value (upsert).
   */
  set(category: string, key: string, value: unknown): void {
    this.repo.set(category, key, value)
  }

  /**
   * Get all settings for a given category.
   * Returns a flat object mapping key -> value.
   */
  getByCategory(category: string): Record<string, unknown> {
    return this.repo.getByCategory(category)
  }

  /**
   * Get all settings across all categories.
   * Returns a nested object: { [category]: { [key]: value } }
   */
  getAll(): Record<string, Record<string, unknown>> {
    return this.repo.getAll()
  }

  /**
   * Delete a single setting.
   */
  delete(category: string, key: string): boolean {
    return this.repo.delete(category, key)
  }
}
