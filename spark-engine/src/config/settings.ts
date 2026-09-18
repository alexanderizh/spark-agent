import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { z } from 'zod'

import type { SparkMcpServerConfig, SparkMcpServerMap } from '../mcp/types.js'
import type { PermissionRule } from '../permission/policy.js'
import { isPermissionMode, type PermissionMode } from '../permission/types.js'
import type { ContextCompactionPolicy } from '../seams.js'
import {
  ConfigFileError,
  deepMergeLayers,
  deleteValueAtPath,
  errorMessage,
  getValueAtPath,
  parseSettingPath,
  readTomlLayer,
  setValueAtPath,
  writeTomlLayerAtomic,
  type TomlLayer,
} from './config-file.js'
import { ModelConfigSchema, type ModelConfig } from './root-schema.js'

/**
 * User-facing settings layer on top of the shared config schema.
 *
 * `model-config.ts` answers "which model does this turn use"; this module
 * answers "how is the CLI itself configured" and owns the read/validate/write
 * path used by `spark config`.
 */
export class SparkSettingsError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'SparkSettingsError'
  }
}

export type SettingsScope = 'global' | 'project'

export interface SparkSettingsPaths {
  readonly sparkHome: string
  readonly globalPath: string
  readonly projectPath: string
}

export interface SparkSettingsOptions {
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
  readonly sparkHome?: string
  readonly globalConfigPath?: string
  readonly projectConfigPath?: string
}

export interface SparkSettings {
  readonly paths: SparkSettingsPaths
  /** Parsed, default-filled view of the merged layers. */
  readonly config: ModelConfig
  /** Merged raw layers, before schema defaults are applied. */
  readonly mergedLayer: Readonly<Record<string, unknown>>
  readonly global: TomlLayer
  readonly project: TomlLayer
}

export interface ResolvedPermissionSettings {
  readonly mode?: PermissionMode
  readonly allowedTools: readonly string[]
  readonly disallowedTools: readonly string[]
  readonly rules: readonly PermissionRule[]
}

export interface ResolvedToolFilter {
  readonly enabled?: readonly string[]
  readonly disabled: readonly string[]
}

export interface ResolvedMcpSettings {
  readonly servers: SparkMcpServerMap
  readonly startupTimeoutMs?: number
}

export interface ResolvedMemorySettings {
  readonly enabled: boolean
  readonly maxInjectTokens: number
  readonly agentId: string
}

export interface SettingEntry {
  readonly key: string
  readonly value: unknown
  readonly scope: SettingsScope | 'default'
  readonly sourcePath: string
}

export function resolveSparkSettingsPaths(options: SparkSettingsOptions): SparkSettingsPaths {
  const environment = options.env ?? process.env
  const sparkHome = resolve(
    options.sparkHome ?? environment.SPARK_HOME ?? resolve(homedir(), '.spark'),
  )
  return {
    sparkHome,
    globalPath: resolve(options.globalConfigPath ?? resolve(sparkHome, 'config.toml')),
    projectPath: resolve(
      options.projectConfigPath ?? resolve(options.cwd, '.spark', 'config.toml'),
    ),
  }
}

export async function loadSparkSettings(options: SparkSettingsOptions): Promise<SparkSettings> {
  const paths = resolveSparkSettingsPaths(options)
  const global = await readSettingsLayer(paths.globalPath)
  const project =
    paths.projectPath === paths.globalPath
      ? { layer: {}, exists: false }
      : await readSettingsLayer(paths.projectPath)
  const mergedLayer = deepMergeLayers(global.layer, project.layer)
  let config: ModelConfig
  try {
    config = ModelConfigSchema.parse(mergedLayer)
  } catch (error) {
    throw new SparkSettingsError(`Invalid Spark configuration: ${formatIssues(error)}`, {
      cause: error,
    })
  }
  return { paths, config, mergedLayer, global, project }
}

/**
 * Maps the `[permissions]` / `[tools]` sections onto the engine's policy
 * inputs. Deny entries are hard denies (they survive `bypass`) rather than
 * ordinary rules, so a configured deny can never be skipped by switching modes.
 */
export function resolvePermissionSettings(settings: SparkSettings): ResolvedPermissionSettings {
  const permissions = settings.config.permissions
  const tools = settings.config.tools
  const askPatterns = permissions?.ask ?? []
  return {
    ...(permissions?.mode === undefined ? {} : { mode: permissions.mode }),
    allowedTools: [...(permissions?.allow ?? [])],
    disallowedTools: [...(tools?.disabled ?? []), ...(permissions?.deny ?? [])],
    rules: askPatterns.map((tool, index) => ({
      id: `settings-ask-${index + 1}`,
      tool,
      action: 'ask' as const,
      reason: 'Required by [permissions].ask',
      remember: 'session' as const,
    })),
  }
}

/** `[tools]` decides which tools are exposed to the model at all. */
export function resolveToolFilter(settings: SparkSettings): ResolvedToolFilter {
  const tools = settings.config.tools
  return {
    ...(tools?.enabled === undefined ? {} : { enabled: [...tools.enabled] }),
    disabled: [...(tools?.disabled ?? [])],
  }
}

/** `[permissions].mode`, when configured. */
export function resolveDefaultPermissionMode(settings: SparkSettings): PermissionMode | undefined {
  return settings.config.permissions?.mode
}

/**
 * Default mode for a new session, with the precedence the CLI documents:
 * an explicitly saved interactive choice (`/perm` writes `agent.permission_mode`)
 * wins over the static `[permissions].mode` default, which wins over the
 * built-in `manual`. A caller can still override both with an explicit flag.
 */
export function resolveSessionPermissionMode(settings: SparkSettings): PermissionMode | undefined {
  return resolveStoredPermissionMode(settings) ?? resolveDefaultPermissionMode(settings)
}

/** The saved `/perm` preference, ignoring the schema default of `manual`. */
export function resolveStoredPermissionMode(settings: SparkSettings): PermissionMode | undefined {
  const stored = getValueAtPath(settings.mergedLayer, ['agent', 'permission_mode'])
  return isPermissionMode(stored) ? stored : undefined
}

export function resolveMcpSettings(
  settings: SparkSettings,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedMcpSettings {
  const mcp = settings.config.mcp
  if (mcp === undefined) return { servers: {} }
  const servers: Record<string, SparkMcpServerConfig> = {}
  for (const [name, server] of Object.entries(mcp.servers)) {
    if (!server.enabled) continue
    if (server.url !== undefined) {
      const headers = expandEnvironmentReferences(
        server.headers,
        env,
        `mcp.servers.${name}.headers`,
      )
      servers[name] = {
        type: 'http',
        url: server.url,
        ...(Object.keys(headers).length === 0 ? {} : { headers }),
      }
      continue
    }
    if (server.command === undefined) continue
    const serverEnv = expandEnvironmentReferences(server.env, env, `mcp.servers.${name}.env`)
    servers[name] = {
      command: server.command,
      ...(server.args.length === 0 ? {} : { args: [...server.args] }),
      ...(Object.keys(serverEnv).length === 0 ? {} : { env: serverEnv }),
      ...(server.cwd === undefined ? {} : { cwd: server.cwd }),
    }
  }
  return {
    servers,
    ...(mcp.startup_timeout_ms === undefined ? {} : { startupTimeoutMs: mcp.startup_timeout_ms }),
  }
}

export function resolveMemorySettings(settings: SparkSettings): ResolvedMemorySettings {
  const memory = settings.config.memory
  return {
    enabled: memory?.enabled ?? true,
    maxInjectTokens: memory?.max_inject_tokens ?? 4_000,
    agentId: memory?.agent_id ?? 'default',
  }
}

/**
 * Context-window management knobs, shaped as a partial engine compaction
 * policy so only explicitly configured fields override kernel defaults.
 */
export function resolveContextSettings(settings: SparkSettings): Partial<ContextCompactionPolicy> {
  const context = settings.config.context
  const policy: { -readonly [K in keyof ContextCompactionPolicy]+?: ContextCompactionPolicy[K] } =
    {}
  if (context === undefined) return policy
  if (context.auto_compact !== undefined) policy.autoCompact = context.auto_compact
  if (context.compact_threshold !== undefined) policy.thresholdRatio = context.compact_threshold
  if (context.keep_recent_turns !== undefined) policy.keepRecentTurns = context.keep_recent_turns
  if (context.min_compactable_tokens !== undefined) {
    policy.minCompactableTokens = context.min_compactable_tokens
  }
  if (context.max_compactions_per_turn !== undefined) {
    policy.maxCompactionsPerTurn = context.max_compactions_per_turn
  }
  return policy
}

export interface ResolvedPlatformSettings {
  readonly serverUrl: string
  readonly webLoginUrl?: string
}

/** Matches the desktop default so a CLI session logs into the same account server. */
export const DEFAULT_PLATFORM_SERVER_URL = 'https://spark.yiqibyte.com/'

/**
 * Resolves the Spark account server used by `spark login` / `whoami`.
 *
 * Environment variables win over TOML so a local integration test server can be
 * selected without editing a shared config file (same precedence as the desktop).
 * The web login URL stays optional: when unset, the client asks the server's
 * `/client-config` and only then falls back to its built-in page.
 */
export function resolvePlatformSettings(
  settings: SparkSettings,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedPlatformSettings {
  const platform = settings.config.platform
  const serverUrl =
    normalizeUrl(env.SPARK_EDUGEN_BASE_URL) ??
    normalizeUrl(platform?.server_url) ??
    DEFAULT_PLATFORM_SERVER_URL
  const webLoginUrl = normalizeUrl(env.SPARK_WEB_LOGIN_URL) ?? normalizeUrl(platform?.web_login_url)
  return {
    serverUrl,
    ...(webLoginUrl === undefined ? {} : { webLoginUrl }),
  }
}

/** Trims a configured URL and drops empty values so they fall through the chain. */
function normalizeUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Everything the engine env needs from configuration, shaped to spread
 * directly into `McpDefaultEnvOptions` so CLI and TUI build identical envs.
 */
export interface ResolvedEngineSettings {
  readonly permissionRules: readonly PermissionRule[]
  readonly allowedTools: readonly string[]
  readonly disallowedTools: readonly string[]
  readonly enabledTools?: readonly string[]
  readonly hiddenTools: readonly string[]
  readonly mcpServers: SparkMcpServerMap
  readonly mcpStartupTimeoutMs?: number
  readonly memoryEnabled: boolean
  readonly memoryMaxInjectTokens: number
  readonly memoryAgentId: string
  readonly compactionPolicy: Partial<ContextCompactionPolicy>
}

export function resolveEngineSettings(
  settings: SparkSettings,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedEngineSettings {
  const permissions = resolvePermissionSettings(settings)
  const tools = resolveToolFilter(settings)
  const mcp = resolveMcpSettings(settings, env)
  const memory = resolveMemorySettings(settings)
  return {
    permissionRules: permissions.rules,
    allowedTools: permissions.allowedTools,
    disallowedTools: permissions.disallowedTools,
    ...(tools.enabled === undefined ? {} : { enabledTools: tools.enabled }),
    hiddenTools: tools.disabled,
    mcpServers: mcp.servers,
    ...(mcp.startupTimeoutMs === undefined ? {} : { mcpStartupTimeoutMs: mcp.startupTimeoutMs }),
    memoryEnabled: memory.enabled,
    memoryMaxInjectTokens: memory.maxInjectTokens,
    memoryAgentId: memory.agentId,
    compactionPolicy: resolveContextSettings(settings),
  }
}

/**
 * Flattens both layers into effective dotted keys for `spark config list`.
 * Arrays and scalars are leaves; empty tables are kept so a section that has
 * been declared but not filled in is still visible.
 */
export function describeSettings(settings: SparkSettings): readonly SettingEntry[] {
  const entries: SettingEntry[] = []
  const visit = (layer: Readonly<Record<string, unknown>>, path: readonly string[]): void => {
    for (const [key, value] of Object.entries(layer)) {
      const next = [...path, key]
      if (isPlainObject(value)) {
        if (Object.keys(value).length === 0) {
          entries.push(entry(settings, next, {}))
          continue
        }
        visit(value, next)
        continue
      }
      entries.push(entry(settings, next, value))
    }
  }
  visit(settings.mergedLayer, [])
  return entries.sort((left, right) => left.key.localeCompare(right.key))
}

export async function readSetting(
  options: SparkSettingsOptions & {
    readonly key: string
    readonly scope?: SettingsScope | 'effective'
  },
): Promise<SettingEntry> {
  const settings = await loadSparkSettings(options)
  const path = parseSettingPath(options.key)
  const scope = options.scope ?? 'effective'
  if (scope === 'global')
    return entry(settings, path, getValueAtPath(settings.global.layer, path), 'global')
  if (scope === 'project') {
    return entry(settings, path, getValueAtPath(settings.project.layer, path), 'project')
  }
  return entry(settings, path, getValueAtPath(settings.mergedLayer, path))
}

export interface SettingWriteResult {
  readonly path: string
  readonly previousValue: unknown
  readonly scope: SettingsScope
}

export async function writeSetting(
  options: SparkSettingsOptions & {
    readonly key: string
    readonly value: unknown
    readonly scope?: SettingsScope
  },
): Promise<SettingWriteResult> {
  return mutateSetting(options, options.scope ?? 'global', (layer) => {
    setValueAtPath(layer, parseSettingPath(options.key), options.value)
  })
}

export async function removeSetting(
  options: SparkSettingsOptions & { readonly key: string; readonly scope?: SettingsScope },
): Promise<SettingWriteResult> {
  return mutateSetting(options, options.scope ?? 'global', (layer) => {
    if (!deleteValueAtPath(layer, parseSettingPath(options.key))) {
      throw new SparkSettingsError(`No ${options.scope ?? 'global'} setting named ${options.key}`)
    }
  })
}

/**
 * Read the target layer, apply the mutation, validate the *merged* result the
 * runtime would actually read, then write atomically. A rejected edit leaves
 * the file untouched.
 */
async function mutateSetting(
  options: SparkSettingsOptions & { readonly key: string },
  scope: SettingsScope,
  mutate: (layer: Record<string, unknown>) => void,
): Promise<SettingWriteResult> {
  const paths = resolveSparkSettingsPaths(options)
  const targetPath = scope === 'project' ? paths.projectPath : paths.globalPath
  const otherPath = scope === 'project' ? paths.globalPath : paths.projectPath
  const target = await readSettingsLayer(targetPath)
  const other =
    otherPath === targetPath ? { layer: {}, exists: false } : await readSettingsLayer(otherPath)
  const mutated = structuredClone(target.layer)
  const previousValue = getValueAtPath(mutated, parseSettingPath(options.key))
  mutate(mutated)
  const merged =
    scope === 'project'
      ? deepMergeLayers(other.layer, mutated)
      : deepMergeLayers(mutated, other.layer)
  try {
    ModelConfigSchema.parse(merged)
  } catch (error) {
    throw new SparkSettingsError(
      `Updating ${targetPath} would produce an invalid config: ${formatIssues(error)}`,
      { cause: error },
    )
  }
  await writeTomlLayerAtomic(targetPath, mutated)
  return { path: targetPath, previousValue, scope }
}

async function readSettingsLayer(path: string): Promise<TomlLayer> {
  try {
    return await readTomlLayer(path)
  } catch (error) {
    throw new SparkSettingsError(errorMessage(error), { cause: error })
  }
}

/** `${VAR}` references keep MCP credentials out of the TOML file itself. */
const ENVIRONMENT_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu

function expandEnvironmentReferences(
  values: Readonly<Record<string, string>>,
  env: NodeJS.ProcessEnv,
  context: string,
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    resolved[key] = value.replace(ENVIRONMENT_REFERENCE, (_match: string, name: string) => {
      const found = env[name]
      if (found === undefined || found === '') {
        throw new SparkSettingsError(
          `${context}.${key} references the ${name} variable in \${...} form, but that environment variable is not set`,
        )
      }
      return found
    })
  }
  return resolved
}

function entry(
  settings: SparkSettings,
  path: readonly string[],
  value: unknown,
  scope?: SettingsScope,
): SettingEntry {
  const resolvedScope =
    scope ??
    (getValueAtPath(settings.project.layer, path) !== undefined
      ? 'project'
      : getValueAtPath(settings.global.layer, path) !== undefined
        ? 'global'
        : 'default')
  return {
    key: path.join('.'),
    value,
    scope: resolvedScope,
    sourcePath:
      resolvedScope === 'project'
        ? settings.paths.projectPath
        : resolvedScope === 'global'
          ? settings.paths.globalPath
          : 'built-in default',
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatIssues(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
  }
  return error instanceof ConfigFileError
    ? error.message
    : error instanceof Error
      ? error.message
      : String(error)
}
