#!/usr/bin/env node
/**
 * download-browser.js — Pre-download chromium into apps/desktop/browsers/ for
 * local use. Invoked manually by `pnpm download-browser` when Chromium should
 * be downloaded into apps/desktop/browsers/.
 *
 * Why a local path?
 *   - Keeps chromium out of Playwright's per-user `~/.cache/ms-playwright/`
 *   - Avoids the per-user `~/.cache/ms-playwright/` shared cache, which
 *     would be missing on end-user machines
 *
 * Idempotent: skips download if the target directory already contains a
 * chromium build.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const https = require('node:https')
const { createWriteStream, createReadStream } = require('node:fs')
const { pipeline } = require('node:stream/promises')
const { createUnzip } = require('node:zlib')

const APP_ROOT = path.resolve(__dirname, '..')
const BROWSERS_DIR = path.join(APP_ROOT, 'browsers')

const CFT_BASE = 'https://storage.googleapis.com/chrome-for-testing-public'

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

/**
 * Resolve path to playwright-core's browsers.json.
 * Can't use require.resolve('playwright-core/browsers.json') because
 * the package's "exports" field doesn't expose it.
 */
function findBrowsersJson() {
  const candidates = [
    () => {
      const pkg = tryResolve('playwright-core')
      if (pkg == null) return null
      const p = path.join(path.dirname(pkg), 'browsers.json')
      return fs.existsSync(p) ? p : null
    },
    () => {
      const p = path.join(APP_ROOT, 'node_modules', 'playwright-core', 'browsers.json')
      return fs.existsSync(p) ? p : null
    },
    () => {
      const p = path.join(APP_ROOT, '..', 'node_modules', 'playwright-core', 'browsers.json')
      return fs.existsSync(p) ? p : null
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

function readChromiumDescriptor() {
  const browsersJsonPath = findBrowsersJson()
  if (!browsersJsonPath) return null
  try {
    const json = JSON.parse(fs.readFileSync(browsersJsonPath, 'utf8'))
    return json.browsers.find((b) => b.name === 'chromium') || null
  } catch {
    return null
  }
}

/**
 * Download a file via HTTPS. Returns a promise.
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    https
      .get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close()
          fs.unlinkSync(dest)
          downloadFile(response.headers.location, dest).then(resolve).catch(reject)
          return
        }
        if (response.statusCode !== 200) {
          file.close()
          fs.unlinkSync(dest)
          reject(new Error(`Download failed: HTTP ${response.statusCode} for ${url}`))
          return
        }
        response.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
      })
      .on('error', (err) => {
        file.close()
        try { fs.unlinkSync(dest) } catch {}
        reject(err)
      })
  })
}

/**
 * Extract a zip file using the system's `unzip` command (macOS).
 */
function extractZip(zipPath, destDir) {
  const result = spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`unzip failed with exit code ${result.status}`)
  }
}

/**
 * On macOS arm64, also download the x64 chromium + headless-shell
 * so that the universal macOS build bundles both architectures.
 */
async function downloadCrossPlatformMac() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return

  const desc = readChromiumDescriptor()
  if (!desc || !desc.browserVersion || !desc.revision) {
    log('Could not determine chromium version — skipping cross-platform download')
    return
  }

  const { browserVersion, revision } = desc

  const chromiumDir = path.join(BROWSERS_DIR, `chromium-${revision}`)
  const headlessDir = path.join(BROWSERS_DIR, `chromium_headless_shell-${revision}`)
  const x64Dir = path.join(chromiumDir, 'chrome-mac-x64')
  const x64HeadlessDir = path.join(headlessDir, 'chrome-headless-shell-mac-x64')

  // Skip if x64 already present
  if (fs.existsSync(x64Dir) && fs.existsSync(x64HeadlessDir)) {
    log('x64 chromium already present — skipping cross-platform download')
    return
  }

  const tmpDir = path.join(BROWSERS_DIR, '.tmp-x64')
  fs.mkdirSync(tmpDir, { recursive: true })

  try {
    // Download x64 chromium
    if (!fs.existsSync(x64Dir)) {
      const url = `${CFT_BASE}/${browserVersion}/mac-x64/chrome-mac-x64.zip`
      const zipPath = path.join(tmpDir, 'chrome-mac-x64.zip')
      log(`Downloading x64 chromium ${browserVersion}...`)
      await downloadFile(url, zipPath)
      extractZip(zipPath, chromiumDir)
      fs.unlinkSync(zipPath)
      log('x64 chromium downloaded successfully.')
    }

    // Download x64 headless shell
    if (!fs.existsSync(x64HeadlessDir)) {
      const url = `${CFT_BASE}/${browserVersion}/mac-x64/chrome-headless-shell-mac-x64.zip`
      const zipPath = path.join(tmpDir, 'chrome-headless-shell-mac-x64.zip')
      log(`Downloading x64 chromium-headless-shell ${browserVersion}...`)
      await downloadFile(url, zipPath)
      extractZip(zipPath, headlessDir)
      fs.unlinkSync(zipPath)
      log('x64 chromium-headless-shell downloaded successfully.')
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

async function main() {
  fs.mkdirSync(BROWSERS_DIR, { recursive: true })

  if (isChromiumAlreadyDownloaded()) {
    log(`chromium already present at ${BROWSERS_DIR} — skipping download`)
  } else {
    const cli = findPlaywrightCli()
    if (cli == null) {
      log('playwright CLI not found — skipping (likely running before install).')
      log('You can manually run: pnpm --filter @spark/desktop download-browser')
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

  // Download x64 chromium for universal macOS build
  await downloadCrossPlatformMac()
}

main().catch((err) => {
  log(`Error: ${err.message}`)
  process.exit(1)
})
