/**
 * PlaywrightEnvironment — Resolve + configure the bundled chromium path.
 *
 * Chromium can be downloaded into `apps/desktop/browsers/` via the
 * `download-browser.js` script for local use. Packaged builds no longer bundle
 * this directory by default; runtime falls back to system Chrome / Edge or
 * Playwright's default cache when no bundled Chromium exists.
 *
 * At runtime this module:
 *   1. Resolves the absolute browsers path (dev vs. packaged)
 *   2. Sets `PLAYWRIGHT_BROWSERS_PATH` on `process.env` so any child process
 *      spawned by `playwright` (including `@playwright/mcp` stdio MCP server)
 *      inherits it and finds the bundled chromium
 *   3. Falls back to system Chrome / Edge if no bundled chromium is found
 *   4. Exports the resolved path + env spread for callers that need to pass
 *      it explicitly to `spawn()`
 */
import { existsSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { app } from 'electron'
import { createLogger } from '@spark/shared'

const log = createLogger('playwright-env')

let cachedBrowsersPath: string | null | undefined = undefined

function getMonorepoRootCandidates(): string[] {
  const candidates: string[] = []

  candidates.push(process.cwd())
  candidates.push(resolve(__dirname, '..', '..', '..', '..'))
  candidates.push(resolve(__dirname, '..', '..', '..'))

  try {
    const appPath = app.getAppPath()
    if (appPath) {
      candidates.push(appPath)
      candidates.push(resolve(appPath, '..'))
      candidates.push(resolve(appPath, '..', '..'))
    }
  } catch {
    // app may not be ready in tests or very early startup
  }

  return [...new Set(candidates)]
}

function getBundledBrowserDirCandidates(): string[] {
  const candidates: string[] = []

  if (process.env.PLAYWRIGHT_BROWSERS_PATH != null) {
    candidates.push(process.env.PLAYWRIGHT_BROWSERS_PATH)
  }

  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, 'browsers'))
  }

  // Keep the direct __dirname-derived guesses first for the common dev case,
  // then fall back to monorepo-root-derived locations when the runtime layout
  // differs from what electron-vite produced.
  candidates.push(resolve(__dirname, '..', '..', '..', '..', 'browsers'))
  candidates.push(resolve(__dirname, '..', '..', '..', 'browsers'))

  for (const root of getMonorepoRootCandidates()) {
    candidates.push(join(root, 'browsers'))
    candidates.push(join(root, 'apps', 'desktop', 'browsers'))
  }

  return [...new Set(candidates)]
}

/**
 * Resolve the bundled chromium directory.
 *
 * - Dev mode: `apps/desktop/browsers/` (relative to the monorepo root)
 * - Packaged: `process.resourcesPath/browsers/` if a custom build includes it
 *
 * Returns null if neither location contains a chromium-* subdirectory — this
 * indicates Chromium was not downloaded into the optional bundled browser
 * directory. Callers should fall back to Playwright's
 * default lookup (~/.cache/ms-playwright) by leaving env unset.
 */
export function getBundledBrowsersPath(): string | null {
  if (cachedBrowsersPath !== undefined) return cachedBrowsersPath

  const candidates = getBundledBrowserDirCandidates()

  for (const dir of candidates) {
    if (existsSync(dir) && hasUsableChromium(dir)) {
      cachedBrowsersPath = dir
      log.info(`Bundled chromium found at: ${dir}`)
      return dir
    }
  }

  log.warn(
    `No usable bundled chromium found in candidates: ${candidates.join(', ')}. Will fall back to system Chrome or Playwright default cache.`,
  )
  cachedBrowsersPath = null
  return null
}

function hasUsableChromium(dir: string): boolean {
  if (!hasChromiumSubdir(dir)) return false
  if (canPlaywrightResolveChromiumFrom(dir)) return true
  return hasChromiumExecutable(dir)
}

function hasChromiumSubdir(dir: string): boolean {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    return entries.some(
      (e) => e.isDirectory() && /^chromium[_-]/.test(e.name),
    )
  } catch {
    return false
  }
}

function canPlaywrightResolveChromiumFrom(dir: string): boolean {
  const previous = process.env.PLAYWRIGHT_BROWSERS_PATH
  try {
    process.env.PLAYWRIGHT_BROWSERS_PATH = dir
    const require = createRequire(import.meta.url)
    const pw = require('playwright') as { chromium?: { executablePath: () => string } }
    if (pw.chromium == null) return false
    const exePath = pw.chromium.executablePath()
    return typeof exePath === 'string' && exePath.length > 0 && existsSync(exePath)
  } catch {
    return false
  } finally {
    if (previous == null) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = previous
    }
  }
}

function hasChromiumExecutable(dir: string, depth = 0): boolean {
  if (depth > 8) return false
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }

  for (const entry of entries) {
    const child = join(dir, entry.name)
    if (entry.isFile() && isChromiumExecutableName(entry.name)) return true
    if (entry.isDirectory() && hasChromiumExecutable(child, depth + 1)) return true
  }
  return false
}

function isChromiumExecutableName(name: string): boolean {
  return (
    name === 'chrome' ||
    name === 'chrome.exe' ||
    name === 'chromium' ||
    name === 'chromium.exe' ||
    name === 'Google Chrome for Testing'
  )
}

// ─── System Browser Detection ─────────────────────────────────────────────

const SYSTEM_CHROME_PATHS_WIN = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

const SYSTEM_EDGE_PATHS_WIN = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const SYSTEM_CHROME_PATHS_MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

const SYSTEM_CHROME_PATHS_LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
]

/**
 * Detect whether a Chromium-based browser is installed on the system.
 * Returns the browser channel to use with `@playwright/mcp`:
 *   - 'chrome' for Google Chrome
 *   - 'msedge' for Microsoft Edge
 *   - null if no system browser found
 */
export function detectSystemBrowser(): 'chrome' | 'msedge' | null {
  const paths =
    process.platform === 'win32'
      ? [...SYSTEM_CHROME_PATHS_WIN, ...SYSTEM_EDGE_PATHS_WIN]
      : process.platform === 'darwin'
        ? SYSTEM_CHROME_PATHS_MAC
        : SYSTEM_CHROME_PATHS_LINUX

  for (const p of paths) {
    if (existsSync(p)) {
      // Determine channel from path
      if (p.includes('Edge') || p.includes('msedge')) {
        log.info(`System Edge found at: ${p}`)
        return 'msedge'
      }
      log.info(`System Chrome found at: ${p}`)
      return 'chrome'
    }
  }

  return null
}

/**
 * Detect whether Playwright's default chromium discovery succeeds.
 *
 * Playwright stores chromium in different layouts across versions:
 *   - Older: `<browsers-root>/chromium-NNNN/chrome-{platform}/chrome.exe`
 *   - Newer (post-1.50ish): `<browsers-root>/b/browser@<hash>/...`
 *
 * Rather than trying to reverse-engineer the layout, we just ask Playwright
 * itself via `chromium.executablePath()` and check the binary exists. If yes,
 * we KNOW Playwright can find it on its own — we should leave
 * PLAYWRIGHT_BROWSERS_PATH unset and let auto-discovery work.
 */
function isPlaywrightDefaultChromiumAvailable(): boolean {
  try {
    const require = createRequire(import.meta.url)
    const pw = require('playwright') as { chromium?: { executablePath: () => string } }
    if (pw.chromium == null) return false
    const exePath = pw.chromium.executablePath()
    return typeof exePath === 'string' && exePath.length > 0 && existsSync(exePath)
  } catch {
    return false
  }
}

/**
 * Determine which browser strategy to use for Playwright MCP.
 * Priority: bundled chromium → Playwright cache chromium → system Chrome/Edge → null
 *
 * IMPORTANT: chromium variants ALWAYS win over system browsers. Falling back to
 * system Edge/Chrome silently changes which engine the agent drives, which the
 * user does not expect — they installed our bundled chromium for a reason.
 *
 * Returns:
 *   - `{ type: 'bundled', browserPath: string }` — use chromium (either our
 *     `apps/desktop/browsers/` or Playwright's `~/.cache/ms-playwright`)
 *   - `{ type: 'system', channel: 'chrome' | 'msedge' }` — use system browser
 *   - `null` — no browser available
 */
export function resolveBrowserStrategy(): {
  type: 'bundled'
  browserPath: string
} | {
  type: 'system'
  channel: 'chrome' | 'msedge'
} | null {
  // 1. Locally downloaded chromium (or app-bundled chromium in custom builds) — best
  const bundledPath = getBundledBrowsersPath()
  if (bundledPath != null) {
    return { type: 'bundled', browserPath: bundledPath }
  }

  // 2. Playwright's own cache (~/.cache/ms-playwright or
  //    %LOCALAPPDATA%/ms-playwright). Common in dev where
  //    `pnpm exec playwright install` was run but our download-browser script
  //    didn't run / browsers/ dir is empty. We don't return a path here —
  //    Playwright knows where its own chromium lives, and the layout differs
  //    between versions (chromium-NNNN/ vs b/browser@hash/). The empty
  //    browserPath signals to callers: "use chromium, don't override env".
  if (isPlaywrightDefaultChromiumAvailable()) {
    log.info('Using Playwright default chromium (auto-discovery via playwright module)')
    return { type: 'bundled', browserPath: '' }
  }

  // 3. System browser fallback — last resort
  const channel = detectSystemBrowser()
  if (channel != null) {
    log.warn(`No chromium found, falling back to system ${channel}`)
    return { type: 'system', channel }
  }

  return null
}

// ─── Env Configuration ─────────────────────────────────────────────────────

/**
 * Ensure `process.env.PLAYWRIGHT_BROWSERS_PATH` is set. Idempotent — only sets
 * if bundled path is available AND the env is not already set (which would
 * mean the caller intentionally overrode it).
 *
 * Should be called early in main process startup, BEFORE any MCP server
 * subprocess is spawned.
 */
export function ensureBundledBrowserEnv(): void {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH != null) {
    log.info(
      `PLAYWRIGHT_BROWSERS_PATH already set: ${process.env.PLAYWRIGHT_BROWSERS_PATH}`,
    )
    return
  }
  // ONLY override the env when we have an app-bundled chromium dir.
  // If we don't, do NOT set the env — Playwright's own auto-discovery handles
  // its default cache (which uses a version-dependent layout we shouldn't
  // hard-code: chromium-NNNN/ for old, b/browser@hash/ for new).
  const path = getBundledBrowsersPath()
  if (path != null) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path
    log.info(`Set PLAYWRIGHT_BROWSERS_PATH=${path}`)
  }
}

/**
 * Returns an env object suitable for spreading into `spawn()` calls (e.g.
 * when launching the Playwright MCP server subprocess). Includes the bundled
 * browsers path if available.
 */
export function getPlaywrightEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  // Same policy as ensureBundledBrowserEnv: only override env when we have an
  // app-bundled location. Otherwise Playwright auto-discovers from its own
  // cache (no env needed, layout differs across versions).
  const path = getBundledBrowsersPath()
  if (path != null) {
    env.PLAYWRIGHT_BROWSERS_PATH = path
  }
  return env
}

/**
 * Reset the cached browsers path so the next call to `getBundledBrowsersPath()`
 * re-scans the filesystem. Call this after downloading the browser to the
 * bundled directory.
 */
export function resetBundledBrowsersPathCache(): void {
  cachedBrowsersPath = undefined
}
