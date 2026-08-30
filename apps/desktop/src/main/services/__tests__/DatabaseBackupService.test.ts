import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_BACKUP_MAX_AGE_DAYS,
  DEFAULT_MAX_DATABASE_BACKUPS,
  ensurePreMigrationBackup,
  restoreDatabaseBackup,
} from '../DatabaseBackupService.js'

const DAY_MS = 24 * 60 * 60 * 1000

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'spark-db-backup-'))
  roots.push(root)
  return root
}

function createLegacyBackup(backupRoot: string, name: string, mtime: Date): void {
  const directory = join(backupRoot, name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'manifest.json'), '{}', 'utf8')
  writeFileSync(join(directory, 'spark.db'), 'legacy payload', 'utf8')
  utimesSync(directory, mtime, mtime)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('DatabaseBackupService', () => {
  it('copies the database and WAL companions once per app version', async () => {
    const root = tempRoot()
    const databasePath = join(root, 'spark.db')
    writeFileSync(databasePath, 'database-v1')
    writeFileSync(`${databasePath}-wal`, 'wal-v1')

    const first = await ensurePreMigrationBackup({
      databasePath,
      backupRoot: join(root, 'backups'),
      appVersion: '0.8.0',
      now: new Date('2026-07-26T00:00:00.000Z'),
    })
    writeFileSync(databasePath, 'database-after-migration')
    const second = await ensurePreMigrationBackup({
      databasePath,
      backupRoot: join(root, 'backups'),
      appVersion: '0.8.0',
    })

    expect(first?.createdThisStartup).toBe(true)
    expect(second?.createdThisStartup).toBe(false)
    expect(readFileSync(join(first!.directory, 'spark.db'), 'utf8')).toBe('database-v1')
    expect(readFileSync(join(first!.directory, 'spark.db-wal'), 'utf8')).toBe('wal-v1')
  })

  it('restores the exact pre-migration database set after a failed upgrade', async () => {
    const root = tempRoot()
    const databasePath = join(root, 'spark.db')
    writeFileSync(databasePath, 'healthy')
    const snapshot = await ensurePreMigrationBackup({
      databasePath,
      backupRoot: join(root, 'backups'),
      appVersion: '0.8.1',
    })
    writeFileSync(databasePath, 'partially-migrated')
    writeFileSync(`${databasePath}-shm`, 'stale')

    await restoreDatabaseBackup(snapshot!)

    expect(readFileSync(databasePath, 'utf8')).toBe('healthy')
    expect(existsSync(`${databasePath}-shm`)).toBe(false)
  })

  it('prunes backups beyond the retention count, keeping the newest ones', async () => {
    const root = tempRoot()
    const backupRoot = join(root, 'backups')
    const databasePath = join(root, 'spark.db')
    writeFileSync(databasePath, 'database')
    const now = new Date()
    createLegacyBackup(backupRoot, 'pre-migration-v0.11.5', new Date(now.getTime() - 10 * DAY_MS))
    createLegacyBackup(backupRoot, 'pre-migration-v0.11.8', new Date(now.getTime() - 5 * DAY_MS))
    createLegacyBackup(backupRoot, 'pre-migration-v0.11.9', new Date(now.getTime() - 1 * DAY_MS))

    await ensurePreMigrationBackup({ databasePath, backupRoot, appVersion: '0.11.12', now })

    expect(readdirSync(backupRoot).sort()).toEqual(['pre-migration-v0.11.12', 'pre-migration-v0.11.9'])
    expect(DEFAULT_MAX_DATABASE_BACKUPS).toBe(2)
  })

  it('prunes backups older than the retention window even below the count limit', async () => {
    const root = tempRoot()
    const backupRoot = join(root, 'backups')
    const databasePath = join(root, 'spark.db')
    writeFileSync(databasePath, 'database')
    const now = new Date()
    createLegacyBackup(
      backupRoot,
      'pre-migration-v0.8.5',
      new Date(now.getTime() - (DEFAULT_BACKUP_MAX_AGE_DAYS + 1) * DAY_MS),
    )

    await ensurePreMigrationBackup({ databasePath, backupRoot, appVersion: '0.11.12', now })

    expect(readdirSync(backupRoot)).toEqual(['pre-migration-v0.11.12'])
  })

  it('recycles stale .tmp- leftovers but keeps recent ones from concurrent startups', async () => {
    const root = tempRoot()
    const backupRoot = join(root, 'backups')
    const databasePath = join(root, 'spark.db')
    writeFileSync(databasePath, 'database')
    const now = new Date()
    const staleTmp = join(backupRoot, 'pre-migration-v0.8.5.tmp-48766-1785157236939')
    mkdirSync(staleTmp, { recursive: true })
    utimesSync(staleTmp, new Date(now.getTime() - 3 * DAY_MS), new Date(now.getTime() - 3 * DAY_MS))
    const freshTmp = join(backupRoot, 'pre-migration-v0.11.12.tmp-3002-1787799995248')
    mkdirSync(freshTmp, { recursive: true })

    await ensurePreMigrationBackup({ databasePath, backupRoot, appVersion: '0.11.12', now })

    const remaining = readdirSync(backupRoot).sort()
    expect(remaining).toContain('pre-migration-v0.11.12')
    expect(remaining).toContain('pre-migration-v0.11.12.tmp-3002-1787799995248')
    expect(remaining).not.toContain('pre-migration-v0.8.5.tmp-48766-1785157236939')
  })

  it('prunes stale backups even when the current version snapshot is reused', async () => {
    const root = tempRoot()
    const backupRoot = join(root, 'backups')
    const databasePath = join(root, 'spark.db')
    writeFileSync(databasePath, 'database')
    await ensurePreMigrationBackup({ databasePath, backupRoot, appVersion: '0.11.12' })
    const now = new Date()
    createLegacyBackup(
      backupRoot,
      'pre-migration-v0.9.0',
      new Date(now.getTime() - (DEFAULT_BACKUP_MAX_AGE_DAYS + 5) * DAY_MS),
    )

    await ensurePreMigrationBackup({ databasePath, backupRoot, appVersion: '0.11.12', now })

    expect(readdirSync(backupRoot)).toEqual(['pre-migration-v0.11.12'])
  })
})
