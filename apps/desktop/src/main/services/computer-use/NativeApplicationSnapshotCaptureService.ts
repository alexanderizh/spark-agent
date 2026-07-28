import { createHash, randomUUID } from 'node:crypto'
import {
  ApplicationSnapshotRefSchema,
  type ApplicationSnapshotCapabilities,
  type ApplicationSnapshotCaptureRequest,
  type ApplicationSnapshotRef,
  type ComputerUseCapabilitySummary,
  type NativeHostCapabilityManifest,
  type NativeWindowDescriptor,
} from '@spark/protocol'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { NativeHostWindowCapture } from './NativeHostComputerUseBackend.js'
import {
  getSnapshotPreviewCapabilityService,
  type SnapshotPreviewCapabilityService,
} from './SnapshotPreviewCapability.js'
import type { SnapshotVaultBlobRecord, SnapshotVaultWriteInput } from './SnapshotVault.js'

const MAX_SNAPSHOT_IMAGE_BYTES = 67_108_864
const MAX_SNAPSHOT_PIXELS = 50_000_000
const SENSITIVE_APP_IDENTITIES = new Set([
  'com.apple.securityagent',
  'com.apple.loginwindow',
  'com.apple.passwords',
  'com.apple.keychainaccess',
  'securityagent',
  'logonui.exe',
  'credentialuibroker.exe',
  'consent.exe',
  'lockapp.exe',
  '1password',
  '1password.exe',
  'bitwarden',
  'bitwarden.exe',
  'keepass',
  'keepass.exe',
  'keepassxc',
  'keepassxc.exe',
])

export interface NativeSnapshotCaptureBackend {
  getCapabilities(): Promise<ComputerUseCapabilitySummary>
  requestPermissions(
    permissions: Array<'screen' | 'accessibility'>,
  ): Promise<NativeHostCapabilityManifest>
  listWindows(): Promise<NativeWindowDescriptor[]>
  captureWindow(input: { snapshotId: string; windowId: string }): Promise<NativeHostWindowCapture>
}

export interface SnapshotCaptureRepository {
  createWithBlobs(input: {
    snapshot: {
      id: string
      sessionId: string | null
      turnId: string | null
      computerSessionId: null
      kind: 'user_context'
      appId: string
      appName: string
      windowId: string
      windowTitle: string
      bounds: Record<string, unknown>
      display: Record<string, unknown>
      imageBlobId: string
      textBlobId: null
      previewBlobId: string
      imageSha256: string
      perceptualHash: null
      treeVersion: null
      accessibleTextMode: 'visible_only'
      redaction: { applied: false; reasonCodes: []; regionCount: 0 }
      retention: { mode: 'session' | 'manual'; expiresAt: null }
      createdAt: string
    }
    blobs: Array<{
      id: string
      kind: 'image' | 'preview'
      storageKey: string
      byteLength: number
      plaintextSha256: string
      cipherSha256: string
      createdAt: string
    }>
  }): unknown
}

export interface SnapshotCaptureVault {
  writeManyRegistered<T>(
    inputs: readonly SnapshotVaultWriteInput[],
    register: (records: SnapshotVaultBlobRecord[]) => Promise<T> | T,
  ): Promise<T>
}

export interface SnapshotImageProcessor {
  inspectAndCreatePreview(image: Buffer): {
    width: number
    height: number
    preview: Buffer
  }
}

export class NativeApplicationSnapshotCaptureService {
  private readonly backend: NativeSnapshotCaptureBackend
  private readonly repository: SnapshotCaptureRepository
  private readonly vault: SnapshotCaptureVault
  private readonly imageProcessor: SnapshotImageProcessor
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly previewCapabilities: Pick<SnapshotPreviewCapabilityService, 'issue'>

  constructor(options: {
    backend: NativeSnapshotCaptureBackend
    repository: SnapshotCaptureRepository
    vault: SnapshotCaptureVault
    imageProcessor: SnapshotImageProcessor
    createId?: () => string
    now?: () => Date
    previewCapabilities?: Pick<SnapshotPreviewCapabilityService, 'issue'>
  }) {
    this.backend = options.backend
    this.repository = options.repository
    this.vault = options.vault
    this.imageProcessor = options.imageProcessor
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.previewCapabilities = options.previewCapabilities ?? getSnapshotPreviewCapabilityService()
  }

  async getCapabilities(): Promise<ApplicationSnapshotCapabilities> {
    const computer = await this.backend.getCapabilities()
    const manifest = computer.nativeHost
    const available =
      computer.available &&
      manifest != null &&
      manifest.features.listWindows &&
      manifest.features.captureWindow
    return {
      available,
      platform: computer.platform,
      permissions: {
        screen: computer.permissions.screen,
        accessibility: computer.permissions.accessibility,
      },
      supportsAppExposedText: manifestSupportsAppText(manifest),
      ...(available
        ? {}
        : { unavailableReason: computer.unavailableReason ?? 'snapshot_capture_unavailable' }),
    }
  }

  async requestPermissions(
    permissions: Array<'screen' | 'accessibility'>,
  ): Promise<ApplicationSnapshotCapabilities> {
    const manifest = await this.backend.requestPermissions(permissions)
    const available = manifest.features.listWindows && manifest.features.captureWindow
    return {
      available,
      platform: manifest.platform,
      permissions: {
        screen: manifest.permissions.screen,
        accessibility: manifest.permissions.accessibility,
      },
      supportsAppExposedText: manifestSupportsAppText(manifest),
      ...(available ? {} : { unavailableReason: 'snapshot_capture_unavailable' }),
    }
  }

  async captureFrontmost(
    request: ApplicationSnapshotCaptureRequest,
  ): Promise<ApplicationSnapshotRef> {
    const capabilities = await this.getCapabilities()
    if (!capabilities.available) {
      throw new ComputerUseBrokerError(
        'environment_unavailable',
        'Application snapshot capture is unavailable',
      )
    }
    if (capabilities.permissions.screen !== 'granted') {
      throw new ComputerUseBrokerError(
        'screen_permission_denied',
        'Screen Recording permission is required for application snapshots',
      )
    }
    if (request.accessibleTextMode === 'app_exposed' && !capabilities.supportsAppExposedText) {
      throw new ComputerUseBrokerError(
        'environment_unavailable',
        'The trusted Native Host does not provide app-exposed accessibility text',
      )
    }

    const focusedWindows = (await this.backend.listWindows()).filter(
      (window) => window.focused && !window.minimized,
    )
    if (focusedWindows.length === 0) {
      throw new ComputerUseBrokerError('focus_mismatch', 'No focused capturable window was found')
    }
    if (focusedWindows.length !== 1) {
      throw new ComputerUseBrokerError(
        'native_host_incompatible',
        'Native Host returned more than one focused window',
      )
    }
    const target = focusedWindows[0]
    if (target == null)
      throw new ComputerUseBrokerError('focus_mismatch', 'Focused window disappeared')
    assertSnapshotTargetAllowed(target)

    const snapshotId = this.createId()
    const imageBlobId = this.createId()
    const previewBlobId = this.createId()
    const capture = await this.backend.captureWindow({
      snapshotId,
      windowId: target.window.id,
    })
    this.assertCapture(capture, snapshotId)
    assertFocusStable(target, await this.backend.listWindows())
    const processed = this.imageProcessor.inspectAndCreatePreview(capture.bytes)
    if (
      processed.width !== capture.width ||
      processed.height !== capture.height ||
      processed.preview.length < 1 ||
      processed.preview.length > MAX_SNAPSHOT_IMAGE_BYTES
    ) {
      throw new ComputerUseBrokerError(
        'native_host_incompatible',
        'Captured application image metadata is inconsistent',
      )
    }

    const createdAt = this.now().toISOString()
    const imageSha256 = sha256(capture.bytes)
    await this.vault.writeManyRegistered(
      [
        { blobId: imageBlobId, kind: 'image', plaintext: capture.bytes },
        { blobId: previewBlobId, kind: 'preview', plaintext: processed.preview },
      ],
      (records) => {
        const recordById = new Map(records.map((record) => [record.blobId, record]))
        const image = requireBlob(recordById, imageBlobId, 'image')
        const preview = requireBlob(recordById, previewBlobId, 'preview')
        return this.repository.createWithBlobs({
          snapshot: {
            id: snapshotId,
            sessionId: request.sessionId,
            turnId: request.turnId,
            computerSessionId: null,
            kind: 'user_context',
            appId: target.app.id,
            appName: target.app.name,
            windowId: target.window.id,
            windowTitle: target.window.title,
            bounds: target.window.bounds,
            display: target.display,
            imageBlobId,
            textBlobId: null,
            previewBlobId,
            imageSha256,
            perceptualHash: null,
            treeVersion: null,
            accessibleTextMode: 'visible_only',
            redaction: { applied: false, reasonCodes: [], regionCount: 0 },
            retention: { mode: request.sessionId == null ? 'manual' : 'session', expiresAt: null },
            createdAt,
          },
          blobs: [toCreateBlob(image, createdAt), toCreateBlob(preview, createdAt)],
        })
      },
    )

    const preview = this.previewCapabilities.issue({
      snapshotId,
      sessionId: request.sessionId,
      turnId: request.turnId,
    })
    return ApplicationSnapshotRefSchema.parse({
      id: snapshotId,
      kind: 'user_context',
      sessionId: request.sessionId,
      turnId: request.turnId,
      computerSessionId: null,
      app: target.app,
      window: target.window,
      display: target.display,
      capturedAt: createdAt,
      previewUrl: preview.previewUrl,
      accessibleTextMode: 'visible_only',
      redaction: { applied: false, reasonCodes: [], regionCount: 0 },
      imageSha256,
    })
  }

  private assertCapture(capture: NativeHostWindowCapture, snapshotId: string): void {
    if (
      capture.snapshotId !== snapshotId ||
      capture.payload.kind !== 'image_png' ||
      !Number.isSafeInteger(capture.width) ||
      !Number.isSafeInteger(capture.height) ||
      capture.width < 1 ||
      capture.height < 1 ||
      capture.width * capture.height > MAX_SNAPSHOT_PIXELS ||
      capture.bytes.length < 1 ||
      capture.bytes.length > MAX_SNAPSHOT_IMAGE_BYTES ||
      capture.bytes.length !== capture.payload.byteLength ||
      sha256(capture.bytes) !== capture.payload.sha256
    ) {
      throw new ComputerUseBrokerError(
        'native_host_incompatible',
        'Native Host capture failed its identity or digest check',
      )
    }
  }
}

function assertSnapshotTargetAllowed(target: NativeWindowDescriptor): void {
  const identities = [
    target.app.id,
    target.app.bundleId,
    target.app.executableIdentity,
    target.app.signingIdentity,
  ]
    .filter((value): value is string => typeof value === 'string')
    .flatMap((value) => {
      const normalized = value.trim().toLowerCase().replaceAll('\\', '/')
      const basename = normalized.split('/').pop()
      return basename == null ? [normalized] : [normalized, basename]
    })
  const exactName = target.app.name.trim().toLowerCase()
  if (
    identities.some((identity) => SENSITIVE_APP_IDENTITIES.has(identity)) ||
    SENSITIVE_APP_IDENTITIES.has(exactName)
  ) {
    throw new ComputerUseBrokerError(
      'sensitive_input_blocked',
      'Application snapshots are disabled for credential and system-authentication apps',
    )
  }
}

function assertFocusStable(
  target: NativeWindowDescriptor,
  windows: NativeWindowDescriptor[],
): void {
  const focused = windows.filter((window) => window.focused && !window.minimized)
  const current = focused.length === 1 ? focused[0] : null
  if (current == null || !sameCaptureIdentity(target, current)) {
    throw new ComputerUseBrokerError(
      'focus_mismatch',
      'The focused application or process changed while the snapshot was captured',
    )
  }
}

function sameCaptureIdentity(
  before: NativeWindowDescriptor,
  after: NativeWindowDescriptor,
): boolean {
  return (
    before.window.id === after.window.id &&
    before.app.id === after.app.id &&
    before.app.processId === after.app.processId &&
    before.app.bundleId === after.app.bundleId &&
    before.app.executableIdentity === after.app.executableIdentity &&
    before.app.signingIdentity === after.app.signingIdentity
  )
}

function manifestSupportsAppText(manifest: NativeHostCapabilityManifest | null): boolean {
  return (
    manifest != null &&
    manifest.backends.accessibility !== 'unavailable' &&
    manifest.features.fullTree
  )
}

function requireBlob(
  records: Map<string, SnapshotVaultBlobRecord>,
  id: string,
  kind: 'image' | 'preview',
): SnapshotVaultBlobRecord {
  const record = records.get(id)
  if (record == null || record.kind !== kind)
    throw new Error('Snapshot Vault registration is incomplete')
  return record
}

function toCreateBlob(record: SnapshotVaultBlobRecord, createdAt: string) {
  return {
    id: record.blobId,
    kind: record.kind as 'image' | 'preview',
    storageKey: record.storageKey,
    byteLength: record.byteLength,
    plaintextSha256: record.plaintextSha256,
    cipherSha256: record.cipherSha256,
    createdAt,
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
