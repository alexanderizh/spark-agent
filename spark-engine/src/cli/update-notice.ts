import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { DEFAULT_RELEASE_BASE, fetchLatestManifest, readUpdateSettings } from './release.js'
import { compareSemVer, isPrerelease, parseSemVer } from './semver.js'

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const NOTICE_TIMEOUT_MS = 4_000
export const UPDATE_NOTICE_DISABLE_VALUE = '0'

interface NoticeState {
  readonly lastCheckAt?: string
  readonly latestVersion?: string
}

/**
 * Interactive-TUI update notice. Contract:
 * - runs at most once per day per Spark home, cached in
 *   ~/.spark/update-check.json;
 * - disabled with SPARK_UPDATE_CHECK=0 or `[update] enabled = false`;
 * - never throws and never blocks longer than the caller's budget — callers
 *   race this against a short timeout and drop the result;
 * - one plain line on stderr; --json/--plain/piped/CI callers never reach it
 *   (the caller gates on interactive TTY).
 */
export async function updateNoticeLine(options: {
  readonly sparkHome: string
  readonly cwd: string
  readonly currentVersion: string
  readonly env?: NodeJS.ProcessEnv
  readonly now?: () => number
}): Promise<string | undefined> {
  const env = options.env ?? process.env
  if (env.SPARK_UPDATE_CHECK === UPDATE_NOTICE_DISABLE_VALUE) return undefined
  // The config kill-switch must gate the whole notice, not just the refresh:
  // a cached newer version must not resurface after the user opted out.
  if (
    readUpdateSettings({ sparkHome: options.sparkHome, cwd: options.cwd }).noticeEnabled === false
  ) {
    return undefined
  }
  const now = options.now ?? Date.now
  const statePath = join(options.sparkHome, 'update-check.json')
  const state = await readState(statePath)
  const lastCheckMs = state.lastCheckAt ? Date.parse(state.lastCheckAt) : Number.NaN

  let latestVersion = state.latestVersion
  if (!Number.isFinite(lastCheckMs) || now() - lastCheckMs >= CHECK_INTERVAL_MS) {
    latestVersion = (await refreshLatestVersion(options)) ?? latestVersion
  }

  const current = parseSemVer(options.currentVersion)
  const latest = latestVersion === undefined ? undefined : parseSemVer(latestVersion)
  if (!current || !latest || isPrerelease(latest)) return undefined
  if (compareSemVer(current, latest) >= 0) return undefined
  return `spark ${latest.raw} is available — run \`spark update\` to upgrade (disable with SPARK_UPDATE_CHECK=0)`
}

async function refreshLatestVersion(options: {
  readonly sparkHome: string
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
}): Promise<string | undefined> {
  const settings = readUpdateSettings({ sparkHome: options.sparkHome, cwd: options.cwd })
  if (settings.noticeEnabled === false) return undefined
  const env = options.env ?? process.env
  const base =
    env.SPARK_RELEASE_BASE ?? env.SPARK_INSTALL_BASE ?? settings.base ?? DEFAULT_RELEASE_BASE
  const statePath = join(options.sparkHome, 'update-check.json')
  try {
    let version: string | undefined
    try {
      version = (await fetchLatestManifest(base, { timeoutMs: NOTICE_TIMEOUT_MS })).version
    } catch {
      // An unreachable or broken release host still records the attempt, so a
      // dead endpoint does not turn into a per-invocation retry.
    }
    await writeState(
      statePath,
      version === undefined
        ? { lastCheckAt: new Date().toISOString() }
        : { lastCheckAt: new Date().toISOString(), latestVersion: version },
    )
    return version
  } catch {
    return undefined
  }
}

async function readState(path: string): Promise<NoticeState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    const record = parsed as Record<string, unknown>
    return {
      ...(typeof record.lastCheckAt === 'string' ? { lastCheckAt: record.lastCheckAt } : {}),
      ...(typeof record.latestVersion === 'string' ? { latestVersion: record.latestVersion } : {}),
    }
  } catch {
    return {}
  }
}

async function writeState(path: string, state: NoticeState): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(state)}\n`, 'utf8')
    await rename(temporary, path)
  } catch {
    // The notice is advisory; cache failures are silent by design.
  }
}
