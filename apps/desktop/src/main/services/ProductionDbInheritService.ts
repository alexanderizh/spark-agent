/**
 * @module ProductionDbInheritService
 *
 * dev 沙箱实例「继承安装版数据」：把安装版 SparkWork 的 spark.db 做一致性快照
 * （SQLite Online Backup API，安装版运行中也可安全导入），替换当前 dev 沙箱库，
 * 重启后生效。安装版数据只读、永不被 dev 改动；可重复执行以同步安装版最新数据。
 *
 * 两段式流程（文件操作全部发生在数据库连接未打开的时机）：
 *   1. stage（设置页触发，运行中）：readonly 打开安装版库 → backup() 写
 *      `<userData>/spark.db.incoming` → 写 marker `<userData>/inherit-db.pending`
 *      → relaunch + 请求退出
 *   2. apply（下次启动、建库之前）：有 marker → 先把当前 db 三件套备份到
 *      backups/database/pre-inherit-* → 删旧三件套 → incoming rename 为 spark.db
 *      → 删 marker；任何失败仅告警并清除 marker，不阻塞启动
 *
 * 可用性：仅当当前 userData 为 `-dev` 后缀（dev 沙箱）且安装版目录存在 spark.db
 * 时可用；`SPARK_DATA_PROFILE=production` 下 userData 无 `-dev` 后缀，自动不可用。
 *
 * 凭据边界：Windows 下 provider API key 存 OS 凭据管理器（keytar 服务名全机共享），
 * 继承 db 后 Provider 配置直接可用；云端登录态不随 db 走，需在 dev 重新登录。
 */

import { app } from 'electron'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createLogger } from '@spark/shared'

const log = createLogger('production-db-inherit')

const INCOMING_DB_FILENAME = 'spark.db.incoming'
const MARKER_FILENAME = 'inherit-db.pending'
/** 与 DatabaseBackupService 的 DATABASE_SUFFIXES 保持一致：db / -wal / -shm 必须整组处理 */
const DATABASE_SUFFIXES = ['', '-wal', '-shm'] as const

interface InheritMarker {
  stagedAt: string
  sourcePath: string
  bytes: number
}

// ─── 退出请求注入（仿 UpdateService.onRequestQuit，避免 ipc ↔ index 循环依赖） ──

let quitRequester: (() => void) | null = null

/** 由 main/index.ts 装配：注入 requestApplicationQuit（走完整 before-quit 关闭链） */
export function setProductionDbInheritQuitRequester(fn: () => void): void {
  quitRequester = fn
}

// ─── 路径推导 ────────────────────────────────────────────────────────────────

function getUserDataDir(): string {
  return app.getPath('userData')
}

/** 当前是否运行在 dev 沙箱目录（applyDevUserData 的 -dev 后缀约定） */
function isDevUserData(userDataDir = getUserDataDir()): boolean {
  return path.basename(userDataDir).endsWith('-dev')
}

/** 安装版（生产）userData 目录：dev 目录去掉 -dev 后缀的兄弟目录 */
function productionUserDataDir(userDataDir = getUserDataDir()): string {
  const dir = path.basename(userDataDir)
  const base = dir.endsWith('-dev') ? dir.slice(0, -4) : dir
  return path.join(path.dirname(userDataDir), base)
}

function productionDbPath(userDataDir = getUserDataDir()): string {
  return path.join(productionUserDataDir(userDataDir), 'spark.db')
}

// ─── 查询 ────────────────────────────────────────────────────────────────────

export interface ProductionDbInheritInfo {
  available: boolean
  currentIsDev: boolean
  productionDbPath?: string
  productionDbSizeBytes?: number
  reason?: string
}

export function describeProductionDbInheritance(
  userDataDir = getUserDataDir(),
): ProductionDbInheritInfo {
  const currentIsDev = isDevUserData(userDataDir)
  if (!currentIsDev) {
    return { available: false, currentIsDev, reason: '当前实例未运行在 dev 沙箱数据目录' }
  }
  const prodDb = productionDbPath(userDataDir)
  if (!existsSync(prodDb)) {
    return {
      available: false,
      currentIsDev,
      reason: '未找到安装版数据目录中的 spark.db',
    }
  }
  let sizeBytes: number | undefined
  try {
    sizeBytes = statSync(prodDb).size
  } catch {
    sizeBytes = undefined
  }
  return {
    available: true,
    currentIsDev,
    productionDbPath: prodDb,
    ...(sizeBytes != null ? { productionDbSizeBytes: sizeBytes } : {}),
  }
}

// ─── stage：运行中生成快照并暂存 ─────────────────────────────────────────────

export interface StageProductionDbInheritanceOptions {
  /**
   * 一致性快照实现（默认 better-sqlite3 backup API：readonly 打开源库，
   * Online Backup 合并 WAL 写出单文件快照）。测试注入 raw copy 替身，
   * 避免单测加载原生模块（本机 Electron ABI 与 Node ABI 不一致）。
   */
  backupDatabase?: (sourcePath: string, destPath: string) => Promise<void>
  userDataDir?: string
}

export async function stageProductionDbInheritance(
  options: StageProductionDbInheritanceOptions = {},
): Promise<{ staged: true; incomingBytes: number }> {
  const userDataDir = options.userDataDir ?? getUserDataDir()
  const info = describeProductionDbInheritance(userDataDir)
  if (!info.available || info.productionDbPath == null) {
    throw new Error(info.reason ?? '当前环境不支持继承安装版数据')
  }

  const incomingPath = path.join(userDataDir, INCOMING_DB_FILENAME)
  const backup = options.backupDatabase ?? backupViaSqlite
  await backup(info.productionDbPath, incomingPath)

  const bytes = statSync(incomingPath).size
  const marker: InheritMarker = {
    stagedAt: new Date().toISOString(),
    sourcePath: info.productionDbPath,
    bytes,
  }
  await writeFile(path.join(userDataDir, MARKER_FILENAME), `${JSON.stringify(marker, null, 2)}\n`, {
    mode: 0o600,
  })
  log.info(`Staged production db snapshot: ${info.productionDbPath} -> ${incomingPath} (${bytes} bytes)`)
  return { staged: true, incomingBytes: bytes }
}

/** 默认实现：better-sqlite3 Online Backup（readonly 源连接，运行中的安装版也能安全备份） */
async function backupViaSqlite(sourcePath: string, destPath: string): Promise<void> {
  const require_ = createRequire(import.meta.url)
  const Database = require_('better-sqlite3') as new (
    filePath: string,
    options?: { readonly?: boolean; fileMustExist?: boolean },
  ) => {
    backup: (destination: string) => Promise<void>
    close: () => void
  }
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try {
    await source.backup(destPath)
  } finally {
    source.close()
  }
}

/** stage 成功后由 IPC 层调用：注册 relaunch 并走完整关闭链退出 */
export function relaunchForInheritedDb(): void {
  if (quitRequester == null) {
    throw new Error('Quit requester 未装配（setProductionDbInheritQuitRequester）')
  }
  app.relaunch()
  log.info('Relaunch registered, requesting application quit for inherited db')
  quitRequester()
}

// ─── apply：下次启动、建库之前应用暂存快照 ───────────────────────────────────

export interface ApplyPendingProductionDbOptions {
  databasePath: string
  userDataDir: string
  appVersion: string
  /** 备份根目录，缺省 <userData>/backups/database */
  backupRoot?: string
}

/**
 * 应用暂存的继承快照。返回是否发生了替换。
 * 设计约束：绝不向上抛错——失败仅告警并清除 marker，用现有 db 正常启动。
 */
export async function applyPendingProductionDbInheritance(
  options: ApplyPendingProductionDbOptions,
): Promise<{ applied: boolean; backupDirectory?: string }> {
  const { databasePath, userDataDir, appVersion } = options
  const markerPath = path.join(userDataDir, MARKER_FILENAME)
  const incomingPath = path.join(userDataDir, INCOMING_DB_FILENAME)

  if (!existsSync(markerPath)) return { applied: false }

  let marker: InheritMarker
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf-8')) as InheritMarker
  } catch {
    log.warn('inherit-db.pending 损坏，忽略并清除')
    await rm(markerPath, { force: true })
    return { applied: false }
  }
  if (!existsSync(incomingPath)) {
    log.warn('spark.db.incoming 不存在（stage 后被清理？），清除 marker')
    await rm(markerPath, { force: true })
    return { applied: false }
  }

  const backupRoot = options.backupRoot ?? path.join(userDataDir, 'backups', 'database')
  const backupDirName = `pre-inherit-v${appVersion}-${Date.now()}`
  const backupDir = path.join(backupRoot, backupDirName)

  try {
    // 1. 备份当前 db 三件套（存在才拷），备份目录以 manifest 收尾后整体可用
    await mkdir(backupDir, { recursive: true })
    for (const suffix of DATABASE_SUFFIXES) {
      const source = `${databasePath}${suffix}`
      if (!existsSync(source)) continue
      await copyFile(source, path.join(backupDir, `spark.db${suffix}`))
    }
    await writeFile(
      path.join(backupDir, 'manifest.json'),
      `${JSON.stringify(
        { databasePath, appVersion, stagedAt: marker.stagedAt, sourcePath: marker.sourcePath, createdAt: new Date().toISOString() },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    )

    // 2. 删旧三件套 → incoming 原子 rename → 清 marker
    for (const suffix of DATABASE_SUFFIXES) {
      await rm(`${databasePath}${suffix}`, { force: true })
    }
    await rename(incomingPath, databasePath)
    await rm(markerPath, { force: true })

    log.warn(
      `Applied inherited production db (source=${marker.sourcePath}, stagedAt=${marker.stagedAt}); previous db backed up to ${backupDir}`,
    )
    return { applied: true, backupDirectory: backupDir }
  } catch (err) {
    log.error(`应用继承快照失败，保留现有数据库继续启动: ${err instanceof Error ? err.message : String(err)}`)
    // 回退：若 rename 已发生但 marker 未清，避免下次启动重复替换；备份目录保留供手动恢复
    await rm(markerPath, { force: true }).catch(() => {})
    return { applied: false }
  }
}
