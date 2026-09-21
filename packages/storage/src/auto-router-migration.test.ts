/**
 * Migration 102（旧 Auto Router 路由卡废弃清理）专项测试：
 * kind='router' 的 model_profiles 被停用（enabled=0），普通模型卡不受影响，
 * 且不生成任何新 provider 行（废弃清理策略，非自动转换）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from './database.js'
import { join } from 'path'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

function applyMigrationsThrough(
  db: SparkDatabase,
  migrationsDir: string,
  maxVersion: number,
): void {
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  const insertMigration = db.raw.prepare(
    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
  )
  const applied = new Set(
    (
      db.raw.prepare(`SELECT version FROM schema_migrations`).all() as Array<{ version: number }>
    ).map((row) => row.version),
  )
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  for (const name of files) {
    const version = Number.parseInt(name, 10)
    if (!Number.isFinite(version) || version > maxVersion || applied.has(version)) continue
    db.raw.exec(readFileSync(join(migrationsDir, name), 'utf8'))
    insertMigration.run(version, name)
  }
}

describe('migration 102: deprecate legacy auto router cards', () => {
  let db: SparkDatabase
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-ar-migration-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
  })

  afterEach(() => {
    if (db != null) db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  function insertModelProfile(id: string, providerId: string, config: object, enabled = 1): void {
    db.raw
      .prepare(
        `INSERT INTO model_profiles (id, provider_id, name, config_json, enabled) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, providerId, id, JSON.stringify(config), enabled)
  }

  it('停用启用的 kind=router 路由卡，普通模型卡保持原状', () => {
    applyMigrationsThrough(db, join(process.cwd(), 'migrations'), 101)
    insertModelProfile('route-1', 'claude-auto-router', {
      kind: 'router',
      adapter: 'claude',
      candidates: { default: { providerProfileId: 'p1', modelId: 'm1' } },
    })
    insertModelProfile('route-2', 'codex-auto-router', { kind: 'router', adapter: 'codex' })
    // 已停用的 router 卡不应被 UPDATE 触碰（幂等）
    insertModelProfile('route-disabled', 'claude-auto-router', { kind: 'router' }, 0)
    // 普通模型卡不受影响
    insertModelProfile('plain-1', 'p1', { defaultModel: 'm1', modelIds: ['m1'] })

    applyMigrationsThrough(db, join(process.cwd(), 'migrations'), 102)

    const rows = db.raw
      .prepare(`SELECT id, enabled FROM model_profiles ORDER BY id`)
      .all() as Array<{ id: string; enabled: number }>
    const byId = new Map(rows.map((row) => [row.id, row.enabled]))
    expect(byId.get('route-1')).toBe(0)
    expect(byId.get('route-2')).toBe(0)
    expect(byId.get('route-disabled')).toBe(0)
    expect(byId.get('plain-1')).toBe(1)
  })

  it('不生成任何新 provider 行（废弃清理而非自动转换）', () => {
    applyMigrationsThrough(db, join(process.cwd(), 'migrations'), 101)
    insertModelProfile('route-1', 'claude-auto-router', { kind: 'router', adapter: 'claude' })

    const before = (
      db.raw.prepare(`SELECT COUNT(*) AS n FROM provider_profiles`).get() as { n: number }
    ).n
    applyMigrationsThrough(db, join(process.cwd(), 'migrations'), 102)
    const after = (
      db.raw.prepare(`SELECT COUNT(*) AS n FROM provider_profiles`).get() as { n: number }
    ).n

    expect(before).toBe(0)
    expect(after).toBe(0)
  })

  it('对新装库（无任何路由卡）幂等安全', () => {
    expect(() => applyMigrationsThrough(db, join(process.cwd(), 'migrations'), 102)).not.toThrow()
  })
})
