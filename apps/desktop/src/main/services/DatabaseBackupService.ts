import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'

const DATABASE_SUFFIXES = ['', '-wal', '-shm'] as const
const BACKUP_PREFIX = 'pre-migration-v'

export interface DatabaseBackupSnapshot {
  directory: string
  databasePath: string
  appVersion: string
  createdAt: string
  files: string[]
  createdThisStartup: boolean
}

interface EnsureDatabaseBackupOptions {
  databasePath: string
  backupRoot: string
  appVersion: string
  maxBackups?: number
  now?: Date
}

function safeVersion(version: string): string {
  return version.trim().replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

function backupDirectory(backupRoot: string, appVersion: string): string {
  return join(backupRoot, `${BACKUP_PREFIX}${safeVersion(appVersion)}`)
}

async function readSnapshot(
  directory: string,
  createdThisStartup: boolean,
): Promise<DatabaseBackupSnapshot | null> {
  try {
    const raw = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as Partial<DatabaseBackupSnapshot>
    if (
      typeof raw.databasePath !== 'string' ||
      typeof raw.appVersion !== 'string' ||
      typeof raw.createdAt !== 'string' ||
      !Array.isArray(raw.files)
    ) return null
    return {
      directory,
      databasePath: raw.databasePath,
      appVersion: raw.appVersion,
      createdAt: raw.createdAt,
      files: raw.files.filter((file): file is string => typeof file === 'string'),
      createdThisStartup,
    }
  } catch {
    return null
  }
}

export async function ensurePreMigrationBackup(
  options: EnsureDatabaseBackupOptions,
): Promise<DatabaseBackupSnapshot | null> {
  if (!existsSync(options.databasePath)) return null

  const directory = backupDirectory(options.backupRoot, options.appVersion)
  const existing = await readSnapshot(directory, false)
  if (existing != null) return existing

  await mkdir(options.backupRoot, { recursive: true })
  const temporaryDirectory = `${directory}.tmp-${process.pid}-${Date.now()}`
  await rm(temporaryDirectory, { recursive: true, force: true })
  await mkdir(temporaryDirectory, { recursive: true })

  try {
    const files: string[] = []
    for (const suffix of DATABASE_SUFFIXES) {
      const source = `${options.databasePath}${suffix}`
      if (!existsSync(source)) continue
      const targetName = basename(source)
      await copyFile(source, join(temporaryDirectory, targetName))
      files.push(targetName)
    }
    const snapshot: DatabaseBackupSnapshot = {
      directory,
      databasePath: options.databasePath,
      appVersion: options.appVersion,
      createdAt: (options.now ?? new Date()).toISOString(),
      files,
      createdThisStartup: true,
    }
    await writeFile(
      join(temporaryDirectory, 'manifest.json'),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
    await rename(temporaryDirectory, directory)
    await pruneDatabaseBackups(options.backupRoot, options.maxBackups ?? 5)
    return snapshot
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
    // 同时启动时另一实例可能已完成同版本备份；优先复用完整快照。
    const raced = await readSnapshot(directory, false)
    if (raced != null) return raced
    throw error
  }
}

export async function restoreDatabaseBackup(snapshot: DatabaseBackupSnapshot): Promise<void> {
  for (const suffix of DATABASE_SUFFIXES) {
    await rm(`${snapshot.databasePath}${suffix}`, { force: true })
  }
  for (const file of snapshot.files) {
    const suffix = file.endsWith('-wal') ? '-wal' : file.endsWith('-shm') ? '-shm' : ''
    await copyFile(join(snapshot.directory, file), `${snapshot.databasePath}${suffix}`)
  }
}

async function pruneDatabaseBackups(backupRoot: string, maxBackups: number): Promise<void> {
  if (maxBackups < 1) return
  const entries = await readdir(backupRoot, { withFileTypes: true })
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(BACKUP_PREFIX) && !entry.name.includes('.tmp-'))
    .map(async (entry) => ({
      path: join(backupRoot, entry.name),
      mtimeMs: (await stat(join(backupRoot, entry.name))).mtimeMs,
    })))
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  await Promise.all(candidates.slice(maxBackups).map((entry) => rm(entry.path, { recursive: true, force: true })))
}
