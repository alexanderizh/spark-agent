/**
 * @module memory-entity.repository.test
 *
 * 真实 DB 单测：实体规范化、落库去重、一跳扩展检索。
 * 需 better-sqlite3 Node ABI（见 storage-tests-better-sqlite3-abi 记忆）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase, MemoryRepository, MemoryEntityRepository, normalizeEntityName } from '@spark/storage'
import type { MemoryEntryInsert } from '@spark/storage'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('MemoryEntityRepository', () => {
  let db: SparkDatabase
  let memRepo: MemoryRepository
  let entRepo: MemoryEntityRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-ent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    memRepo = new MemoryRepository(db)
    entRepo = new MemoryEntityRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  // raw 查询 helper（better-sqlite3 .get/.all 返回 unknown，cast 在此集中处理）
  const countLinks = (memoryId: string): number =>
    (db.raw.prepare('SELECT COUNT(*) c FROM memory_entity_link WHERE memory_id=?').get(memoryId) as { c: number }).c
  const countEntities = (): number =>
    (db.raw.prepare('SELECT COUNT(*) c FROM memory_entity').get() as { c: number }).c
  const countEntitiesByNorm = (norm: string): number =>
    (db.raw.prepare('SELECT COUNT(*) c FROM memory_entity WHERE normalized_name=?').get(norm) as { c: number }).c
  const linkedNames = (memoryId: string): string[] =>
    (db.raw
      .prepare('SELECT e.normalized_name n FROM memory_entity_link l JOIN memory_entity e ON e.id=l.entity_id WHERE l.memory_id=?')
      .all(memoryId) as Array<{ n: string }>).map((r) => r.n)
  const entityNorms = (): string[] =>
    (db.raw.prepare('SELECT normalized_name FROM memory_entity WHERE scope = ?').all('user') as Array<{ normalized_name: string }>).map((r) => r.normalized_name)

  let seq = 0
  function makeEntry(overrides: Partial<MemoryEntryInsert> = {}): MemoryEntryInsert {
    seq += 1
    return {
      id: `usr_e${seq}`,
      scope: 'user',
      scope_ref: null,
      type: 'user',
      name: `entry-${seq}`,
      description: `desc ${seq}`,
      file_path: `/tmp/e${seq}.md`,
      confidence: 0.9,
      hit_count: 0,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
      ...overrides,
    }
  }

  describe('normalizeEntityName', () => {
    it('lowercase + trim + whitespace fold (non-alias name)', () => {
      expect(normalizeEntityName('  My   Custom   Framework ')).toBe('my custom framework')
    })
    it('alias mapping', () => {
      expect(normalizeEntityName('Arco Design')).toBe('arco')
      expect(normalizeEntityName('@arco-design/web-react')).toBe('arco')
      expect(normalizeEntityName('React.js')).toBe('react')
      expect(normalizeEntityName('TypeScript')).toBe('ts')
    })
    it('no alias → lowercase only', () => {
      expect(normalizeEntityName('Vite')).toBe('vite')
    })
    it('empty → empty', () => {
      expect(normalizeEntityName('   ')).toBe('')
    })
  })

  describe('upsertEntitiesForMemory', () => {
    it('normalizes + dedups entities within scope (same normalized → one row)', () => {
      const a = memRepo.insert(makeEntry())
      entRepo.upsertEntitiesForMemory(a.id, 'user', null, ['Arco Design', 'arco design', 'VITE', 'vite'])
      expect(entityNorms().sort()).toEqual(['arco', 'vite'])
    })

    it('links memory to entities; re-call replaces links (full refresh)', () => {
      const a = memRepo.insert(makeEntry())
      entRepo.upsertEntitiesForMemory(a.id, 'user', null, ['React', 'Vite'])
      expect(countLinks(a.id)).toBe(2)

      // 换一组实体：旧链接清除，新链接建立
      entRepo.upsertEntitiesForMemory(a.id, 'user', null, ['Vite', 'Webpack'])
      expect(linkedNames(a.id).sort()).toEqual(['vite', 'webpack'])
    })

    it('empty names → clears links, creates no entities', () => {
      const a = memRepo.insert(makeEntry())
      entRepo.upsertEntitiesForMemory(a.id, 'user', null, ['React'])
      entRepo.upsertEntitiesForMemory(a.id, 'user', null, [])
      expect(countLinks(a.id)).toBe(0)
    })

    it('same normalized name across two memories → one entity row, two links', () => {
      const a = memRepo.insert(makeEntry())
      const b = memRepo.insert(makeEntry())
      entRepo.upsertEntitiesForMemory(a.id, 'user', null, ['Arco Design'])
      entRepo.upsertEntitiesForMemory(b.id, 'user', null, ['arco design']) // 同 normalized
      expect(countEntitiesByNorm('arco')).toBe(1)
    })
  })

  describe('findRelated (one-hop)', () => {
    it('memories sharing an entity are related', () => {
      const a = memRepo.insert(makeEntry({ description: '用 Arco 做的 UI' }))
      const b = memRepo.insert(makeEntry({ description: 'Arco 的另一个用法' }))
      const c = memRepo.insert(makeEntry({ description: '完全无关，用 Vite' }))
      entRepo.upsertEntitiesForMemory(a.id, 'user', null, ['Arco Design'])
      entRepo.upsertEntitiesForMemory(b.id, 'user', null, ['Arco Design'])
      entRepo.upsertEntitiesForMemory(c.id, 'user', null, ['Vite'])

      const related = entRepo.findRelated(a.id, 5)
      expect(related.map((r) => r.id)).toContain(b.id)
      expect(related.map((r) => r.id)).not.toContain(c.id)
      expect(related.map((r) => r.id)).not.toContain(a.id) // 排除自身
    })

    it('excludes archived + invalidated entries', () => {
      const a = memRepo.insert(makeEntry())
      const archived = memRepo.insert(makeEntry())
      const invalidated = memRepo.insert(makeEntry())
      entRepo.upsertEntitiesForMemory(a.id, 'user', null, ['React'])
      entRepo.upsertEntitiesForMemory(archived.id, 'user', null, ['React'])
      entRepo.upsertEntitiesForMemory(invalidated.id, 'user', null, ['React'])
      memRepo.archive(archived.id)
      memRepo.update(invalidated.id, { invalid_at: Date.now() })

      expect(entRepo.findRelated(a.id, 5)).toHaveLength(0)
    })

    it('respects limit', () => {
      const a = memRepo.insert(makeEntry())
      const others = Array.from({ length: 5 }, () => memRepo.insert(makeEntry()))
      for (const o of others) entRepo.upsertEntitiesForMemory(o.id, 'user', null, ['React'])
      entRepo.upsertEntitiesForMemory(a.id, 'user', null, ['React'])
      expect(entRepo.findRelated(a.id, 2)).toHaveLength(2)
    })
  })

  it('clearLinksForMemory removes links without deleting entities', () => {
    const a = memRepo.insert(makeEntry())
    entRepo.upsertEntitiesForMemory(a.id, 'user', null, ['React'])
    entRepo.clearLinksForMemory(a.id)
    expect(countLinks(a.id)).toBe(0)
    expect(countEntities()).toBe(1) // 实体仍在
  })
})
