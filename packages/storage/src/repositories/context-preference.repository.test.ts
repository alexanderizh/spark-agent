/**
 * ContextPreferenceRepository unit tests
 *
 * Tests CRUD operations and the getOverrides helper for the context_preferences table.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '../database.js'
import { ContextPreferenceRepository } from './context-preference.repository.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('ContextPreferenceRepository', () => {
  let db: SparkDatabase
  let repo: ContextPreferenceRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-ctx-pref-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    const dbPath = join(testDir, 'test.db')
    db = new SparkDatabase(dbPath)
    db.runMigrations(join(process.cwd(), 'migrations'))
    repo = new ContextPreferenceRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('upsert + list', () => {
    it('should insert a new pin preference', () => {
      const row = repo.upsert({
        id: 'pref-1',
        workspaceId: 'ws-1',
        filePath: 'AGENTS.md',
        action: 'pin',
      })
      expect(row.workspace_id).toBe('ws-1')
      expect(row.file_path).toBe('AGENTS.md')
      expect(row.action).toBe('pin')
      expect(row.enabled).toBe(1)
    })

    it('should insert a new exclude preference', () => {
      const row = repo.upsert({
        id: 'pref-2',
        workspaceId: 'ws-1',
        filePath: '.cursorrules',
        action: 'exclude',
      })
      expect(row.action).toBe('exclude')
    })

    it('should upsert (update) an existing preference', () => {
      repo.upsert({ id: 'pref-1', workspaceId: 'ws-1', filePath: 'README.md', action: 'pin' })
      const updated = repo.upsert({ id: 'pref-1b', workspaceId: 'ws-1', filePath: 'README.md', action: 'exclude' })
      expect(updated.action).toBe('exclude')
      expect(updated.id).toBe('pref-1') // original id preserved on conflict
    })

    it('should list preferences filtered by workspace', () => {
      repo.upsert({ id: 'p1', workspaceId: 'ws-1', filePath: 'a.md', action: 'pin' })
      repo.upsert({ id: 'p2', workspaceId: 'ws-2', filePath: 'b.md', action: 'pin' })
      const ws1 = repo.list({ workspaceId: 'ws-1' })
      expect(ws1).toHaveLength(1)
      expect(ws1[0]!.file_path).toBe('a.md')
    })

    it('should list preferences filtered by action', () => {
      repo.upsert({ id: 'p1', workspaceId: 'ws-1', filePath: 'a.md', action: 'pin' })
      repo.upsert({ id: 'p2', workspaceId: 'ws-1', filePath: 'b.md', action: 'exclude' })
      const pins = repo.list({ workspaceId: 'ws-1', action: 'pin' })
      expect(pins).toHaveLength(1)
      expect(pins[0]!.action).toBe('pin')
    })

    it('should list only enabled preferences', () => {
      repo.upsert({ id: 'p1', workspaceId: 'ws-1', filePath: 'a.md', action: 'pin', enabled: true })
      repo.upsert({ id: 'p2', workspaceId: 'ws-1', filePath: 'b.md', action: 'exclude', enabled: false })
      const enabled = repo.list({ workspaceId: 'ws-1', enabledOnly: true })
      expect(enabled).toHaveLength(1)
      expect(enabled[0]!.file_path).toBe('a.md')
    })
  })

  describe('getByPath', () => {
    it('should find preference by workspace and path', () => {
      repo.upsert({ id: 'p1', workspaceId: 'ws-1', filePath: 'CLAUDE.md', action: 'pin' })
      const row = repo.getByPath('ws-1', 'CLAUDE.md')
      expect(row).not.toBeNull()
      expect(row!.action).toBe('pin')
    })

    it('should return null for non-existent path', () => {
      expect(repo.getByPath('ws-1', 'nope.md')).toBeNull()
    })
  })

  describe('delete', () => {
    it('should delete a preference by id', () => {
      repo.upsert({ id: 'p1', workspaceId: 'ws-1', filePath: 'a.md', action: 'pin' })
      expect(repo.delete('p1')).toBe(true)
      expect(repo.getByPath('ws-1', 'a.md')).toBeNull()
    })

    it('should return false for non-existent id', () => {
      expect(repo.delete('nonexistent')).toBe(false)
    })
  })

  describe('deleteByWorkspace', () => {
    it('should delete all preferences for a workspace', () => {
      repo.upsert({ id: 'p1', workspaceId: 'ws-1', filePath: 'a.md', action: 'pin' })
      repo.upsert({ id: 'p2', workspaceId: 'ws-1', filePath: 'b.md', action: 'exclude' })
      repo.upsert({ id: 'p3', workspaceId: 'ws-2', filePath: 'c.md', action: 'pin' })
      const count = repo.deleteByWorkspace('ws-1')
      expect(count).toBe(2)
      expect(repo.list({ workspaceId: 'ws-1' })).toHaveLength(0)
      expect(repo.list({ workspaceId: 'ws-2' })).toHaveLength(1)
    })
  })

  describe('getOverrides', () => {
    it('should return pinned and excluded path sets', () => {
      repo.upsert({ id: 'p1', workspaceId: 'ws-1', filePath: 'AGENTS.md', action: 'pin' })
      repo.upsert({ id: 'p2', workspaceId: 'ws-1', filePath: 'CLAUDE.md', action: 'pin' })
      repo.upsert({ id: 'p3', workspaceId: 'ws-1', filePath: '.cursorrules', action: 'exclude' })
      const { pinnedPaths, excludedPaths } = repo.getOverrides('ws-1')
      expect(pinnedPaths).toEqual(new Set(['AGENTS.md', 'CLAUDE.md']))
      expect(excludedPaths).toEqual(new Set(['.cursorrules']))
    })

    it('should only include enabled preferences', () => {
      repo.upsert({ id: 'p1', workspaceId: 'ws-1', filePath: 'a.md', action: 'pin', enabled: true })
      repo.upsert({ id: 'p2', workspaceId: 'ws-1', filePath: 'b.md', action: 'pin', enabled: false })
      const { pinnedPaths } = repo.getOverrides('ws-1')
      expect(pinnedPaths).toEqual(new Set(['a.md']))
    })

    it('should return empty sets for workspace with no preferences', () => {
      const { pinnedPaths, excludedPaths } = repo.getOverrides('ws-unknown')
      expect(pinnedPaths.size).toBe(0)
      expect(excludedPaths.size).toBe(0)
    })
  })
})
