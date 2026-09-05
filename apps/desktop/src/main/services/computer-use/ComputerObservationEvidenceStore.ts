import { createHash, randomUUID } from 'node:crypto'
import type { ComputerObservation, NativeBinaryPayloadDescriptor } from '@spark/protocol'
import type { ApplicationSnapshotRepository } from '@spark/storage'
import type { ComputerSessionRepository } from '@spark/storage'
import { createLogger } from '@spark/shared'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { NativeObservationEvidenceSink } from './NativeHostComputerUseBackend.js'
import type { SnapshotVault, SnapshotVaultBlobRecord } from './SnapshotVault.js'

const log = createLogger('computer-use-evidence')

const MAX_EVIDENCE_IMAGE_BYTES = 67_108_864
const MAX_EVIDENCE_PIXELS = 50_000_000
const MAX_CACHED_COMPUTER_SESSIONS = 64
const MAX_CACHED_EVIDENCE_BYTES = 256 * 1024 * 1024
const EXECUTION_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1_000

type EvidenceRepository = Pick<ApplicationSnapshotRepository, 'createWithBlobs'>
type EvidenceSessionRepository = Pick<ComputerSessionRepository, 'get'>
type EvidenceVault = Pick<SnapshotVault, 'writeManyRegistered'>

export class ComputerObservationEvidenceStore implements NativeObservationEvidenceSink {
  private readonly repository: EvidenceRepository
  private readonly sessions: EvidenceSessionRepository | undefined
  private readonly vault: EvidenceVault
  private readonly createId: () => string
  private readonly imageProcessor: (
    bytes: Buffer,
    observation: ComputerObservation,
  ) => { bytes: Buffer; perceptualHash: string }
  /**
   * Produces the frame the DECISION model sees: redacted, long-edge capped,
   * JPEG-encoded for fast upload. Returns the geometry/mime of the produced
   * image so consumers can map model coordinates back to the window.
   */
  private readonly decisionImageProcessor: (
    bytes: Buffer,
    observation: ComputerObservation,
  ) => { bytes: Buffer; width: number; height: number; mimeType: 'image/png' | 'image/jpeg' }
  private readonly now: () => Date
  private readonly maxCachedBytes: number
  private readonly latestImages = new Map<
    string,
    {
      snapshotId: string
      bytes: Buffer
      width: number
      height: number
      mimeType: 'image/png' | 'image/jpeg'
    }
  >()
  private cachedBytes = 0
  /**
   * Per-session serialized durable-write chains. The expensive encrypted-vault + SQLite
   * write happens here, ordered within a session so audit replay stays chronological.
   * Failures are swallowed and logged so a storage fault can never fail the live action.
   */
  private readonly pendingWrites = new Map<string, Promise<void>>()
  private readonly durableWriteFailures = new Map<string, unknown>()

  constructor(options: {
    repository: EvidenceRepository
    sessions?: EvidenceSessionRepository
    vault: EvidenceVault
    imageProcessor: (
      bytes: Buffer,
      observation: ComputerObservation,
    ) => { bytes: Buffer; perceptualHash: string }
    decisionImageProcessor?: (
      bytes: Buffer,
      observation: ComputerObservation,
    ) => { bytes: Buffer; width: number; height: number; mimeType: 'image/png' | 'image/jpeg' }
    createId?: () => string
    now?: () => Date
    maxCachedBytes?: number
  }) {
    this.repository = options.repository
    this.sessions = options.sessions
    this.vault = options.vault
    this.imageProcessor = options.imageProcessor
    this.decisionImageProcessor =
      options.decisionImageProcessor ?? wrapAsDecision(options.imageProcessor)
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
    const processed = this.imageProcessor(input.bytes, input.observation)
    if (processed.bytes.length < 1 || !/^[a-f0-9]{16,128}$/iu.test(processed.perceptualHash)) {
      throw incompatibleEvidence()
    }
    // The decision model reads the capped JPEG frame (fast upload + vision
    // models downscale internally anyway), while durable audit keeps the
    // bounded 1200px redacted preview. When the model variant fails to build
    // we degrade to the audit frame rather than failing the observation.
    let decision = wrapAsDecisionResult(processed, input.observation)
    try {
      const built = this.decisionImageProcessor(input.bytes, input.observation)
      if (built.bytes.length >= 1) {
        decision = {
          bytes: built.bytes,
          width: built.width,
          height: built.height,
          mimeType: built.mimeType,
        }
      }
    } catch {
      // Fall back to the bounded frame — same behaviour as before the split.
    }
    this.cacheLatest(input.computerSessionId, input.observation.screenshot.snapshotId, decision)
    const imageBlobId = this.createId()
    const imageSha256 = sha256(processed.bytes)
    const expiresAt = new Date(this.now().getTime() + EXECUTION_EVIDENCE_TTL_MS).toISOString()

    // Fire-and-forget: the expensive encrypted-vault + SQLite write runs on the per-session
    // serial chain without blocking the live action. `cacheLatest` above already made this
    // sanitized frame available to `readLatestImage`, and the wire layer has already validated the
    // payload, so a storage fault must never fail the observation that produced it.
    void this.scheduleDurableWrite({
      computerSessionId: input.computerSessionId,
      kind: input.kind,
      observation: input.observation,
      processed,
      imageBlobId,
      imageSha256,
      expiresAt,
    })
    return { visualFingerprint: processed.perceptualHash }
  }

  /**
   * Waits for every queued durable write to settle. The live action never awaits this — it
   * exists so tests and graceful shutdown can assert/flush the background chain. Failures
   * are already swallowed inside {@link scheduleDurableWrite}, so this never rejects.
   */
  async flushPendingWrites(): Promise<void> {
    const pending = [...this.pendingWrites.values()]
    if (pending.length === 0) return
    await Promise.allSettled(pending)
  }

  /**
   * High-risk actions call this before execution so their current before-frame is durably
   * available for audit. Low-risk actions never call it and retain the fire-and-forget path.
   */
  async flushPendingWritesOrThrow(computerSessionId: string): Promise<void> {
    const pending = this.pendingWrites.get(computerSessionId)
    if (pending != null) await pending
    if (!this.durableWriteFailures.has(computerSessionId)) return
    throw new ComputerUseBrokerError(
      'environment_unavailable',
      'High-risk computer action evidence could not be persisted',
      undefined,
      {
        diagnostic: {
          diagnosticCode: 'high_risk_evidence_persist_failed',
          stage: 'persist',
          repairAction: 'Check available disk space and retry the action',
        },
      },
    )
  }

  /**
   * Queues the encrypted-vault + SQLite write on the per-session serial chain. Callers do
   * NOT await settlement (see {@link persist}); the chain only serializes writes within a
   * session so audit replay stays chronological and SQLite never sees concurrent writers.
   * A durable-write failure is logged and swallowed: the live action has already been
   * validated at the wire layer, and the in-memory cache (`cacheLatest`, run synchronously
   * in `persist`) is what feeds the decision model.
   */
  private scheduleDurableWrite(input: {
    computerSessionId: string
    kind: 'execution_before' | 'execution_after'
    observation: ComputerObservation
    processed: { bytes: Buffer; perceptualHash: string }
    imageBlobId: string
    imageSha256: string
    expiresAt: string
  }): Promise<void> {
    const previous = this.pendingWrites.get(input.computerSessionId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => this.writeDurableEvidence(input))
      .then(() => {
        this.durableWriteFailures.delete(input.computerSessionId)
      })
      .catch((error: unknown) => {
        this.durableWriteFailures.set(input.computerSessionId, error)
        log.warn('Computer observation evidence could not be persisted', error)
      })
    this.pendingWrites.set(input.computerSessionId, next)
    void next.then(() => {
      if (this.pendingWrites.get(input.computerSessionId) === next) {
        this.pendingWrites.delete(input.computerSessionId)
      }
    })
    return next
  }

  private async writeDurableEvidence(input: {
    computerSessionId: string
    kind: 'execution_before' | 'execution_after'
    observation: ComputerObservation
    processed: { bytes: Buffer; perceptualHash: string }
    imageBlobId: string
    imageSha256: string
    expiresAt: string
  }): Promise<void> {
    const owner = this.sessions?.get(input.computerSessionId)
    if (this.sessions != null && owner == null) {
      throw new ComputerUseBrokerError(
        'environment_unavailable',
        'Computer observation owner could not be resolved',
      )
    }
    await this.vault.writeManyRegistered(
      [{ blobId: input.imageBlobId, kind: 'image', plaintext: input.processed.bytes }],
      (records) => {
        const recordById = new Map(records.map((record) => [record.blobId, record]))
        const image = requireBlob(recordById, input.imageBlobId, 'image')
        if (image.plaintextSha256 !== input.imageSha256) {
          throw incompatibleEvidence()
        }
        this.repository.createWithBlobs({
          snapshot: {
            id: input.observation.screenshot.snapshotId,
            sessionId: owner?.session_id ?? null,
            turnId: owner?.turn_id ?? null,
            computerSessionId: input.computerSessionId,
            kind: input.kind,
            appId: input.observation.foreground.app.id,
            appName: input.observation.foreground.app.name,
            windowId: input.observation.foreground.window.id,
            windowTitle: input.observation.foreground.window.title,
            bounds: input.observation.foreground.window.bounds,
            display: input.observation.display,
            imageBlobId: input.imageBlobId,
            textBlobId: null,
            previewBlobId: null,
            imageSha256: input.imageSha256,
            perceptualHash: input.processed.perceptualHash,
            treeVersion: input.observation.treeVersion,
            accessibleTextMode: 'app_exposed',
            redaction: {
              applied: input.observation.sensitiveRegions.length > 0,
              reasonCodes:
                input.observation.sensitiveRegions.length > 0 ? ['sensitive_region'] : [],
              regionCount: input.observation.sensitiveRegions.length,
            },
            retention: { mode: 'ttl', expiresAt: input.expiresAt },
            createdAt: input.observation.capturedAt,
          },
          blobs: [toCreateBlob(image, input.observation.capturedAt)],
        })
      },
    )
  }

  private cacheLatest(
    computerSessionId: string,
    snapshotId: string,
    image: { bytes: Buffer; width: number; height: number; mimeType: 'image/png' | 'image/jpeg' },
  ): void {
    const existing = this.latestImages.get(computerSessionId)
    if (existing != null) this.cachedBytes -= existing.bytes.length
    this.latestImages.delete(computerSessionId)
    const copy = Buffer.from(image.bytes)
    this.latestImages.set(computerSessionId, {
      snapshotId,
      bytes: copy,
      width: image.width,
      height: image.height,
      mimeType: image.mimeType,
    })
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

  async readLatestImage(
    computerSessionId: string,
    snapshotId: string,
  ): Promise<{
    bytes: Buffer
    width: number
    height: number
    mimeType: 'image/png' | 'image/jpeg'
  }> {
    const image = this.latestImages.get(computerSessionId)
    if (image == null || image.snapshotId !== snapshotId) {
      throw new ComputerUseBrokerError(
        'stale_frame',
        'Computer observation image is no longer the latest persisted frame',
      )
    }
    return {
      bytes: Buffer.from(image.bytes),
      width: image.width,
      height: image.height,
      mimeType: image.mimeType,
    }
  }

  clearSession(computerSessionId: string): void {
    this.cachedBytes -= this.latestImages.get(computerSessionId)?.bytes.length ?? 0
    this.latestImages.delete(computerSessionId)
    this.durableWriteFailures.delete(computerSessionId)
    const pending = this.pendingWrites.get(computerSessionId)
    if (pending != null) {
      void pending.then(() => this.durableWriteFailures.delete(computerSessionId))
    }
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

/** Adapts a plain audit processor to the decision-image contract (audit dims, PNG). */
function wrapAsDecision(
  processor: (
    bytes: Buffer,
    observation: ComputerObservation,
  ) => { bytes: Buffer; perceptualHash: string },
): (
  bytes: Buffer,
  observation: ComputerObservation,
) => { bytes: Buffer; width: number; height: number; mimeType: 'image/png' | 'image/jpeg' } {
  return (bytes, observation) => wrapAsDecisionResult(processor(bytes, observation), observation)
}

function wrapAsDecisionResult(
  processed: { bytes: Buffer },
  observation: ComputerObservation,
): { bytes: Buffer; width: number; height: number; mimeType: 'image/png' | 'image/jpeg' } {
  return {
    bytes: processed.bytes,
    width: observation.screenshot.width,
    height: observation.screenshot.height,
    mimeType: 'image/png',
  }
}

function incompatibleEvidence(): ComputerUseBrokerError {
  return new ComputerUseBrokerError(
    'native_host_incompatible',
    'Native Host observation evidence failed integrity validation',
  )
}
