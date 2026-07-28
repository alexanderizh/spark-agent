import { createHash, randomUUID } from 'node:crypto'
import type { ComputerObservation, NativeBinaryPayloadDescriptor } from '@spark/protocol'
import type { ApplicationSnapshotRepository } from '@spark/storage'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { NativeObservationEvidenceSink } from './NativeHostComputerUseBackend.js'
import type { SnapshotVault, SnapshotVaultBlobRecord } from './SnapshotVault.js'

const MAX_EVIDENCE_IMAGE_BYTES = 67_108_864
const MAX_EVIDENCE_PIXELS = 50_000_000
const MAX_CACHED_COMPUTER_SESSIONS = 64
const MAX_CACHED_EVIDENCE_BYTES = 256 * 1024 * 1024
const EXECUTION_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1_000

type EvidenceRepository = Pick<ApplicationSnapshotRepository, 'createWithBlobs'>
type EvidenceVault = Pick<SnapshotVault, 'writeManyRegistered'>

export class ComputerObservationEvidenceStore implements NativeObservationEvidenceSink {
  private readonly repository: EvidenceRepository
  private readonly vault: EvidenceVault
  private readonly createId: () => string
  private readonly imageProcessor: (
    bytes: Buffer,
    observation: ComputerObservation,
  ) => { bytes: Buffer; perceptualHash: string }
  private readonly now: () => Date
  private readonly maxCachedBytes: number
  private readonly latestImages = new Map<string, { snapshotId: string; bytes: Buffer }>()
  private cachedBytes = 0

  constructor(options: {
    repository: EvidenceRepository
    vault: EvidenceVault
    imageProcessor: (
      bytes: Buffer,
      observation: ComputerObservation,
    ) => { bytes: Buffer; perceptualHash: string }
    createId?: () => string
    now?: () => Date
    maxCachedBytes?: number
  }) {
    this.repository = options.repository
    this.vault = options.vault
    this.imageProcessor = options.imageProcessor
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.maxCachedBytes = options.maxCachedBytes ?? MAX_CACHED_EVIDENCE_BYTES
  }

  async persist(input: {
    computerSessionId: string
    kind: 'execution_before' | 'execution_after'
    observation: ComputerObservation
    payload: NativeBinaryPayloadDescriptor
    bytes: Buffer
  }): Promise<{ visualFingerprint: string }> {
    assertEvidenceImage(input.observation, input.payload, input.bytes)
    this.cacheLatest(input.computerSessionId, input.observation.screenshot.snapshotId, input.bytes)
    const processed = this.imageProcessor(input.bytes, input.observation)
    if (processed.bytes.length < 1 || !/^[a-f0-9]{16,128}$/iu.test(processed.perceptualHash)) {
      throw incompatibleEvidence()
    }
    const imageBlobId = this.createId()
    const imageSha256 = sha256(processed.bytes)
    const expiresAt = new Date(this.now().getTime() + EXECUTION_EVIDENCE_TTL_MS).toISOString()

    await this.vault.writeManyRegistered(
      [{ blobId: imageBlobId, kind: 'image', plaintext: processed.bytes }],
      (records) => {
        const recordById = new Map(records.map((record) => [record.blobId, record]))
        const image = requireBlob(recordById, imageBlobId, 'image')
        if (image.plaintextSha256 !== imageSha256) {
          throw incompatibleEvidence()
        }
        this.repository.createWithBlobs({
          snapshot: {
            id: input.observation.screenshot.snapshotId,
            sessionId: null,
            turnId: null,
            computerSessionId: input.computerSessionId,
            kind: input.kind,
            appId: input.observation.foreground.app.id,
            appName: input.observation.foreground.app.name,
            windowId: input.observation.foreground.window.id,
            windowTitle: input.observation.foreground.window.title,
            bounds: input.observation.foreground.window.bounds,
            display: input.observation.display,
            imageBlobId,
            textBlobId: null,
            previewBlobId: null,
            imageSha256,
            perceptualHash: processed.perceptualHash,
            treeVersion: input.observation.treeVersion,
            accessibleTextMode: 'app_exposed',
            redaction: {
              applied: input.observation.sensitiveRegions.length > 0,
              reasonCodes:
                input.observation.sensitiveRegions.length > 0 ? ['sensitive_region'] : [],
              regionCount: input.observation.sensitiveRegions.length,
            },
            retention: { mode: 'ttl', expiresAt },
            createdAt: input.observation.capturedAt,
          },
          blobs: [toCreateBlob(image, input.observation.capturedAt)],
        })
      },
    )
    return { visualFingerprint: processed.perceptualHash }
  }

  private cacheLatest(computerSessionId: string, snapshotId: string, bytes: Buffer): void {
    const existing = this.latestImages.get(computerSessionId)
    if (existing != null) this.cachedBytes -= existing.bytes.length
    this.latestImages.delete(computerSessionId)
    const copy = Buffer.from(bytes)
    this.latestImages.set(computerSessionId, { snapshotId, bytes: copy })
    this.cachedBytes += copy.length
    while (
      this.latestImages.size > MAX_CACHED_COMPUTER_SESSIONS ||
      this.cachedBytes > this.maxCachedBytes
    ) {
      const oldest = this.latestImages.keys().next().value
      if (oldest == null) break
      this.cachedBytes -= this.latestImages.get(oldest)?.bytes.length ?? 0
      this.latestImages.delete(oldest)
    }
  }

  async readLatestImage(computerSessionId: string, snapshotId: string): Promise<Buffer> {
    const image = this.latestImages.get(computerSessionId)
    if (image == null || image.snapshotId !== snapshotId) {
      throw new ComputerUseBrokerError(
        'stale_frame',
        'Computer observation image is no longer the latest persisted frame',
      )
    }
    return Buffer.from(image.bytes)
  }

  clearSession(computerSessionId: string): void {
    this.cachedBytes -= this.latestImages.get(computerSessionId)?.bytes.length ?? 0
    this.latestImages.delete(computerSessionId)
  }
}

function assertEvidenceImage(
  observation: ComputerObservation,
  payload: NativeBinaryPayloadDescriptor,
  bytes: Buffer,
): void {
  if (
    payload.kind !== 'image_png' ||
    bytes.length < 1 ||
    bytes.length > MAX_EVIDENCE_IMAGE_BYTES ||
    bytes.length !== payload.byteLength ||
    sha256(bytes) !== payload.sha256 ||
    observation.screenshot.width * observation.screenshot.height > MAX_EVIDENCE_PIXELS
  ) {
    throw incompatibleEvidence()
  }
}

function requireBlob(
  records: Map<string, SnapshotVaultBlobRecord>,
  id: string,
  kind: 'image' | 'text',
): SnapshotVaultBlobRecord {
  const record = records.get(id)
  if (record == null || record.kind !== kind) throw incompatibleEvidence()
  return record
}

function toCreateBlob(record: SnapshotVaultBlobRecord, createdAt: string) {
  return {
    id: record.blobId,
    kind: record.kind,
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

function incompatibleEvidence(): ComputerUseBrokerError {
  return new ComputerUseBrokerError(
    'native_host_incompatible',
    'Native Host observation evidence failed integrity validation',
  )
}
