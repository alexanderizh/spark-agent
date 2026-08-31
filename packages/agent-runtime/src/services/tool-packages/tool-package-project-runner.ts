import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ToolPackageDevelopmentStep,
  ToolPackageManifest,
  ToolPackageProjectStepResult,
} from '@spark/protocol'

const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000
const MAX_STEP_TIMEOUT_MS = 30 * 60 * 1000
const MAX_STEP_OUTPUT_BYTES = 256 * 1024
const OUTPUT_TAIL_BYTES = 64 * 1024

interface BoundedBuffer {
  data: Buffer
  totalBytes: number
}

export async function runManagedProjectDevelopmentStep(params: {
  packageId: string
  projectPath: string
  manifest: ToolPackageManifest
  step: ToolPackageDevelopmentStep
  timeoutMs?: number
}): Promise<ToolPackageProjectStepResult> {
  const { command, inferred } = await resolveStepCommand(
    params.projectPath,
    params.manifest,
    params.step,
  )
  const timeoutMs = Math.min(params.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS, MAX_STEP_TIMEOUT_MS)
  const startedAt = Date.now()

  const child = spawn(command, {
    cwd: params.projectPath,
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildStepEnvironment(params.manifest),
  })

  const stdout = createBoundedBuffer()
  const stderr = createBoundedBuffer()
  child.stdout.on('data', (chunk: Buffer) => appendBounded(stdout, chunk))
  child.stderr.on('data', (chunk: Buffer) => appendBounded(stderr, chunk))

  const exitedBeforeTimeout = await new Promise<boolean>((resolveExited) => {
    let settled = false
    const finish = (exited: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('exit', onExit)
      child.off('error', onError)
      resolveExited(exited)
    }
    const onExit = (): void => finish(true)
    const onError = (): void => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
    child.once('error', onError)
  })

  if (!exitedBeforeTimeout) {
    terminateProcessTree(child)
    await waitForExit(child, 15_000)
  }

  return {
    packageId: params.packageId,
    step: params.step,
    command,
    inferred,
    exitCode: child.exitCode,
    timedOut: !exitedBeforeTimeout,
    durationMs: Date.now() - startedAt,
    stdout: formatBounded(stdout),
    stderr: formatBounded(stderr),
    truncated:
      stdout.totalBytes > MAX_STEP_OUTPUT_BYTES || stderr.totalBytes > MAX_STEP_OUTPUT_BYTES,
  }
}

export async function resolveStepCommand(
  projectPath: string,
  manifest: ToolPackageManifest,
  step: ToolPackageDevelopmentStep,
): Promise<{ command: string; inferred: boolean }> {
  const declared =
    step === 'install' ? manifest.development?.installCommand : manifest.development?.buildCommand
  if (declared != null && declared.trim().length > 0) return { command: declared, inferred: false }
  if (step === 'build') {
    throw new Error(
      'Tool project has no development.buildCommand declared; add it to spark-tool.json or skip the build step',
    )
  }
  const inferredCommand = await inferInstallCommand(projectPath)
  if (inferredCommand == null) {
    throw new Error(
      'Tool project has no development.installCommand and no supported lockfile; declare installCommand in spark-tool.json',
    )
  }
  return { command: inferredCommand, inferred: true }
}

async function inferInstallCommand(projectPath: string): Promise<string | null> {
  if (await fileExists(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm install'
  if (await fileExists(join(projectPath, 'yarn.lock'))) return 'yarn install'
  if (await fileExists(join(projectPath, 'bun.lockb'))) return 'bun install'
  if (await fileExists(join(projectPath, 'package.json'))) return 'npm install'
  return null
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function buildStepEnvironment(manifest: ToolPackageManifest): NodeJS.ProcessEnv {
  const inheritedNames = [
    'PATH',
    'Path',
    'PATHEXT',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
  ]
  const inherited = Object.fromEntries(
    inheritedNames.flatMap((name) =>
      process.env[name] == null ? [] : ([[name, process.env[name]]] as Array<[string, string]>),
    ),
  )
  return {
    ...inherited,
    SPARK_TOOL_PACKAGE_ID: manifest.id,
    SPARK_TOOL_PACKAGE_VERSION: manifest.version,
    SPARK_TOOL_PROJECT_STEP: '1',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  }
}

function createBoundedBuffer(): BoundedBuffer {
  return { data: Buffer.alloc(0), totalBytes: 0 }
}

function appendBounded(buffer: BoundedBuffer, chunk: Buffer): void {
  buffer.totalBytes += chunk.length
  if (buffer.data.length >= MAX_STEP_OUTPUT_BYTES) return
  const remaining = MAX_STEP_OUTPUT_BYTES - buffer.data.length
  buffer.data = Buffer.concat([buffer.data, chunk.subarray(0, remaining)])
}

function formatBounded(buffer: BoundedBuffer): string {
  if (buffer.data.length <= OUTPUT_TAIL_BYTES) return buffer.data.toString('utf8')
  const tail = buffer.data.subarray(buffer.data.length - OUTPUT_TAIL_BYTES)
  return `[前 ${buffer.data.length - OUTPUT_TAIL_BYTES} 字节已截断]\n${tail.toString('utf8')}`
}

export function terminateProcessTree(child: { pid?: number | undefined }): void {
  const pid = child.pid
  if (pid == null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.unref()
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // The process tree already exited.
    }
  }
}

export async function waitForExit(
  child: { exitCode: number | null; signalCode: string | null },
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode != null || child.signalCode != null) return true
  return new Promise((resolveExited) => {
    const timer = setTimeout(() => resolveExited(false), timeoutMs)
    const probe = setInterval(() => {
      if (child.exitCode != null || child.signalCode != null) {
        clearTimeout(timer)
        clearInterval(probe)
        resolveExited(true)
      }
    }, 100)
  })
}
