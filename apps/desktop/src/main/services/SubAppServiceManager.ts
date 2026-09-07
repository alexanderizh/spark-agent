import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import type {
  SubAppServiceLogEntry,
  SubAppServiceLogsResponse,
  SubAppServiceStatus,
} from '@spark/protocol'
import { SubAppPackageService, SubAppPlatformRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { SparkError } from '@spark/shared'
import { resolveStandaloneNodeRuntimePath } from './StandaloneNodeRuntime.js'

const READY_TIMEOUT_MS = 15_000
const DEFAULT_INVOKE_TIMEOUT_MS = 30_000
const MAX_INVOKE_TIMEOUT_MS = 24 * 60 * 60 * 1_000
const MAX_PENDING = 16
const MAX_LOGS = 500
const MAX_LINE_BYTES = 4 * 1024 * 1024

interface PendingInvocation {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  onProgress?: (progress: number, message: string | null, checkpoint: unknown) => void
}

interface ServiceSession {
  appId: string
  releaseId: string
  lifecycle: 'on-demand' | 'application'
  idleTimeoutMs: number
  child: ChildProcessWithoutNullStreams
  status: SubAppServiceStatus
  ready: Promise<void>
  readyResolve: () => void
  readyReject: (error: Error) => void
  readyTimer: ReturnType<typeof setTimeout>
  stdoutBuffer: string
  pending: Map<string, PendingInvocation>
  idleTimer: ReturnType<typeof setTimeout> | null
  stopping: boolean
  exited: boolean
}

export class SubAppServiceManager {
  private readonly packages: SubAppPackageService
  private readonly platform: SubAppPlatformRepository
  private readonly sessions = new Map<string, ServiceSession>()
  private readonly logs = new Map<string, SubAppServiceLogEntry[]>()
  private readonly restartTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly database: SparkDatabase,
    private readonly eventSink?: (event: {
      appId: string
      event: string
      payload: unknown
    }) => void,
  ) {
    this.packages = new SubAppPackageService(database)
    this.platform = new SubAppPlatformRepository(database)
  }

  async restoreEnabledServices(): Promise<void> {
    await Promise.allSettled(
      this.platform
        .listApplicationServiceApps()
        .map((appId) => this.ensureSession(appId).then(() => undefined)),
    )
  }

  async startIfApplication(appId: string): Promise<void> {
    if (this.platform.listApplicationServiceApps().includes(appId)) await this.ensureSession(appId)
  }

  async preflightDraft(appId: string): Promise<void> {
    const runtime = await this.packages.resolveRuntime({ appId, mode: 'draft' })
    const service = runtime.descriptor.manifest.service
    if (runtime.descriptor.serviceEntry == null || service == null) return
    const entryUrl = pathToFileURL(path.join(runtime.root, runtime.descriptor.serviceEntry)).href
    const child = spawn(
      resolveStandaloneNodeRuntimePath(),
      ['--input-type=module', '--eval', SERVICE_PREFLIGHT_SOURCE],
      {
        cwd: runtime.root,
        env: {
          PATH: process.env.PATH ?? '',
          SPARK_SUB_APP_SERVICE_ENTRY: entryUrl,
          SPARK_SUB_APP_HEALTH_ACTION: service.healthAction ?? '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-MAX_LINE_BYTES)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_LINE_BYTES)
    })
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        killProcessTree(child)
        reject(new SparkError('EXECUTION_FAILED', '候选后台服务健康检查超时。'))
      }, READY_TIMEOUT_MS)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    if (exitCode !== 0 || !stdout.includes('"ok":true')) {
      throw new SparkError(
        'VALIDATION_FAILED',
        `候选后台服务健康检查失败：${stderr.trim() || stdout.trim() || `exit ${String(exitCode)}`}`,
      )
    }
  }

  async invoke(
    appId: string,
    action: string,
    input: unknown,
    timeoutMs = DEFAULT_INVOKE_TIMEOUT_MS,
    onProgress?: PendingInvocation['onProgress'],
    onStarted?: (requestId: string) => void,
  ): Promise<{ output: unknown; durationMs: number; requestId: string }> {
    const started = Date.now()
    const session = await this.ensureSession(appId)
    if (session.pending.size >= MAX_PENDING)
      throw new SparkError('RATE_LIMITED', '子应用后台并发请求已达上限。')
    const requestId = crypto.randomUUID()
    onStarted?.(requestId)
    const output = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          session.pending.delete(requestId)
          this.writeFrame(session, { type: 'cancel', requestId })
          reject(new SparkError('EXECUTION_FAILED', `后台操作 ${action} 超时。`))
        },
        Math.min(Math.max(timeoutMs, 100), MAX_INVOKE_TIMEOUT_MS),
      )
      session.pending.set(requestId, {
        resolve,
        reject,
        timer,
        ...(onProgress != null ? { onProgress } : {}),
      })
      this.writeFrame(session, { type: 'invoke', requestId, action, input: input ?? null })
    })
    this.scheduleIdle(session)
    return { output, durationMs: Date.now() - started, requestId }
  }

  cancel(appId: string, requestId: string): void {
    const session = this.sessions.get(appId)
    if (session != null) this.writeFrame(session, { type: 'cancel', requestId })
  }

  status(appId: string): SubAppServiceStatus {
    return (
      this.sessions.get(appId)?.status ?? {
        appId,
        releaseId: null,
        status: 'stopped',
        pid: null,
        startedAt: null,
        lastExitAt: null,
        lastError: null,
        restartCount: 0,
      }
    )
  }

  getLogs(appId: string, limit = 100): SubAppServiceLogsResponse {
    const items = this.logs.get(appId) ?? []
    return { items: items.slice(-Math.min(Math.max(limit, 1), MAX_LOGS)) }
  }

  async restart(appId: string): Promise<SubAppServiceStatus> {
    this.clearRestart(appId)
    await this.stop(appId)
    const session = await this.ensureSession(appId)
    return session.status
  }

  async stop(appId: string): Promise<void> {
    this.clearRestart(appId)
    const session = this.sessions.get(appId)
    if (session == null) return
    this.sessions.delete(appId)
    session.stopping = true
    if (session.idleTimer != null) clearTimeout(session.idleTimer)
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new SparkError('EXECUTION_FAILED', '子应用后台服务已停止。'))
    }
    session.pending.clear()
    this.writeFrame(session, { type: 'shutdown' })
    await new Promise<void>((resolve) => {
      if (session.child.exitCode != null) return resolve()
      const force = setTimeout(() => {
        killProcessTree(session.child)
        resolve()
      }, 1_000)
      session.child.once('exit', () => {
        clearTimeout(force)
        resolve()
      })
    })
    this.updateStatus(session, 'stopped', null)
  }

  async dispose(): Promise<void> {
    for (const timer of this.restartTimers.values()) clearTimeout(timer)
    this.restartTimers.clear()
    await Promise.allSettled([...this.sessions.keys()].map((appId) => this.stop(appId)))
  }

  private async ensureSession(appId: string): Promise<ServiceSession> {
    if (!this.platform.isEnabledPublished(appId)) {
      throw new SparkError('PERMISSION_DENIED', '子应用未启用，不能启动后台服务。')
    }
    const published = this.platform.getPublishedPackage(appId)
    if (published?.serviceEntry == null || published.manifest.service == null) {
      throw new SparkError('VALIDATION_FAILED', '子应用未声明可调用的后台服务。')
    }
    const existing = this.sessions.get(appId)
    if (
      existing != null &&
      existing.releaseId === published.releaseId &&
      existing.status.status === 'running'
    )
      return existing
    if (existing != null) await this.stop(appId)
    const runtime = await this.packages.resolveRuntime({
      appId,
      releaseId: published.releaseId,
      mode: 'published',
    })
    const entryUrl = pathToFileURL(path.join(runtime.root, published.serviceEntry)).href
    const child = spawn(
      resolveStandaloneNodeRuntimePath(),
      ['--input-type=module', '--eval', SERVICE_RUNNER_SOURCE],
      {
        cwd: runtime.root,
        env: { PATH: process.env.PATH ?? '', SPARK_SUB_APP_SERVICE_ENTRY: entryUrl },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      },
    )
    let readyResolve!: () => void
    let readyReject!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject
    })
    const now = new Date().toISOString()
    const session: ServiceSession = {
      appId,
      releaseId: published.releaseId,
      lifecycle: published.manifest.service.lifecycle,
      idleTimeoutMs: (published.manifest.service.idleTimeoutSeconds ?? 300) * 1_000,
      child,
      status: {
        appId,
        releaseId: published.releaseId,
        status: 'starting',
        pid: child.pid ?? null,
        startedAt: now,
        lastExitAt: null,
        lastError: null,
        restartCount: this.platform.getServiceState(appId)?.restartCount ?? 0,
      },
      ready,
      readyResolve,
      readyReject,
      readyTimer: setTimeout(() => readyReject(new Error('后台服务启动超时。')), READY_TIMEOUT_MS),
      stdoutBuffer: '',
      pending: new Map(),
      idleTimer: null,
      stopping: false,
      exited: false,
    }
    this.sessions.set(appId, session)
    this.persistStatus(session)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onStdout(session, chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => this.appendLog(appId, 'error', chunk.trim()))
    child.once('error', (error) => this.onExit(session, error))
    child.once('exit', (code, signal) =>
      this.onExit(
        session,
        new Error(`service exited: code=${String(code)} signal=${String(signal)}`),
      ),
    )
    try {
      await ready
      this.updateStatus(session, 'running', null)
      const healthAction = published.manifest.service.healthAction
      if (healthAction != null) await this.invoke(appId, healthAction, {}, 5_000)
      this.scheduleIdle(session)
      return session
    } catch (error) {
      this.updateStatus(session, 'crashed', error instanceof Error ? error.message : String(error))
      killProcessTree(child)
      throw error
    }
  }

  private onStdout(session: ServiceSession, chunk: string): void {
    session.stdoutBuffer += chunk
    if (Buffer.byteLength(session.stdoutBuffer) > MAX_LINE_BYTES) {
      this.onExit(session, new Error('后台服务协议行超过 4 MB。'))
      killProcessTree(session.child)
      return
    }
    for (;;) {
      const newline = session.stdoutBuffer.indexOf('\n')
      if (newline < 0) break
      const line = session.stdoutBuffer.slice(0, newline).trim()
      session.stdoutBuffer = session.stdoutBuffer.slice(newline + 1)
      if (!line) continue
      try {
        this.onFrame(session, JSON.parse(line) as Record<string, unknown>)
      } catch {
        this.appendLog(session.appId, 'error', '后台服务输出了无效协议帧。')
      }
    }
  }

  private onFrame(session: ServiceSession, frame: Record<string, unknown>): void {
    if (frame.type === 'ready') {
      clearTimeout(session.readyTimer)
      session.readyResolve()
      return
    }
    if (frame.type === 'log') {
      this.appendLog(session.appId, normalizeLogLevel(frame.level), String(frame.message ?? ''))
      return
    }
    if (frame.type === 'event' && typeof frame.event === 'string' && frame.event.length <= 120) {
      this.eventSink?.({ appId: session.appId, event: frame.event, payload: frame.payload ?? null })
      return
    }
    const requestId = typeof frame.requestId === 'string' ? frame.requestId : null
    if (requestId == null) return
    const pending = session.pending.get(requestId)
    if (pending == null) return
    if (frame.type === 'progress') {
      const progress =
        typeof frame.progress === 'number' ? Math.min(Math.max(frame.progress, 0), 1) : 0
      pending.onProgress?.(
        progress,
        typeof frame.message === 'string' ? frame.message : null,
        frame.checkpoint ?? null,
      )
      return
    }
    clearTimeout(pending.timer)
    session.pending.delete(requestId)
    if (frame.type === 'result') {
      if (Buffer.byteLength(JSON.stringify(frame.output ?? null), 'utf8') > 2 * 1024 * 1024) {
        pending.reject(new SparkError('VALIDATION_FAILED', '后台服务结果超过 2 MB 上限。'))
      } else {
        pending.resolve(frame.output)
      }
    } else
      pending.reject(
        new SparkError(
          'EXECUTION_FAILED',
          typeof frame.message === 'string' ? frame.message : '后台服务调用失败。',
        ),
      )
  }

  private onExit(session: ServiceSession, error: Error): void {
    if (session.exited) return
    session.exited = true
    clearTimeout(session.readyTimer)
    if (this.sessions.get(session.appId) === session) this.sessions.delete(session.appId)
    if (session.stopping) return
    const nextCount = session.status.restartCount + 1
    session.status.restartCount = nextCount
    this.updateStatus(session, 'crashed', error.message)
    session.readyReject(error)
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    session.pending.clear()
    if (session.lifecycle === 'application' && nextCount <= 3) {
      const delay = Math.min(1_000 * 2 ** (nextCount - 1), 10_000)
      this.restartTimers.set(
        session.appId,
        setTimeout(() => {
          this.restartTimers.delete(session.appId)
          void this.ensureSession(session.appId).catch((reason) =>
            this.appendLog(session.appId, 'error', String(reason)),
          )
        }, delay),
      )
    }
  }

  private scheduleIdle(session: ServiceSession): void {
    if (session.lifecycle !== 'on-demand' || session.pending.size > 0) return
    if (session.idleTimer != null) clearTimeout(session.idleTimer)
    session.idleTimer = setTimeout(() => void this.stop(session.appId), session.idleTimeoutMs)
  }

  private writeFrame(session: ServiceSession, frame: Record<string, unknown>): void {
    if (!session.child.stdin.destroyed) session.child.stdin.write(`${JSON.stringify(frame)}\n`)
  }

  private appendLog(appId: string, level: SubAppServiceLogEntry['level'], message: string): void {
    if (!message) return
    const list = this.logs.get(appId) ?? []
    list.push({ at: new Date().toISOString(), level, message: message.slice(0, 4_000) })
    if (list.length > MAX_LOGS) list.splice(0, list.length - MAX_LOGS)
    this.logs.set(appId, list)
  }

  private updateStatus(
    session: ServiceSession,
    status: SubAppServiceStatus['status'],
    error: string | null,
  ): void {
    session.status.status = status
    session.status.lastError = error
    if (status === 'stopped' || status === 'crashed') {
      session.status.pid = null
      session.status.lastExitAt = new Date().toISOString()
    }
    this.persistStatus(session)
  }

  private persistStatus(session: ServiceSession): void {
    const { pid: _pid, ...stored } = session.status
    this.platform.saveServiceState(stored)
  }

  private clearRestart(appId: string): void {
    const timer = this.restartTimers.get(appId)
    if (timer != null) clearTimeout(timer)
    this.restartTimers.delete(appId)
  }
}

function killProcessTree(child: Pick<ChildProcess, 'pid' | 'killed' | 'kill'>): void {
  if (child.pid == null || child.killed) return
  try {
    if (process.platform === 'win32') child.kill('SIGKILL')
    else process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already exited */
    }
  }
}

function normalizeLogLevel(value: unknown): SubAppServiceLogEntry['level'] {
  return value === 'error' || value === 'warn' ? value : 'info'
}

const SERVICE_RUNNER_SOURCE = String.raw`
const entry = process.env.SPARK_SUB_APP_SERVICE_ENTRY
if (!entry) throw new Error('Missing service entry')
const loaded = await import(entry)
const service = loaded.default ?? loaded
if (!service || typeof service.invoke !== 'function') throw new Error('Service must default-export invoke(action,input,context)')
const active = new Map()
let buffer = ''
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
console.log = (...args) => send({ type: 'log', level: 'info', message: args.map(String).join(' ') })
console.warn = (...args) => send({ type: 'log', level: 'warn', message: args.map(String).join(' ') })
console.error = (...args) => send({ type: 'log', level: 'error', message: args.map(String).join(' ') })
send({ type: 'ready' })
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  for (;;) {
    const i = buffer.indexOf('\n')
    if (i < 0) break
    const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1)
    if (!line) continue
    let frame
    try { frame = JSON.parse(line) } catch { continue }
    if (frame.type === 'shutdown') { process.exit(0); return }
    if (frame.type === 'cancel') { active.get(frame.requestId)?.abort(); continue }
    if (frame.type !== 'invoke') continue
    const controller = new AbortController(); active.set(frame.requestId, controller)
    const context = {
      signal: controller.signal,
      progress(progress, message = null, checkpoint = null) {
        send({ type: 'progress', requestId: frame.requestId, progress, message, checkpoint })
      },
      log(level, message) { send({ type: 'log', level, message }) },
      emit(event, payload) { send({ type: 'event', event, payload }) }
    }
    Promise.resolve(service.invoke(frame.action, frame.input, context)).then(
      output => send({ type: 'result', requestId: frame.requestId, output }),
      error => send({ type: 'error', requestId: frame.requestId, message: error?.message ?? String(error) })
    ).finally(() => active.delete(frame.requestId))
  }
})
`

const SERVICE_PREFLIGHT_SOURCE = String.raw`
const loaded = await import(process.env.SPARK_SUB_APP_SERVICE_ENTRY)
const service = loaded.default ?? loaded
if (!service || typeof service.invoke !== 'function') throw new Error('Service must default-export invoke')
const health = process.env.SPARK_SUB_APP_HEALTH_ACTION
if (health) await service.invoke(health, {}, { signal: new AbortController().signal, progress() {}, log() {} })
process.stdout.write(JSON.stringify({ ok: true }))
`
