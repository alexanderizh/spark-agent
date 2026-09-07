/**
 * 确保原生模块已针对 Electron ABI 编译
 *
 * 在 `pnpm dev` 前运行，检查 better-sqlite3 / keytar 是否已针对当前安装的
 * Electron 版本编译。若未编译或 Electron 版本变更，则自动恢复/重建。
 *
 * 原理：
 *   pnpm install 阶段原生模块编译为系统 Node.js ABI；Electron 内嵌的
 *   Node.js 使用不同的 modules ABI，直接加载会失败。
 *
 * 指纹 + 真实加载验证：
 *   旧实现只看标记文件里的 Electron 版本号，但 `pnpm test:unit` 收尾会把
 *   better-sqlite3 切换回系统 Node ABI（scripts/sqlite-abi.sh），版本号没变
 *   却会跳过检查，导致 Electron 启动时 NODE_MODULE_VERSION 不匹配崩溃。
 *   因此标记文件记录每个 live 二进制的 sha256 指纹，ready 判定必须逐个核对；
 *   且指纹必须来自「在真实 Electron 里 require 成功」的二进制（scripts/
 *   verify-native-electron-abi.cjs）—— @electron/rebuild 报成功但实际没有
 *   替换二进制（缓存空转）的情况出现过，不能只信重建退出码。
 *
 * 恢复顺序（未通过指纹校验时）：
 *   1. vendor/prebuilds/better-sqlite3 的 electron 预编译产物（macOS，经
 *      scripts/sqlite-abi.sh 拷贝，秒级；产物按 vendor/prebuilds/better-sqlite3/
 *      README.md 在依赖升级时重新生成）→ 拷贝后在 Electron 里验证；
 *   2. @electron/rebuild 全量重建 → 重建后在 Electron 里验证。
 *   两条路都必须验证通过才写标记；验证失败则退出非零，阻断 dev 启动。
 *
 * 重要：electron-rebuild 必须从 apps/desktop/ 目录运行（其 package.json 的
 * dependencies 中声明了原生模块），否则无法发现需要重建的模块。
 *
 * 注意：node-pty 不在此处编译，因为它依赖 Spectre-mitigated 库（Windows），
 * 该库可能未安装且缺失不应阻塞数据库初始化（verify 脚本会检查它，缺失时报错
 * 但不写标记，可按需单独处理）。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appDir = join(__dirname, '..')
const rootDir = join(appDir, '..', '..')

/** 数据库启动需要的最小模块集合及其 live 二进制路径 */
const MODULE_BINARIES = {
  'better-sqlite3': join(
    rootDir,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node',
  ),
  keytar: join(rootDir, 'node_modules', 'keytar', 'build', 'Release', 'keytar.node'),
}

const SQLITE_ABI_SCRIPT = join(rootDir, 'scripts', 'sqlite-abi.sh')
const VENDOR_ELECTRON_BINARY = join(
  rootDir,
  'vendor',
  'prebuilds',
  'better-sqlite3',
  'better_sqlite3.node.electron',
)
const VERIFY_SCRIPT = join(__dirname, 'verify-native-electron-abi.cjs')

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

const electronPkgPath = join(rootDir, 'node_modules', 'electron', 'package.json')
if (!existsSync(electronPkgPath)) {
  console.error('[native] Electron 未安装，请先执行 `pnpm install`。')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(electronPkgPath, 'utf-8'))
const electronVersion = pkg.version

const markerDir = join(appDir, 'node_modules')
const markerPath = join(markerDir, '.electron-native-abi')

/**
 * 读取标记文件。
 * 兼容旧版纯文本格式（electron-<ver>-<arch>）：无法校验指纹，返回 null 走恢复流程。
 */
function readMarker() {
  if (!existsSync(markerPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf-8'))
    if (
      parsed &&
      parsed.electron === electronVersion &&
      parsed.arch === process.arch &&
      Array.isArray(parsed.goodHashes) &&
      parsed.goodHashes.every((h) => typeof h === 'string')
    ) {
      return parsed
    }
  } catch {
    // 旧版纯文本标记，按指纹未校验处理
  }
  return null
}

/**
 * 在真实 Electron 里加载全部原生模块，验证 ABI 兼容。
 * 返回 true = 全部加载成功。
 */
function verifyInElectron() {
  // electron npm 包在 Node 环境下导出 Electron 可执行文件路径
  const require = createRequire(import.meta.url)
  let electronBinary
  try {
    electronBinary = require(join(rootDir, 'node_modules', 'electron'))
  } catch (err) {
    console.error(`[native] 无法定位 Electron 可执行文件：${err.message}`)
    return false
  }

  console.log('[native] 在 Electron 中加载验证原生模块...')
  const result = spawnSync(electronBinary, [VERIFY_SCRIPT], {
    cwd: appDir,
    timeout: 120_000,
    encoding: 'utf-8',
  })

  if (result.status === 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    return true
  }

  console.error('[native] Electron 加载验证失败：')
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return false
}

/** 用 vendor electron 预编译产物恢复 better-sqlite3（复用 sqlite-abi.sh 的拷贝语义） */
function restoreFromVendor() {
  if (process.platform !== 'darwin') return false
  if (!existsSync(VENDOR_ELECTRON_BINARY) || !existsSync(SQLITE_ABI_SCRIPT)) {
    return false
  }
  console.log('[native] 尝试用 vendor electron 预编译产物恢复 better-sqlite3 ...')
  const result = spawnSync('bash', [SQLITE_ABI_SCRIPT, 'electron'], {
    cwd: rootDir,
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    console.error('[native] vendor 预编译产物拷贝失败。')
    if (result.stderr) process.stderr.write(result.stderr)
    return false
  }
  process.stdout.write(result.stdout)
  return true
}

const markerFileExists = existsSync(markerPath)
const marker = readMarker()

// 当前 live 二进制指纹（缺失的模块不记录）
const liveHashes = new Map()
for (const [mod, binary] of Object.entries(MODULE_BINARIES)) {
  if (existsSync(binary)) liveHashes.set(mod, sha256(binary))
}

const allBinariesPresent = liveHashes.size === Object.keys(MODULE_BINARIES).length

if (marker && allBinariesPresent) {
  const allKnown = [...liveHashes.values()].every((hash) => marker.goodHashes.includes(hash))
  if (allKnown) {
    console.log(`[native] 原生模块已就绪 (Electron ${electronVersion}, ${process.arch})`)
    process.exit(0)
  }
  console.log('[native] 原生二进制与 ABI 标记不一致（可能跑过单测切到 Node ABI，或依赖被重装）...')
} else if (markerFileExists) {
  console.log('[native] ABI 标记过期或格式升级，执行恢复...')
} else if (!allBinariesPresent) {
  console.log('[native] 原生模块二进制缺失，执行恢复...')
} else {
  console.log(`[native] 首次启动：为 Electron ${electronVersion} (${process.arch}) 准备原生模块...`)
}

// ---- 恢复流程：先 vendor 快速恢复，再全量重建；两者都以 Electron 真实加载为准 ----

let verified = false

if (restoreFromVendor()) {
  verified = verifyInElectron()
  if (verified) {
    console.log('[native] vendor 预编译产物加载验证通过 ✓')
  } else {
    console.error('[native] vendor 预编译产物与当前依赖不匹配，转为全量重建...')
  }
}

if (!verified) {
  let rebuildFailed = false
  try {
    const { rebuild } = await import('@electron/rebuild')

    // 逐个重建，避免一个模块失败阻塞其他模块
    for (const mod of Object.keys(MODULE_BINARIES)) {
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
    if (process.platform === 'win32') {
      console.error('[native] Windows 下 node-pty 需安装 Spectre-mitigated 库。')
    }
  }

  verified = verifyInElectron()
}

if (!verified) {
  console.error('')
  console.error('[native] 原生模块在 Electron 中加载验证未通过，不写入 ABI 标记。')
  console.error('[native] 可尝试：cd apps/desktop && pnpm run rebuild:native 后重新启动。')
  process.exit(1)
}

// 验证通过后才写标记；指纹取自验证通过时的 live 二进制
const goodHashes = new Set()
for (const binary of Object.values(MODULE_BINARIES)) {
  if (existsSync(binary)) goodHashes.add(sha256(binary))
}

mkdirSync(markerDir, { recursive: true })
writeFileSync(
  markerPath,
  JSON.stringify(
    { electron: electronVersion, arch: process.arch, goodHashes: [...goodHashes] },
    null,
    2,
  ),
  'utf-8',
)

console.log('[native] 原生模块已就绪（ABI 标记已更新） ✓')
