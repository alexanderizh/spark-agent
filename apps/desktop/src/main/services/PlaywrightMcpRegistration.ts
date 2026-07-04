/**
 * PlaywrightMcpRegistration — Auto-register the managed `playwright` MCP server.
 *
 * Responsibilities:
 *   1. Ensure exactly one DB row exists with `scope=managed, name=playwright`
 *   2. Default to `enabled=1` (user explicitly requested auto-enable)
 *   3. Default mode is `headful` (Playwright launches its own visible browser)
 *   4. Keep `cdpEndpoint` only as a compatibility input; normal registration
 *      passes null and does not reuse Electron windows
 *   5. Dynamically choose browser args based on what's available:
 *      - Bundled Chromium → `--browser chromium`
 *      - System Chrome/Edge → `--channel chrome` / `--channel msedge`
 *   6. Idempotent — preserves user `enabled` preference on re-registration
 *
 * This module is the single source of truth for the playwright MCP server's
 * configJson. The "reset config" IPC handler delegates here.
 */

import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import type { SparkDatabase } from '@spark/storage'
import { McpServerRepository } from '@spark/storage'
import { MANAGED_MCP_SCOPE, PLAYWRIGHT_MCP_NAME } from '@spark/agent-runtime'
import { createLogger } from '@spark/shared'
import { getPlaywrightEnv, resolveBrowserStrategy } from './PlaywrightEnvironment.js'

const log = createLogger('playwright-mcp-registration')

export type PlaywrightMode = 'headful' | 'headless'

export interface PlaywrightMcpConfig {
  type: 'stdio'
  command: string
  args: string[]
  /** Environment variables for the MCP subprocess (PLAYWRIGHT_BROWSERS_PATH, etc). */
  env?: Record<string, string>
}

export interface RegisterOptions {
  /** Force overwrite of `config_json` even if row already exists (preserves `enabled`). */
  force?: boolean
  /** Override run mode (used when toggling headful/headless from UI). */
  mode?: PlaywrightMode
  /** If provided, appends `--cdp-endpoint=<url>` to args. */
  cdpEndpoint?: string | null
}

/**
 * Build the canonical configJson for the playwright MCP server.
 *
 * Args design:
 *   - Bundled Chromium: `--browser chromium`
 *   - System Chrome: `--channel chrome`
 *   - System Edge: `--channel msedge`
 *   - `--headless`             — only when mode === 'headless'
 *   - `--cdp-endpoint=<url>`   — compatibility only; current registration passes null
 *
 * Env design:
 *   - `PLAYWRIGHT_BROWSERS_PATH` injected when bundled chromium is available,
 *     so the MCP subprocess uses the bundled binary instead of looking in
 *     ~/.cache/ms-playwright (which won't exist on end-user machines).
 */
export function buildPlaywrightConfig(
  mode: PlaywrightMode,
  cdpEndpoint: string | null,
): PlaywrightMcpConfig {
  const cliPath = resolvePlaywrightMcpCliPath()
  const args: string[] = [cliPath]

  // Choose browser arg based on what's available.
  //
  // The CLI `--browser` flag accepts only: chrome | firefox | webkit | msedge
  // ("chromium" is the DEFAULT but is not a valid value for the flag —
  // passing it would have @playwright/mcp error out). For bundled chromium we
  // simply omit the flag and let PLAYWRIGHT_BROWSERS_PATH (set via env) route
  // the default chromium download to our bundled binary.
  const strategy = resolveBrowserStrategy()
  if (strategy?.type === 'system') {
    // strategy.channel is already 'chrome' | 'msedge' — both are valid --browser values
    args.push('--browser', strategy.channel)
  }
  // else: bundled or none → omit --browser, default chromium will be used

  if (mode === 'headless') {
    args.push('--headless')
  }
  if (cdpEndpoint != null && cdpEndpoint.length > 0) {
    args.push('--cdp-endpoint', cdpEndpoint)
  }
  const config: PlaywrightMcpConfig = {
    type: 'stdio',
    command: process.execPath,
    args,
    env: {
      ELECTRON_RUN_AS_NODE: '1',
    },
  }
  const env = getPlaywrightEnv()
  if (Object.keys(env).length > 0) {
    config.env = { ...config.env, ...env }
  }
  return config
}

function resolvePlaywrightMcpCliPath(): string {
  const require = createRequire(import.meta.url)
  const packageJsonPath = require.resolve('@playwright/mcp/package.json')
  return join(dirname(packageJsonPath), 'cli.js')
}

/**
 * Ensure the playwright MCP server row exists in DB. Idempotent.
 *
 * @returns the persisted enabled state and current mode (for status reporting)
 */
export function ensureRegistered(
  db: SparkDatabase,
  opts: RegisterOptions = {},
): { id: string; enabled: boolean; mode: PlaywrightMode; configJson: string } {
  const repo = new McpServerRepository(db)
  const existingRows = repo.findByScope(MANAGED_MCP_SCOPE)
  const existing = existingRows.find((r) => r.name === PLAYWRIGHT_MCP_NAME)

  // Determine target mode
  let targetMode: PlaywrightMode = opts.mode ?? 'headful'
  if (opts.mode == null && existing != null) {
    // Preserve existing mode unless caller forced a change
    const parsed = parseModeFromConfig(existing.config_json)
    if (parsed != null) targetMode = parsed
  }

  // Determine CDP endpoint (transient — caller passes it in)
  const cdpEndpoint = opts.cdpEndpoint ?? null
  const config = buildPlaywrightConfig(targetMode, cdpEndpoint)
  const configJson = JSON.stringify(config)

  if (existing == null) {
    // First registration — auto-enable per product decision
    const row = repo.create({
      scope: MANAGED_MCP_SCOPE,
      name: PLAYWRIGHT_MCP_NAME,
      configJson,
      enabled: true,
    })
    log.info(`Registered managed MCP server: ${PLAYWRIGHT_MCP_NAME} (id=${row.id}, enabled=true, mode=${targetMode})`)
    return { id: row.id, enabled: true, mode: targetMode, configJson }
  }

  // Existing row — update config if forced or if structural change is needed
  const needsUpdate =
    opts.force ||
    opts.mode !== undefined ||
    opts.cdpEndpoint !== undefined ||
    existing.config_json !== configJson

  if (needsUpdate) {
    const row = repo.update(existing.id, { configJson })
    log.info(
      `Updated managed MCP server config: ${PLAYWRIGHT_MCP_NAME} (mode=${targetMode}, cdp=${cdpEndpoint ?? 'none'})`,
    )
    return {
      id: existing.id,
      enabled: row?.enabled === 1,
      mode: targetMode,
      configJson: row?.config_json ?? configJson,
    }
  }

  return {
    id: existing.id,
    enabled: existing.enabled === 1,
    mode: targetMode,
    configJson: existing.config_json,
  }
}

/**
 * Look up the persisted mode (headful/headless) from existing configJson.
 */
function parseModeFromConfig(configJson: string): PlaywrightMode | null {
  try {
    const config = JSON.parse(configJson) as { args?: string[] }
    if (Array.isArray(config.args) && config.args.includes('--headless')) {
      return 'headless'
    }
    return 'headful'
  } catch {
    return null
  }
}

/**
 * Set the persisted enabled flag.
 */
export function setEnabled(db: SparkDatabase, enabled: boolean): void {
  const repo = new McpServerRepository(db)
  const row = repo
    .findByScope(MANAGED_MCP_SCOPE)
    .find((r) => r.name === PLAYWRIGHT_MCP_NAME)
  if (row == null) {
    log.warn(`Cannot toggle: managed MCP server "${PLAYWRIGHT_MCP_NAME}" not registered`)
    return
  }
  repo.update(row.id, { enabled })
}

/**
 * Read current registration state without writing.
 */
export function readRegistration(db: SparkDatabase): {
  id: string | null
  enabled: boolean
  mode: PlaywrightMode
  registered: boolean
} {
  const repo = new McpServerRepository(db)
  const row = repo
    .findByScope(MANAGED_MCP_SCOPE)
    .find((r) => r.name === PLAYWRIGHT_MCP_NAME)
  if (row == null) {
    return { id: null, enabled: false, mode: 'headful', registered: false }
  }
  return {
    id: row.id,
    enabled: row.enabled === 1,
    mode: parseModeFromConfig(row.config_json) ?? 'headful',
    registered: true,
  }
}
