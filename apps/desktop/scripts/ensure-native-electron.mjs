/**
 * 确保原生模块已针对 Electron ABI 编译（真实加载校验版）
 *
 * 在 `pnpm dev` 前运行，用真实 Electron 运行时逐个加载 better-sqlite3 / keytar
 * 校验可用性（复用 verify-native-electron-abi.cjs），而不是仅凭编译命令退出码
 * 或 Electron 版本号判定就绪。本脚本修复的两个历史问题：
 *
 *   1. 旧版在 rebuild 失败（含 better-sqlite3 本身失败）时仍写入就绪标记，
 *      后续启动直接跳过重建，dev 启动报 NODE_MODULE_VERSION 错误；
 *   2. 旧版标记只记录 Electron 版本+架构，`pnpm install` 重装依赖后模块回退
 *      为系统 Node ABI，标记仍判定「已就绪」导致带病启动。
 *
 * 流程：
 *   1) Electron 运行时真实加载校验（秒级，每次启动执行）→ 通过则写标记放行；
 *   2) 校验失败 → 复用仓库 rebuild:native 的 staging 方案重建
 *      （rebuild-native-for-electron.sh）；
 *   3) 重建后必须再次通过加载校验才写就绪标记；仍失败则删除标记并以非 0 退出。
 *
 * 重要：不要直接调 @electron/rebuild API 重建——hoisted 布局下它从
 * apps/desktop 发现不到根 node_modules 里的原生模块，会「报成功但实际什么
 * 都没编译」（空转）。rebuild-native-for-electron.sh 通过把模块 stage 进
 * apps/desktop/node_modules 再编译、完成后回拷，绕开了这个发现缺陷。
 *
 * 注意：node-pty 不在此处编译，因为它依赖 Spectre-mitigated 库（Windows），
 * 该库可能未安装且缺失不应阻塞数据库初始化，故不在校验/重建集合内。
 */

import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appDir = join(__dirname, '..')
const rootDir = join(appDir, '..', '..')

/** 数据库启动需要的最小模块集合（全部要求在 Electron 运行时真实可加载） */
const MODULES = ['better-sqlite3', 'keytar']

/** Electron 冷启动 + 模块加载的校验超时 */
const PROBE_TIMEOUT_MS = 120_000

const electronPkgPath = join(rootDir, 'node_modules', 'electron', 'package.json')
if (!existsSync(electronPkgPath)) {
  console.error('[native] Electron 未安装，请先执行 `pnpm install`。')
  process.exit(1)
}
const electronVersion = JSON.parse(readFileSync(electronPkgPath, 'utf-8')).version

// Electron 可执行文件（electron npm 包的 dist 布局），校验时以应用方式运行
// verify 脚本（默认 app 直接以传入的 .cjs 作为主进程模块），不使用 ELECTRON_RUN_AS_NODE
const electronBin = join(
  rootDir,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron',
)
if (!existsSync(electronBin)) {
  console.error('[native] Electron 二进制缺失（node_modules/electron/dist），请先执行 `pnpm install`。')
  process.exit(1)
}

const markerDir = join(appDir, 'node_modules')
const markerPath = join(markerDir, '.electron-native-abi')
const expectedMarker = `electron-${electronVersion}-${process.arch}`

function writeMarker() {
  mkdirSync(markerDir, { recursive: true })
  writeFileSync(markerPath, expectedMarker, 'utf-8')
}

function clearMarker() {
  try {
    rmSync(markerPath, { force: true })
  } catch {
    // 标记清理失败不影响主流程：每次启动都会重新做真实校验
  }
}

/**
 * 用真实 Electron 运行时加载校验（verify-native-electron-abi.cjs）。
 * 返回 true 表示 MODULES 全部真实可用；失败明细由子进程直接输出。
 */
function verifyWithElectron() {
  console.log(`[native] 使用 Electron ${electronVersion} (${process.arch}) 真实加载校验...`)
  const res = spawnSync(electronBin, [join(__dirname, 'verify-native-electron-abi.cjs'), ...MODULES], {
    cwd: appDir, // verify 脚本按 cwd 解析模块
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
  })
  const out = res.stdout ? res.stdout.toString() : ''
  if (out) {
    process.stdout.write(out)
  }
  if (res.error) {
    console.error(`[native] 校验进程启动失败：${res.error.message}`)
    return false
  }
  if (res.signal) {
    console.error(`[native] 校验进程异常终止（${res.signal}，可能超过 ${PROBE_TIMEOUT_MS}ms 超时）`)
    return false
  }
  if (res.status !== 0) {
    console.error(`[native] 校验未通过（exit ${res.status ?? 'unknown'}）`)
    return false
  }
  // exit 0 时从 ok 行提取已确认模块，防御性兜底：解析不到即视为校验失败（触发重建）
  const okModules = new Set()
  for (const m of out.matchAll(/\[native-verify\] ok: require\("([^"]+)"\)/g)) {
    okModules.add(m[1])
  }
  const missing = MODULES.filter((name) => !okModules.has(name))
  if (missing.length > 0) {
    console.error(`[native] 以下模块未确认加载成功：${missing.join(', ')}`)
    return false
  }
  return true
}

// ── 第一步：真实加载校验（秒级；天然覆盖依赖重装、Electron 升级等场景） ──
if (verifyWithElectron()) {
  writeMarker()
  console.log('[native] 原生模块已就绪 ✓')
  process.exit(0)
}

console.log('[native] 原生模块与当前 Electron ABI 不匹配或加载失败，开始重建...')

// ── 第二步：复用仓库 rebuild:native 的 staging 方案重建 ──
// 脚本内含 staging 编译 + 回拷 + native:verify 自检；NATIVE_MODULES 覆盖为
// 最小集合以排除 node-pty（Spectre 依赖可能缺失，见文件头注释）。脚本自身的
// native:verify 终检含 node-pty，可能误报失败——以本脚本第三步校验为准。
console.log('[native]   运行 rebuild-native-for-electron.sh（staging 编译，可能需要数分钟）...')
const rebuildSpawn = spawnSync('bash', [join(__dirname, 'rebuild-native-for-electron.sh')], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, NATIVE_MODULES: MODULES.join(',') },
  timeout: 15 * 60_000,
  windowsHide: true,
})
if (rebuildSpawn.error) {
  if (rebuildSpawn.error.code === 'ENOENT') {
    console.error('[native] 未找到 bash：重建脚本需要 Git Bash 在 PATH 中。')
  } else {
    console.error(`[native] 重建脚本启动失败：${rebuildSpawn.error.message}`)
  }
}

// ── 第三步：重建后必须再次通过真实加载校验，才允许写就绪标记 ──
if (!verifyWithElectron()) {
  clearMarker()
  console.error('')
  console.error('[native] 重建后校验仍未通过，已终止启动（未写入就绪标记）。')
  console.error('[native] 建议：删除 node_modules 后重新 `pnpm install`；Windows 下确认已安装 VS Build Tools（含 C++ 工作负载）。')
  process.exit(1)
}

writeMarker()
console.log('[native] 原生模块编译并校验完成 ✓')
