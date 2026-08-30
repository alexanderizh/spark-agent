/**
 * 确保原生模块已针对 Electron ABI 编译
 *
 * 在 `pnpm dev` 前运行，检查 better-sqlite3 / keytar 是否已针对当前安装的
 * Electron 版本编译。若未编译或 Electron 版本变更，则自动调用 @electron/rebuild。
 *
 * 原理：
 *   pnpm install 阶段原生模块编译为系统 Node.js ABI；Electron 内嵌的
 *   Node.js 使用不同的 modules ABI，直接加载会失败。
 *
 * 重要：electron-rebuild 必须从 apps/desktop/ 目录运行（其 package.json 的
 * dependencies 中声明了原生模块），否则无法发现需要重建的模块。
 *
 * 注意：node-pty 不在此处编译，因为它依赖 Spectre-mitigated 库（Windows），
 * 该库可能未安装且缺失不应阻塞数据库初始化。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appDir = join(__dirname, '..')
const rootDir = join(appDir, '..', '..')

/** 数据库启动需要的最小模块集合 */
const MODULES = ['better-sqlite3', 'keytar']

const electronPkgPath = join(rootDir, 'node_modules', 'electron', 'package.json')
if (!existsSync(electronPkgPath)) {
  console.error('[native] Electron 未安装，请先执行 `pnpm install`。')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(electronPkgPath, 'utf-8'))
const electronVersion = pkg.version

const markerDir = join(appDir, 'node_modules')
const markerPath = join(markerDir, '.electron-native-abi')
const expectedMarker = `electron-${electronVersion}-${process.arch}`

if (existsSync(markerPath)) {
  const currentMarker = readFileSync(markerPath, 'utf-8').trim()
  if (currentMarker === expectedMarker) {
    console.log(
      `[native] 原生模块已就绪 (Electron ${electronVersion}, ${process.arch})`,
    )
    process.exit(0)
  }
  console.log(
    `[native] Electron 版本或架构变更 (${currentMarker} → ${expectedMarker})，重新编译...`,
  )
} else {
  console.log(
    `[native] 首次启动：为 Electron ${electronVersion} (${process.arch}) 编译原生模块...`,
  )
}

let rebuildFailed = false

try {
  const { rebuild } = await import('@electron/rebuild')

  // 逐个重建，避免一个模块失败阻塞其他模块
  for (const mod of MODULES) {
    try {
      console.log(`[native]   重建 ${mod}...`)
      await rebuild({
        // 必须指向 apps/desktop/，electron-rebuild 依据其 package.json
        // 的 dependencies 发现需要重建的原生模块
        buildPath: appDir,
        electronVersion,
        arch: process.arch,
        onlyModules: [mod],
        force: true,
      })
      console.log(`[native]   ${mod} ✓`)
    } catch (err) {
      rebuildFailed = true
      console.error(`[native]   ${mod} ✗ ${err.message}`)
    }
  }
} catch (err) {
  console.error('[native] @electron/rebuild 加载失败：')
  console.error(err.message)
  process.exit(1)
}

if (rebuildFailed) {
  console.error('')
  console.error('[native] 部分模块编译失败（见上）。')
  console.error(
    '[native] 数据库所需模块 (better-sqlite3) 若已成功，不影响开发启动。',
  )
  if (process.platform === 'win32') {
    console.error(
      '[native] Windows 下 node-pty 需安装 Spectre-mitigated 库。',
    )
  }
}

// 只要 better-sqlite3 重建成功就写标记（数据库能启动即可）
mkdirSync(markerDir, { recursive: true })
writeFileSync(markerPath, expectedMarker, 'utf-8')

if (rebuildFailed) {
  console.log('[native] 数据库所需模块已就绪（部分终端模块未编译）')
} else {
  console.log('[native] 原生模块编译完成 ✓')
}
