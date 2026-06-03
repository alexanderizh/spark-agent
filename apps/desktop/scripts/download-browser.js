#!/usr/bin/env node
/**
 * download-browser.js — Pre-download chromium into apps/desktop/browsers/ for
 * bundled use. Invoked by `pnpm download-browser` (postinstall + pre-build).
 *
 * Why a local path?
 *   - Bundles chromium with the app via electron-builder `extraResources`
 *   - Avoids the per-user `~/.cache/ms-playwright/` shared cache, which
 *     would be missing on end-user machines
 *
 * Idempotent: skips download if the target directory already contains a
 * chromium build.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const APP_ROOT = path.resolve(__dirname, '..')
const BROWSERS_DIR = path.join(APP_ROOT, 'browsers')

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[download-browser] ${msg}`)
}

function tryResolve(p) {
  try {
    return require.resolve(p)
  } catch {
    return null
  }
}

/**
 * Find the playwright CLI script. Tries multiple resolution strategies
 * to handle pnpm strict hoisting + monorepo layouts.
 */
function findPlaywrightCli() {
  const candidates = [
    // 1. Direct resolution of playwright package
    () => {
      const p = tryResolve('playwright/cli.js')
      return p && fs.existsSync(p) ? p : null
    },
    // 2. Local node_modules (pnpm virtual store or hoisted)
    () => {
      const p = path.join(APP_ROOT, 'node_modules', 'playwright', 'cli.js')
      return fs.existsSync(p) ? p : null
    },
    // 3. Monorepo root node_modules
    () => {
      const p = path.join(APP_ROOT, '..', 'node_modules', 'playwright', 'cli.js')
      return fs.existsSync(p) ? p : null
    },
    // 4. Try resolving via @playwright/mcp's dependency
    () => {
      const mcpPkgPath = tryResolve('@playwright/mcp/package.json')
      if (mcpPkgPath == null) return null
      try {
        const Module = require('node:module')
        const pkgRequire = Module.createRequire(mcpPkgPath)
        const p = pkgRequire.resolve('playwright/cli.js')
        return p && fs.existsSync(p) ? p : null
      } catch {
        return null
      }
    },
  ]

  for (const fn of candidates) {
    try {
      const p = fn()
      if (p != null) return p
    } catch {
      // continue
    }
  }
  return null
}

function isChromiumAlreadyDownloaded() {
  if (!fs.existsSync(BROWSERS_DIR)) return false
  return hasChromiumSubdir(BROWSERS_DIR) && hasChromiumExecutable(BROWSERS_DIR)
}

function hasChromiumSubdir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.some((e) => e.isDirectory() && /^chromium[_-]/.test(e.name))
}

function hasChromiumExecutable(dir, depth = 0) {
  if (depth > 8) return false

  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }

  for (const entry of entries) {
    const child = path.join(dir, entry.name)
    if (entry.isFile() && isChromiumExecutableName(entry.name)) return true
    if (entry.isDirectory() && hasChromiumExecutable(child, depth + 1)) return true
  }
  return false
}

function isChromiumExecutableName(name) {
  return [
    'chrome',
    'chrome.exe',
    'chromium',
    'chromium.exe',
    'Google Chrome for Testing',
  ].includes(name)
}

function main() {
  fs.mkdirSync(BROWSERS_DIR, { recursive: true })

  if (isChromiumAlreadyDownloaded()) {
    log(`chromium already present at ${BROWSERS_DIR} — skipping download`)
    return
  }

  const cli = findPlaywrightCli()
  if (cli == null) {
    log('playwright CLI not found — skipping (likely running before install).')
    log('You can manually run: pnpm --filter @spark/desktop-dev download-browser')
    process.exit(0)
  }

  log(`Using playwright CLI: ${cli}`)
  log(`Target dir: ${BROWSERS_DIR}`)
  log('Downloading chromium (≈150 MB)...')

  const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], {
    cwd: APP_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR,
    },
  })

  if (result.status !== 0) {
    log(`playwright install failed with exit code ${result.status}`)
    process.exit(result.status ?? 1)
  }

  if (!isChromiumAlreadyDownloaded()) {
    log(`chromium download finished but no executable was found at ${BROWSERS_DIR}`)
    process.exit(1)
  }

  log('chromium downloaded successfully.')
}

main()
