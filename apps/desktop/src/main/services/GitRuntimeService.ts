/**
 * GitRuntimeService - Resolve which Git runtime the app should use.
 *
 * Resolution order (per docs/plans/2026-08-24-bundled-git-runtime-fallback.md):
 *   1. SPARK_GIT_EXECUTABLE override (dev/test/diagnostics only, strict)
 *   2. System Git from the (already PATH-fixed) environment, gated on a
 *      minimum version and a working --exec-path
 *   3. Bundled Git shipped under <resources>/runtime/git
 *
 * The resolver never writes Git-specific variables into process.env. Consumers
 * either pass descriptor.commandEnvPatch per command (internal executor) or use
 * buildGitChildEnvironment() to construct a child-process environment.
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  GitCommandService,
  buildGitChildEnvironment as buildSharedGitChildEnvironment,
  configureDefaultGitCommandService,
  type GitCommandRuntimeDescriptor,
  type GitRuntimeSource as SharedGitRuntimeSource,
} from '@spark/agent-runtime'
import { createLogger } from '@spark/shared'

const log = createLogger('git-runtime')

const execFileAsync = promisify(execFile)

// ─── Types ────────────────────────────────────────────────────────────────────

export type GitRuntimeSource = SharedGitRuntimeSource

/**
 * SPARK_GIT_RUNTIME_MODE is a diagnostics/CI switch, not a product setting:
 *   auto          (default) system Git first, bundled fallback
 *   system-only   never use bundled
 *   bundled-only  never use system
 */
export type GitRuntimeMode = 'auto' | 'system-only' | 'bundled-only'

export interface GitRuntimeDescriptor extends GitCommandRuntimeDescriptor {}

export type GitRuntimeUnavailableReason =
  | 'override_invalid'
  | 'no_system_git'
  | 'system_git_below_min_version'
  | 'bundled_missing'
  | 'bundled_invalid'
  | 'mode_excluded'

export interface GitRuntimeResolution {
  descriptor: GitRuntimeDescriptor | null
  unavailableReason: GitRuntimeUnavailableReason | null
  /** Stable, non-sensitive message safe for logs and IPC. */
  message: string | null
}

export interface BundledGitRuntimeMetadata {
  version: string
  platform: string
  arch: string
  entry: string
}

/** Injectable filesystem/exec layer so the resolver stays unit-testable. */
export interface GitRuntimeResolverDeps {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: string
  resourcesPath?: string | undefined
  existsSync?: (path: string) => boolean
  readFileSync?: (path: string, encoding: BufferEncoding) => string
  execFileAsync?: (
    file: string,
    args: string[],
    options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv },
  ) => Promise<{ stdout: string; stderr: string }>
}

/** Resolver deps with every injectable filled in. */
interface ResolvedGitRuntimeDeps {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  arch: string
  resourcesPath: string | undefined
  existsSync: (path: string) => boolean
  readFileSync: (path: string, encoding: BufferEncoding) => string
  execFileAsync: (
    file: string,
    args: string[],
    options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv },
  ) => Promise<{ stdout: string; stderr: string }>
}

/** Minimum Git version required by the features we use (switch/restore etc.). */
export const MIN_GIT_VERSION = '2.31.0'

export const GIT_RUNTIME_METADATA_FILENAME = 'git-runtime.json'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Parse "git version 2.45.4 (Apple Git-150)" into "2.45.4". */
export function parseGitVersion(output: string): string | null {
  const match = output.match(/git version (\d+\.\d+(\.\d+)?)/i)
  return match?.[1] ?? null
}

/** Compare two dotted versions; -1 if a < b, 0 if equal, 1 if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10))
  const pb = b.split('.').map((part) => Number.parseInt(part, 10))
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

/**
 * Merge descriptor env/PATH into a child-process environment without mutating
 * the base. On Windows only one of PATH/Path survives, uppercase preferred.
 *
 * `platform` defaults to the host platform; pass the child's platform when it
 * is known (e.g. a descriptor resolved for another target).
 */
export function buildGitChildEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  descriptor: GitRuntimeDescriptor,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  return buildSharedGitChildEnvironment(baseEnv, descriptor, platform)
}

export function parseGitRuntimeMode(value: string | undefined): GitRuntimeMode {
  if (value === 'system-only' || value === 'bundled-only') return value
  return 'auto'
}

// ─── Bundled runtime layout ───────────────────────────────────────────────────

export function getBundledGitRootCandidates(
  resourcesPath: string | undefined,
  moduleDir: string,
): string[] {
  const roots: string[] = []
  if (resourcesPath) {
    roots.push(join(resourcesPath, 'runtime', 'git'))
  }
  // Dev fallback: apps/desktop/runtime/git (next to the lock file).
  roots.push(join(moduleDir, '..', '..', '..', 'runtime', 'git'))
  return [...new Set(roots)]
}

function readBundledMetadata(
  root: string,
  deps: ResolvedGitRuntimeDeps,
): BundledGitRuntimeMetadata | null {
  const metadataPath = join(root, GIT_RUNTIME_METADATA_FILENAME)
  if (!deps.existsSync(metadataPath)) return null
  try {
    const parsed = JSON.parse(deps.readFileSync(metadataPath, 'utf-8')) as BundledGitRuntimeMetadata
    if (
      typeof parsed.version !== 'string' ||
      typeof parsed.platform !== 'string' ||
      typeof parsed.arch !== 'string' ||
      typeof parsed.entry !== 'string'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

async function probeGitExecutable(
  executablePath: string,
  deps: ResolvedGitRuntimeDeps,
  env: NodeJS.ProcessEnv,
): Promise<{ version: string; execPath: string } | null> {
  try {
    const { stdout: versionOutput } = await deps.execFileAsync(executablePath, ['--version'], {
      timeout: 5000,
      env,
    })
    const version = parseGitVersion(versionOutput)
    if (version == null) return null
    const { stdout: execPathOutput } = await deps.execFileAsync(executablePath, ['--exec-path'], {
      timeout: 5000,
      env,
    })
    const execPath = execPathOutput.trim()
    if (!isAbsolute(execPath) || !deps.existsSync(execPath)) return null
    const httpsHelper = join(
      execPath,
      deps.platform === 'win32' ? 'git-remote-https.exe' : 'git-remote-https',
    )
    if (!deps.existsSync(httpsHelper)) return null
    return { version, execPath }
  } catch {
    return null
  }
}

async function resolveSystemGit(
  deps: ResolvedGitRuntimeDeps,
  generation: number,
): Promise<GitRuntimeResolution> {
  const candidates = getSystemGitCandidates(deps)
  for (const executablePath of candidates) {
    if (deps.platform === 'darwin' && executablePath === '/usr/bin/git') {
      try {
        await deps.execFileAsync('/usr/bin/xcode-select', ['-p'], { timeout: 3000, env: deps.env })
      } catch {
        continue
      }
    }
    const probe = await probeGitExecutable(executablePath, deps, deps.env)
    if (probe == null) continue
    if (compareVersions(probe.version, MIN_GIT_VERSION) < 0) {
      return {
        descriptor: null,
        unavailableReason: 'system_git_below_min_version',
        message: `System Git ${probe.version} is below the minimum supported ${MIN_GIT_VERSION}`,
      }
    }
    return {
      descriptor: {
        generation,
        source: 'system',
        executablePath,
        version: probe.version,
        commandEnvPatch: {},
        shellPathEntries: [dirname(executablePath)],
      },
      unavailableReason: null,
      message: null,
    }
  }
  return {
    descriptor: null,
    unavailableReason: 'no_system_git',
    message: 'No usable system Git found in PATH',
  }
}

function getSystemGitCandidates(deps: ResolvedGitRuntimeDeps): string[] {
  const rawPath = Object.entries(deps.env).find(([key]) => key.toLowerCase() === 'path')?.[1]
  if (!rawPath) return []
  const separator = deps.platform === 'win32' ? ';' : ':'
  const names = deps.platform === 'win32' ? ['git.exe', 'git.cmd', 'git'] : ['git']
  const candidates: string[] = []
  for (const rawEntry of rawPath.split(separator)) {
    const entry = rawEntry.trim().replace(/^"|"$/g, '')
    if (!entry) continue
    for (const name of names) {
      const candidate = join(entry, name)
      if (isAbsolute(candidate) && deps.existsSync(candidate)) candidates.push(candidate)
    }
  }
  return [...new Set(candidates)]
}

async function resolveBundledGit(
  deps: ResolvedGitRuntimeDeps,
  generation: number,
): Promise<GitRuntimeResolution> {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  for (const root of getBundledGitRootCandidates(deps.resourcesPath, moduleDir)) {
    const metadata = readBundledMetadata(root, deps)
    if (metadata == null) continue
    if (metadata.platform !== deps.platform || metadata.arch !== deps.arch) {
      continue
    }
    const executablePath = join(root, ...metadata.entry.split('/'))
    if (!deps.existsSync(executablePath)) {
      return {
        descriptor: null,
        unavailableReason: 'bundled_invalid',
        message: 'Bundled Git metadata found but the entry executable is missing',
      }
    }
    // Bundled runtime env: bind its own helpers/templates if the prefix needs it.
    const commandEnvPatch: NodeJS.ProcessEnv = {}
    const execCore = join(root, 'libexec', 'git-core')
    if (deps.existsSync(execCore)) commandEnvPatch['GIT_EXEC_PATH'] = execCore
    const probeEnv = { ...deps.env, ...commandEnvPatch }
    const probe = await probeGitExecutable(executablePath, deps, probeEnv)
    if (probe == null) {
      return {
        descriptor: null,
        unavailableReason: 'bundled_invalid',
        message: 'Bundled Git executable found but failed its health check',
      }
    }
    if (probe.version !== metadata.version) {
      return {
        descriptor: null,
        unavailableReason: 'bundled_invalid',
        message: `Bundled Git version mismatch: metadata says ${metadata.version}, executable reports ${probe.version}`,
      }
    }
    if (compareVersions(probe.version, MIN_GIT_VERSION) < 0) {
      return {
        descriptor: null,
        unavailableReason: 'bundled_invalid',
        message: `Bundled Git ${probe.version} is below the minimum supported ${MIN_GIT_VERSION}`,
      }
    }
    return {
      descriptor: {
        generation,
        source: 'bundled',
        executablePath,
        version: probe.version,
        commandEnvPatch,
        shellPathEntries: [dirname(executablePath)],
      },
      unavailableReason: null,
      message: null,
    }
  }
  return {
    descriptor: null,
    unavailableReason: 'bundled_missing',
    message: 'No bundled Git runtime is installed for this platform',
  }
}

export async function resolveGitRuntime(
  injectedDeps: GitRuntimeResolverDeps = {},
): Promise<GitRuntimeResolution> {
  const deps: ResolvedGitRuntimeDeps = {
    env: injectedDeps.env ?? process.env,
    platform: injectedDeps.platform ?? process.platform,
    arch: injectedDeps.arch ?? process.arch,
    resourcesPath: injectedDeps.resourcesPath ?? process.resourcesPath,
    existsSync: injectedDeps.existsSync ?? existsSync,
    readFileSync: injectedDeps.readFileSync ?? ((p, encoding) => readFileSync(p, encoding)),
    execFileAsync:
      injectedDeps.execFileAsync ??
      (async (
        file: string,
        args: string[],
        options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv },
      ) => execFileAsync(file, args, options)),
  }

  const generation = ++_generationCounter
  const mode = parseGitRuntimeMode(deps.env['SPARK_GIT_RUNTIME_MODE'])

  // 1. Explicit override - strict: an invalid override is an error, never a fallback.
  const overridePath = deps.env['SPARK_GIT_EXECUTABLE']
  if (overridePath) {
    if (!isAbsolute(overridePath) || !deps.existsSync(overridePath)) {
      return {
        descriptor: null,
        unavailableReason: 'override_invalid',
        message: 'SPARK_GIT_EXECUTABLE must point to an existing absolute path',
      }
    }
    const probe = await probeGitExecutable(overridePath, deps, deps.env)
    if (probe == null) {
      return {
        descriptor: null,
        unavailableReason: 'override_invalid',
        message: 'SPARK_GIT_EXECUTABLE is set but the executable is not a working Git',
      }
    }
    if (compareVersions(probe.version, MIN_GIT_VERSION) < 0) {
      return {
        descriptor: null,
        unavailableReason: 'override_invalid',
        message: `SPARK_GIT_EXECUTABLE reports Git ${probe.version}, below the minimum supported ${MIN_GIT_VERSION}`,
      }
    }
    return {
      descriptor: {
        generation,
        source: 'override',
        executablePath: overridePath,
        version: probe.version,
        commandEnvPatch: {},
        shellPathEntries: [dirname(overridePath)],
      },
      unavailableReason: null,
      message: null,
    }
  }

  const trySystem = mode !== 'bundled-only'
  const tryBundled = mode !== 'system-only'

  if (trySystem) {
    const system = await resolveSystemGit(deps, generation)
    if (system.descriptor) return system
    if (mode === 'system-only') return system
  }

  if (tryBundled) {
    const bundled = await resolveBundledGit(deps, generation)
    if (bundled.descriptor) return bundled
    if (mode === 'bundled-only') return bundled
  }

  return {
    descriptor: null,
    unavailableReason: 'no_system_git',
    message: 'No usable Git runtime found (system Git missing, no bundled runtime)',
  }
}

// ─── Single-flight cached state ───────────────────────────────────────────────

let _generationCounter = 0
let _cached: GitRuntimeResolution | null = null
let _inflight: Promise<GitRuntimeResolution> | null = null

export async function initializeGitRuntime(): Promise<GitRuntimeResolution> {
  if (_inflight) return _inflight
  _inflight = resolveGitRuntime().finally(() => {
    _inflight = null
  })
  _cached = await _inflight
  if (_cached.descriptor) {
    log.info(
      `Git runtime ready: source=${_cached.descriptor.source} version=${_cached.descriptor.version}`,
    )
  } else {
    log.warn(`Git runtime unavailable: ${_cached.unavailableReason}`)
  }
  return _cached
}

export function getCachedGitRuntime(): GitRuntimeResolution | null {
  return _cached
}

/** Re-resolve (e.g. user clicked "re-detect" or the executable vanished). */
export async function refreshGitRuntime(): Promise<GitRuntimeResolution> {
  return initializeGitRuntime()
}

/** Expose the resolved executable for internal callers in Phase 2+ migration. */
export function getGitExecutablePath(): string | null {
  return _cached?.descriptor?.executablePath ?? null
}

const gitCommandService = new GitCommandService({
  current: () => getCachedGitRuntime(),
  resolve: () => initializeGitRuntime(),
  refresh: () => refreshGitRuntime(),
})

configureDefaultGitCommandService(gitCommandService)

export function getGitCommandService(): GitCommandService {
  return gitCommandService
}
