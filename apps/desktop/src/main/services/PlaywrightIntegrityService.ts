/**
 * PlaywrightIntegrityService — Playwright + @playwright/mcp 完整性检测与安装
 *
 * 职责：
 *   1. 检测 `@playwright/mcp` 与 `playwright` 包是否已安装
 *   2. 检测浏览器是否可用（内置 Chromium + 系统 Chrome/Edge 回退）
 *   3. 提供 MCP 包安装能力（通过 pnpm/npm 添加到 apps/desktop）
 *   4. 提供 chromium 浏览器下载能力（下载到内置 `browsers/` 目录）
 *
 * 模式：参考 `SdkIntegrityService.ts`
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { app } from 'electron'
import { createLogger } from '@spark/shared'
import type {
  PlaywrightStatusResponse,
  PlaywrightInstallResponse,
} from '@spark/protocol'
import {
  getBundledBrowsersPath,
  resolveBrowserStrategy,
  resetBundledBrowsersPathCache,
} from './PlaywrightEnvironment.js'

const log = createLogger('playwright-integrity')

const MCP_PACKAGE = '@playwright/mcp'
const PLAYWRIGHT_PACKAGE = 'playwright'

export interface PlaywrightIntegrityState {
  mcpInstalled: boolean
  mcpVersion: string | null
  playwrightInstalled: boolean
  browserReady: boolean
  /** Which browser source is being used. */
  browserSource: 'bundled' | 'system' | 'none'
  lastError: string | null
}

let cachedState: PlaywrightIntegrityState | null = null

// ─── Path Resolution ────────────────────────────────────────────────────────

function getMonorepoRootCandidates(): string[] {
  const candidates: string[] = []
  const fromDir = resolve(__dirname, '..', '..', '..', '..')
  candidates.push(fromDir)
  try {
    const appPath = app.getAppPath()
    if (appPath) {
      candidates.push(appPath)
      candidates.push(resolve(appPath, '..', '..'))
      candidates.push(resolve(appPath, '..'))
    }
  } catch {
    // app not ready
  }
  candidates.push(process.cwd())
  return candidates
}

function findPackageJson(packageName: string): string | null {
  const pkgSubPath = join(...packageName.split('/'), 'package.json')

  try {
    const require = createRequire(import.meta.url)
    const resolved = require.resolve(`${packageName}/package.json`)
    if (resolved && existsSync(resolved)) return resolved
  } catch {
    // fallback below
  }

  const roots = getMonorepoRootCandidates()
  const builders = [
    (root: string) => join(root, 'node_modules', pkgSubPath),
    (root: string) => join(root.replace(/\.asar$/, '.asar.unpacked'), 'node_modules', pkgSubPath),
    (root: string) => join(root, 'apps', 'desktop', 'node_modules', pkgSubPath),
    (root: string) => join(root, 'packages', 'agent-runtime', 'node_modules', pkgSubPath),
  ]

  for (const root of roots) {
    for (const build of builders) {
      const p = build(root)
      if (existsSync(p)) return p
    }
  }
  return null
}

function readVersion(packageName: string): string | null {
  const pkgPath = findPackageJson(packageName)
  if (pkgPath == null) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

// ─── Browser Detection ──────────────────────────────────────────────────────

/**
 * Detect whether a browser is available for Playwright MCP.
 *
 * Strategy (in priority order):
 *   1. Bundled chromium (apps/desktop/browsers/ or resources/browsers/)
 *   2. System Chrome or Edge
 *   3. Playwright's default cache (~/.cache/ms-playwright)
 */
function detectBrowserReady(): { ready: boolean; source: 'bundled' | 'system' | 'none' } {
  // 1. Check bundled browsers directory
  const bundledPath = getBundledBrowsersPath()
  if (bundledPath != null) {
    log.info(`Browser detected via bundled path: ${bundledPath}`)
    return { ready: true, source: 'bundled' }
  }

  // 2. Check system browser via resolveBrowserStrategy (which also checks bundled)
  const strategy = resolveBrowserStrategy()
  if (strategy?.type === 'system') {
    log.info(`Browser detected via system ${strategy.channel}`)
    return { ready: true, source: 'system' }
  }

  // 3. Fall back to Playwright's default cache detection
  try {
    const require = createRequire(import.meta.url)
    const pw = require('playwright') as { chromium?: { executablePath: () => string } }
    if (pw.chromium == null) return { ready: false, source: 'none' }
    const exePath = pw.chromium.executablePath()
    if (typeof exePath === 'string' && exePath.length > 0 && existsSync(exePath)) {
      log.info(`Browser detected via Playwright default cache: ${exePath}`)
      return { ready: true, source: 'bundled' }
    }
  } catch (err) {
    log.warn(`Browser detection failed: ${String(err)}`)
  }

  return { ready: false, source: 'none' }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Synchronously return cached state. Use `detect()` to refresh.
 */
export function getCachedIntegrity(): PlaywrightIntegrityState | null {
  return cachedState
}

/**
 * Detect current Playwright integrity state. Refreshes cache.
 */
export function detectIntegrity(): PlaywrightIntegrityState {
  const mcpVersion = readVersion(MCP_PACKAGE)
  const playwrightVersion = readVersion(PLAYWRIGHT_PACKAGE)
  const mcpInstalled = mcpVersion != null
  const playwrightInstalled = playwrightVersion != null
  const { ready: browserReady, source: browserSource } = playwrightInstalled
    ? detectBrowserReady()
    : { ready: false, source: 'none' as const }

  const state: PlaywrightIntegrityState = {
    mcpInstalled,
    mcpVersion,
    playwrightInstalled,
    browserReady,
    browserSource,
    lastError: cachedState?.lastError ?? null,
  }
  cachedState = state
  return state
}

/**
 * Build a full status response combining integrity state with managed-MCP
 * registration status. The MCP registration info is supplied by the caller
 * (from `PlaywrightMcpRegistration`) so this service stays decoupled from DB.
 */
export function buildStatus(opts: {
  mcpRegistered: boolean
  mcpEnabled: boolean
  mode: 'headful' | 'headless'
  viewOpen: boolean
  cdpEndpoint: string | null
}): PlaywrightStatusResponse {
  const state = cachedState ?? detectIntegrity()
  return {
    mcpInstalled: state.mcpInstalled,
    mcpVersion: state.mcpVersion,
    playwrightInstalled: state.playwrightInstalled,
    browserReady: state.browserReady,
    browserSource: state.browserSource,
    mcpRegistered: opts.mcpRegistered,
    mcpEnabled: opts.mcpEnabled,
    mode: opts.mode,
    viewOpen: opts.viewOpen,
    cdpEndpoint: opts.cdpEndpoint,
    lastError: state.lastError,
  }
}

function findDesktopDir(): string | null {
  if (app.isPackaged) {
    // In packaged mode, attempt to use app path; installation will fall back to global npm cache
    try {
      return app.getAppPath()
    } catch {
      return null
    }
  }
  const roots = getMonorepoRootCandidates()
  for (const root of roots) {
    const dir = join(root, 'apps', 'desktop')
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  return null
}

function runCmd(
  command: string,
  args: string[],
  cwd: string,
  onLog: (line: string) => void,
  extraEnv?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    log.info(`Run: ${command} ${args.join(' ')} (cwd=${cwd})`)
    const child = spawn(command, args, {
      cwd,
      shell: true,
      timeout: 300_000, // 5 minutes max (browser download can be slow)
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...extraEnv,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (b: Buffer) => {
      const text = b.toString()
      stdout += text
      onLog(text)
    })
    child.stderr?.on('data', (b: Buffer) => {
      const text = b.toString()
      stderr += text
      onLog(text)
    })
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: `${stderr}\n${String(err)}` })
    })
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

/**
 * Install `@playwright/mcp` (and `playwright` as a peer).
 * Uses pnpm (project's package manager) in dev mode, falls back to npm in packaged mode.
 */
export async function installMcp(
  onLog: (line: string) => void = () => {},
): Promise<PlaywrightInstallResponse> {
  onLog(`[playwright] Installing ${MCP_PACKAGE} ...`)

  const targetDir = findDesktopDir()
  if (targetDir == null) {
    return {
      success: false,
      message: '无法定位 desktop 应用目录，请在开发模式下运行',
    }
  }

  const cmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = await runCmd(cmd, ['add', MCP_PACKAGE, PLAYWRIGHT_PACKAGE], targetDir, onLog)

  if (result.code !== 0) {
    const message = `MCP 安装失败 (退出码 ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`
    log.error(message)
    cachedState = { ...detectIntegrity(), lastError: message }
    return { success: false, message }
  }

  onLog(`[playwright] ${MCP_PACKAGE} 安装完成`)
  const newVersion = readVersion(MCP_PACKAGE)
  cachedState = { ...detectIntegrity(), lastError: null }
  return {
    success: true,
    message: `${MCP_PACKAGE} 安装成功`,
    ...(newVersion != null ? { newVersion } : {}),
  }
}

/**
 * Run `playwright install chromium` to download the chromium browser.
 * Downloads to the bundled `browsers/` directory so it can be packaged with
 * the app via electron-builder `extraResources`.
 */
export async function installBrowser(
  onLog: (line: string) => void = () => {},
): Promise<PlaywrightInstallResponse> {
  onLog('[playwright] Downloading chromium browser (~150MB) ...')

  const targetDir = findDesktopDir()
  if (targetDir == null) {
    return {
      success: false,
      message: '无法定位 desktop 应用目录，请在开发模式下运行',
    }
  }

  // Ensure the bundled browsers directory exists. In packaged apps this must
  // match PlaywrightEnvironment's runtime lookup path.
  const browsersDir = app.isPackaged
    ? join(process.resourcesPath, 'browsers')
    : join(targetDir, 'browsers')
  mkdirSync(browsersDir, { recursive: true })

  // Set PLAYWRIGHT_BROWSERS_PATH so chromium downloads to the bundled directory
  const installEnv: Record<string, string> = {
    PLAYWRIGHT_BROWSERS_PATH: browsersDir,
  }

  const cmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = await runCmd(
    cmd,
    ['exec', 'playwright', 'install', 'chromium'],
    targetDir,
    onLog,
    installEnv,
  )

  if (result.code !== 0) {
    const message = `浏览器下载失败 (退出码 ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`
    log.error(message)
    cachedState = { ...detectIntegrity(), lastError: message }
    return { success: false, message }
  }

  onLog('[playwright] chromium 下载完成')

  // Update process env before detection so both Playwright and spawned MCP
  // subprocesses resolve the newly downloaded bundled browser.
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir
  log.info(`Set PLAYWRIGHT_BROWSERS_PATH=${browsersDir}`)

  // Reset caches so next detection picks up the newly downloaded browser
  resetBundledBrowsersPathCache()
  const nextState = detectIntegrity()

  if (nextState.browserSource !== 'bundled') {
    const message = `浏览器下载完成，但未能在内置目录检测到 Chromium: ${browsersDir}`
    log.error(message)
    cachedState = { ...nextState, lastError: message }
    return { success: false, message }
  }

  cachedState = { ...nextState, lastError: null }

  return { success: true, message: 'chromium 浏览器下载完成' }
}

/**
 * Reset the cached state. Called by PlaywrightMcpRegistration after config reset.
 */
export function invalidateCache(): void {
  cachedState = null
}
