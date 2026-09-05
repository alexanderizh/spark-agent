import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { HookRunner, type HookSpawn } from './runner.js'
import { HooksConfigSchema, type HookEventName, type HooksConfig } from './types.js'
import type { Telemetry } from '../seams.js'

export type HookSettingsScope = 'user' | 'project' | 'local'

export interface HookSettingsFile {
  readonly path: string
  readonly scope: HookSettingsScope
}

export interface HookSettingsIssue {
  readonly path: string
  readonly message: string
}

export interface DiscoveredHookSettings {
  readonly config: HooksConfig
  readonly files: readonly HookSettingsFile[]
  readonly issues: readonly HookSettingsIssue[]
}

/**
 * Settings files, in ascending precedence (all hook entries run, earlier
 * scopes first): user `settings.json`, project `settings.json`, project
 * `settings.local.json`.
 */
export function hookSettingsFiles(
  cwd: string,
  userSettingsDir: string,
): readonly HookSettingsFile[] {
  return [
    { path: join(userSettingsDir, 'settings.json'), scope: 'user' },
    { path: join(cwd, '.spark', 'settings.json'), scope: 'project' },
    { path: join(cwd, '.spark', 'settings.local.json'), scope: 'local' },
  ]
}

type SyncReader = (path: string) => string

/** Synchronous discovery, run once at env construction; a broken file is skipped, never fatal. */
export function discoverHookSettings(
  cwd: string,
  userSettingsDir: string,
  read: SyncReader = (path) => readFileSync(path, 'utf8'),
): DiscoveredHookSettings {
  const configs: { scope: HookSettingsScope; config: HooksConfig }[] = []
  const files: HookSettingsFile[] = []
  const issues: HookSettingsIssue[] = []
  for (const file of hookSettingsFiles(cwd, userSettingsDir)) {
    let raw: string
    try {
      raw = read(file.path)
    } catch {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      issues.push({ path: file.path, message: errorMessage(error) })
      continue
    }
    const validated = HooksConfigSchema.safeParse(parsed)
    if (!validated.success) {
      issues.push({ path: file.path, message: validated.error.issues.map(issueIssue).join('; ') })
      continue
    }
    configs.push({ scope: file.scope, config: validated.data })
    files.push(file)
  }
  return { config: mergeHooksConfigs(configs), files, issues }
}

export interface LoadHookRunnerOptions {
  readonly cwd: string
  /** Directory holding the user-scope settings.json (the shared data root). */
  readonly userSettingsDir: string
  readonly spawn?: HookSpawn
  readonly telemetry?: Telemetry
}

/**
 * Builds the session-independent hook runner from discovered settings, or
 * returns undefined when no settings file exists so env construction stays
 * zero-cost for users without hooks.
 */
export function loadHookRunner(options: LoadHookRunnerOptions): HookRunner | undefined {
  const discovered = discoverHookSettings(options.cwd, options.userSettingsDir)
  if (discovered.files.length === 0) return undefined
  return new HookRunner({
    config: discovered.config,
    ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
    ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
  })
}

/** Merges per-event matcher arrays; entries from every source are kept in scope order. */
function mergeHooksConfigs(
  configs: readonly { scope: HookSettingsScope; config: HooksConfig }[],
): HooksConfig {
  const merged: HooksConfig = {}
  for (const { config } of configs) {
    for (const event of Object.keys(config) as HookEventName[]) {
      const matchers = config[event]
      if (!matchers) continue
      merged[event] = [...(merged[event] ?? []), ...matchers]
    }
  }
  return merged
}

function issueIssue(issue: {
  readonly path: readonly PropertyKey[]
  readonly message: string
}): string {
  return `${issue.path.map((key) => String(key)).join('.')}: ${issue.message}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
