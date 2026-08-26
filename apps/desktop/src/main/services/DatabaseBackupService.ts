import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'

const DATABASE_SUFFIXES = ['', '-wal', '-shm'] as const
const BACKUP_PREFIX = 'pre-migration-v'
/** 每个版本首次启动做一次全量备份，单份约等于数据库体积；2 份 = 当前版本 + 上一版本 */
export const DEFAULT_MAX_DATABASE_BACKUPS = 2
/** 备份保留天数：迁移问题一般在升级后短时间内暴露，超期即回收 */
export const DEFAULT_BACKUP_MAX_AGE_DAYS = 14
/** 崩溃残留的 .tmp- 目录回收下限；更近的可能属于并发启动实例 */
const STALE_TMP_DIRECTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000

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
  maxAgeDays?: number
  now?: Date
}

interface PruneDatabaseBackupsOptions {
  maxBackups: number
  maxAgeDays: number
  now: Date
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
  if (existing != null) {
    await safePruneDatabaseBackups(options.backupRoot, options)
    return existing
  }

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
    await safePruneDatabaseBackups(options.backupRoot, options)
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

/**
 * 清理历史迁移备份：
 *   - 超过 maxAgeDays 的整份回收（无论数量）；
 *   - 其余按 mtime 从新到旧只保留 maxBackups 份；
 *   - 崩溃残留的 .tmp- 目录超过 24h 直接回收（近期的可能属于并发启动实例）。
 * 清理是尽力而为：失败不影响启动与备份流程。
 */
export async function pruneDatabaseBackups(
  backupRoot: string,
  options: PruneDatabaseBackupsOptions,
): Promise<void> {
  const { maxBackups, maxAgeDays, now } = options
  if (maxBackups < 1) return
  const entries = await readdir(backupRoot, { withFileTypes: true })
  const tmpDirectories: Array<{ path: string; mtimeMs: number }> = []
  const candidates: Array<{ path: string; mtimeMs: number }> = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(BACKUP_PREFIX)) continue
    const path = join(backupRoot, entry.name)
    try {
      const mtimeMs = (await stat(path)).mtimeMs
      if (entry.name.includes('.tmp-')) tmpDirectories.push({ path, mtimeMs })
      else candidates.push({ path, mtimeMs })
    } catch {
      // 枚举后被删除等竞态：跳过
    }
  }

  const staleTmpCutoff = now.getTime() - STALE_TMP_DIRECTORY_MAX_AGE_MS
  // maxAgeDays < 1 视为不限期，避免误传 0 时把刚创建的备份也按超龄回收
  const ageCutoff = maxAgeDays >= 1 ? now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000 : Number.NEGATIVE_INFINITY
  const toDelete = tmpDirectories.filter((entry) => entry.mtimeMs < staleTmpCutoff)
  toDelete.push(...candidates.filter((entry) => entry.mtimeMs < ageCutoff))

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  const kept = candidates.filter((entry) => entry.mtimeMs >= ageCutoff)
  toDelete.push(...kept.slice(maxBackups))

  await Promise.all(toDelete.map((entry) => rm(entry.path, { recursive: true, force: true })))
}

async function safePruneDatabaseBackups(
  backupRoot: string,
  options: EnsureDatabaseBackupOptions,
): Promise<void> {
  try {
    await pruneDatabaseBackups(backupRoot, {
      maxBackups: options.maxBackups ?? DEFAULT_MAX_DATABASE_BACKUPS,
      maxAgeDays: options.maxAgeDays ?? DEFAULT_BACKUP_MAX_AGE_DAYS,
      now: options.now ?? new Date(),
    })
  } catch {
    // 清理失败不影响备份与启动
  }
}
