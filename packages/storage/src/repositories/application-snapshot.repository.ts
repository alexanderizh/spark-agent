import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type SnapshotBlobKind = 'image' | 'text' | 'preview'
export type ApplicationSnapshotKind =
  | 'user_context'
  | 'execution_before'
  | 'execution_after'
  | 'verification'
  | 'manual_checkpoint'
export type SnapshotRetentionMode = 'session' | 'computer_run' | 'ttl' | 'manual'

export interface SnapshotBlobRow {
  id: string
  kind: SnapshotBlobKind
  storage_key: string
  byte_length: number
  plaintext_sha256: string
  cipher_sha256: string
  ref_count: number
  created_at: string
}

export interface ApplicationSnapshotRow {
  id: string
  session_id: string | null
  turn_id: string | null
  computer_session_id: string | null
  kind: ApplicationSnapshotKind
  app_id: string
  app_name: string
  window_id: string
  window_title: string
  bounds_json: string
  display_json: string
  image_blob_id: string
  text_blob_id: string | null
  preview_blob_id: string | null
  image_sha256: string
  perceptual_hash: string | null
  tree_version: string | null
  accessible_text_mode: 'visible_only' | 'app_exposed'
  redaction_json: string
  retention_mode: SnapshotRetentionMode
  expires_at: string | null
  created_at: string
  deleted_at: string | null
}

export interface CreateSnapshotBlobParams {
  id: string
  kind: SnapshotBlobKind
  storageKey: string
  byteLength: number
  plaintextSha256: string
  cipherSha256: string
  createdAt: string
}

export interface CreateApplicationSnapshotParams {
  id: string
  sessionId: string | null
  turnId: string | null
  computerSessionId: string | null
  kind: ApplicationSnapshotKind
  appId: string
  appName: string
  windowId: string
  windowTitle: string
  bounds: Record<string, unknown>
  display: Record<string, unknown>
  imageBlobId: string
  textBlobId: string | null
  previewBlobId: string | null
  imageSha256: string
  perceptualHash: string | null
  treeVersion: string | null
  accessibleTextMode: 'visible_only' | 'app_exposed'
  redaction: Record<string, unknown>
  retention: { mode: SnapshotRetentionMode; expiresAt: string | null }
  createdAt: string
}

export interface CreateApplicationSnapshotWithBlobsParams {
  snapshot: CreateApplicationSnapshotParams
  blobs: CreateSnapshotBlobParams[]
}

export class ApplicationSnapshotRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'application_snapshots')
  }

  get(id: string): ApplicationSnapshotRow | null {
    return this.findById<ApplicationSnapshotRow>(id)
  }

  getBlob(id: string): SnapshotBlobRow | null {
    const row = this.raw.prepare('SELECT * FROM computer_snapshot_blobs WHERE id = ?').get(id) as
      | SnapshotBlobRow
      | undefined
    return row ?? null
  }

  createWithBlobs(params: CreateApplicationSnapshotWithBlobsParams): ApplicationSnapshotRow {
    const transaction = this.raw.transaction(() => {
      const insertBlob = this.raw.prepare(
        `INSERT INTO computer_snapshot_blobs (
           id, kind, storage_key, byte_length, plaintext_sha256, cipher_sha256, ref_count, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      for (const blob of params.blobs) {
        insertBlob.run(
          blob.id,
          blob.kind,
          blob.storageKey,
          blob.byteLength,
          blob.plaintextSha256,
          blob.cipherSha256,
          blob.createdAt,
        )
      }

      const snapshot = params.snapshot
      const referencedBlobIds = new Set(
        [snapshot.imageBlobId, snapshot.textBlobId, snapshot.previewBlobId].filter(
          (id): id is string => id != null,
        ),
      )
      if (params.blobs.some((blob) => !referencedBlobIds.has(blob.id))) {
        throw new Error('Snapshot registration contains an unreferenced blob')
      }
      const imageBlob = this.requireBlobKind(snapshot.imageBlobId, 'image')
      if (imageBlob.plaintext_sha256 !== snapshot.imageSha256) {
        throw new Error('Snapshot image digest does not match its encrypted blob')
      }
      if (snapshot.textBlobId != null) this.requireBlobKind(snapshot.textBlobId, 'text')
      if (snapshot.previewBlobId != null) this.requireBlobKind(snapshot.previewBlobId, 'preview')

      this.raw
        .prepare(
          `INSERT INTO application_snapshots (
             id, session_id, turn_id, computer_session_id, kind,
             app_id, app_name, window_id, window_title, bounds_json, display_json,
             image_blob_id, text_blob_id, preview_blob_id, image_sha256, perceptual_hash,
             tree_version, accessible_text_mode, redaction_json, retention_mode,
             expires_at, created_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          snapshot.id,
          snapshot.sessionId,
          snapshot.turnId,
          snapshot.computerSessionId,
          snapshot.kind,
          snapshot.appId,
          snapshot.appName,
          snapshot.windowId,
          snapshot.windowTitle,
          this.toJson(snapshot.bounds),
          this.toJson(snapshot.display),
          snapshot.imageBlobId,
          snapshot.textBlobId,
          snapshot.previewBlobId,
          snapshot.imageSha256,
          snapshot.perceptualHash,
          snapshot.treeVersion,
          snapshot.accessibleTextMode,
          this.toJson(snapshot.redaction),
          snapshot.retention.mode,
          snapshot.retention.expiresAt,
          snapshot.createdAt,
        )

      const row = this.get(snapshot.id)
      if (row == null) throw new Error('Snapshot insertion did not return a row')
      return row
    })
    return transaction()
  }

  listBySession(sessionId: string, limit = 200): ApplicationSnapshotRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM application_snapshots
         WHERE session_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(sessionId, limit) as ApplicationSnapshotRow[]
  }

  listExpired(nowIso: string, limit = 200): ApplicationSnapshotRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM application_snapshots
         WHERE retention_mode = 'ttl' AND expires_at <= ? AND deleted_at IS NULL
         ORDER BY expires_at ASC LIMIT ?`,
      )
      .all(nowIso, limit) as ApplicationSnapshotRow[]
  }

  updateRetention(
    id: string,
    retention: { mode: SnapshotRetentionMode; expiresAt: string | null },
  ): ApplicationSnapshotRow | null {
    this.raw
      .prepare(
        `UPDATE application_snapshots
         SET retention_mode = ?, expires_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(retention.mode, retention.expiresAt, id)
    return this.get(id)
  }

  delete(id: string): SnapshotBlobRow[] {
    const transaction = this.raw.transaction(() => {
      const snapshot = this.get(id)
      if (snapshot == null) return []
      const blobIds = [snapshot.image_blob_id, snapshot.text_blob_id, snapshot.preview_blob_id]
      this.raw.prepare('DELETE FROM application_snapshots WHERE id = ?').run(id)
      return this.raw
        .prepare(
          `SELECT * FROM computer_snapshot_blobs
           WHERE ref_count = 0 AND id IN (?, ?, ?)
           ORDER BY id ASC`,
        )
        .all(...blobIds) as SnapshotBlobRow[]
    })
    return transaction()
  }

  listUnreferencedBlobs(limit = 200): SnapshotBlobRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM computer_snapshot_blobs
         WHERE ref_count = 0 ORDER BY created_at ASC LIMIT ?`,
      )
      .all(limit) as SnapshotBlobRow[]
  }

  listBlobStorageKeys(): string[] {
    const rows = this.raw
      .prepare('SELECT storage_key FROM computer_snapshot_blobs ORDER BY storage_key ASC')
      .all() as Array<{ storage_key: string }>
    return rows.map((row) => row.storage_key)
  }

  deleteBlobRecordIfUnreferenced(id: string): SnapshotBlobRow | null {
    const transaction = this.raw.transaction(() => {
      const blob = this.getBlob(id)
      if (blob == null || blob.ref_count !== 0) return null
      this.raw.prepare('DELETE FROM computer_snapshot_blobs WHERE id = ? AND ref_count = 0').run(id)
      return blob
    })
    return transaction()
  }

  getPreviewBlob(snapshotId: string): SnapshotBlobRow | null {
    const row = this.raw
      .prepare(
        `SELECT blob.*
         FROM application_snapshots snapshot
         JOIN computer_snapshot_blobs blob
           ON blob.id = COALESCE(snapshot.preview_blob_id, snapshot.image_blob_id)
         WHERE snapshot.id = ? AND snapshot.deleted_at IS NULL`,
      )
      .get(snapshotId) as SnapshotBlobRow | undefined
    return row ?? null
  }

  private requireBlobKind(id: string, expectedKind: SnapshotBlobKind): SnapshotBlobRow {
    const blob = this.getBlob(id)
    if (blob == null || blob.kind !== expectedKind) {
      throw new Error(`Snapshot ${expectedKind} blob is missing or has the wrong kind`)
    }
    return blob
  }
}
