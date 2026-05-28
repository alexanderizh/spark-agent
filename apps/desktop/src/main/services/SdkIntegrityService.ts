/**
 * SdkIntegrityService — SDK 完整性检测服务
 *
 * 职责：
 *   1. 检测 Claude Agent SDK 和 Codex SDK（openai）是否安装
 *   2. 获取已安装版本号
 *   3. 从 npm registry 检查最新版本（HTTP API，不依赖 npm CLI）
 *   4. 提供安装/更新能力（spawn + shell: true 兼容 Windows）
 *
 * 使用场景：
 *   - 应用启动时自动自检
 *   - 设置页面"完整性"tab 手动检测
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as https from 'node:https'
import { createRequire } from 'node:module'
import { app } from 'electron'
import { createLogger } from '@spark/shared'
import type { SdkIntegrityItem, SdkIntegrityCheckRequest, SdkIntegrityCheckResponse, SdkIntegrityInstallResponse, RuntimeToolStatus } from '@spark/protocol'
import { recheckRuntimeTools } from './ShellEnvironmentService.js'

const log = createLogger('sdk-integrity')

/** SDK 定义列表 */
const SDK_DEFINITIONS: Array<{ packageName: string; displayName: string }> = [
  { packageName: '@anthropic-ai/claude-agent-sdk', displayName: 'Claude Agent SDK' },
  { packageName: 'openai', displayName: 'OpenAI / Codex SDK' },
]

/** 缓存上次检测结果 */
let cachedResult: SdkIntegrityCheckResponse | null = null

/**
 * 获取 monorepo 根目录的候选路径列表
 *
 * 开发模式：__dirname → out/main/，往上 4 级到 monorepo root
 * 生产模式：app.getAppPath() 或 process.resourcesPath
 */
function getMonorepoRootCandidates(): string[] {
  const candidates: string[] = []

  // 开发模式: out/main/services/ → 4 级上 = monorepo root
  // __dirname in electron-vite output is like: /path/to/spark-agent/apps/desktop/out/main/services
  const fromDir = resolve(__dirname, '..', '..', '..', '..')
  candidates.push(fromDir)

  // 从 app path 推断
  try {
    const appPath = app.getAppPath()
    if (appPath) {
      // appPath 可能指向 apps/desktop，往上 1 级到 monorepo root
      candidates.push(appPath)
      candidates.push(resolve(appPath, '..', '..'))
      candidates.push(resolve(appPath, '..'))
    }
  } catch {
    // app not ready
  }

  // process.cwd() 作为最后备选
  candidates.push(process.cwd())
  if (!app.isPackaged) {
    candidates.push(resolve(__dirname, '..', '..', '..', '..'))
  }

  return candidates
}

/**
 * 查找包含指定包的 node_modules 目录
 */
function findPackageJsonInNodeModules(packageName: string): string | null {
  const pkgSubPath = join(...packageName.split('/'), 'package.json')

  // 方法1: 通过 require.resolve（在 Electron main 进程中有效）
  try {
    const require = createRequire(import.meta.url)
    const resolved = require.resolve(`${packageName}/package.json`)
    if (resolved && existsSync(resolved)) return resolved
  } catch {
    // fallback
  }

  // 方法2: 遍历 monorepo 候选路径中的 node_modules
  const roots = getMonorepoRootCandidates()
  const searchPaths = [
    // packaged Electron app: Contents/Resources/app.asar/node_modules
    (root: string) => join(root, 'node_modules', pkgSubPath),
    // packaged Electron app: Contents/Resources/app.asar.unpacked/node_modules
    (root: string) => join(root.replace(/\.asar$/, '.asar.unpacked'), 'node_modules', pkgSubPath),
    // monorepo root 的 node_modules（pnpm hoisted 或 symlinked）
    (root: string) => join(root, 'node_modules', pkgSubPath),
    // agent-runtime 的 node_modules（pnpm 可能放在包内部）
    (root: string) => join(root, 'packages', 'agent-runtime', 'node_modules', pkgSubPath),
    // desktop 的 node_modules
    (root: string) => join(root, 'apps', 'desktop', 'node_modules', pkgSubPath),
  ]

  for (const root of roots) {
    for (const pathBuilder of searchPaths) {
      const pkgPath = pathBuilder(root)
      if (existsSync(pkgPath)) return pkgPath
    }
  }

  return null
}

/**
 * 从 package.json 读取已安装版本
 */
function getInstalledVersion(packageName: string): string | null {
  const pkgJsonPath = findPackageJsonInNodeModules(packageName)
  if (pkgJsonPath == null) return null

  try {
    const content = readFileSync(pkgJsonPath, 'utf-8')
    const pkg = JSON.parse(content) as { version: string }
    return pkg.version ?? null
  } catch {
    return null
  }
}

/**
 * 检测 SDK 是否已安装
 */
function isSdkInstalled(packageName: string): boolean {
  return getInstalledVersion(packageName) != null
}

/**
 * 从 npm registry 获取最新版本号（使用 HTTPS API，不依赖 npm CLI）
 */
async function getLatestVersion(packageName: string): Promise<string | null> {
  return new Promise((resolve) => {
    // npm registry API: GET https://registry.npmjs.org/<pkg>/latest
    // 对 scoped package: @anthropic-ai/claude-agent-sdk → %40anthropic-ai%2Fclaude-agent-sdk
    const encodedName = encodeURIComponent(packageName)
    const urlPath = `/${encodedName}/latest`

    const options = {
      hostname: 'registry.npmjs.org',
      path: urlPath,
      method: 'GET',
      timeout: 15_000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'spark-agent-sdk-check/1.0',
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString()
      })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          log.warn(`npm registry returned ${res.statusCode} for ${packageName}`)
          resolve(null)
          return
        }
        try {
          const parsed = JSON.parse(data) as { version?: string }
          const version = parsed.version
          if (typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version)) {
            resolve(version)
          } else {
            resolve(null)
          }
        } catch {
          log.warn(`Failed to parse npm registry response for ${packageName}`)
          resolve(null)
        }
      })
    })

    req.on('error', (err) => {
      log.warn(`Failed to fetch latest version for ${packageName}: ${String(err)}`)
      resolve(null)
    })

    req.on('timeout', () => {
      req.destroy()
      log.warn(`Timeout fetching latest version for ${packageName}`)
      resolve(null)
    })

    req.end()
  })
}

/**
 * 比较 semver 版本号大小
 * @returns true if v1 > v2
 */
function isVersionNewer(v1: string, v2: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const a = parse(v1)
  const b = parse(v2)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false
  }
  return false
}

/**
 * 执行 SDK 完整性检测
 */
export async function checkSdkIntegrity(request: SdkIntegrityCheckRequest): Promise<SdkIntegrityCheckResponse> {
  const { checkLatest = false } = request
  const sdks: SdkIntegrityItem[] = []

  for (const def of SDK_DEFINITIONS) {
    const item: SdkIntegrityItem = {
      packageName: def.packageName,
      displayName: def.displayName,
      installed: false,
      installedVersion: null,
      latestVersion: null,
      updateAvailable: false,
      latestChecked: false,
    }

    try {
      // 1. 检查是否安装 + 获取版本
      const version = getInstalledVersion(def.packageName)
      item.installed = version != null
      item.installedVersion = version

      // 2. 如果请求了最新版检测
      if (checkLatest) {
        const latest = await getLatestVersion(def.packageName)
        item.latestVersion = latest
        item.latestChecked = true

        if (latest != null && item.installedVersion != null) {
          item.updateAvailable = isVersionNewer(latest, item.installedVersion)
        }
      }
    } catch (err) {
      item.error = err instanceof Error ? err.message : String(err)
    }

    sdks.push(item)
  }

  // Also detect host runtime tools (node, npm, git, etc.)
  let tools: RuntimeToolStatus[] = []
  try {
    const envStatus = await recheckRuntimeTools()
    // Only include tools relevant to agent runtime (node, npm, git)
    const relevantTools = ['node', 'npm', 'git']
    tools = envStatus.tools.filter((t) => relevantTools.includes(t.command))
  } catch (err) {
    log.warn(`Failed to detect host tools: ${String(err)}`)
  }

  const result: SdkIntegrityCheckResponse = {
    sdks,
    tools,
    checkedAt: new Date().toISOString(),
  }

  cachedResult = result
  return result
}

/**
 * 获取缓存的检测结果
 */
export function getCachedIntegrity(): SdkIntegrityCheckResponse | null {
  return cachedResult
}

/**
 * 获取包管理器命令（兼容 Windows/macOS/Linux）
 *
 * 使用 pnpm 因为项目是 pnpm monorepo。
 * Windows 上需要 shell: true 来执行 .cmd 文件。
 */
function getPackageManagerCommand(): { command: string; args?: string[] } {
  // 统一使用 pnpm（项目本身就是 pnpm monorepo）
  const cmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  return { command: cmd }
}

/**
 * 查找 agent-runtime 包目录路径
 */
function findAgentRuntimeDir(): string | null {
  if (app.isPackaged) return null

  const roots = getMonorepoRootCandidates()
  for (const root of roots) {
    const dir = join(root, 'packages', 'agent-runtime')
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  return null
}

/**
 * 安装或更新 SDK 包
 *
 * 使用 spawn + shell: true 确保 Windows 上 .cmd 文件可执行。
 */
export async function installSdk(packageName: string): Promise<SdkIntegrityInstallResponse> {
  const targetDir = findAgentRuntimeDir()
  if (targetDir == null) {
    return {
      success: false,
      message: '无法定位 agent-runtime 目录，安装功能仅在开发模式下可用',
    }
  }

  const { command } = getPackageManagerCommand()
  const args = ['add', packageName]

  log.info(`Installing ${packageName} via ${command} ${args.join(' ')} in ${targetDir}`)

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: targetDir,
      shell: true, // 必须: Windows .cmd 文件需要 shell
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('error', (err) => {
      log.error(`Failed to spawn install process for ${packageName}: ${String(err)}`)
      resolve({
        success: false,
        message: `启动安装进程失败: ${err.message}`,
      })
    })

    child.on('close', (code) => {
      if (code !== 0) {
        log.error(`Install ${packageName} failed with code ${code}: ${stderr}`)
        resolve({
          success: false,
          message: `安装失败 (退出码 ${code}): ${stderr.trim() || '未知错误'}`,
        })
        return
      }

      log.info(`Successfully installed ${packageName}\n${stdout}`)

      // 获取安装后的版本
      const newVersion = getInstalledVersion(packageName)

      // 清除缓存，下次获取新数据
      cachedResult = null

      resolve({
        success: true,
        message: `${packageName} 安装成功`,
        ...(newVersion != null ? { newVersion } : {}),
      })
    })
  })
}
