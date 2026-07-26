import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensurePreMigrationBackup, restoreDatabaseBackup } from '../DatabaseBackupService.js'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'spark-db-backup-'))
  roots.push(root)
  return root
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
})
