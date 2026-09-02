/**
 * ProductionDbInheritService 单测 —— 注入 fake backupDatabase（raw copy），
 * 不加载 better-sqlite3 原生模块（本机 Electron ABI 下 vitest 无法加载）。
 * 覆盖：describe 可用性判定、stage 暂存、apply 替换/备份/失败回退、relaunch 注入。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({ app: { relaunch: vi.fn() } }))

import {
  applyPendingProductionDbInheritance,
  describeProductionDbInheritance,
  relaunchForInheritedDb,
  setProductionDbInheritQuitRequester,
  stageProductionDbInheritance,
} from '../ProductionDbInheritService.js'

async function makeTempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'spark-inherit-test-'))
}

/** 造一个假 db 文件（内容即标记文本） */
async function seedDb(dir: string, content: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const dbPath = path.join(dir, 'spark.db')
  await writeFile(dbPath, content)
  return dbPath
}

/** fake 快照：与默认实现同为"单文件拷贝"语义 */
const fakeBackup = (sourcePath: string, destPath: string) => copyFile(sourcePath, destPath)

describe('describeProductionDbInheritance', () => {
  it('dev 沙箱 + 安装版库存在 → available 且带路径与大小', async () => {
    const root = await makeTempRoot()
    const prodDb = await seedDb(path.join(root, 'prod'), 'production-db-bytes')
    const devDir = path.join(root, 'prod-dev')
    await mkdir(devDir, { recursive: true })

    const info = describeProductionDbInheritance(devDir)
    expect(info.available).toBe(true)
    expect(info.currentIsDev).toBe(true)
    expect(info.productionDbPath).toBe(prodDb)
    expect(info.productionDbSizeBytes).toBe('production-db-bytes'.length)
    await rm(root, { recursive: true, force: true })
  })

  it('安装版库不存在 → available=false 带原因', async () => {
    const root = await makeTempRoot()
    const devDir = path.join(root, 'prod-dev')
    await mkdir(devDir, { recursive: true })
    const info = describeProductionDbInheritance(devDir)
    expect(info.available).toBe(false)
    expect(info.reason).toContain('未找到')
    await rm(root, { recursive: true, force: true })
  })

  it('非 -dev 数据目录 → available=false', () => {
    const info = describeProductionDbInheritance(path.join(tmpdir(), 'plain-dir'))
    expect(info.available).toBe(false)
    expect(info.currentIsDev).toBe(false)
  })
})

describe('stage + apply 全流程', () => {
  let root: string
  let prodDir: string
  let devDir: string

  beforeEach(async () => {
    root = await makeTempRoot()
    prodDir = path.join(root, 'app')
    devDir = path.join(root, 'app-dev')
    await mkdir(devDir, { recursive: true })
    await seedDb(prodDir, 'fresh-production-data')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('stage 写出 incoming 与 marker；apply 替换当前库并备份旧库', async () => {
    const currentDb = await seedDb(devDir, 'old-dev-data')

    const staged = await stageProductionDbInheritance({
      backupDatabase: fakeBackup,
      userDataDir: devDir,
    })
    expect(staged.staged).toBe(true)
    expect(staged.incomingBytes).toBe('fresh-production-data'.length)
    expect(existsSync(path.join(devDir, 'spark.db.incoming'))).toBe(true)
    expect(existsSync(path.join(devDir, 'inherit-db.pending'))).toBe(true)

    const result = await applyPendingProductionDbInheritance({
      databasePath: currentDb,
      userDataDir: devDir,
      appVersion: '0.0.0-test',
    })
    expect(result.applied).toBe(true)
    expect(result.backupDirectory).toBeTruthy()

    // 当前库被替换为安装版内容，incoming 与 marker 清理干净
    expect(await readFile(currentDb, 'utf-8')).toBe('fresh-production-data')
    expect(existsSync(path.join(devDir, 'spark.db.incoming'))).toBe(false)
    expect(existsSync(path.join(devDir, 'inherit-db.pending'))).toBe(false)

    // 旧库三件套备份保留，manifest 记录溯源
    const backupDir = result.backupDirectory!
    expect(await readFile(path.join(backupDir, 'spark.db'), 'utf-8')).toBe('old-dev-data')
    const manifest = JSON.parse(await readFile(path.join(backupDir, 'manifest.json'), 'utf-8'))
    expect(manifest.appVersion).toBe('0.0.0-test')
  })

  it('apply 失败（incoming 缺失）→ 不替换且清除 marker', async () => {
    const currentDb = await seedDb(devDir, 'old-dev-data')
    await writeFile(path.join(devDir, 'inherit-db.pending'), JSON.stringify({ stagedAt: 'x' }))

    const result = await applyPendingProductionDbInheritance({
      databasePath: currentDb,
      userDataDir: devDir,
      appVersion: '0.0.0-test',
    })
    expect(result.applied).toBe(false)
    expect(await readFile(currentDb, 'utf-8')).toBe('old-dev-data')
    expect(existsSync(path.join(devDir, 'inherit-db.pending'))).toBe(false)
  })

  it('无 marker 时 apply 为 no-op', async () => {
    const currentDb = await seedDb(devDir, 'old-dev-data')
    const result = await applyPendingProductionDbInheritance({
      databasePath: currentDb,
      userDataDir: devDir,
      appVersion: '0.0.0-test',
    })
    expect(result.applied).toBe(false)
    expect(existsSync(currentDb)).toBe(true)
  })
})

describe('relaunchForInheritedDb', () => {
  it('未装配 quit requester 时抛错；装配后触发并注册 relaunch', async () => {
    const { app } = (await import('electron')) as unknown as {
      app: { relaunch: ReturnType<typeof vi.fn> }
    }
    expect(() => relaunchForInheritedDb()).toThrow(/Quit requester/)

    const requester = vi.fn()
    setProductionDbInheritQuitRequester(requester)
    relaunchForInheritedDb()
    expect(app.relaunch).toHaveBeenCalledTimes(1)
    expect(requester).toHaveBeenCalledTimes(1)
  })
})
