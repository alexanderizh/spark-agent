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
import type {
  ComputerExecutorBackend,
  ComputerHostBackend,
  ComputerObserverBackend,
} from './ComputerUseBackend.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'

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
  visualFingerprint: string
  semanticFingerprint: string
}

export class NativeHostComputerUseBackend
  implements ComputerObserverBackend, ComputerExecutorBackend, ComputerHostBackend
{
  private readonly platform: NativeHostPlatform
  private readonly connect: () => Promise<NativeHostConnection>
  private readonly evidenceSink: NativeObservationEvidenceSink | null
  private readonly createId: () => string
  private readonly observationSessions = new Map<string, ObservationSessionState>()
  private connectionPromise: Promise<NativeHostConnection> | null = null
  private connection: NativeHostConnection | null = null
  private disposed = false

  constructor(options: {
    platform: NativeHostPlatform
    connect: () => Promise<NativeHostConnection>
    evidenceSink?: NativeObservationEvidenceSink
    createId?: () => string
  }) {
    this.platform = options.platform
    this.connect = options.connect
    this.evidenceSink = options.evidenceSink ?? null
    this.createId = options.createId ?? randomUUID
  }

  async getCapabilities(): Promise<ComputerUseCapabilitySummary> {
    try {
      const manifest = await this.withConnection((connection) => connection.getCapabilities())
      return {
        available: true,
        platform: this.platform,
        nativeHost: manifest,
        permissions: manifest.permissions,
      }
    } catch (error) {
      const brokerError = normalizeBackendError(error)
      return {
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
    }
  }

  async listWindows(): Promise<NativeWindowDescriptor[]> {
    return this.withConnection((connection) => connection.listWindows())
  }

  async requestPermissions(
    permissions: Array<'screen' | 'accessibility'>,
  ): Promise<NativeHostCapabilityManifest> {
    return this.withConnection((connection) => connection.requestPermissions(permissions))
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
    const connection = await this.getControlConnection('observation')
    const target = await requireFocusedWindow(await connection.listWindows(input.signal))
    const previous = this.observationSessions.get(input.computerSessionId)
    if (
      previous != null &&
      (previous.appId !== target.app.id || previous.windowId !== target.window.id)
    ) {
      throw new ComputerUseBrokerError(
        'focus_mismatch',
        'The focused application or window changed since the previous observation',
      )
    }
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
  }

  async execute(input: {
    envelope: ComputerActionEnvelope
    observation: ComputerObservation
    signal: AbortSignal
  }): Promise<{ observation: ComputerObservation; noop: boolean }> {
    const connection = await this.getControlConnection('execution', input.envelope.action)
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
    const beforeEvidence = state
    const actionResult = await connection.executeAction(input.envelope, input.signal)
    const target =
      input.envelope.action.type === 'focus_window'
        ? await requireFocusedWindow(await connection.listWindows(input.signal))
        : { app: input.observation.foreground.app, window: input.observation.foreground.window }
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
    const afterEvidence = this.observationSessions.get(input.envelope.computerSessionId)
    return {
      observation,
      noop:
        actionResult.status === 'noop' ||
        (input.envelope.action.type !== 'wait_for' &&
          afterEvidence != null &&
          evidenceEquivalent(beforeEvidence, afterEvidence)),
    }
  }

  async cancelSession(computerSessionId: string): Promise<void> {
    this.observationSessions.delete(computerSessionId)
    if (this.connectionPromise == null) return
    try {
      const connection = await this.connectionPromise
      await connection.cancelSession(computerSessionId)
    } catch (error) {
      const normalized = normalizeBackendError(error)
      if (shouldInvalidateConnection(normalized) && this.connection != null) {
        await this.invalidateConnection(this.connection)
      }
      throw normalized
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.observationSessions.clear()
    if (this.connectionPromise == null) return
    try {
      await (await this.connectionPromise).close()
    } finally {
      this.connection = null
      this.connectionPromise = null
    }
  }

  private async withConnection<T>(
    operation: (connection: NativeHostConnection) => Promise<T>,
  ): Promise<T> {
    const connection = await this.getConnection()
    try {
      return await operation(connection)
    } catch (error) {
      const normalized = normalizeBackendError(error)
      if (shouldInvalidateConnection(normalized)) await this.invalidateConnection(connection)
      throw normalized
    }
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
        ? manifest.features.fullTree && manifest.backends.accessibility !== 'unavailable'
        : action != null && actionSupportedByManifest(action, manifest)
    if (!supported) {
      throw operation === 'observation' ? observationUnavailable() : executionUnavailable()
    }
    return connection
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
    const persistedEvidence = await this.evidenceSink?.persist({
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
      visualFingerprint: persistedEvidence?.visualFingerprint ?? result.response.payload.sha256,
      semanticFingerprint: semanticEvidenceFingerprint(observation),
    })
    return observation
  }

  private async invalidateConnection(connection: NativeHostConnection): Promise<void> {
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

function semanticEvidenceFingerprint(observation: ComputerObservation): string {
  return JSON.stringify({
    display: observation.display,
    foreground: observation.foreground,
    elements: observation.elements.map(({ treeVersion: _, ...element }) => element),
    loading: observation.loading,
    sensitiveRegions: observation.sensitiveRegions,
  })
}

function evidenceEquivalent(
  before: ObservationSessionState,
  after: ObservationSessionState,
): boolean {
  return (
    before.semanticFingerprint === after.semanticFingerprint &&
    perceptuallySimilar(before.visualFingerprint, after.visualFingerprint)
  )
}

function perceptuallySimilar(left: string, right: string): boolean {
  if (left === right) return true
  if (!/^[a-f0-9]+$/iu.test(left) || left.length !== right.length) return false
  let distance = 0
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`)
  while (bits > 0n) {
    distance += Number(bits & 1n)
    bits >>= 1n
  }
  return distance <= Math.max(1, Math.floor((left.length * 4) / 10))
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
  if (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'native_host_missing' ||
      error.code === 'native_host_untrusted' ||
      error.code === 'native_host_incompatible')
  ) {
    return new ComputerUseBrokerError(error.code, error.message)
  }
  return new ComputerUseBrokerError(
    'native_host_incompatible',
    'Trusted Native Host backend failed',
  )
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

function requireFocusedWindow(windows: NativeWindowDescriptor[]): NativeWindowDescriptor {
  const focused = windows.filter((window) => window.focused && !window.minimized)
  if (focused.length === 0) {
    throw new ComputerUseBrokerError('focus_mismatch', 'No focused controllable window was found')
  }
  if (focused.length !== 1) {
    throw new ComputerUseBrokerError(
      'native_host_incompatible',
      'Native Host returned more than one focused window',
    )
  }
  return focused[0] as NativeWindowDescriptor
}
