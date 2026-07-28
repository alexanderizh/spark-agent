import { app, nativeImage, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import {
  ApplicationSnapshotRefSchema,
  type ApplicationSnapshotCapabilities,
  type ApplicationSnapshotCaptureRequest,
  type ApplicationSnapshotRef,
} from '@spark/protocol'
import {
  ApplicationSnapshotRepository,
  type ApplicationSnapshotRow,
  type SnapshotBlobRow,
} from '@spark/storage'
import { SparkError } from '@spark/shared'
import { getDatabase } from '../db.js'
import { ComputerUseBrokerError } from '../services/computer-use/ComputerUseBrokerError.js'
import { ElectronSnapshotImageProcessor } from '../services/computer-use/ElectronSnapshotImageProcessor.js'
import {
  NativeApplicationSnapshotCaptureService,
  type NativeSnapshotCaptureBackend,
  type SnapshotCaptureRepository,
  type SnapshotCaptureVault,
} from '../services/computer-use/NativeApplicationSnapshotCaptureService.js'
import {
  getComputerUseServices,
  type ComputerUseServices,
} from '../services/computer-use/ComputerUseServices.js'
import {
  getSnapshotPreviewCapabilityService,
  type SnapshotPreviewCapabilityService,
} from '../services/computer-use/SnapshotPreviewCapability.js'
import { SnapshotVault } from '../services/computer-use/SnapshotVault.js'
import { SnapshotVaultKeyProvider } from '../services/computer-use/SnapshotVaultKeyProvider.js'
import { typedIpcHandle } from './typed-ipc.js'
import { safeComputerUseIpc } from './computerUseIpcError.js'
import { getMainWindow } from '../windows/index.js'

interface ApplicationSnapshotStore {
  get(id: string): ApplicationSnapshotRow | null
  listBySession(sessionId: string, limit?: number): ApplicationSnapshotRow[]
  delete(id: string): SnapshotBlobRow[]
  updateRetention(
    id: string,
    retention: { mode: 'session' | 'computer_run' | 'ttl' | 'manual'; expiresAt: string | null },
  ): ApplicationSnapshotRow | null
  deleteBlobRecordIfUnreferenced(id: string): SnapshotBlobRow | null
  createWithBlobs?: SnapshotCaptureRepository['createWithBlobs']
}

interface SnapshotBlobDeleter {
  deleteBlob(storageKey: string): Promise<boolean>
  writeManyRegistered?: SnapshotCaptureVault['writeManyRegistered']
}

export interface ApplicationSnapshotCaptureService {
  getCapabilities(): Promise<ApplicationSnapshotCapabilities>
  requestPermissions(
    permissions: Array<'screen' | 'accessibility'>,
  ): Promise<ApplicationSnapshotCapabilities>
  captureFrontmost(request: ApplicationSnapshotCaptureRequest): Promise<ApplicationSnapshotRef>
}

export interface RegisterApplicationSnapshotIpcOptions {
  repository?: ApplicationSnapshotStore
  vault?: SnapshotBlobDeleter
  capture?: ApplicationSnapshotCaptureService
  createCapture?: (input: {
    backend: ComputerUseServices['backend']
    repository: ApplicationSnapshotStore
    vault: SnapshotBlobDeleter
  }) => ApplicationSnapshotCaptureService
  getServices?: () => ComputerUseServices
  previewCapabilities?: Pick<SnapshotPreviewCapabilityService, 'issue' | 'revokeSnapshot'>
  authorizeRenderer?: (event: IpcMainInvokeEvent) => boolean
}

/** Registers the main-process application snapshot IPC surface. */
export function registerApplicationSnapshotIpc(
  options: RegisterApplicationSnapshotIpcOptions = {},
): void {
  const repository = options.repository ?? new ApplicationSnapshotRepository(getDatabase())
  const vault =
    options.vault ??
    new SnapshotVault({
      rootDirectory: join(app.getPath('userData'), 'snapshot-vault', 'blobs'),
      keyProvider: new SnapshotVaultKeyProvider(),
    })
  const services = options.getServices ?? getComputerUseServices
  const previewCapabilities = options.previewCapabilities ?? getSnapshotPreviewCapabilityService()
  const authorizeRenderer = options.authorizeRenderer ?? isTrustedSnapshotRenderer
  const assertRenderer = (event: IpcMainInvokeEvent): void => {
    if (!authorizeRenderer(event)) {
      throw new ComputerUseBrokerError(
        'action_not_allowed',
        'Application snapshots are available only to the trusted top-level app renderer',
      )
    }
  }
  const capture = resolveCaptureService(options, repository, vault, services, previewCapabilities)

  typedIpcHandle('app-snapshot:get-capabilities', async (_request, event) =>
    safeComputerUseIpc(async () => {
      assertRenderer(event)
      if (capture != null) return capture.getCapabilities()
      const computer = await services().backend.getCapabilities()
      return {
        available: false,
        platform: computer.platform,
        permissions: {
          screen: computer.permissions.screen,
          accessibility: computer.permissions.accessibility,
        },
        supportsAppExposedText: false,
        unavailableReason: computer.unavailableReason ?? 'snapshot_capture_service_missing',
      }
    }),
  )

  typedIpcHandle('app-snapshot:request-permissions', async ({ permissions }, event) =>
    safeComputerUseIpc(async () => {
      assertRenderer(event)
      return requireCaptureService(capture).requestPermissions(permissions)
    }),
  )

  typedIpcHandle('app-snapshot:capture-frontmost', async (request, event) =>
    safeComputerUseIpc(async () => {
      assertRenderer(event)
      const snapshot = ApplicationSnapshotRefSchema.parse(
        await requireCaptureService(capture).captureFrontmost(request),
      )
      return { snapshot }
    }),
  )

  typedIpcHandle('app-snapshot:get', async ({ id }, event) =>
    safeComputerUseIpc(() => {
      assertRenderer(event)
      return { snapshot: toSnapshotRef(repository.get(id), previewCapabilities) }
    }),
  )

  typedIpcHandle('app-snapshot:list-for-session', async ({ sessionId }, event) =>
    safeComputerUseIpc(() => {
      assertRenderer(event)
      return {
        snapshots: repository
          .listBySession(sessionId)
          .filter((row) => row.deleted_at == null)
          .map((row) => requireSnapshotRef(row, previewCapabilities)),
      }
    }),
  )

  typedIpcHandle('app-snapshot:delete', async ({ id }, event) =>
    safeComputerUseIpc(async () => {
      assertRenderer(event)
      const existing = repository.get(id)
      if (existing == null || existing.deleted_at != null) return { deleted: false }
      const unreferenced = repository.delete(id)
      previewCapabilities.revokeSnapshot(id)
      for (const blob of unreferenced) {
        const claimed = repository.deleteBlobRecordIfUnreferenced(blob.id)
        if (claimed != null) await vault.deleteBlob(claimed.storage_key)
      }
      return { deleted: true }
    }),
  )

  typedIpcHandle('app-snapshot:update-retention', async ({ id, retention }, event) =>
    safeComputerUseIpc(() => {
      assertRenderer(event)
      const row = repository.updateRetention(id, retention)
      if (row == null) throw new SparkError('NOT_FOUND', '应用快照不存在或已被删除。')
      return { snapshot: requireSnapshotRef(row, previewCapabilities) }
    }),
  )
}

function isTrustedSnapshotRenderer(event: IpcMainInvokeEvent): boolean {
  const mainWindow = getMainWindow()
  return (
    mainWindow != null &&
    !mainWindow.isDestroyed() &&
    !event.sender.isDestroyed() &&
    event.sender.id === mainWindow.webContents.id &&
    event.senderFrame != null &&
    event.senderFrame === event.sender.mainFrame
  )
}

function resolveCaptureService(
  options: RegisterApplicationSnapshotIpcOptions,
  repository: ApplicationSnapshotStore,
  vault: SnapshotBlobDeleter,
  getServices: () => ComputerUseServices,
  previewCapabilities: Pick<SnapshotPreviewCapabilityService, 'issue'>,
): ApplicationSnapshotCaptureService | undefined {
  if (options.capture != null) return options.capture
  const runtime = getServices()
  const backend = runtime.backend
  if (options.createCapture != null) {
    return options.createCapture({ backend, repository, vault })
  }
  if (runtime.snapshots != null) return runtime.snapshots
  if (
    !isNativeSnapshotCaptureBackend(backend) ||
    typeof repository.createWithBlobs !== 'function' ||
    typeof vault.writeManyRegistered !== 'function'
  ) {
    return undefined
  }
  return new NativeApplicationSnapshotCaptureService({
    backend,
    repository: repository as SnapshotCaptureRepository,
    vault: vault as SnapshotCaptureVault,
    imageProcessor: new ElectronSnapshotImageProcessor((bytes) =>
      nativeImage.createFromBuffer(bytes),
    ),
    previewCapabilities,
  })
}

function isNativeSnapshotCaptureBackend(
  backend: ComputerUseServices['backend'],
): backend is ComputerUseServices['backend'] & NativeSnapshotCaptureBackend {
  return (
    'requestPermissions' in backend &&
    typeof backend.requestPermissions === 'function' &&
    'captureWindow' in backend &&
    typeof backend.captureWindow === 'function'
  )
}

function requireCaptureService(
  capture: ApplicationSnapshotCaptureService | undefined,
): ApplicationSnapshotCaptureService {
  if (capture == null) {
    throw new ComputerUseBrokerError(
      'native_host_missing',
      'A trusted application snapshot capture service is not installed',
    )
  }
  return capture
}

function toSnapshotRef(
  row: ApplicationSnapshotRow | null,
  previewCapabilities: Pick<SnapshotPreviewCapabilityService, 'issue'>,
): ApplicationSnapshotRef | null {
  if (row == null || row.deleted_at != null) return null
  return requireSnapshotRef(row, previewCapabilities)
}

function requireSnapshotRef(
  row: ApplicationSnapshotRow,
  previewCapabilities: Pick<SnapshotPreviewCapabilityService, 'issue'>,
): ApplicationSnapshotRef {
  try {
    const preview = previewCapabilities.issue({
      snapshotId: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
    })
    return ApplicationSnapshotRefSchema.parse({
      id: row.id,
      kind: row.kind,
      sessionId: row.session_id,
      turnId: row.turn_id,
      computerSessionId: row.computer_session_id,
      app: { id: row.app_id, name: row.app_name },
      window: {
        id: row.window_id,
        title: row.window_title,
        bounds: JSON.parse(row.bounds_json) as unknown,
      },
      display: JSON.parse(row.display_json) as unknown,
      capturedAt: row.created_at,
      previewUrl: preview.previewUrl,
      accessibleTextMode: row.accessible_text_mode,
      redaction: JSON.parse(row.redaction_json) as unknown,
      imageSha256: row.image_sha256,
    })
  } catch {
    throw new ComputerUseBrokerError(
      'native_host_incompatible',
      'Stored application snapshot metadata is invalid',
    )
  }
}
