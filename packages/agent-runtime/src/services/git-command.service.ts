import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

export type GitRuntimeSource = 'override' | 'system' | 'bundled'

export interface GitCommandRuntimeDescriptor {
  generation: number
  source: GitRuntimeSource
  executablePath: string
  version: string
  commandEnvPatch: NodeJS.ProcessEnv
  shellPathEntries: string[]
}

export interface GitCommandRuntimeResolution {
  descriptor: GitCommandRuntimeDescriptor | null
  message: string | null
}

export interface GitCommandRuntimeProvider {
  current(): GitCommandRuntimeResolution | null
  resolve(): Promise<GitCommandRuntimeResolution>
  refresh(): Promise<GitCommandRuntimeResolution>
}

export type GitCommandOperation = 'read' | 'write' | 'network'

export type GitFailureCode =
  | 'GIT_RUNTIME_UNAVAILABLE'
  | 'GIT_OPERATION_FAILED'
  | 'GIT_OPERATION_OUTCOME_UNKNOWN'
  | 'AUTH_REQUIRED'

export interface GitCommandOptions {
  cwd: string
  operation?: GitCommandOperation
  timeoutMs?: number
  maxBufferBytes?: number
  env?: NodeJS.ProcessEnv
  allowedExitCodes?: readonly number[]
}

export interface GitCommandResult {
  stdout: string
  stderr: string
  exitCode: number
  runtime: GitCommandRuntimeDescriptor
}

export type GitRepositoryState =
  | {
      kind: 'ready'
      repositoryKind: 'worktree' | 'bare'
      runtimeSource: GitRuntimeSource
      runtimeVersion: string
    }
  | { kind: 'not_repository' }
  | { kind: 'runtime_unavailable'; code: 'GIT_RUNTIME_UNAVAILABLE'; message: string }
  | {
      kind: 'failed'
      code: Exclude<GitFailureCode, 'GIT_RUNTIME_UNAVAILABLE'>
      message: string
    }

interface GitCommandServiceDeps {
  existsSync?: (path: string) => boolean
  platform?: NodeJS.Platform
  spawn?: typeof spawn
}

interface ProcessResult {
  stdout: string
  stderr: string
  exitCode: number
  started: boolean
  timedOut: boolean
  outputLimitExceeded: boolean
  spawnError?: NodeJS.ErrnoException
}

const DEFAULT_TIMEOUT_MS: Record<GitCommandOperation, number> = {
  read: 15_000,
  write: 30_000,
  network: 60_000,
}

const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024
const PROBE_LOCALE_ENV: NodeJS.ProcessEnv = {
  LC_ALL: 'C',
  LANG: 'C',
  LANGUAGE: 'C',
  GIT_TERMINAL_PROMPT: '0',
}

export class GitCommandError extends Error {
  readonly code: GitFailureCode
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly started: boolean
  readonly timedOut: boolean

  constructor(
    code: GitFailureCode,
    message: string,
    details: {
      exitCode?: number | null
      stdout?: string
      stderr?: string
      started?: boolean
      timedOut?: boolean
      cause?: unknown
    } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'GitCommandError'
    this.code = code
    this.exitCode = details.exitCode ?? null
    this.stdout = details.stdout ?? ''
    this.stderr = details.stderr ?? ''
    this.started = details.started ?? false
    this.timedOut = details.timedOut ?? false
  }
}

export function isGitCommandError(error: unknown): error is GitCommandError {
  return error instanceof GitCommandError
}

/**
 * Build a child-only environment for managed shells and PTYs. Git-specific
 * variables never leak into the parent process environment.
 */
export function buildGitChildEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  descriptor: GitCommandRuntimeDescriptor,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...baseEnv, ...descriptor.commandEnvPatch }
  if (descriptor.shellPathEntries.length === 0) return childEnv

  const isWindows = platform === 'win32'
  const separator = isWindows ? ';' : ':'
  const currentPath = isWindows
    ? (Object.entries(childEnv).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '')
    : (childEnv.PATH ?? '')
  const merged = [...descriptor.shellPathEntries, ...currentPath.split(separator).filter(Boolean)]

  if (isWindows) {
    for (const key of Object.keys(childEnv)) {
      if (key.toLowerCase() === 'path') delete childEnv[key]
    }
  }
  childEnv.PATH = merged.join(separator)
  return childEnv
}

/**
 * Central Git subprocess executor. It captures an immutable runtime descriptor
 * per invocation and never replays a command that reached a child process.
 */
export class GitCommandService {
  private readonly exists: (path: string) => boolean
  private readonly platform: NodeJS.Platform
  private readonly spawnProcess: typeof spawn

  constructor(
    private readonly runtimeProvider: GitCommandRuntimeProvider,
    deps: GitCommandServiceDeps = {},
  ) {
    this.exists = deps.existsSync ?? existsSync
    this.platform = deps.platform ?? process.platform
    this.spawnProcess = deps.spawn ?? spawn
  }

  getCurrentRuntime(): GitCommandRuntimeDescriptor | null {
    return this.runtimeProvider.current()?.descriptor ?? null
  }

  buildChildEnvironment(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const descriptor = this.getCurrentRuntime()
    return descriptor == null
      ? { ...baseEnv }
      : buildGitChildEnvironment(baseEnv, descriptor, this.platform)
  }

  async execute(args: readonly string[], options: GitCommandOptions): Promise<GitCommandResult> {
    const descriptor = await this.requireRuntime()
    const first = await this.runOnce(descriptor, args, options)

    if (this.shouldRefreshMissingExecutable(descriptor, first)) {
      const refreshed = await this.runtimeProvider.refresh()
      if (refreshed.descriptor == null) {
        throw this.runtimeUnavailable(refreshed.message)
      }
      const retry = await this.runOnce(refreshed.descriptor, args, options)
      return this.toCommandResult(refreshed.descriptor, retry, options)
    }

    return this.toCommandResult(descriptor, first, options)
  }

  async probeRepository(cwd: string): Promise<GitRepositoryState> {
    try {
      const result = await this.execute(
        ['rev-parse', '--is-inside-work-tree', '--is-bare-repository'],
        {
          cwd,
          operation: 'read',
          env: PROBE_LOCALE_ENV,
          allowedExitCodes: [0, 128],
        },
      )
      if (result.exitCode === 128 && isNotRepositoryMessage(result.stderr)) {
        return { kind: 'not_repository' }
      }
      if (result.exitCode !== 0) {
        return {
          kind: 'failed',
          code: 'GIT_OPERATION_FAILED',
          message: summarizeProbeFailure(result.stderr),
        }
      }
      const [insideWorkTree, bareRepository] = result.stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
      if (insideWorkTree === 'true' || bareRepository === 'true') {
        return {
          kind: 'ready',
          repositoryKind: bareRepository === 'true' ? 'bare' : 'worktree',
          runtimeSource: result.runtime.source,
          runtimeVersion: result.runtime.version,
        }
      }
      return {
        kind: 'failed',
        code: 'GIT_OPERATION_FAILED',
        message: 'Git repository probe returned an unexpected result',
      }
    } catch (error) {
      if (isGitCommandError(error)) {
        if (error.code === 'GIT_RUNTIME_UNAVAILABLE') {
          return { kind: 'runtime_unavailable', code: error.code, message: error.message }
        }
        return { kind: 'failed', code: error.code, message: error.message }
      }
      return {
        kind: 'failed',
        code: 'GIT_OPERATION_FAILED',
        message: 'Unable to inspect the Git repository',
      }
    }
  }

  private async requireRuntime(): Promise<GitCommandRuntimeDescriptor> {
    const current = this.runtimeProvider.current()
    if (current?.descriptor != null) return current.descriptor
    const resolution = await this.runtimeProvider.resolve()
    if (resolution.descriptor == null) throw this.runtimeUnavailable(resolution.message)
    return resolution.descriptor
  }

  private runtimeUnavailable(message: string | null): GitCommandError {
    return new GitCommandError(
      'GIT_RUNTIME_UNAVAILABLE',
      message?.trim() || 'No usable Git runtime is available',
    )
  }

  private shouldRefreshMissingExecutable(
    descriptor: GitCommandRuntimeDescriptor,
    result: ProcessResult,
  ): boolean {
    if (result.started || result.spawnError?.code !== 'ENOENT') return false
    return !isAbsolute(descriptor.executablePath) || !this.exists(descriptor.executablePath)
  }

  private async runOnce(
    descriptor: GitCommandRuntimeDescriptor,
    args: readonly string[],
    options: GitCommandOptions,
  ): Promise<ProcessResult> {
    if (!this.exists(options.cwd)) {
      return {
        stdout: '',
        stderr: '',
        exitCode: -1,
        started: false,
        timedOut: false,
        outputLimitExceeded: false,
        spawnError: Object.assign(new Error('Git working directory is unavailable'), {
          code: 'ENOENT_CWD',
        }),
      }
    }

    const operation = options.operation ?? 'read'
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS[operation]
    const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
    const childEnv = buildGitChildEnvironment(
      { ...process.env, ...options.env },
      descriptor,
      this.platform,
    )
    if (operation === 'network') childEnv.GIT_TERMINAL_PROMPT = '0'

    return new Promise<ProcessResult>((resolve) => {
      let child: ChildProcess
      try {
        child = this.spawnProcess(descriptor.executablePath, [...args], {
          cwd: options.cwd,
          env: childEnv,
          windowsHide: true,
          detached: this.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        resolve({
          stdout: '',
          stderr: '',
          exitCode: -1,
          started: false,
          timedOut: false,
          outputLimitExceeded: false,
          spawnError: toErrnoException(error),
        })
        return
      }

      let stdout = ''
      let stderr = ''
      let outputBytes = 0
      let settled = false
      let started = false
      let timedOut = false
      let outputLimitExceeded = false
      let spawnError: NodeJS.ErrnoException | undefined

      const finish = (exitCode: number) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve({
          stdout,
          stderr,
          exitCode,
          started,
          timedOut,
          outputLimitExceeded,
          ...(spawnError == null ? {} : { spawnError }),
        })
      }

      const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
        outputBytes += chunk.byteLength
        if (outputBytes > maxBufferBytes) {
          if (!outputLimitExceeded) {
            outputLimitExceeded = true
            void terminateProcessTree(child, this.platform)
          }
          return
        }
        if (target === 'stdout') stdout += chunk.toString('utf8')
        else stderr += chunk.toString('utf8')
      }

      child.once('spawn', () => {
        started = true
      })
      child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk))
      child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk))
      child.once('error', (error: NodeJS.ErrnoException) => {
        spawnError = error
        if (!started) finish(-1)
      })
      child.once('close', (code) => finish(code ?? -1))

      const timeout = setTimeout(
        () => {
          timedOut = true
          void terminateProcessTree(child, this.platform)
        },
        Math.max(1, timeoutMs),
      )
      timeout.unref?.()
    })
  }

  private toCommandResult(
    descriptor: GitCommandRuntimeDescriptor,
    result: ProcessResult,
    options: GitCommandOptions,
  ): GitCommandResult {
    const operation = options.operation ?? 'read'
    if (result.spawnError != null) {
      const missingCwd = result.spawnError.code === 'ENOENT_CWD'
      const missingRuntime = result.spawnError.code === 'ENOENT'
      throw new GitCommandError(
        missingRuntime ? 'GIT_RUNTIME_UNAVAILABLE' : 'GIT_OPERATION_FAILED',
        missingCwd
          ? 'Git working directory is unavailable'
          : missingRuntime
            ? 'The selected Git runtime could not be started'
            : 'Git could not be started',
        { started: result.started, cause: result.spawnError },
      )
    }
    if (result.timedOut || result.outputLimitExceeded) {
      const outcomeUnknown = operation !== 'read' && result.started
      throw new GitCommandError(
        outcomeUnknown ? 'GIT_OPERATION_OUTCOME_UNKNOWN' : 'GIT_OPERATION_FAILED',
        result.timedOut
          ? outcomeUnknown
            ? 'Git timed out; the operation may already have taken effect'
            : 'Git timed out before producing a result'
          : outcomeUnknown
            ? 'Git output exceeded the safety limit; the operation outcome is unknown'
            : 'Git output exceeded the safety limit',
        {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          started: result.started,
          timedOut: result.timedOut,
        },
      )
    }

    const allowed = options.allowedExitCodes ?? [0]
    if (!allowed.includes(result.exitCode)) {
      const code = isAuthenticationFailure(result.stderr, result.stdout)
        ? 'AUTH_REQUIRED'
        : 'GIT_OPERATION_FAILED'
      throw new GitCommandError(code, commandFailureMessage(code), {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        started: result.started,
      })
    }
    return { ...result, runtime: descriptor }
  }
}

function isNotRepositoryMessage(stderr: string): boolean {
  return /not a git repository/i.test(stderr)
}

function summarizeProbeFailure(stderr: string): string {
  if (/dubious ownership/i.test(stderr))
    return 'Git rejected this repository because of dubious ownership'
  if (/permission denied|access is denied/i.test(stderr)) return 'Git cannot access this repository'
  return 'Git could not inspect this repository'
}

function isAuthenticationFailure(stderr: string, stdout: string): boolean {
  const combined = `${stderr}\n${stdout}`
  return /authentication failed|could not read username|terminal prompts disabled|permission denied \(publickey\)|host key verification failed|could not read password/i.test(
    combined,
  )
}

function commandFailureMessage(code: GitFailureCode): string {
  return code === 'AUTH_REQUIRED'
    ? 'Git requires authentication or interactive credentials'
    : 'Git command failed'
}

function toErrnoException(error: unknown): NodeJS.ErrnoException {
  return error instanceof Error ? (error as NodeJS.ErrnoException) : new Error(String(error))
}

async function terminateProcessTree(child: ChildProcess, platform: NodeJS.Platform): Promise<void> {
  const pid = child.pid
  if (pid == null) return
  if (platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }
        killer.once('error', () => {
          child.kill()
          finish()
        })
        killer.once('close', finish)
      })
    } catch {
      child.kill()
    }
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  const forceKill = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }, 250)
  child.once('close', () => clearTimeout(forceKill))
  forceKill.unref?.()
}

function createPathGitRuntimeProvider(): GitCommandRuntimeProvider {
  let current = resolvePathGitRuntime()
  return {
    current: () => current,
    resolve: async () => {
      if (current.descriptor == null) current = resolvePathGitRuntime()
      return current
    },
    refresh: async () => {
      current = resolvePathGitRuntime()
      return current
    },
  }
}

function resolvePathGitRuntime(): GitCommandRuntimeResolution {
  const rawPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1]
  const separator = process.platform === 'win32' ? ';' : ':'
  const names = process.platform === 'win32' ? ['git.exe', 'git'] : ['git']
  for (const rawEntry of rawPath?.split(separator) ?? []) {
    const entry = rawEntry.trim().replace(/^"|"$/g, '')
    if (!isAbsolute(entry)) continue
    for (const name of names) {
      const executablePath = join(entry, name)
      if (!existsSync(executablePath)) continue
      return {
        descriptor: {
          generation: 0,
          source: 'system',
          executablePath,
          version: 'unknown',
          commandEnvPatch: {},
          shellPathEntries: [dirname(executablePath)],
        },
        message: null,
      }
    }
  }
  return { descriptor: null, message: 'No Git executable was found in PATH' }
}

let defaultGitCommandService = new GitCommandService(createPathGitRuntimeProvider())

export function configureDefaultGitCommandService(service: GitCommandService): void {
  defaultGitCommandService = service
}

export function getDefaultGitCommandService(): GitCommandService {
  return defaultGitCommandService
}

export function buildDefaultGitChildEnvironment(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return defaultGitCommandService.buildChildEnvironment(baseEnv)
}
