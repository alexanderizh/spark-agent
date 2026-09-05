import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve } from 'node:path'
import type { ToolPackageManifest } from '@spark/protocol'
import {
  TOOL_PROCESS_PROTOCOL_VERSION,
  ToolProcessChildFrameSchema,
  type ToolPackageRuntimeEvent,
  type ToolProcessChildFrame,
  type ToolProcessHostFrame,
} from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { z } from 'zod'
import {
  ToolHostCapabilityBroker,
  ToolHostCapabilityError,
  type ToolHostCapabilityContext,
} from './tool-host-capability-broker.js'

const log = createLogger('tool-package:process-host')
const MAX_PROTOCOL_LINE_BYTES = 4 * 1024 * 1024
const INITIALIZE_TIMEOUT_MS = 15_000
const DEFAULT_INVOKE_TIMEOUT_MS = 120_000
const GRACEFUL_STOP_MS = 1_000
const MAX_PENDING_REQUESTS = 16
const MAX_STDERR_BYTES = 1024 * 1024

export interface ToolProcessInvocationContext {
  sessionId?: string
  turnId?: string
  projectId?: string
  agentId?: string
  workflowId?: string
  correlationId?: string
  invocationSource?: 'model' | 'workflow' | 'test' | 'platform' | 'nested'
  environment?: Record<string, string>
  values?: Record<string, unknown>
}

export type ToolProcessRuntimeEvent = ToolPackageRuntimeEvent

export type ToolProcessRuntimeEventSink = (event: ToolProcessRuntimeEvent) => void

export interface ToolProcessInvokeRequest {
  manifest: ToolPackageManifest
  installPath: string
  toolName: string
  input: unknown
  context?: ToolProcessInvocationContext
  grantedCapabilities?: ReadonlySet<string>
  timeoutMs?: number
  signal?: AbortSignal
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  expectedType: 'ready' | 'result'
  invocationId?: string
  removeAbortListener?: () => void
}

interface ActiveInvocation {
  context: ToolHostCapabilityContext
  grantedCapabilities: ReadonlySet<string>
}

type HostFramePayload = ToolProcessHostFrame extends infer Frame
  ? Frame extends ToolProcessHostFrame
    ? Omit<Frame, 'protocolVersion' | 'requestId' | 'sequence'>
    : never
  : never

export class ToolProcessHost {
  private readonly sessions = new Map<string, ToolProcessSession>()
  private readonly runtimeEventListeners = new Set<ToolProcessRuntimeEventSink>()
  private readonly startingSessions = new Map<
    string,
    { session: ToolProcessSession; promise: Promise<ToolProcessSession> }
  >()

  constructor(
    private readonly capabilities = new ToolHostCapabilityBroker(),
    private readonly resolveExecutable: (command: string) => Promise<string> = async (command) =>
      command,
    private readonly initializeTimeoutMs = INITIALIZE_TIMEOUT_MS,
    eventSink?: ToolProcessRuntimeEventSink,
  ) {
    if (eventSink != null) this.runtimeEventListeners.add(eventSink)
  }

  onRuntimeEvent(listener: ToolProcessRuntimeEventSink): () => void {
    this.runtimeEventListeners.add(listener)
    return () => this.runtimeEventListeners.delete(listener)
  }

  async invoke(request: ToolProcessInvokeRequest): Promise<unknown> {
    if (request.manifest.runtime.adapter !== 'process') {
      throw new Error(`Tool process host cannot execute ${request.manifest.runtime.adapter}`)
    }
    const runtime = request.manifest.runtime
    const environment = request.context?.environment ?? {}
    const key = createSessionKey(request.manifest, request.installPath, environment)
    const persistent = runtime.lifecycle === 'persistent'
    let session = persistent ? this.sessions.get(key) : undefined
    if (persistent && (session == null || !session.available)) {
      session = await this.getOrStartPersistentSession(key, request, environment)
    } else if (!persistent) {
      session = new ToolProcessSession({
        manifest: request.manifest,
        installPath: request.installPath,
        environment,
        capabilities: this.capabilities,
        initializeTimeoutMs: this.initializeTimeoutMs,
        resolveExecutable: this.resolveExecutable,
        eventSink: (event) => this.emitRuntimeEvent(event),
        onClosed: () => {
          if (this.sessions.get(key) === session) this.sessions.delete(key)
        },
      })
      await session.start()
    }
    if (session == null) throw new Error('Tool process session could not be created')
    try {
      return await session.invoke(
        request.toolName,
        request.input,
        request.context ?? {},
        request.grantedCapabilities ?? new Set(),
        request.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS,
        request.signal,
      )
    } finally {
      if (!persistent) await session.stop()
    }
  }

  async dispose(): Promise<void> {
    const sessions = [
      ...new Set([
        ...this.sessions.values(),
        ...[...this.startingSessions.values()].map((entry) => entry.session),
      ]),
    ]
    this.sessions.clear()
    this.startingSessions.clear()
    await Promise.all(sessions.map((session) => session.stop()))
  }

  /** Invalidate persistent processes after configuration, permission or lifecycle changes. */
  invalidatePackage(packageId: string): Promise<void> {
    const sessions = new Set<ToolProcessSession>()
    for (const [key, session] of this.sessions) {
      if (!session.belongsToPackage(packageId)) continue
      this.sessions.delete(key)
      sessions.add(session)
    }
    for (const [key, entry] of this.startingSessions) {
      if (!entry.session.belongsToPackage(packageId)) continue
      this.startingSessions.delete(key)
      sessions.add(entry.session)
    }
    return Promise.allSettled([...sessions].map((session) => session.stop())).then(() => undefined)
  }

  private async getOrStartPersistentSession(
    key: string,
    request: ToolProcessInvokeRequest,
    environment: Record<string, string>,
  ): Promise<ToolProcessSession> {
    const existing = this.startingSessions.get(key)
    if (existing != null) return existing.promise

    const session = new ToolProcessSession({
      manifest: request.manifest,
      installPath: request.installPath,
      environment,
      capabilities: this.capabilities,
      initializeTimeoutMs: this.initializeTimeoutMs,
      resolveExecutable: this.resolveExecutable,
      eventSink: (event) => this.emitRuntimeEvent(event),
      onClosed: () => {
        if (this.sessions.get(key) === session) this.sessions.delete(key)
        if (this.startingSessions.get(key)?.session === session) {
          this.startingSessions.delete(key)
        }
      },
    })
    const promise = session.start().then(() => {
      if (this.startingSessions.get(key)?.session === session && session.available) {
        this.sessions.set(key, session)
      }
      return session
    })
    this.startingSessions.set(key, { session, promise })
    try {
      return await promise
    } finally {
      if (this.startingSessions.get(key)?.session === session) {
        this.startingSessions.delete(key)
      }
    }
  }

  private emitRuntimeEvent(event: ToolProcessRuntimeEvent): void {
    for (const listener of this.runtimeEventListeners) {
      try {
        listener(event)
      } catch (error) {
        log.warn('tool process runtime event listener failed', {
          packageId: event.packageId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}

class ToolProcessSession {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = Buffer.alloc(0)
  private sequence = 0
  private readonly pending = new Map<string, PendingRequest>()
  private readonly invocations = new Map<string, ActiveInvocation>()
  private stderrBytes = 0
  private stderrLimitReported = false
  private readonly processLog: ReturnType<typeof createLogger>
  private readonly lastProgressLogAt = new Map<string, number>()
  private stopping = false
  private stopPromise: Promise<void> | null = null
  closed = false

  constructor(
    private readonly options: {
      manifest: ToolPackageManifest
      installPath: string
      environment: Record<string, string>
      capabilities: ToolHostCapabilityBroker
      initializeTimeoutMs: number
      resolveExecutable(command: string): Promise<string>
      eventSink?: ToolProcessRuntimeEventSink
      onClosed(): void
    },
  ) {
    this.processLog = createLogger(`tools:process:${options.manifest.id}`)
  }

  belongsToPackage(packageId: string): boolean {
    return this.options.manifest.id === packageId
  }

  get available(): boolean {
    return !this.closed && !this.stopping
  }

  async start(): Promise<void> {
    const runtime = this.options.manifest.runtime
    if (runtime.adapter !== 'process') throw new Error('Invalid process runtime')
    const command = runtime.command.startsWith('./')
      ? resolve(this.options.installPath, runtime.command.slice(2))
      : await this.options.resolveExecutable(runtime.command)
    const cwd = resolve(this.options.installPath, runtime.workingDirectory ?? '.')
    const child = spawn(command, runtime.args, {
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildChildEnvironment(this.options.environment, this.options.manifest),
    })
    this.child = child
    child.stdout.on('data', (chunk: Buffer) => this.handleStdoutChunk(chunk))
    child.stdout.on('error', (error) => this.failProtocol(error))
    child.stdin.on('error', (error) => this.failProtocol(error))
    child.stderr.on('data', (chunk: Buffer) => {
      if (this.stderrBytes >= MAX_STDERR_BYTES) {
        if (!this.stderrLimitReported) {
          this.stderrLimitReported = true
          log.warn('tool package stderr limit reached', {
            packageId: this.options.manifest.id,
            maxBytes: MAX_STDERR_BYTES,
          })
        }
        return
      }
      const remaining = MAX_STDERR_BYTES - this.stderrBytes
      const bounded = chunk.subarray(0, remaining)
      this.stderrBytes += bounded.length
      log.info('tool package stderr', {
        packageId: this.options.manifest.id,
        message: redactConfiguredSecrets(
          bounded.toString('utf8').slice(0, 32_000),
          this.options.manifest,
          this.options.environment,
        ),
      })
    })
    child.stderr.on('error', (error) => this.failProtocol(error))
    child.once('error', (error) => this.handleClosed(error))
    child.once('exit', (code, signal) => {
      this.handleClosed(
        this.stopping
          ? undefined
          : new Error(
              `Tool process exited unexpectedly (code=${String(code)}, signal=${String(signal)})`,
            ),
      )
    })
    try {
      await this.request(
        {
          type: 'initialize',
          packageId: this.options.manifest.id,
          packageVersion: this.options.manifest.version,
          capabilityProtocolVersion: this.options.capabilities.protocolVersion,
        },
        this.options.initializeTimeoutMs,
      )
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async invoke(
    toolName: string,
    input: unknown,
    context: ToolProcessInvocationContext,
    grantedCapabilities: ReadonlySet<string>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const tool = this.options.manifest.tools.find((candidate) => candidate.name === toolName)
    if (tool == null) throw new Error(`Tool package does not define tool: ${toolName}`)
    const parsedInput = z.fromJSONSchema(tool.inputSchema).safeParse(input)
    if (!parsedInput.success) {
      throw new Error(
        `Invalid Tool Package input for ${toolName}: ${z.prettifyError(parsedInput.error)}`,
      )
    }
    if (
      parsedInput.data == null ||
      typeof parsedInput.data !== 'object' ||
      Array.isArray(parsedInput.data)
    ) {
      throw new Error(`Invalid Tool Package input for ${toolName}: expected an object`)
    }
    const invocationId = randomUUID()
    this.invocations.set(invocationId, {
      context: {
        packageId: this.options.manifest.id,
        packageVersion: this.options.manifest.version,
        toolName,
        invocationId,
        ...(context.sessionId != null ? { sessionId: context.sessionId } : {}),
        ...(context.turnId != null ? { turnId: context.turnId } : {}),
        ...(context.projectId != null ? { projectId: context.projectId } : {}),
        ...(context.agentId != null ? { agentId: context.agentId } : {}),
        ...(context.workflowId != null ? { workflowId: context.workflowId } : {}),
        ...(context.correlationId != null ? { correlationId: context.correlationId } : {}),
        ...(signal != null ? { signal } : {}),
      },
      grantedCapabilities: new Set(grantedCapabilities),
    })
    try {
      return await this.request(
        {
          type: 'invoke',
          invocationId,
          toolName,
          input: parsedInput.data,
          context: context.values ?? {},
        },
        timeoutMs,
        signal,
      )
    } catch (error) {
      try {
        this.send({ type: 'cancel', invocationId }, randomUUID())
      } catch {
        // Preserve the original timeout/protocol/process failure when the child is already gone.
      }
      if (error instanceof ToolProcessRequestTimeoutError) await this.stop()
      throw error
    } finally {
      this.invocations.delete(invocationId)
    }
  }

  stop(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.stopPromise != null) return this.stopPromise
    this.stopping = true
    this.stopPromise = this.performStop()
    return this.stopPromise
  }

  private async performStop(): Promise<void> {
    try {
      this.send({ type: 'shutdown' }, randomUUID())
    } catch {
      // Process may already be gone.
    }
    const child = this.child
    if (child == null) {
      if (!this.closed) this.handleClosed()
      return
    }
    const exitedGracefully = await waitForExit(child, GRACEFUL_STOP_MS)
    if (!exitedGracefully) {
      terminateProcessTree(child)
      await waitForExit(child, GRACEFUL_STOP_MS)
    } else if (process.platform !== 'win32') {
      // The direct child may exit while leaving descendants in its detached process group.
      terminateProcessTree(child)
    }
    if (!this.closed) this.handleClosed()
  }

  private request(
    frame: HostFramePayload,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(
        new Error(`Tool process has too many concurrent requests (max ${MAX_PENDING_REQUESTS})`),
      )
    }
    const requestId = randomUUID()
    return new Promise((resolveRequest, rejectRequest) => {
      if (signal?.aborted === true) {
        rejectRequest(new ToolProcessRequestCancelledError())
        return
      }
      const onAbort = (): void => {
        const pending = this.pending.get(requestId)
        if (pending == null) return
        clearTimeout(pending.timer)
        pending.removeAbortListener?.()
        this.pending.delete(requestId)
        rejectRequest(new ToolProcessRequestCancelledError())
      }
      const timer = setTimeout(() => {
        const pending = this.pending.get(requestId)
        pending?.removeAbortListener?.()
        this.pending.delete(requestId)
        rejectRequest(new ToolProcessRequestTimeoutError(frame.type))
      }, timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(requestId, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
        expectedType: frame.type === 'initialize' ? 'ready' : 'result',
        ...('invocationId' in frame && typeof frame.invocationId === 'string'
          ? { invocationId: frame.invocationId }
          : {}),
        ...(signal != null
          ? { removeAbortListener: () => signal.removeEventListener('abort', onAbort) }
          : {}),
      })
      try {
        this.send(frame, requestId)
      } catch (error) {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.pending.delete(requestId)
        rejectRequest(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private send(frame: HostFramePayload, requestId: string): void {
    if (this.child == null || this.closed) throw new Error('Tool process is not running')
    const payload = JSON.stringify({
      ...frame,
      protocolVersion: TOOL_PROCESS_PROTOCOL_VERSION,
      requestId,
      sequence: this.sequence++,
    })
    if (Buffer.byteLength(payload) > MAX_PROTOCOL_LINE_BYTES) {
      throw new Error('Tool process protocol frame exceeds 4 MB')
    }
    this.child.stdin.write(`${payload}\n`)
  }

  private handleStdoutChunk(chunk: Buffer): void {
    if (this.closed || chunk.length === 0) return
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk])
    let newline = this.stdoutBuffer.indexOf(0x0a)
    while (newline >= 0) {
      if (newline > MAX_PROTOCOL_LINE_BYTES) {
        this.failProtocol(new Error('Tool process emitted a protocol frame larger than 4 MB'))
        return
      }
      let line = this.stdoutBuffer.subarray(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1)
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1)
      void this.handleLine(line.toString('utf8')).catch((error) => {
        this.failProtocol(
          error instanceof Error
            ? error
            : new Error('Tool process protocol handler failed', { cause: error }),
        )
      })
      newline = this.stdoutBuffer.indexOf(0x0a)
    }
    if (this.stdoutBuffer.length > MAX_PROTOCOL_LINE_BYTES) {
      this.failProtocol(new Error('Tool process emitted a protocol frame larger than 4 MB'))
    }
  }

  private async handleLine(line: string): Promise<void> {
    let frame: ToolProcessChildFrame
    try {
      frame = ToolProcessChildFrameSchema.parse(JSON.parse(line) as unknown)
    } catch (error) {
      this.failProtocol(
        new Error('Tool process emitted an invalid protocol frame', { cause: error }),
      )
      return
    }
    if (frame.type === 'log') {
      this.handleLogFrame(frame)
      return
    }
    if (frame.type === 'progress') {
      this.handleProgressFrame(frame)
      return
    }
    if (frame.type === 'capability.request') {
      await this.handleCapabilityRequest(frame)
      return
    }
    const pending = this.pending.get(frame.requestId)
    if (pending == null) return
    if (frame.type !== 'error' && frame.type !== pending.expectedType) {
      this.failProtocol(
        new Error(
          `Tool process response type mismatch: expected ${pending.expectedType}, received ${frame.type}`,
        ),
      )
      return
    }
    if (
      pending.invocationId != null &&
      'invocationId' in frame &&
      frame.invocationId != null &&
      frame.invocationId !== pending.invocationId
    ) {
      this.failProtocol(new Error('Tool process response invocationId does not match its request'))
      return
    }
    clearTimeout(pending.timer)
    pending.removeAbortListener?.()
    this.pending.delete(frame.requestId)
    if (frame.type === 'error') pending.reject(new Error(`${frame.code}: ${frame.message}`))
    else if (frame.type === 'result') pending.resolve(frame.result)
    else pending.resolve(undefined)
  }

  private handleLogFrame(frame: Extract<ToolProcessChildFrame, { type: 'log' }>): void {
    const invocation =
      frame.invocationId == null ? undefined : this.invocations.get(frame.invocationId)
    const message = redactConfiguredSecrets(
      frame.message,
      this.options.manifest,
      this.options.environment,
    )
    this.processLog[frame.level]('tool process log', {
      packageVersion: this.options.manifest.version,
      ...(frame.invocationId != null ? { invocationId: frame.invocationId } : {}),
      ...(invocation?.context.correlationId != null
        ? { correlationId: invocation.context.correlationId }
        : {}),
      ...(invocation != null ? { toolName: invocation.context.toolName } : {}),
      message,
    })
    this.options.eventSink?.({
      type: 'log',
      packageId: this.options.manifest.id,
      packageVersion: this.options.manifest.version,
      ...(frame.invocationId != null ? { invocationId: frame.invocationId } : {}),
      ...(invocation?.context.correlationId != null
        ? { correlationId: invocation.context.correlationId }
        : {}),
      ...(invocation != null ? { toolName: invocation.context.toolName } : {}),
      level: frame.level,
      message,
    })
  }

  private handleProgressFrame(frame: Extract<ToolProcessChildFrame, { type: 'progress' }>): void {
    const invocation = this.invocations.get(frame.invocationId)
    const message =
      frame.message == null
        ? undefined
        : redactConfiguredSecrets(frame.message, this.options.manifest, this.options.environment)
    const now = Date.now()
    const lastLoggedAt = this.lastProgressLogAt.get(frame.invocationId) ?? 0
    const terminal = frame.progress === 0 || frame.progress === 1
    if (terminal || now - lastLoggedAt >= 500) {
      this.lastProgressLogAt.set(frame.invocationId, now)
      this.processLog.info('tool process progress', {
        packageVersion: this.options.manifest.version,
        invocationId: frame.invocationId,
        ...(invocation?.context.correlationId != null
          ? { correlationId: invocation.context.correlationId }
          : {}),
        ...(invocation != null ? { toolName: invocation.context.toolName } : {}),
        ...(frame.progress != null ? { progress: frame.progress } : {}),
        ...(message != null ? { message } : {}),
      })
    }
    this.options.eventSink?.({
      type: 'progress',
      packageId: this.options.manifest.id,
      packageVersion: this.options.manifest.version,
      invocationId: frame.invocationId,
      ...(invocation?.context.correlationId != null
        ? { correlationId: invocation.context.correlationId }
        : {}),
      ...(invocation != null ? { toolName: invocation.context.toolName } : {}),
      ...(frame.progress != null ? { progress: frame.progress } : {}),
      ...(message != null ? { message } : {}),
    })
  }

  private async handleCapabilityRequest(
    frame: Extract<ToolProcessChildFrame, { type: 'capability.request' }>,
  ): Promise<void> {
    const invocation = this.invocations.get(frame.invocationId)
    if (invocation == null) {
      this.sendCapabilityError(frame, 'INVOCATION_NOT_ACTIVE', 'Invocation is no longer active')
      return
    }
    const permissions = this.options.manifest.permissions
    const declared = new Set([
      ...permissions.requiredSparkCapabilities,
      ...permissions.optionalSparkCapabilities,
    ])
    try {
      const result = await this.options.capabilities.invoke({
        capability: frame.capability,
        declaredCapabilities: declared,
        grantedCapabilities: invocation.grantedCapabilities,
        context: invocation.context,
        input: frame.input,
      })
      this.send(
        { type: 'capability.result', invocationId: frame.invocationId, result },
        frame.requestId,
      )
    } catch (error) {
      const code = error instanceof ToolHostCapabilityError ? error.code : 'CAPABILITY_FAILED'
      this.sendCapabilityError(
        frame,
        code,
        error instanceof Error ? error.message : 'Spark capability failed',
      )
    }
  }

  private sendCapabilityError(
    frame: Extract<ToolProcessChildFrame, { type: 'capability.request' }>,
    code: string,
    message: string,
  ): void {
    this.send(
      { type: 'capability.error', invocationId: frame.invocationId, code, message },
      frame.requestId,
    )
  }

  private handleClosed(error?: Error): void {
    if (this.closed) return
    this.closed = true
    this.stdoutBuffer = Buffer.alloc(0)
    this.child = null
    const failure = error ?? new Error('Tool process closed')
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.removeAbortListener?.()
      pending.reject(failure)
    }
    this.pending.clear()
    this.invocations.clear()
    this.lastProgressLogAt.clear()
    this.options.onClosed()
  }

  private failProtocol(error: Error): void {
    const child = this.child
    this.handleClosed(error)
    if (child != null) terminateProcessTree(child)
  }
}

class ToolProcessRequestTimeoutError extends Error {
  constructor(frameType: string) {
    super(`Tool process request timed out: ${frameType}`)
    this.name = 'ToolProcessRequestTimeoutError'
  }
}

class ToolProcessRequestCancelledError extends Error {
  constructor() {
    super('Tool process request was cancelled')
    this.name = 'AbortError'
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve(true)
  return new Promise((resolveExited) => {
    let settled = false
    const finish = (exited: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('exit', onExit)
      resolveExited(exited)
    }
    const onExit = (): void => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
  })
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams): void {
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
      child.kill('SIGKILL')
    } catch {
      // The process tree already exited.
    }
  }
}

function createSessionKey(
  manifest: ToolPackageManifest,
  installPath: string,
  environment: Record<string, string>,
): string {
  return createHash('sha256')
    .update(manifest.id)
    .update('\0')
    .update(manifest.version)
    .update('\0')
    .update(installPath)
    .update('\0')
    .update(
      JSON.stringify(
        Object.entries(environment).sort(([left], [right]) => left.localeCompare(right)),
      ),
    )
    .digest('hex')
}

function buildChildEnvironment(
  configured: Record<string, string>,
  manifest: ToolPackageManifest,
): NodeJS.ProcessEnv {
  const inheritedNames = [
    'PATH',
    'Path',
    'PATHEXT',
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
    ...configured,
    SPARK_TOOL_PACKAGE_ID: manifest.id,
    SPARK_TOOL_PACKAGE_VERSION: manifest.version,
    SPARK_TOOL_PROCESS_PROTOCOL: TOOL_PROCESS_PROTOCOL_VERSION,
  }
}

function redactConfiguredSecrets(
  message: string,
  manifest: ToolPackageManifest,
  environment: Record<string, string>,
): string {
  let redacted = message
  for (const variable of manifest.environment) {
    if (!variable.secret) continue
    const value = environment[variable.name]
    if (value != null && value.length > 0) redacted = redacted.split(value).join('[REDACTED]')
  }
  return redacted
}
