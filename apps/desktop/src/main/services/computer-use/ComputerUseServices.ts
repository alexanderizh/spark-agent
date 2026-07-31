import { app, nativeImage } from 'electron'
import { join } from 'node:path'
import {
  ApplicationSnapshotRepository,
  ComputerActionRepository,
  ComputerActivityEventRepository,
  ComputerActuatorLeaseRepository,
  ComputerApprovalRepository,
  ComputerSessionRepository,
  ComputerVerificationRepository,
  type SparkDatabase,
} from '@spark/storage'
import { ComputerApprovalService } from './ComputerApprovalService.js'
import { ComputerControlBroker } from './ComputerControlBroker.js'
import {
  ComputerKillSwitchService,
  type ComputerGlobalShortcutRegistrar,
} from './ComputerKillSwitchService.js'
import { ComputerPolicyService } from './ComputerPolicyService.js'
import { ComputerSessionManager } from './ComputerSessionManager.js'
import { ComputerObservationEvidenceStore } from './ComputerObservationEvidenceStore.js'
import { ComputerUseTimelineStore } from './ComputerUseTimelineStore.js'
import { ComputerUseMetricsCollector } from './ComputerUseMetricsCollector.js'
import { ComputerUseNativeHostDiagnostics } from './ComputerUseNativeHostDiagnostics.js'
import {
  type ComputerExecutorBackend,
  type ComputerHostBackend,
  type ComputerObserverBackend,
} from './ComputerUseBackend.js'
import { createDefaultComputerUseBackend } from './NativeHostBackendFactory.js'
import type { NativeObservationEvidenceSink } from './NativeHostComputerUseBackend.js'
import { SnapshotVault } from './SnapshotVault.js'
import { SnapshotVaultKeyProvider } from './SnapshotVaultKeyProvider.js'
import {
  NativeApplicationSnapshotCaptureService,
  type NativeSnapshotCaptureBackend,
} from './NativeApplicationSnapshotCaptureService.js'
import { ElectronSnapshotImageProcessor } from './ElectronSnapshotImageProcessor.js'
import { getMainWindow } from '../../windows/index.js'
import { AppControlBridge } from './AppControlBridge.js'
import { AppControlExecutorBackend } from './AppControlExecutorBackend.js'
import { computerUseV2RolloutController } from './ComputerUseV2RolloutController.js'

export type TrustedComputerUseBackend = ComputerObserverBackend &
  ComputerExecutorBackend &
  ComputerHostBackend

export interface ComputerUseServices {
  readonly sessions: ComputerSessionManager
  readonly policy: ComputerPolicyService
  readonly approvals: ComputerApprovalService
  readonly verifications: ComputerVerificationRepository
  readonly broker: ComputerControlBroker
  /** Live in-memory timeline of action lifecycle events per computer session. */
  readonly timeline: ComputerUseTimelineStore
  readonly metrics: ComputerUseMetricsCollector
  readonly diagnostics: ComputerUseNativeHostDiagnostics
  readonly backend: TrustedComputerUseBackend
  readonly killSwitch: ComputerKillSwitchService
  readonly appControlBridge: AppControlBridge
  readonly evidence?: NativeObservationEvidenceSink & {
    readLatestImage(computerSessionId: string, snapshotId: string): Promise<Buffer>
    clearSession(computerSessionId: string): void
    flushPendingWritesOrThrow?(computerSessionId: string): Promise<void>
  }
  readonly snapshots?: Pick<
    NativeApplicationSnapshotCaptureService,
    'getCapabilities' | 'requestPermissions' | 'captureFrontmost'
  >
  armKillSwitch(accelerator: string): boolean
  dispose(): Promise<void>
}

let activeServices: ComputerUseServices | null = null

export function createComputerUseServices(
  database: SparkDatabase,
  options: {
    backend?: TrustedComputerUseBackend
    shortcutRegistrar?: ComputerGlobalShortcutRegistrar
    onKillSwitchError?: (error: unknown) => void
    evidenceSink?: NativeObservationEvidenceSink
    createBackend?: (evidenceSink: NativeObservationEvidenceSink) => TrustedComputerUseBackend
    snapshotCapture?: ComputerUseServices['snapshots']
    appControlBridge?: AppControlBridge
  } = {},
): ComputerUseServices {
  const evidence =
    options.evidenceSink ?? (options.backend == null ? createDefaultEvidenceSink(database) : null)
  const metrics = new ComputerUseMetricsCollector()
  const backend =
    options.backend ??
    (
      options.createBackend ??
      ((evidenceSink) =>
        createDefaultComputerUseBackend({
          evidenceSink,
          packaged: app.isPackaged,
          metrics,
          appVersion: app.getVersion(),
        }))
    )(evidence as NativeObservationEvidenceSink)
  const timeline = new ComputerUseTimelineStore({
    repository: new ComputerActivityEventRepository(database),
  })
  const sessions = new ComputerSessionManager({
    sessions: new ComputerSessionRepository(database),
    leases: new ComputerActuatorLeaseRepository(database),
    timeline,
  })
  const policy = new ComputerPolicyService()
  const approvals = new ComputerApprovalService({
    repository: new ComputerApprovalRepository(database),
  })
  const verifications = new ComputerVerificationRepository(database)
  const appControlBridge =
    options.appControlBridge ??
    new AppControlBridge({
      send: (request) => {
        const window = getMainWindow()
        if (window == null || window.isDestroyed()) return false
        window.webContents.send('stream:computer-use:app-command', request)
        return true
      },
    })
  const executor = new AppControlExecutorBackend(
    backend,
    backend,
    appControlBridge,
    new Set(['com.spark-agent.desktop']),
  )
  const diagnostics = new ComputerUseNativeHostDiagnostics({
    backend,
    metrics,
    appVersion: () => app.getVersion(),
    isPackaged: () => app.isPackaged,
  })
  const usableEvidence =
    evidence != null &&
    'readLatestImage' in evidence &&
    typeof evidence.readLatestImage === 'function' &&
    'clearSession' in evidence &&
    typeof evidence.clearSession === 'function'
      ? (evidence as NonNullable<ComputerUseServices['evidence']>)
      : null
  const broker = new ComputerControlBroker({
    sessions,
    policy,
    approvals,
    actions: new ComputerActionRepository(database),
    observer: backend,
    executor,
    timeline,
    rollout: computerUseV2RolloutController,
    ...(usableEvidence?.flushPendingWritesOrThrow == null
      ? {}
      : {
          flushHighRiskEvidence: usableEvidence.flushPendingWritesOrThrow.bind(usableEvidence),
        }),
  })
  const killSwitch = new ComputerKillSwitchService(
    options.shortcutRegistrar ?? FAIL_CLOSED_SHORTCUT_REGISTRAR,
    options.onKillSwitchError,
  )
  const snapshotCapture = options.snapshotCapture ?? createDefaultSnapshotCapture(database, backend)
  return {
    sessions,
    policy,
    approvals,
    verifications,
    broker,
    timeline,
    metrics,
    diagnostics,
    backend,
    killSwitch,
    appControlBridge,
    ...(usableEvidence == null ? {} : { evidence: usableEvidence }),
    ...(snapshotCapture == null ? {} : { snapshots: snapshotCapture }),
    armKillSwitch: (accelerator) =>
      killSwitch.arm(accelerator, async () => {
        const results = await Promise.allSettled(
          sessions
            .listActiveSessionIds()
            .map(async (computerSessionId) => broker.killSwitch(computerSessionId)),
        )
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason)
        if (failures.length > 0) {
          throw new AggregateError(failures, 'One or more Computer Use sessions failed to stop')
        }
      }),
    dispose: async () => {
      killSwitch.dispose()
      await Promise.allSettled(
        sessions
          .listActiveSessionIds()
          .map(async (computerSessionId) => broker.killSwitch(computerSessionId)),
      )
      timeline.clear()
      metrics.clear()
      if (isDisposableBackend(backend)) await backend.dispose()
    },
  }
}

function createDefaultSnapshotCapture(
  database: SparkDatabase,
  backend: TrustedComputerUseBackend,
): NativeApplicationSnapshotCaptureService | null {
  if (!isNativeSnapshotCaptureBackend(backend)) return null
  return new NativeApplicationSnapshotCaptureService({
    backend,
    repository: new ApplicationSnapshotRepository(database),
    vault: new SnapshotVault({
      rootDirectory: join(app.getPath('userData'), 'snapshot-vault', 'blobs'),
      keyProvider: new SnapshotVaultKeyProvider(),
    }),
    imageProcessor: new ElectronSnapshotImageProcessor((bytes) =>
      nativeImage.createFromBuffer(bytes),
    ),
  })
}

function isNativeSnapshotCaptureBackend(
  backend: TrustedComputerUseBackend,
): backend is TrustedComputerUseBackend & NativeSnapshotCaptureBackend {
  return (
    'requestPermissions' in backend &&
    typeof backend.requestPermissions === 'function' &&
    'captureWindow' in backend &&
    typeof backend.captureWindow === 'function'
  )
}

function createDefaultEvidenceSink(database: SparkDatabase): NativeObservationEvidenceSink {
  const imageProcessor = new ElectronSnapshotImageProcessor(
    (bytes) => nativeImage.createFromBuffer(bytes),
    (bitmap, size) => nativeImage.createFromBitmap(bitmap, size),
  )
  return new ComputerObservationEvidenceStore({
    repository: new ApplicationSnapshotRepository(database),
    vault: new SnapshotVault({
      rootDirectory: join(app.getPath('userData'), 'snapshot-vault', 'blobs'),
      keyProvider: new SnapshotVaultKeyProvider(),
    }),
    imageProcessor: imageProcessor.createRedactedEvidence.bind(imageProcessor),
  })
}

export function initializeComputerUseServices(
  database: SparkDatabase,
  options?: Parameters<typeof createComputerUseServices>[1],
): ComputerUseServices {
  if (activeServices == null) activeServices = createComputerUseServices(database, options)
  return activeServices
}

export function getComputerUseServices(): ComputerUseServices {
  if (activeServices == null) throw new Error('Computer Use services have not been initialized')
  return activeServices
}

export async function disposeComputerUseServices(): Promise<void> {
  await activeServices?.dispose()
  activeServices = null
}

const FAIL_CLOSED_SHORTCUT_REGISTRAR: ComputerGlobalShortcutRegistrar = {
  register: () => false,
  unregister: () => undefined,
}

function isDisposableBackend(
  backend: TrustedComputerUseBackend,
): backend is TrustedComputerUseBackend & { dispose(): Promise<void> } {
  return 'dispose' in backend && typeof backend.dispose === 'function'
}
