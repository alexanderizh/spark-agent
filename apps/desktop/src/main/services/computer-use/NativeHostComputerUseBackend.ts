import { randomUUID } from 'node:crypto'
import type {
  ComputerActionEnvelope,
  ComputerObservation,
  ComputerUseCapabilitySummary,
  NativeBinaryPayloadDescriptor,
  NativeHostCapabilityManifest,
  NativeHostPlatform,
  NativeHostResponse,
  NativeWindowDescriptor,
} from '@spark/protocol'
import { ComputerObservationSchema } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import type {
  ComputerExecutorBackend,
  ComputerHostBackend,
  ComputerObserverBackend,
  NativeHostDiagnosticProbe,
} from './ComputerUseBackend.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import { NativeHostArtifactError } from './NativeHostArtifact.js'
import { NativeHostSupervisor } from './NativeHostSupervisor.js'
import type {
  ComputerUseMetricDimensions,
  ComputerUseMetricName,
  ComputerUseMetricsCollector,
} from './ComputerUseMetricsCollector.js'

const log = createLogger('computer-use-native-host')

// Idempotent operations (observe / list_windows / capabilities) are transparently retried when
// the Host reports a recoverable (retryable) failure on an otherwise healthy connection. The
// connection is only invalidated for hard failures (see shouldInvalidateConnection), so a
// retryable hit reuses the same live connection instead of bouncing the whole turn on a hiccup.
const IDEMPOTENT_RETRY_MAX_ATTEMPTS = 3
const IDEMPOTENT_RETRY_BASE_DELAY_MS = 50

function delayForIdempotentRetry(attempt: number): Promise<void> {
  const delayMs = IDEMPOTENT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export interface NativeHostConnection {
  getCapabilities(): Promise<NativeHostCapabilityManifest>
  requestPermissions(
    permissions: Array<'screen' | 'accessibility'>,
  ): Promise<NativeHostCapabilityManifest>
  listWindows(signal?: AbortSignal): Promise<NativeWindowDescriptor[]>
  captureWindow(input: {
    snapshotId: string
    windowId: string
    signal?: AbortSignal
  }): Promise<NativeHostWindowCapture>
  observe(input: {
    snapshotId: string
    appId: string
    windowId: string
    previousTreeVersion: string | null
    fullTree: boolean
    signal?: AbortSignal
  }): Promise<{
    response: Extract<NativeHostResponse, { type: 'observation' }>
    bytes: Buffer
  }>
  executeAction(
    envelope: ComputerActionEnvelope,
    signal?: AbortSignal,
  ): Promise<Extract<NativeHostResponse, { type: 'action_result' }>>
  cancelSession(computerSessionId: string): Promise<void>
  close(): Promise<void>
}

export interface NativeHostWindowCapture {
  snapshotId: string
  width: number
  height: number
  payload: NativeBinaryPayloadDescriptor
  bytes: Buffer
}

export interface NativeObservationEvidenceSink {
  persist(input: {
    computerSessionId: string
    kind: 'execution_before' | 'execution_after'
    observation: ComputerObservation
    payload: NativeBinaryPayloadDescriptor
    bytes: Buffer
  }): Promise<{ visualFingerprint: string } | void>
}

interface ObservationSessionState {
  appId: string
  windowId: string
  frameId: string
  treeVersion: string
}

export class NativeHostComputerUseBackend
  implements ComputerObserverBackend, ComputerExecutorBackend, ComputerHostBackend
{
  private readonly platform: NativeHostPlatform
  private readonly connect: () => Promise<NativeHostConnection>
  private readonly evidenceSink: NativeObservationEvidenceSink | null
  private readonly createId: () => string
  private readonly observationSessions = new Map<string, ObservationSessionState>()
  private readonly targetBindings = new Map<string, { appId: string; windowId: string }>()
  private readonly supervisor: NativeHostSupervisor | null
  private readonly metrics: ComputerUseMetricsCollector | null
  private readonly metricDimensions: () => ComputerUseMetricDimensions
  private connectionPromise: Promise<NativeHostConnection> | null = null
  private connection: NativeHostConnection | null = null
  private disposed = false

  constructor(options: {
    platform: NativeHostPlatform
    connect: () => Promise<NativeHostConnection>
    evidenceSink?: NativeObservationEvidenceSink
    createId?: () => string
    /**
     * Inject a pre-built supervisor (tests). Mutually exclusive with
     * {@link enableHostSupervisor}.
     */
    supervisor?: NativeHostSupervisor
    /**
     * Construct the supervisor internally so its {@code onRebound} callback can
     * clear this backend's cached observations. Production path, gated by the
     * factory feature flag.
     */
    enableHostSupervisor?: boolean
    metrics?: ComputerUseMetricsCollector
    metricDimensions?: () => ComputerUseMetricDimensions
  }) {
    this.platform = options.platform
    this.connect = options.connect
    this.evidenceSink = options.evidenceSink ?? null
    this.createId = options.createId ?? randomUUID
    this.metrics = options.metrics ?? null
    this.metricDimensions =
      options.metricDimensions ??
      (() => ({
        platform: this.platform,
        architecture: process.arch,
        appVersion: 'unknown',
        hostVersion: 'unknown',
        trustMode: 'unknown',
      }))
    if (options.supervisor != null && options.enableHostSupervisor === true) {
      throw new Error(
        'NativeHostComputerUseBackend: pass either supervisor or enableHostSupervisor, not both',
      )
    }
    this.supervisor =
      options.supervisor ??
      (options.enableHostSupervisor === true
        ? new NativeHostSupervisor({
            connect: () => this.connect(),
            probe: async (connection) => {
              await connection.getCapabilities()
            },
            onRebound: () => {
              // The new host process lost all session state — every cached
              // observation is now stale. Force callers to re-bind + re-observe.
              this.observationSessions.clear()
            },
          })
        : null)
  }

  async getCapabilities(): Promise<ComputerUseCapabilitySummary> {
    const startedAt = performance.now()
    try {
      const manifest = await this.withConnection((connection) => connection.getCapabilities())
      const capabilities: ComputerUseCapabilitySummary = {
        available: true,
        platform: this.platform,
        nativeHost: manifest,
        permissions: manifest.permissions,
      }
      this.recordMetric('native_host_capability_ms', startedAt, true)
      return capabilities
    } catch (error) {
      const brokerError = normalizeBackendError(error)
      const capabilities: ComputerUseCapabilitySummary = {
        available: false,
        platform: this.platform,
        nativeHost: null,
        permissions: {
          screen: 'unsupported',
          accessibility: 'unsupported',
          input: 'unsupported',
        },
        unavailableReason: brokerError.code,
      }
      this.recordMetric('native_host_capability_ms', startedAt, false)
      return capabilities
    }
  }

  async diagnoseNativeHost(): Promise<NativeHostDiagnosticProbe> {
    try {
      const manifest = await this.withConnection((connection) => connection.getCapabilities(), {
        idempotent: true,
      })
      return {
        capabilities: {
          available: true,
          platform: this.platform,
          nativeHost: manifest,
          permissions: manifest.permissions,
        },
        diagnostic: {
          diagnosticCode: 'native_host_ready',
          stage: 'handshake',
        },
        errorCode: null,
        message: 'Trusted Native Host verification and handshake succeeded',
      }
    } catch (error) {
      const brokerError = normalizeBackendError(error)
      return {
        capabilities: unavailableCapabilities(this.platform, brokerError.code),
        diagnostic: brokerError.diagnostic ?? fallbackNativeHostDiagnostic(brokerError.code),
        errorCode: brokerError.code,
        message: brokerError.message,
      }
    }
  }

  async listWindows(): Promise<NativeWindowDescriptor[]> {
    return this.withConnection((connection) => connection.listWindows(), { idempotent: true })
  }

  bindSessionTarget(input: { computerSessionId: string; appId: string; windowId: string }): void {
    this.targetBindings.set(input.computerSessionId, {
      appId: input.appId,
      windowId: input.windowId,
    })
    this.observationSessions.delete(input.computerSessionId)
  }

  async requestPermissions(
    permissions: Array<'screen' | 'accessibility'>,
  ): Promise<NativeHostCapabilityManifest> {
    return this.measure('permission_request_ms', () =>
      this.withConnection((connection) => connection.requestPermissions(permissions)),
    )
  }

  async captureWindow(input: {
    snapshotId: string
    windowId: string
    signal?: AbortSignal
  }): Promise<NativeHostWindowCapture> {
    return this.withConnection((connection) => connection.captureWindow(input))
  }

  async observe(input: {
    computerSessionId: string
    fullTree: boolean
    signal: AbortSignal
  }): Promise<ComputerObservation> {
    return this.measure('observation_ms', () =>
      this.runControlOperation(
        'observation',
        undefined,
        async (connection) => {
          const previous = this.observationSessions.get(input.computerSessionId)
          const targetBinding = this.targetBindings.get(input.computerSessionId)
          const target = selectControllableWindow(
            await connection.listWindows(input.signal),
            previous == null
              ? targetBinding
              : { appId: previous.appId, windowId: previous.windowId },
            targetBinding != null,
          )
          return this.captureObservation({
            connection,
            computerSessionId: input.computerSessionId,
            appId: target.app.id,
            windowId: target.window.id,
            previousTreeVersion: previous?.treeVersion ?? null,
            fullTree: input.fullTree || previous == null,
            kind: 'execution_before',
            signal: input.signal,
          })
        },
        { idempotent: true },
      ),
    )
  }

  async execute(input: {
    envelope: ComputerActionEnvelope
    observation: ComputerObservation
    signal: AbortSignal
  }): Promise<{ observation: ComputerObservation; noop: boolean }> {
    const state = this.observationSessions.get(input.envelope.computerSessionId)
    if (
      state == null ||
      state.frameId !== input.observation.frameId ||
      state.treeVersion !== input.observation.treeVersion ||
      state.appId !== input.envelope.targetAppId ||
      state.windowId !== input.envelope.targetWindowId
    ) {
      throw new ComputerUseBrokerError(
        'stale_frame',
        'Native Host action does not match the latest persisted observation',
      )
    }
    return this.measure('action_ms', () =>
      this.runControlOperation('execution', input.envelope.action, async (connection) => {
        const actionResult = await connection.executeAction(input.envelope, input.signal)
        const target = selectControllableWindow(
          await connection.listWindows(input.signal),
          {
            appId: input.observation.foreground.app.id,
            windowId: input.observation.foreground.window.id,
          },
          this.targetBindings.has(input.envelope.computerSessionId),
        )
        const observation = await this.captureObservation({
          connection,
          computerSessionId: input.envelope.computerSessionId,
          appId: target.app.id,
          windowId: target.window.id,
          previousTreeVersion: input.observation.treeVersion,
          fullTree: false,
          kind: 'execution_after',
          signal: input.signal,
        })
        return {
          observation,
          // The Host knows whether it actually emitted an input/semantic action. Visual
          // similarity is deliberately not used as a hard interruption signal because
          // video and animated applications change without the action, while successful
          // focus/caret actions may make only a tiny pixel-level change.
          noop: actionResult.status === 'noop',
        }
      }),
    )
  }

  async cancelSession(computerSessionId: string): Promise<void> {
    this.observationSessions.delete(computerSessionId)
    this.targetBindings.delete(computerSessionId)
    if (this.supervisor != null) {
      let connection: NativeHostConnection
      try {
        connection = await this.supervisor.acquire()
      } catch (error) {
        // The supervisor has no live connection to cancel on; the local session
        // is already cleared. Surface the underlying error for observability.
        throw normalizeBackendError(error)
      }
      try {
        await connection.cancelSession(computerSessionId)
      } catch (error) {
        const normalized = normalizeBackendError(error)
        if (shouldInvalidateConnection(normalized)) {
          await this.invalidateConnection(connection, normalized)
        }
        throw normalized
      }
      return
    }
    if (this.connectionPromise == null) return
    try {
      const connection = await this.connectionPromise
      await connection.cancelSession(computerSessionId)
    } catch (error) {
      const normalized = normalizeBackendError(error)
      if (shouldInvalidateConnection(normalized) && this.connection != null) {
        await this.invalidateConnection(this.connection, normalized)
      }
      throw normalized
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.observationSessions.clear()
    this.targetBindings.clear()
    if (this.supervisor != null) {
      await this.supervisor.dispose()
      return
    }
    if (this.connectionPromise == null) return
    try {
      await (await this.connectionPromise).close()
    } finally {
      this.connection = null
      this.connectionPromise = null
    }
  }

  private async measure<T>(name: ComputerUseMetricName, operation: () => Promise<T>): Promise<T> {
    const startedAt = performance.now()
    try {
      const result = await operation()
      this.recordMetric(name, startedAt, true)
      return result
    } catch (error) {
      this.recordMetric(name, startedAt, false)
      throw error
    }
  }

  private recordMetric(name: ComputerUseMetricName, startedAt: number, succeeded: boolean): void {
    this.metrics?.record(name, performance.now() - startedAt, this.metricDimensions(), succeeded)
  }

  private async withConnection<T>(
    operation: (connection: NativeHostConnection) => Promise<T>,
    options?: { idempotent?: boolean },
  ): Promise<T> {
    return this.runIdempotentRetry(options?.idempotent === true, async () => {
      const connection = await this.getConnection()
      try {
        return await operation(connection)
      } catch (error) {
        const normalized = normalizeBackendError(error)
        if (shouldInvalidateConnection(normalized))
          await this.invalidateConnection(connection, normalized)
        throw normalized
      }
    })
  }

  /**
   * Bounds transparent retry to idempotent operations whose failure the Host flagged as
   * recoverable. Non-idempotent operations (execute_action / capture_window) and any
   * non-retryable error propagate on the first attempt; `fn` itself only invalidates the
   * connection for hard failures (see shouldInvalidateConnection), so a retryable hit on an
   * idempotent operation reuses the same still-healthy connection instead of bouncing the turn.
   */
  private async runIdempotentRetry<T>(idempotent: boolean, fn: () => Promise<T>): Promise<T> {
    const maxAttempts = idempotent ? IDEMPOTENT_RETRY_MAX_ATTEMPTS : 1
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) await delayForIdempotentRetry(attempt)
      try {
        return await fn()
      } catch (error) {
        if (
          !idempotent ||
          attempt >= maxAttempts - 1 ||
          !(error instanceof ComputerUseBrokerError) ||
          !error.retryable
        ) {
          throw error
        }
        log.warn('Retrying idempotent Native Host operation after a recoverable failure', {
          attempt: attempt + 1,
          code: error.code,
        })
      }
    }
    // Unreachable: every iteration either returns on success or throws on the terminal attempt.
    throw new ComputerUseBrokerError('native_host_incompatible', 'Native Host retry loop exhausted')
  }

  private async getControlConnection(
    operation: 'observation' | 'execution',
    action?: ComputerActionEnvelope['action'],
  ): Promise<NativeHostConnection> {
    if (this.evidenceSink == null) {
      throw operation === 'observation' ? observationUnavailable() : executionUnavailable()
    }
    const connection = await this.getConnection()
    const manifest = await connection.getCapabilities()
    const supported =
      operation === 'observation'
        ? manifest.features.captureWindow &&
          manifest.backends.screen !== 'unavailable' &&
          manifest.permissions.screen === 'granted'
        : action != null && actionSupportedByManifest(action, manifest)
    if (!supported) {
      throw operation === 'observation' ? observationUnavailable() : executionUnavailable()
    }
    return connection
  }

  private async runControlOperation<T>(
    operation: 'observation' | 'execution',
    action: ComputerActionEnvelope['action'] | undefined,
    callback: (connection: NativeHostConnection) => Promise<T>,
    options?: { idempotent?: boolean },
  ): Promise<T> {
    return this.runIdempotentRetry(options?.idempotent === true, async () => {
      const connection = await this.getControlConnection(operation, action)
      try {
        return await callback(connection)
      } catch (error) {
        const normalized = normalizeBackendError(error)
        if (shouldInvalidateConnection(normalized))
          await this.invalidateConnection(connection, normalized)
        throw normalized
      }
    })
  }

  private async captureObservation(input: {
    connection: NativeHostConnection
    computerSessionId: string
    appId: string
    windowId: string
    previousTreeVersion: string | null
    fullTree: boolean
    kind: 'execution_before' | 'execution_after'
    signal: AbortSignal
  }): Promise<ComputerObservation> {
    if (input.signal.aborted) throw sessionCanceled()
    const snapshotId = this.createId()
    const result = await input.connection.observe({
      snapshotId,
      appId: input.appId,
      windowId: input.windowId,
      previousTreeVersion: input.previousTreeVersion,
      fullTree: input.fullTree,
      signal: input.signal,
    })
    const observation = ComputerObservationSchema.parse(result.response.observation)
    if (
      observation.screenshot.snapshotId !== snapshotId ||
      observation.foreground.app.id !== input.appId ||
      observation.foreground.window.id !== input.windowId ||
      (input.fullTree && observation.tree.mode !== 'full')
    ) {
      throw new ComputerUseBrokerError(
        'native_host_incompatible',
        'Native Host observation does not match its focused-window request',
      )
    }
    if (input.signal.aborted) throw sessionCanceled()
    await this.evidenceSink?.persist({
      computerSessionId: input.computerSessionId,
      kind: input.kind,
      observation,
      payload: result.response.payload,
      bytes: result.bytes,
    })
    if (input.signal.aborted) throw sessionCanceled()
    this.observationSessions.set(input.computerSessionId, {
      appId: observation.foreground.app.id,
      windowId: observation.foreground.window.id,
      frameId: observation.frameId,
      treeVersion: observation.treeVersion,
    })
    return observation
  }

  private async invalidateConnection(
    connection: NativeHostConnection,
    error?: unknown,
  ): Promise<void> {
    if (this.supervisor != null) {
      const brokerError =
        error instanceof ComputerUseBrokerError ? error : normalizeBackendError(error)
      await this.supervisor.reportTerminalFailure(connection, brokerError)
      return
    }
    if (this.connection !== connection) return
    this.connection = null
    this.connectionPromise = null
    await connection.close().catch(() => undefined)
  }

  private getConnection(): Promise<NativeHostConnection> {
    if (this.disposed) {
      return Promise.reject(
        new ComputerUseBrokerError('session_canceled', 'Native Host backend is disposed'),
      )
    }
    if (this.supervisor != null) return this.supervisor.acquire()
    if (this.connectionPromise != null) return this.connectionPromise
    const pending = this.connect()
      .then((connection) => {
        this.connection = connection
        return connection
      })
      .catch((error: unknown) => {
        if (this.connectionPromise === pending) this.connectionPromise = null
        throw normalizeBackendError(error)
      })
    this.connectionPromise = pending
    return pending
  }
}

function actionSupportedByManifest(
  action: ComputerActionEnvelope['action'],
  manifest: NativeHostCapabilityManifest,
): boolean {
  const semanticAction =
    action.type === 'invoke_element' ||
    action.type === 'set_value' ||
    action.type === 'select_text' ||
    action.type === 'focus_window' ||
    action.type === 'wait_for' ||
    (action.type === 'scroll' && action.elementId != null)
  if (semanticAction) {
    return manifest.features.semanticActions && manifest.backends.accessibility !== 'unavailable'
  }
  const pointerAction =
    action.type === 'click' ||
    action.type === 'move' ||
    action.type === 'drag' ||
    action.type === 'scroll'
  if (pointerAction) {
    return manifest.features.absolutePointer && manifest.backends.input !== 'unavailable'
  }
  return manifest.features.keyboard && manifest.backends.input !== 'unavailable'
}

function shouldInvalidateConnection(error: ComputerUseBrokerError): boolean {
  return (
    error.code === 'native_host_missing' ||
    error.code === 'native_host_untrusted' ||
    error.code === 'native_host_incompatible' ||
    error.code === 'action_timeout' ||
    error.code === 'session_canceled'
  )
}

function normalizeBackendError(error: unknown): ComputerUseBrokerError {
  if (error instanceof ComputerUseBrokerError) return error
  if (error instanceof NativeHostArtifactError) {
    // Preserve the structured diagnostic so the actionable repair hint (reinstall /
    // update_app / grant_permission) survives the boundary into the broker error and
    // reaches the renderer via safeComputerUseIpc instead of being flattened away.
    const options = error.diagnostic != null ? { diagnostic: error.diagnostic } : undefined
    return new ComputerUseBrokerError(error.code, error.message, undefined, options)
  }
  return new ComputerUseBrokerError(
    'native_host_incompatible',
    'Trusted Native Host backend failed',
  )
}

function unavailableCapabilities(
  platform: NativeHostPlatform,
  unavailableReason: string,
): ComputerUseCapabilitySummary {
  return {
    available: false,
    platform,
    nativeHost: null,
    permissions: {
      screen: 'unsupported',
      accessibility: 'unsupported',
      input: 'unsupported',
    },
    unavailableReason,
  }
}

function fallbackNativeHostDiagnostic(code: ComputerUseBrokerError['code']): {
  diagnosticCode: string
  stage: 'discover' | 'verify' | 'handshake'
  repairAction: string
} {
  if (code === 'native_host_missing') {
    return { diagnosticCode: 'native_host_missing', stage: 'discover', repairAction: 'reinstall' }
  }
  if (code === 'native_host_untrusted') {
    return { diagnosticCode: 'native_host_untrusted', stage: 'verify', repairAction: 'reinstall' }
  }
  return {
    diagnosticCode: code === 'action_timeout' ? 'host_handshake_timeout' : 'host_handshake_failed',
    stage: 'handshake',
    repairAction: 'restart_app',
  }
}

function observationUnavailable(): ComputerUseBrokerError {
  return new ComputerUseBrokerError(
    'environment_unavailable',
    'Native Host observation is unavailable until its evidence sink is installed',
  )
}

function executionUnavailable(): ComputerUseBrokerError {
  return new ComputerUseBrokerError(
    'environment_unavailable',
    'Native Host action execution is unavailable until observation persistence is installed',
  )
}

function sessionCanceled(): ComputerUseBrokerError {
  return new ComputerUseBrokerError('session_canceled', 'Computer session is canceled')
}

function selectControllableWindow(
  windows: NativeWindowDescriptor[],
  previous?: { appId: string; windowId: string },
  requireExactTarget = false,
): NativeWindowDescriptor {
  if (!requireExactTarget) {
    const focused = windows.filter((window) => window.focused && !window.minimized)
    if (focused.length > 0) return largestWindow(focused)
  }
  const previousWindow = windows.find(
    (window) =>
      !window.minimized &&
      window.app.id === previous?.appId &&
      window.window.id === previous.windowId,
  )
  if (previousWindow != null) return previousWindow
  if (previous != null && requireExactTarget) {
    throw new ComputerUseBrokerError('focus_mismatch', 'The bound target window is unavailable')
  }
  const visible = windows.filter((window) => !window.minimized)
  if (visible.length > 0) return largestWindow(visible)
  throw new ComputerUseBrokerError('focus_mismatch', 'No controllable window was found')
}

function largestWindow(windows: NativeWindowDescriptor[]): NativeWindowDescriptor {
  return [...windows].sort(
    (left, right) =>
      right.window.bounds.width * right.window.bounds.height -
      left.window.bounds.width * left.window.bounds.height,
  )[0] as NativeWindowDescriptor
}
