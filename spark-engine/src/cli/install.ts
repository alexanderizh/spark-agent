import { access, constants, lstat, mkdir, open, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SPARK_PACKAGE_NAME = '@spark/agent'
const PACKAGE_ENTRY = join('dist', 'cli', 'main.js')
const CMD_MARKER = '@spark/agent launcher'
const MAX_ROOT_WALK = 8

export class InstallError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'InstallError'
  }
}

export interface SparkInstall {
  readonly root: string
  readonly version: string
  readonly entry: string
  readonly nodeEngines?: string
}

/**
 * Locates the @spark/agent package that contains the running code. Works from
 * the TypeScript source tree (vitest), the built dist tree, and installed npm
 * packages alike, because it only relies on walking up to the enclosing
 * package.json — never on the caller's working directory.
 */
export async function resolveSparkInstall(fromUrl: string = import.meta.url): Promise<SparkInstall> {
  let directory = dirname(fileURLToPath(fromUrl))
  for (let depth = 0; depth < MAX_ROOT_WALK; depth += 1) {
    const manifestPath = join(directory, 'package.json')
    if (await fileExists(manifestPath)) {
      let manifest: unknown
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      } catch (error) {
        throw new InstallError(`Unable to read ${manifestPath}`, { cause: error })
      }
      const name = field(manifest, 'name')
      if (name === SPARK_PACKAGE_NAME) {
        const version = field(manifest, 'version')
        const engines = field(manifest, 'engines')
        const entry = join(directory, PACKAGE_ENTRY)
        if (!(await fileExists(entry))) {
          throw new InstallError(
            `spark package at ${directory} is missing ${PACKAGE_ENTRY}; build it with npm run build`,
          )
        }
        return {
          root: directory,
          version: typeof version === 'string' && version ? version : '0.0.0',
          entry,
          ...(typeof engines === 'object' && engines !== null && typeof (engines as { node?: unknown }).node === 'string'
            ? { nodeEngines: (engines as { node: string }).node }
            : {}),
        }
      }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new InstallError(
    `Unable to locate the ${SPARK_PACKAGE_NAME} package containing this code (started from ${fromUrl})`,
  )
}

export interface LauncherOptions {
  readonly binDir: string
  readonly platform?: NodeJS.Platform
}

export interface InstallLauncherOptions extends LauncherOptions {
  readonly install: SparkInstall
  readonly force?: boolean
}

export interface LauncherInstallResult {
  readonly launcherPath: string
  readonly replaced: boolean
}

export async function installLauncher(
  options: InstallLauncherOptions,
): Promise<LauncherInstallResult> {
  const platform = options.platform ?? process.platform
  const launcherPath = launcherPathFor(options.binDir, platform)
  await mkdir(options.binDir, { recursive: true })
  const existing = await lstatIfExists(launcherPath)
  if (existing?.isDirectory()) {
    throw new InstallError(`${launcherPath} is a directory; remove it or pass --bin elsewhere`)
  }
  const ours =
    existing === undefined ||
    (platform === 'win32' ? await isOurCmdLauncher(launcherPath) : existing.isSymbolicLink())
  if (!ours && !options.force) {
    throw new InstallError(
      `${launcherPath} already exists and is not a spark launcher; pass --force to replace it`,
    )
  }

  const temporary = join(options.binDir, `.spark-launcher-${process.pid}.tmp`)
  await rm(temporary, { force: true })
  if (platform === 'win32') {
    await writeFile(
      temporary,
      `@echo off\r\nrem ${CMD_MARKER}\r\nnode "${options.install.entry}" %*\r\n`,
      'utf8',
    )
  } else {
    await symlink(options.install.entry, temporary)
  }
  try {
    if (platform === 'win32') await rm(launcherPath, { force: true })
    await rename(temporary, launcherPath)
  } catch (error) {
    await rm(temporary, { force: true })
    throw new InstallError(`Unable to publish launcher at ${launcherPath}`, { cause: error })
  }
  return { launcherPath, replaced: existing !== undefined }
}

export type UninstallResult = 'removed' | 'absent'

export async function uninstallLauncher(options: LauncherOptions): Promise<UninstallResult> {
  const platform = options.platform ?? process.platform
  const launcherPath = launcherPathFor(options.binDir, platform)
  const existing = await lstatIfExists(launcherPath)
  if (existing === undefined) return 'absent'
  if (platform === 'win32') {
    if (!existing.isFile() || !(await isOurCmdLauncher(launcherPath))) {
      throw new InstallError(
        `${launcherPath} was not installed by spark; remove it manually if you no longer need it`,
      )
    }
    await rm(launcherPath, { force: true })
    return 'removed'
  }
  if (!existing.isSymbolicLink()) {
    throw new InstallError(
      `${launcherPath} is not a spark launcher (regular ${existing.isFile() ? 'file' : 'entry'}); remove it manually`,
    )
  }
  const target = await readlink(launcherPath)
  if (!target.endsWith(PACKAGE_ENTRY)) {
    throw new InstallError(
      `${launcherPath} links to ${target}, which is not a spark package entry; remove it manually`,
    )
  }
  await rm(launcherPath, { force: true })
  return 'removed'
}

export interface PathSparkCandidate {
  readonly path: string
  readonly dir: string
  readonly broken?: boolean
  readonly targetPath?: string
  readonly version?: string
  readonly isSparkInstall?: boolean
}

/**
 * Scans PATH (in order) for executables named `spark` and resolves what each
 * one points at, so `spark install` and `spark doctor` can report shadowing,
 * dangling launchers, and version drift instead of failing silently.
 */
export async function findSparkOnPath(
  options: { pathEnv?: string; platform?: NodeJS.Platform } = {},
): Promise<readonly PathSparkCandidate[]> {
  const platform = options.platform ?? process.platform
  const pathEnv = options.pathEnv ?? process.env.PATH ?? ''
  const candidates: PathSparkCandidate[] = []
  for (const dir of splitPath(pathEnv, platform)) {
    const direct = join(dir, 'spark')
    const probePaths = platform === 'win32' ? [`${direct}.cmd`, `${direct}.exe`, direct] : [direct]
    for (const candidatePath of probePaths) {
      const info = await lstatIfExists(candidatePath)
      if (info === undefined) continue
      // A dangling symlink still counts: reporting it as broken is the whole
      // point. Only regular entries must prove executable.
      if (!info.isSymbolicLink() && !(await isExecutable(candidatePath))) continue
      candidates.push(await describeCandidate(candidatePath, dir, platform))
      break
    }
  }
  return candidates
}

export function splitPath(pathEnv: string, platform: NodeJS.Platform): readonly string[] {
  const seen = new Set<string>()
  const entries: string[] = []
  for (const raw of pathEnv.split(platform === 'win32' ? ';' : delimiter)) {
    const dir = raw.trim()
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    entries.push(dir)
  }
  return entries
}

async function describeCandidate(
  candidatePath: string,
  dir: string,
  platform: NodeJS.Platform,
): Promise<PathSparkCandidate> {
  const info = await lstat(candidatePath)
  if (platform === 'win32' || !info.isSymbolicLink()) {
    return {
      path: candidatePath,
      dir,
      // The marker line only exists in Windows shims; foreign regular entries on
      // POSIX are reported as-is without reading (possibly huge) file bodies.
      ...(platform === 'win32' && (await hasCmdMarker(candidatePath))
        ? { isSparkInstall: true }
        : {}),
    }
  }
  const targetPath = await readlink(candidatePath)
  const resolvedTarget = resolve(dir, targetPath)
  if (!(await fileExists(resolvedTarget))) {
    return { path: candidatePath, dir, broken: true, targetPath: resolvedTarget }
  }
  return {
    path: candidatePath,
    dir,
    targetPath: resolvedTarget,
    ...(await describeTarget(resolvedTarget)),
  }
}

async function describeTarget(
  entryPath: string,
): Promise<{ version?: string; isSparkInstall?: boolean }> {
  let directory = dirname(entryPath)
  for (let depth = 0; depth < MAX_ROOT_WALK; depth += 1) {
    const manifestPath = join(directory, 'package.json')
    if (await fileExists(manifestPath)) {
      try {
        const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
        if (field(manifest, 'name') === SPARK_PACKAGE_NAME) {
          const version = field(manifest, 'version')
          const parsed = typeof version === 'string' && version ? version : undefined
          return parsed === undefined ? { isSparkInstall: true } : { isSparkInstall: true, version: parsed }
        }
        return {}
      } catch {
        return {}
      }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return {}
}

async function hasCmdMarker(entryPath: string): Promise<boolean> {
  // Bounded read: a foreign executable earlier on PATH may be arbitrarily large.
  try {
    const handle = await open(entryPath, 'r')
    try {
      const buffer = Buffer.alloc(8 * 1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      return buffer.subarray(0, bytesRead).toString('utf8').includes(CMD_MARKER)
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

export function pathExportHint(binDir: string, shell: string | undefined): string {
  const shellName = shell ? basename(shell) : ''
  if (shellName.endsWith('fish')) {
    return `fish_add_path ${binDir}`
  }
  const rc =
    shellName.endsWith('zsh') ? '~/.zshrc' : shellName.endsWith('bash') ? '~/.bashrc' : undefined
  const exportLine = `export PATH="${binDir}:$PATH"`
  return rc ? `${exportLine}   # add to ${rc} and restart your terminal` : exportLine
}

export interface InitConfigResult {
  readonly created: boolean
  readonly path: string
}

export async function initSparkConfig(sparkHome: string): Promise<InitConfigResult> {
  await mkdir(sparkHome, { recursive: true, mode: 0o700 })
  const configPath = resolve(sparkHome, 'config.toml')
  if (await fileExists(configPath)) return { created: false, path: configPath }
  const temporary = resolve(sparkHome, `.config.toml.${process.pid}.tmp`)
  await writeFile(temporary, STARTER_CONFIG, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, configPath)
  return { created: true, path: configPath }
}

export function satisfiesNodeEngines(
  nodeVersion: string,
  range: string | undefined,
): { status: 'unmanaged' | 'ok' | 'out_of_range'; detail?: string } {
  if (!range) return { status: 'unmanaged' }
  const bounds = range
    .split(/\s+/u)
    .map((bound) => /^>=(\d+)\.(\d+)\.(\d+)$/u.exec(bound) ?? /^<(\d+)\.(\d+)\.(\d+)$/u.exec(bound))
  if (bounds.length === 0 || bounds.some((bound) => bound === null)) {
    return { status: 'unmanaged' }
  }
  const parts = /^(\d+)\.(\d+)\.(\d+)/u.exec(nodeVersion)
  if (!parts) return { status: 'unmanaged' }
  const current = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  for (const bound of bounds) {
    if (!bound) continue
    const operator = bound[0]
    const target = [Number(bound[1]), Number(bound[2]), Number(bound[3])]
    const comparison = compareVersions(current, target)
    if (operator === '>=' && comparison < 0) {
      return { status: 'out_of_range', detail: `Node ${nodeVersion} is below ${range}` }
    }
    if (operator === '<' && comparison >= 0) {
      return { status: 'out_of_range', detail: `Node ${nodeVersion} is outside ${range}` }
    }
  }
  return { status: 'ok' }
}

function compareVersions(current: readonly number[], target: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const left = current[index] ?? 0
    const right = target[index] ?? 0
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

export function launcherPathFor(binDir: string, platform: NodeJS.Platform): string {
  return join(binDir, platform === 'win32' ? 'spark.cmd' : 'spark')
}

export type ResolvedSparkKind = 'missing' | 'spark' | 'foreign' | 'broken'

export interface InstallReport {
  readonly running: SparkInstall
  readonly defaultBinDir: string
  readonly resolvedKind: ResolvedSparkKind
  readonly resolved?: PathSparkCandidate
  readonly versionMatchesRunning?: boolean
  readonly shadowedBy?: string
  readonly defaultBinDirOnPath: boolean
  readonly node: { readonly version: string; readonly status: string; readonly detail?: string }
}

export async function buildInstallReport(options: {
  readonly install: SparkInstall
  readonly sparkHome: string
  readonly pathEnv?: string
  readonly platform?: NodeJS.Platform
}): Promise<InstallReport> {
  const platform = options.platform ?? process.platform
  const defaultBinDir = join(options.sparkHome, 'bin')
  const candidates = await findSparkOnPath({
    ...(options.pathEnv === undefined ? {} : { pathEnv: options.pathEnv }),
    platform,
  })
  const resolved = candidates[0]
  const resolvedKind: ResolvedSparkKind = resolved
    ? resolved.broken
      ? 'broken'
      : resolved.isSparkInstall
        ? 'spark'
        : 'foreign'
    : 'missing'
  const pathEntries = splitPath(options.pathEnv ?? process.env.PATH ?? '', platform).map((dir) =>
    resolve(dir),
  )
  const hasSparkLater = candidates.some(
    (candidate) => !candidate.broken && candidate.isSparkInstall,
  )
  return {
    running: options.install,
    defaultBinDir,
    resolvedKind,
    ...(resolved ? { resolved } : {}),
    ...(resolved?.version !== undefined
      ? { versionMatchesRunning: resolved.version === options.install.version }
      : {}),
    ...(resolvedKind !== 'spark' && hasSparkLater && resolved ? { shadowedBy: resolved.path } : {}),
    defaultBinDirOnPath: pathEntries.includes(resolve(defaultBinDir)),
    node: {
      version: process.version,
      ...satisfiesNodeEngines(process.version, options.install.nodeEngines),
    },
  }
}

async function isOurCmdLauncher(path: string): Promise<boolean> {
  try {
    return (await readFile(path, 'utf8')).includes(CMD_MARKER)
  } catch {
    return false
  }
}

async function lstatIfExists(path: string) {
  try {
    return await lstat(path)
  } catch {
    return undefined
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function field(manifest: unknown, key: string): unknown {
  return typeof manifest === 'object' && manifest !== null
    ? Reflect.get(manifest, key)
    : undefined
}

export const STARTER_CONFIG = `# Spark CLI configuration, created by \`spark init\`.
# Credentials are never stored in this file. Reference environment variables
# through api_key_env and export them in your shell instead.
#
# When SparkWork is running, its configured models are discovered automatically
# and this file is only needed for standalone providers.

[agent]
# model = "main"           # uncomment once [models.main] below is configured
failover = []
max_retries = 2

# [providers.openai]
# protocol = "openai-responses"
# base_url = "https://api.openai.com/v1"
# api_key_env = "OPENAI_API_KEY"
#
# [models.main]
# provider = "openai"
# model = "gpt-5"

# [providers.anthropic]
# protocol = "anthropic-messages"
# base_url = "https://api.anthropic.com"
# api_key_env = "ANTHROPIC_API_KEY"
#
# [models.claude]
# provider = "anthropic"
# model = "claude-sonnet-4-5"
`
