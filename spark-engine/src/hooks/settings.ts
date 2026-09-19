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
  /** Per-scope validated configs in ascending-precedence order; empty when no file loaded. */
  readonly scopedConfigs: readonly { scope: HookSettingsScope; config: HooksConfig }[]
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
  return { config: mergeHooksConfigs(configs), files, issues, scopedConfigs: configs }
}

export interface LoadHookRunnerOptions {
  readonly cwd: string
  /** Directory holding the user-scope settings.json (the shared data root). */
  readonly userSettingsDir: string
  readonly spawn?: HookSpawn
  readonly telemetry?: Telemetry
  readonly env?: NodeJS.ProcessEnv
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
    ...(options.env === undefined ? {} : { env: options.env }),
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

/** One hook command as listed for hosts (mirrors the Claude SDK's get_hooks_listing shape, host-relevant subset). */
export interface ListedHookEntry {
  readonly event: HookEventName
  /** Tool-name glob for PreToolUse/PostToolUse; absent = all tools. */
  readonly matcher?: string
  readonly command: string
  readonly timeoutMs?: number
  /** File the entry was loaded from, when discovery kept file attribution. */
  readonly sourcePath: string | null
  /** Settings scope the entry came from (ascending precedence: user → project → local). */
  readonly scope: HookSettingsScope
}

/**
 * Flattens discovered settings into a per-command listing. Scope order follows
 * hookSettingsFiles (ascending precedence: user → project → local); every
 * entry from every loaded file is listed, matching the merge semantics of
 * loadHookRunner. Informational only — hosts edit the source files.
 */
export function listHookEntries(discovered: DiscoveredHookSettings): readonly ListedHookEntry[] {
  const pathByScope = new Map<HookSettingsScope, string>()
  for (const file of discovered.files) pathByScope.set(file.scope, file.path)
  const entries: ListedHookEntry[] = []
  for (const { scope, config } of discovered.scopedConfigs) {
    const sourcePath = pathByScope.get(scope) ?? null
    for (const event of Object.keys(config) as HookEventName[]) {
      for (const matcherGroup of config[event] ?? []) {
        for (const hook of matcherGroup.hooks) {
          entries.push({
            event,
            ...(matcherGroup.matcher ? { matcher: matcherGroup.matcher } : {}),
            command: hook.command,
            ...(hook.timeoutMs ? { timeoutMs: hook.timeoutMs } : {}),
            sourcePath,
            scope,
          })
        }
      }
    }
  }
  return entries
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
