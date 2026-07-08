/**
 * ShellEnvironmentService — Fix PATH and detect runtime dependencies
 *
 * Problem:
 *   Electron apps launched from desktop shortcuts / taskbar inherit the Windows
 *   Explorer environment, which does NOT include the user's shell PATH entries.
 *   This means `node`, `python`, `git`, etc. are often missing from
 *   `process.env.PATH` even though they are installed.
 *
 * Solution:
 *   1. On Windows: Read the user PATH from Registry (HKCU\Environment\Path)
 *      and system PATH from (HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path),
 *      then merge them into `process.env.PATH`.
 *   2. On macOS: Source the user's login shell profile to get the full PATH.
 *   3. Detect whether `node` and `python` are available after PATH fix.
 *   4. Expose detection results via IPC for the renderer to show install prompts.
 */

import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createLogger } from '@spark/shared'

const log = createLogger('shell-env')

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'
const isLinux = process.platform === 'linux'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RuntimeToolStatus {
  /** Tool command name (e.g. 'node', 'python') */
  command: string
  /** Display name */
  displayName: string
  /** Whether the tool was found in PATH */
  available: boolean
  /** Resolved absolute path (null if not found) */
  resolvedPath: string | null
  /** Version string (null if not found) */
  version: string | null
  /** Download URL for installation */
  downloadUrl: string
}

export interface ShellEnvironmentStatus {
  /** Whether PATH was fixed */
  pathFixed: boolean
  /** The original PATH before fixing */
  originalPath: string | null
  /** The new PATH after fixing (null if unchanged) */
  fixedPath: string | null
  /** Detected runtime tools */
  tools: RuntimeToolStatus[]
  /** Timestamp of last check */
  checkedAt: string
}

// ─── PATH Fix ─────────────────────────────────────────────────────────────────

/**
 * Fix process.env.PATH by merging in the user's actual shell PATH.
 *
 * On Windows, reads PATH from Registry (both HKCU and HKLM).
 * On macOS/Linux, sources the user's login shell profile.
 *
 * Returns the merged PATH, or null if no fix was needed/possible.
 */
export async function fixShellPath(): Promise<{
  originalPath: string
  fixedPath: string
  changed: boolean
}> {
  const originalPath = process.env.PATH ?? ''

  if (isWin) {
    return fixWindowsPath(originalPath)
  } else if (isMac || isLinux) {
    return fixUnixPath(originalPath)
  }

  return { originalPath, fixedPath: originalPath, changed: false }
}

/**
 * Windows: Read user and system PATH from Registry and merge.
 */
async function fixWindowsPath(originalPath: string): Promise<{
  originalPath: string
  fixedPath: string
  changed: boolean
}> {
  try {
    // Use reg.exe to query user PATH from HKCU
    const userPathPromise = execFileAsync(
      'reg',
      ['query', 'HKCU\\Environment', '/v', 'Path'],
      { timeout: 5000, windowsHide: true },
    ).catch(() => ({ stdout: '' }))

    // Query system PATH from HKLM
    const systemPathPromise = execFileAsync(
      'reg',
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', '/v', 'Path'],
      { timeout: 5000, windowsHide: true },
    ).catch(() => ({ stdout: '' }))

    const [userResult, systemResult] = await Promise.all([userPathPromise, systemPathPromise])

    const userPath = parseRegPathValue(userResult.stdout)
    const systemPath = parseRegPathValue(systemResult.stdout)

    // Common install directories to ensure are in PATH
    const extraPaths = getCommonWindowsPaths()

    // Merge: existing process.env.PATH + system PATH + user PATH + extra known paths
    const allPaths = [
      ...splitPathEntries(originalPath),
      ...splitPathEntries(systemPath),
      ...splitPathEntries(userPath),
      ...extraPaths,
    ]

    // Deduplicate while preserving order
    const seen = new Set<string>()
    const uniquePaths: string[] = []
    for (const p of allPaths) {
      const lower = p.toLowerCase()
      if (!seen.has(lower) && existsSync(p)) {
        seen.add(lower)
        uniquePaths.push(p)
      } else if (!seen.has(lower)) {
        // Include even if doesn't exist yet (might be on another drive, etc.)
        seen.add(lower)
        uniquePaths.push(p)
      }
    }

    const fixedPath = uniquePaths.join(';')

    if (fixedPath !== originalPath) {
      process.env.PATH = fixedPath
      log.info(`PATH fixed: added ${uniquePaths.length - splitPathEntries(originalPath).length} entries`)
    }

    return { originalPath, fixedPath, changed: fixedPath !== originalPath }
  } catch (err) {
    log.warn(`Failed to fix Windows PATH: ${String(err)}`)
    return { originalPath, fixedPath: originalPath, changed: false }
  }
}

/**
 * Parse the output of `reg query ... /v Path` to extract the PATH value.
 * Output format:
 *   \n    Path    REG_EXPAND_SZ    C:\Users\...\AppData\Local\...
 *   or
 *   \n    Path    REG_SZ    C:\...
 */
function parseRegPathValue(output: string): string {
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('Path') || trimmed.startsWith('PATH')) {
      // Split by whitespace, take everything after REG_SZ or REG_EXPAND_SZ
      const match = trimmed.match(/REG_\w+\s+(.+)$/i)
      if (match?.[1]) {
        return match[1].trim()
      }
    }
  }
  return ''
}

/**
 * Common Windows paths where node/python/git might be installed.
 */
function getCommonWindowsPaths(): string[] {
  const home = homedir()
  const paths: string[] = []

  // Node.js
  paths.push(
    join(home, 'AppData', 'Roaming', 'npm'),
    join(home, 'AppData', 'Local', 'fnm_multishells'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'nodejs'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'nodejs'),
  )

  // npm (bundled with Node.js, but also available standalone)
  paths.push(
    join(home, 'AppData', 'Roaming', 'npm'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'nodejs'),
  )

  // nvm-windows
  paths.push(
    join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'nvm'),
  )

  // Volta
  paths.push(
    join(home, 'AppData', 'Local', 'Volta', 'bin'),
  )

  // Python
  paths.push(
    join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python311'),
    join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python312'),
    join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python313'),
    join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python310'),
    join(home, 'AppData', 'Roaming', 'Python', 'Python311', 'Scripts'),
    join(home, 'AppData', 'Roaming', 'Python', 'Python312', 'Scripts'),
    join(home, 'AppData', 'Roaming', 'Python', 'Python313', 'Scripts'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Python311'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Python312'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Python313'),
  )

  // Git
  paths.push(
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'cmd'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'cmd'),
  )

  // pnpm
  paths.push(
    join(home, 'AppData', 'Local', 'pnpm'),
  )

  // yarn
  paths.push(
    join(home, 'AppData', 'Local', 'Yarn', 'bin'),
  )

  return paths
}

/**
 * macOS/Linux: Source the user's login shell profile to get the full PATH.
 */
async function fixUnixPath(originalPath: string): Promise<{
  originalPath: string
  fixedPath: string
  changed: boolean
}> {
  try {
    const shell = process.env.SHELL ?? '/bin/bash'
    // Run an interactive login shell to get the full user PATH
    const { stdout } = await execFileAsync(
      '/usr/bin/env',
      ['-i', `HOME=${homedir()}`, `SHELL=${shell}`, shell, '-l', '-c', 'printf "%s" "$PATH"'],
      { timeout: 5000 },
    )

    const shellPath = stdout.trim()
    if (!shellPath) {
      return { originalPath, fixedPath: originalPath, changed: false }
    }

    // Merge shell PATH with existing process.env.PATH
    const allPaths = [
      ...splitPathEntries(originalPath),
      ...splitPathEntries(shellPath),
      ...getCommonUnixPaths(),
    ]

    // Deduplicate
    const seen = new Set<string>()
    const uniquePaths: string[] = []
    for (const p of allPaths) {
      if (!seen.has(p)) {
        seen.add(p)
        uniquePaths.push(p)
      }
    }

    const fixedPath = uniquePaths.join(':')

    if (fixedPath !== originalPath) {
      process.env.PATH = fixedPath
      log.info(`PATH fixed: added ${uniquePaths.length - splitPathEntries(originalPath).length} entries`)
    }

    return { originalPath, fixedPath, changed: fixedPath !== originalPath }
  } catch (err) {
    log.warn(`Failed to fix Unix PATH: ${String(err)}`)
    return { originalPath, fixedPath: originalPath, changed: false }
  }
}

function getCommonUnixPaths(): string[] {
  const paths = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]

  const nvmVersionsDir = join(homedir(), '.nvm', 'versions', 'node')
  try {
    for (const version of readdirSync(nvmVersionsDir)) {
      paths.push(join(nvmVersionsDir, version, 'bin'))
    }
  } catch {
    // nvm is optional.
  }

  return paths.filter((path) => existsSync(path))
}

// ─── Runtime Detection ────────────────────────────────────────────────────────

interface ToolDefinition {
  command: string
  displayName: string
  /** Windows-specific alternatives to try */
  winCommands?: string[]
  /** macOS/Linux alternatives to try */
  unixCommands?: string[]
  /** Arguments to get version */
  versionArgs: string[]
  /** Regex to extract version from output */
  versionRegex: RegExp
  /** Download URL */
  downloadUrl: string
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    command: 'node',
    displayName: 'Node.js',
    winCommands: ['node.exe'],
    versionArgs: ['--version'],
    versionRegex: /v(\d+\.\d+\.\d+)/,
    downloadUrl: 'https://nodejs.org/en/download/',
  },
  {
    command: 'npm',
    displayName: 'npm',
    winCommands: ['npm.cmd'],
    versionArgs: ['--version'],
    versionRegex: /(\d+\.\d+\.\d+)/,
    downloadUrl: 'https://docs.npmjs.com/downloading-and-installing-node-js-and-npm',
  },
  {
    command: 'git',
    displayName: 'Git',
    winCommands: ['git.exe'],
    versionArgs: ['--version'],
    versionRegex: /(\d+\.\d+\.\d+)/,
    downloadUrl: 'https://git-scm.com/downloads',
  },
  {
    command: 'python',
    displayName: 'Python',
    winCommands: ['python.exe', 'py.exe'],
    unixCommands: ['python3'],
    versionArgs: ['--version'],
    versionRegex: /(\d+\.\d+\.\d+)/,
    downloadUrl: 'https://www.python.org/downloads/',
  },
]

/**
 * Detect a single tool's availability and version.
 */
async function detectTool(tool: ToolDefinition): Promise<RuntimeToolStatus> {
  const commands = isWin
    ? [tool.command, ...(tool.winCommands ?? [])]
    : [tool.command, ...(tool.unixCommands ?? [])]

  for (const cmd of commands) {
    try {
      // Try to get version (implies the tool is in PATH and executable)
      const { stdout } = await execFileAsync(cmd, tool.versionArgs, { timeout: 5000 })
      const versionMatch = stdout.match(tool.versionRegex)
      const version = versionMatch?.[1] ?? stdout.trim()

      // Try to resolve the full path
      let resolvedPath: string | null = null
      try {
        const whichCmd = isWin ? 'where' : 'which'
        const { stdout: pathOutput } = await execFileAsync(whichCmd, [cmd], { timeout: 3000 })
        resolvedPath = pathOutput.trim().split(/[\r\n]/)[0] ?? null
      } catch {
        // which/where failed, that's fine
      }

      return {
        command: tool.command,
        displayName: tool.displayName,
        available: true,
        resolvedPath,
        version,
        downloadUrl: tool.downloadUrl,
      }
    } catch {
      // This command variant didn't work, try next
      continue
    }
  }

  const bundledTool = await detectBundledTool(tool)
  if (bundledTool != null) return bundledTool

  return {
    command: tool.command,
    displayName: tool.displayName,
    available: false,
    resolvedPath: null,
    version: null,
    downloadUrl: tool.downloadUrl,
  }
}

async function detectBundledTool(tool: ToolDefinition): Promise<RuntimeToolStatus | null> {
  if (tool.command === 'node') {
    return detectBundledNode(tool)
  }
  if (tool.command === 'npm') {
    return detectBundledNpm(tool)
  }
  return null
}

async function detectBundledNode(tool: ToolDefinition): Promise<RuntimeToolStatus | null> {
  const nodePath = process.env.SPARK_ELECTRON_NODE ?? process.execPath
  if (!nodePath || !existsSync(nodePath)) return null

  try {
    const { stdout } = await execFileAsync(nodePath, tool.versionArgs, {
      timeout: 5000,
      env: getBundledNodeEnv(),
    })
    const versionMatch = stdout.match(tool.versionRegex)
    return {
      command: tool.command,
      displayName: tool.displayName,
      available: true,
      resolvedPath: nodePath,
      version: versionMatch?.[1] ?? stdout.trim(),
      downloadUrl: tool.downloadUrl,
    }
  } catch {
    return null
  }
}

async function detectBundledNpm(tool: ToolDefinition): Promise<RuntimeToolStatus | null> {
  const npmCli = findBundledNpmCli()
  if (npmCli == null) return null

  const nodePath = process.env.SPARK_ELECTRON_NODE ?? process.execPath
  if (!nodePath || !existsSync(nodePath)) return null

  try {
    const { stdout } = await execFileAsync(nodePath, [npmCli, ...tool.versionArgs], {
      timeout: 5000,
      env: getBundledNodeEnv(),
    })
    const versionMatch = stdout.match(tool.versionRegex)
    return {
      command: tool.command,
      displayName: tool.displayName,
      available: true,
      resolvedPath: npmCli,
      version: versionMatch?.[1] ?? stdout.trim(),
      downloadUrl: tool.downloadUrl,
    }
  } catch {
    return null
  }
}

function getBundledNodeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  }
}

function findBundledNpmCli(): string | null {
  const explicit = process.env.SPARK_BUNDLED_NPM_CLI
  if (explicit && existsSync(explicit)) return explicit

  try {
    const pkgPath = require.resolve('npm/package.json')
    const cliPath = join(dirname(pkgPath), 'bin', 'npm-cli.js')
    if (existsSync(cliPath)) return cliPath
  } catch {
    // Fall through to packaged-layout candidates.
  }

  const candidates = new Set<string>()
  for (const root of getBundledRuntimeRootCandidates()) {
    candidates.add(join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    candidates.add(join(root.replace(/\.asar$/, '.asar.unpacked'), 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    candidates.add(join(root, 'app.asar', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    candidates.add(join(root, 'app.asar.unpacked', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    candidates.add(join(root, 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    candidates.add(join(root, 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    candidates.add(join(root, 'runtime', 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    candidates.add(join(root, 'runtime', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function getBundledRuntimeRootCandidates(): string[] {
  const roots: string[] = []

  roots.push(process.cwd())
  roots.push(resolve(__dirname, '..', '..', '..'))
  roots.push(resolve(__dirname, '..', '..', '..', '..', '..'))

  const resourcesPath = process.resourcesPath
  if (resourcesPath) {
    roots.push(resourcesPath)
    roots.push(join(resourcesPath, 'app'))
    roots.push(join(resourcesPath, 'app.asar'))
    roots.push(join(resourcesPath, 'app.asar.unpacked'))
  }

  return [...new Set(roots)]
}

// ─── Public API ───────────────────────────────────────────────────────────────

let _cachedStatus: ShellEnvironmentStatus | null = null

function exposeBundledNodeRuntime(): void {
  process.env.SPARK_ELECTRON_NODE = process.execPath
  process.env.SPARK_ELECTRON_NODE_ENV = 'ELECTRON_RUN_AS_NODE=1'
}

/**
 * Initialize the shell environment:
 * 1. Fix PATH
 * 2. Detect runtime tools
 *
 * Should be called early in app startup, before any subprocess is spawned.
 */
export async function initializeShellEnvironment(): Promise<ShellEnvironmentStatus> {
  log.info('Initializing shell environment...')

  exposeBundledNodeRuntime()

  // Step 1: Fix PATH
  const pathResult = await fixShellPath()

  // Step 2: Detect tools
  const tools = await Promise.all(TOOL_DEFINITIONS.map(detectTool))

  const status: ShellEnvironmentStatus = {
    pathFixed: pathResult.changed,
    originalPath: pathResult.originalPath,
    fixedPath: pathResult.changed ? pathResult.fixedPath : null,
    tools,
    checkedAt: new Date().toISOString(),
  }

  _cachedStatus = status

  const available = tools.filter(t => t.available).map(t => `${t.displayName}@${t.version}`)
  const missing = tools.filter(t => !t.available).map(t => t.displayName)

  log.info(
    `Shell environment initialized. PATH ${pathResult.changed ? 'fixed' : 'unchanged'}. ` +
    `Available: [${available.join(', ')}]. Missing: [${missing.join(', ')}].`,
  )

  return status
}

/**
 * Get cached shell environment status (re-detect if needed).
 */
export async function getShellEnvironmentStatus(): Promise<ShellEnvironmentStatus> {
  if (_cachedStatus != null) {
    return _cachedStatus
  }
  return initializeShellEnvironment()
}

/**
 * Re-check runtime tools (e.g. after user installed something).
 */
export async function recheckRuntimeTools(): Promise<ShellEnvironmentStatus> {
  log.info('Re-checking runtime tools...')
  const tools = await Promise.all(TOOL_DEFINITIONS.map(detectTool))

  const status: ShellEnvironmentStatus = {
    pathFixed: _cachedStatus?.pathFixed ?? false,
    originalPath: _cachedStatus?.originalPath ?? process.env.PATH ?? null,
    fixedPath: _cachedStatus?.fixedPath ?? null,
    tools,
    checkedAt: new Date().toISOString(),
  }

  _cachedStatus = status
  return status
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitPathEntries(pathStr: string): string[] {
  if (!pathStr) return []
  const sep = isWin ? ';' : ':'
  return pathStr.split(sep).filter(Boolean)
}
