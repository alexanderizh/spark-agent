import { spawn, type SpawnOptions } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import {
  NATIVE_HOST_PROTOCOL_VERSION,
  NativeHostRequestSchema,
  NativeHostResponseSchema,
  type ComputerActionEnvelope,
  type NativeBinaryPayloadDescriptor,
  type NativeHostCapabilityManifest,
  type NativeHostRequest,
  type NativeHostResponse,
  type NativeWindowDescriptor,
} from '@spark/protocol'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { VerifiedNativeHostArtifact } from './NativeHostArtifact.js'
import { createLogger } from '@spark/shared'
import {
  MAX_NATIVE_HOST_FRAME_PAYLOAD_BYTES,
  NativeHostFrameDecoder,
  encodeNativeHostJsonFrame,
  type NativeHostFrame,
} from './NativeHostFrameCodec.js'

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000
const CAPABILITY_REFRESH_INTERVAL_MS = 1_000
const ACTION_TIMEOUT_GRACE_MS = 5_000
const MAX_REQUEST_TIMEOUT_MS = 180_000
const INPUT_RELEASE_GRACE_MS = 300
const MAX_PENDING_REQUESTS = 64
const MAX_STDERR_DIAGNOSTIC_BYTES = 2_000
const log = createLogger('computer-use-native-host')

export interface NativeHostChildProcess extends EventEmitter {
  readonly stdin: Writable
  readonly stdout: Readable
  readonly stderr: Readable
  kill(signal?: NodeJS.Signals): boolean
}

export type NativeHostSpawnOptions = SpawnOptions & {
  shell: false
  stdio: ['pipe', 'pipe', 'pipe']
  env: {
    LANG: 'C'
    LC_ALL: 'C'
    SPARK_COMPUTER_LOCAL_TRUST?: '1'
  }
}

export type NativeHostSpawn = (
  executablePath: string,
  args: string[],
  options: NativeHostSpawnOptions,
) => NativeHostChildProcess

export interface NativeHostBinaryResponse<T extends NativeHostResponse> {
  response: T
  bytes: Buffer
}

interface PendingRequest {
  expectedType: NativeHostResponse['type']
  resolve: (value: NativeHostResponseResult) => void
  reject: (error: unknown) => void
  timeout: NodeJS.Timeout
  removeAbortListener?: () => void
}

interface NativeHostResponseResult {
  response: NativeHostResponse
  bytes?: Buffer
}

type NativeHostRequestInput = NativeHostRequest extends infer TRequest
  ? TRequest extends NativeHostRequest
    ? Omit<TRequest, 'protocolVersion' | 'requestId'>
    : never
  : never

interface AwaitingBinary {
  response: Extract<NativeHostResponse, { type: 'capture_result' | 'observation' }>
  descriptor: NativeBinaryPayloadDescriptor
  pending: PendingRequest
}

export class NativeHostClient {
  private readonly artifact: VerifiedNativeHostArtifact
  private readonly child: NativeHostChildProcess
  private readonly requestTimeoutMs: number
  private readonly decoder = new NativeHostFrameDecoder()
  private readonly pending = new Map<string, PendingRequest>()
  private capabilities: NativeHostCapabilityManifest | null = null
  private capabilitiesFetchedAt = 0
  private awaitingBinary: AwaitingBinary | null = null
  private terminalError: ComputerUseBrokerError | null = null
  private maxMessageBytes = MAX_NATIVE_HOST_FRAME_PAYLOAD_BYTES
  private stderrTail = ''

  private constructor(options: {
    artifact: VerifiedNativeHostArtifact
    child: NativeHostChildProcess
    requestTimeoutMs: number
  }) {
    this.artifact = options.artifact
    this.child = options.child
    this.requestTimeoutMs = options.requestTimeoutMs
    this.attachProcessListeners()
  }

  static async connect(options: {
    artifact: VerifiedNativeHostArtifact
    spawnProcess?: NativeHostSpawn
    requestTimeoutMs?: number
  }): Promise<NativeHostClient> {
    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    if (
      !Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs < 50 ||
      requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
    ) {
      throw new ComputerUseBrokerError(
        'native_host_incompatible',
        'Native Host request timeout is outside the supported range',
      )
    }
    const spawnProcess = options.spawnProcess ?? (spawn as unknown as NativeHostSpawn)
    let child: NativeHostChildProcess
    try {
      const env: NativeHostSpawnOptions['env'] =
        options.artifact.trustMode === 'local'
          ? { LANG: 'C', LC_ALL: 'C', SPARK_COMPUTER_LOCAL_TRUST: '1' }
          : { LANG: 'C', LC_ALL: 'C' }
      child = spawnProcess(options.artifact.executablePath, [], {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        windowsHide: true,
      })
    } catch {
      throw new ComputerUseBrokerError(
        'native_host_missing',
        'Trusted Native Host could not be started',
      )
    }

    const client = new NativeHostClient({ artifact: options.artifact, child, requestTimeoutMs })
    try {
      const result = await client.sendRequest(
        {
          protocolVersion: NATIVE_HOST_PROTOCOL_VERSION,
          requestId: randomUUID(),
          type: 'get_capabilities',
        },
        'capabilities',
      )
      const response = result.response as Extract<NativeHostResponse, { type: 'capabilities' }>
      client.assertHandshake(response.manifest)
      client.capabilities = response.manifest
      client.capabilitiesFetchedAt = Date.now()
      client.maxMessageBytes = response.manifest.limits.maxMessageBytes
      return client
    } catch (error) {
      client.terminate(normalizeClientError(error), 'SIGKILL')
      throw error
    }
  }

  async getCapabilities(): Promise<NativeHostCapabilityManifest> {
    this.assertConnected()
    if (Date.now() - this.capabilitiesFetchedAt >= CAPABILITY_REFRESH_INTERVAL_MS) {
      const result = await this.sendTypedRequest({ type: 'get_capabilities' }, 'capabilities')
      this.assertHandshake(result.response.manifest)
      this.capabilities = result.response.manifest
      this.capabilitiesFetchedAt = Date.now()
      this.maxMessageBytes = result.response.manifest.limits.maxMessageBytes
    }
    return this.capabilities as NativeHostCapabilityManifest
  }

  async listWindows(signal?: AbortSignal): Promise<NativeWindowDescriptor[]> {
    const result = await this.sendTypedRequest({ type: 'list_windows' }, 'windows', signal)
    return result.response.windows
  }

  async requestPermissions(
    permissions: Array<'screen' | 'accessibility'>,
  ): Promise<NativeHostCapabilityManifest> {
    const result = await this.sendTypedRequest(
      { type: 'request_permissions', permissions },
      'capabilities',
    )
    this.assertHandshake(result.response.manifest)
    this.capabilities = result.response.manifest
    this.capabilitiesFetchedAt = Date.now()
    this.maxMessageBytes = result.response.manifest.limits.maxMessageBytes
    return result.response.manifest
  }

  async captureWindow(input: {
    snapshotId: string
    windowId: string
    signal?: AbortSignal
  }): Promise<{
    snapshotId: string
    width: number
    height: number
    payload: NativeBinaryPayloadDescriptor
    bytes: Buffer
  }> {
    const result = await this.sendTypedRequest(
      { type: 'capture_window', snapshotId: input.snapshotId, windowId: input.windowId },
      'capture_result',
      input.signal,
    )
    if (result.response.snapshotId !== input.snapshotId || result.bytes == null) {
      throw this.protocolFailure('Native Host capture response does not match its request')
    }
    return { ...result.response, bytes: result.bytes }
  }

  async observe(input: {
    snapshotId: string
    appId: string
    windowId: string
    previousTreeVersion: string | null
    fullTree: boolean
    persistentCapture?: boolean
    signal?: AbortSignal
  }): Promise<NativeHostBinaryResponse<Extract<NativeHostResponse, { type: 'observation' }>>> {
    const result = await this.sendTypedRequest(
      {
        type: 'observe',
        snapshotId: input.snapshotId,
        appId: input.appId,
        windowId: input.windowId,
        previousTreeVersion: input.previousTreeVersion,
        fullTree: input.fullTree,
        ...(input.persistentCapture === true ? { persistentCapture: true } : {}),
      },
      'observation',
      input.signal,
    )
    if (result.bytes == null)
      throw this.protocolFailure('Native Host observation omitted its image')
    return { response: result.response, bytes: result.bytes }
  }

  async executeAction(
    envelope: ComputerActionEnvelope,
    signal?: AbortSignal,
  ): Promise<Extract<NativeHostResponse, { type: 'action_result' }>> {
    const result = await this.sendTypedRequest(
      { type: 'execute_action', envelope },
      'action_result',
      signal,
      actionRequestTimeoutMs(envelope, this.requestTimeoutMs),
    )
    if (result.response.actionId !== envelope.actionId) {
      throw this.protocolFailure('Native Host action response does not match its request')
    }
    return result.response
  }

  async cancelSession(computerSessionId: string): Promise<void> {
    await this.sendTypedRequest({ type: 'cancel_session', computerSessionId }, 'ack')
  }

  async ping(): Promise<void> {
    await this.sendTypedRequest({ type: 'ping' }, 'pong')
  }

  async close(): Promise<void> {
    if (this.terminalError != null) return
    this.terminateAfterInputRelease(
      new ComputerUseBrokerError('session_canceled', 'Native Host client was closed'),
      'SIGTERM',
    )
  }

  private async sendTypedRequest<TResponseType extends NativeHostResponse['type']>(
    request: NativeHostRequestInput,
    expectedType: TResponseType,
    signal?: AbortSignal,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<{
    response: Extract<NativeHostResponse, { type: TResponseType }>
    bytes?: Buffer
  }> {
    const result = await this.sendRequest(
      NativeHostRequestSchema.parse({
        ...request,
        protocolVersion: NATIVE_HOST_PROTOCOL_VERSION,
        requestId: randomUUID(),
      }),
      expectedType,
      signal,
      timeoutMs,
    )
    return result as {
      response: Extract<NativeHostResponse, { type: TResponseType }>
      bytes?: Buffer
    }
  }

  private sendRequest(
    request: NativeHostRequest,
    expectedType: NativeHostResponse['type'],
    signal?: AbortSignal,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<NativeHostResponseResult> {
    this.assertConnectedOrHandshaking()
    if (signal?.aborted) {
      return Promise.reject(
        new ComputerUseBrokerError('session_canceled', 'Computer session is canceled'),
      )
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(
        new ComputerUseBrokerError(
          'environment_unavailable',
          'Native Host already has the maximum number of in-flight requests',
          undefined,
          {
            retryable: true,
            diagnostic: {
              diagnosticCode: 'native_host_request_capacity_reached',
              stage: 'execute',
              repairAction: 'Wait for the current Native Host requests to finish, then retry.',
            },
          },
        ),
      )
    }
    return new Promise<NativeHostResponseResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new ComputerUseBrokerError('action_timeout', 'Native Host request timed out')
        this.terminateAfterInputRelease(error, 'SIGKILL')
      }, timeoutMs)
      const pending: PendingRequest = { expectedType, resolve, reject, timeout }
      if (signal != null) {
        const abort = () => {
          this.terminateAfterInputRelease(
            new ComputerUseBrokerError('session_canceled', 'Computer session is canceled'),
            'SIGKILL',
          )
        }
        signal.addEventListener('abort', abort, { once: true })
        pending.removeAbortListener = () => signal.removeEventListener('abort', abort)
      }
      this.pending.set(request.requestId, pending)
      try {
        this.child.stdin.write(
          encodeNativeHostJsonFrame(request, this.maxMessageBytes),
          (error) => {
            if (error != null) {
              this.terminate(
                new ComputerUseBrokerError(
                  'native_host_incompatible',
                  'Native Host request pipe failed',
                ),
                'SIGKILL',
              )
            }
          },
        )
      } catch {
        this.terminate(
          new ComputerUseBrokerError(
            'native_host_incompatible',
            'Native Host request could not be encoded or written',
          ),
          'SIGKILL',
        )
      }
    })
  }

  private attachProcessListeners(): void {
    this.child.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk))
    this.child.stdout.on('end', () => {
      try {
        this.decoder.end()
      } catch (error) {
        this.terminate(normalizeClientError(error), 'SIGKILL')
      }
    })
    this.child.stderr.on('data', (chunk: Buffer) => {
      const rawMessage = chunk.toString('utf8')
      this.stderrTail = `${this.stderrTail}${rawMessage}`.slice(-MAX_STDERR_DIAGNOSTIC_BYTES)
      const message = rawMessage.trim().slice(0, MAX_STDERR_DIAGNOSTIC_BYTES)
      if (message.length > 0) log.warn(`Native Host stderr: ${message}`)
    })
    this.child.once('error', () => {
      this.terminate(
        new ComputerUseBrokerError('native_host_incompatible', 'Native Host process failed'),
        'SIGKILL',
      )
    })
    this.child.once('exit', () => {
      if (this.terminalError == null) {
        const stderr = this.stderrTail.trim().replace(/\s+/g, ' ')
        this.terminate(
          new ComputerUseBrokerError(
            'native_host_incompatible',
            stderr.length > 0 ? `Native Host process exited: ${stderr}` : 'Native Host process exited',
          ),
          'SIGKILL',
        )
      }
    })
  }

  private onStdout(chunk: Buffer): void {
    if (this.terminalError != null) return
    try {
      for (const frame of this.decoder.push(chunk)) {
        if (frame.payload.length > this.maxMessageBytes) {
          throw new Error('Native Host exceeded its negotiated message limit')
        }
        this.handleFrame(frame)
        if (this.terminalError != null) break
      }
    } catch (error) {
      this.terminate(normalizeClientError(error), 'SIGKILL')
    }
  }

  private handleFrame(frame: NativeHostFrame): void {
    if (this.awaitingBinary != null) {
      if (frame.kind !== 'binary') {
        throw new Error('Native Host binary payload was not adjacent to its descriptor')
      }
      this.completeBinary(frame.payload)
      return
    }
    if (frame.kind !== 'json') throw new Error('Native Host sent an unexpected binary frame')

    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(frame.payload)
    const response = NativeHostResponseSchema.parse(JSON.parse(decoded))
    const pending = this.pending.get(response.requestId)
    if (pending == null) throw new Error('Native Host sent an unsolicited or duplicate response')
    if (response.type === 'error') {
      this.finishPending(response.requestId, pending)
      // Surface the Host-declared `retryable` flag so callers can transparently retry
      // idempotent operations (observe/list_windows/ping) on a transient failure without
      // tearing down an otherwise healthy connection. The connection is still alive here —
      // the Host reported a recoverable error, not a crash — so the decision to retry sits
      // with the backend, not with this transport client.
      pending.reject(
        new ComputerUseBrokerError(response.error.code, response.error.message, undefined, {
          retryable: response.error.retryable === true,
        }),
      )
      return
    }
    if (response.type !== pending.expectedType) {
      throw new Error('Native Host response type does not match its request')
    }
    if (response.type === 'capture_result' || response.type === 'observation') {
      this.awaitingBinary = { response, descriptor: response.payload, pending }
      return
    }
    this.finishPending(response.requestId, pending)
    pending.resolve({ response })
  }

  private completeBinary(bytes: Buffer): void {
    const awaiting = this.awaitingBinary
    if (awaiting == null) throw new Error('Native Host sent an unexpected binary frame')
    this.awaitingBinary = null
    const { descriptor, pending, response } = awaiting
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (bytes.length !== descriptor.byteLength || digest !== descriptor.sha256) {
      throw new Error('Native Host binary payload failed its length or digest check')
    }
    this.finishPending(response.requestId, pending)
    pending.resolve({ response, bytes: Buffer.from(bytes) })
  }

  private finishPending(requestId: string, pending: PendingRequest): void {
    this.pending.delete(requestId)
    clearTimeout(pending.timeout)
    pending.removeAbortListener?.()
  }

  private assertHandshake(manifest: NativeHostCapabilityManifest): void {
    const expected = this.artifact.manifest
    if (
      manifest.protocolVersion !== expected.protocolVersion ||
      manifest.hostVersion !== expected.hostVersion ||
      manifest.platform !== expected.platform ||
      manifest.architecture !== expected.architecture
    ) {
      throw new ComputerUseBrokerError(
        'native_host_incompatible',
        'Native Host handshake does not match its verified artifact manifest',
      )
    }
  }

  private protocolFailure(message: string): ComputerUseBrokerError {
    const error = new ComputerUseBrokerError('native_host_incompatible', message)
    this.terminate(error, 'SIGKILL')
    return error
  }

  private assertConnected(): void {
    this.assertConnectedOrHandshaking()
    if (this.capabilities == null) {
      throw new ComputerUseBrokerError(
        'native_host_incompatible',
        'Native Host handshake is incomplete',
      )
    }
  }

  private assertConnectedOrHandshaking(): void {
    if (this.terminalError != null) throw this.terminalError
  }

  private terminate(error: ComputerUseBrokerError, signal: NodeJS.Signals): void {
    if (this.terminalError != null) return
    this.terminalError = error
    this.awaitingBinary = null
    for (const [requestId, pending] of this.pending) {
      this.finishPending(requestId, pending)
      pending.reject(error)
    }
    this.child.stdin.destroy()
    this.child.stdout.destroy()
    this.child.stderr.destroy()
    this.child.kill(signal)
  }

  private terminateAfterInputRelease(error: ComputerUseBrokerError, signal: NodeJS.Signals): void {
    if (this.terminalError != null) return
    this.terminalError = error
    this.awaitingBinary = null
    for (const [requestId, pending] of this.pending) {
      this.finishPending(requestId, pending)
      pending.reject(error)
    }
    // Stop accepting work immediately, then let the Host's bounded input guard
    // emit mouse/key-up before force termination.
    this.child.stdin.end()
    const forceTermination = setTimeout(() => {
      this.child.stdin.destroy()
      this.child.stdout.destroy()
      this.child.stderr.destroy()
      this.child.kill(signal)
    }, INPUT_RELEASE_GRACE_MS)
    forceTermination.unref()
  }
}

function actionRequestTimeoutMs(
  envelope: ComputerActionEnvelope,
  defaultTimeoutMs: number,
): number {
  const actionDurationMs =
    envelope.action.type === 'drag'
      ? (envelope.action.durationMs ?? 250)
      : envelope.action.type === 'wait_for'
        ? envelope.action.timeoutMs
        : 0
  return Math.min(
    MAX_REQUEST_TIMEOUT_MS,
    Math.max(defaultTimeoutMs, actionDurationMs + ACTION_TIMEOUT_GRACE_MS),
  )
}

function normalizeClientError(error: unknown): ComputerUseBrokerError {
  if (error instanceof ComputerUseBrokerError) return error
  return new ComputerUseBrokerError(
    'native_host_incompatible',
    'Native Host violated the trusted wire protocol',
  )
}
