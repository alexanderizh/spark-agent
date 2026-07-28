import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SnapshotVaultKeySource } from './SnapshotVaultKeyProvider.js'

const MAGIC = Buffer.from('SPKSVLT', 'ascii')
const FORMAT_VERSION = 1
const NONCE_BYTES = 12
const AUTH_TAG_BYTES = 16
const HEADER_BYTES = MAGIC.length + 1 + NONCE_BYTES + AUTH_TAG_BYTES
const STORAGE_KEY_PATTERN = /^[0-9a-f]{48}\.svb$/
const DEFAULT_ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1_000

export type SnapshotVaultBlobKind = 'image' | 'text' | 'preview'

export interface SnapshotVaultBlobRecord {
  blobId: string
  kind: SnapshotVaultBlobKind
  storageKey: string
  byteLength: number
  plaintextSha256: string
  cipherSha256: string
}

export interface SnapshotVaultWriteInput {
  blobId: string
  kind: SnapshotVaultBlobKind
  plaintext: Uint8Array
}

export interface SnapshotVaultCleanupRepository {
  listUnreferencedBlobs(limit?: number): Array<{
    id: string
    storage_key: string
    ref_count: number
  }>
  listBlobStorageKeys(): string[]
  deleteBlobRecordIfUnreferenced(id: string): unknown
}

export interface SnapshotVaultCleanupResult {
  unreferencedDeleted: number
  orphanFilesDeleted: number
}

export class SnapshotVault {
  private readonly rootDirectory: string
  private readonly keyProvider: SnapshotVaultKeySource

  constructor(options: { rootDirectory: string; keyProvider: SnapshotVaultKeySource }) {
    this.rootDirectory = options.rootDirectory
    this.keyProvider = options.keyProvider
  }

  async writeBlob(input: SnapshotVaultWriteInput): Promise<SnapshotVaultBlobRecord> {
    validateBlobIdentity(input.blobId, input.kind)
    const key = await this.loadKey()
    const plaintext = Buffer.from(input.plaintext)
    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: AUTH_TAG_BYTES })
    cipher.setAAD(createAad(input.blobId, input.kind))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const encrypted = Buffer.concat([
      MAGIC,
      Buffer.from([FORMAT_VERSION]),
      nonce,
      cipher.getAuthTag(),
      ciphertext,
    ])
    const storageKey = `${randomBytes(24).toString('hex')}.svb`

    await this.writeAtomically(storageKey, encrypted)
    return {
      blobId: input.blobId,
      kind: input.kind,
      storageKey,
      byteLength: encrypted.length,
      plaintextSha256: sha256(plaintext),
      cipherSha256: sha256(encrypted),
    }
  }

  async writeRegistered<T>(
    input: SnapshotVaultWriteInput,
    register: (record: SnapshotVaultBlobRecord) => Promise<T> | T,
  ): Promise<T> {
    return this.writeManyRegistered([input], (records) => {
      const record = records[0]
      if (record == null) throw new Error('Snapshot blob was not written')
      return register(record)
    })
  }

  async writeManyRegistered<T>(
    inputs: readonly SnapshotVaultWriteInput[],
    register: (records: SnapshotVaultBlobRecord[]) => Promise<T> | T,
  ): Promise<T> {
    const records: SnapshotVaultBlobRecord[] = []
    try {
      for (const input of inputs) records.push(await this.writeBlob(input))
      return await register(records)
    } catch (primaryError) {
      const cleanupErrors: unknown[] = []
      for (const record of [...records].reverse()) {
        try {
          await this.deleteBlob(record.storageKey)
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [primaryError, ...cleanupErrors],
          'Snapshot registration failed and encrypted blob cleanup also failed',
          { cause: primaryError },
        )
      }
      throw primaryError
    }
  }

  async readBlob(record: SnapshotVaultBlobRecord): Promise<Buffer> {
    validateBlobIdentity(record.blobId, record.kind)
    const filePath = this.resolveStoragePath(record.storageKey)
    try {
      const encrypted = await readFile(filePath)
      if (encrypted.length < HEADER_BYTES || sha256(encrypted) !== record.cipherSha256) {
        throw new Error('invalid encrypted snapshot')
      }
      if (!encrypted.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error('invalid encrypted snapshot')
      }
      const version = encrypted[MAGIC.length]
      if (version !== FORMAT_VERSION) throw new Error('unsupported snapshot format')

      const nonceOffset = MAGIC.length + 1
      const tagOffset = nonceOffset + NONCE_BYTES
      const ciphertextOffset = tagOffset + AUTH_TAG_BYTES
      const decipher = createDecipheriv(
        'aes-256-gcm',
        await this.loadKey(),
        encrypted.subarray(nonceOffset, tagOffset),
        { authTagLength: AUTH_TAG_BYTES },
      )
      decipher.setAAD(createAad(record.blobId, record.kind))
      decipher.setAuthTag(encrypted.subarray(tagOffset, ciphertextOffset))
      const plaintext = Buffer.concat([
        decipher.update(encrypted.subarray(ciphertextOffset)),
        decipher.final(),
      ])
      if (sha256(plaintext) !== record.plaintextSha256) {
        throw new Error('invalid snapshot plaintext digest')
      }
      return plaintext
    } catch {
      throw new Error('Snapshot blob authentication failed')
    }
  }

  async deleteBlob(storageKey: string): Promise<boolean> {
    const filePath = this.resolveStoragePath(storageKey)
    try {
      await rm(filePath)
      return true
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return false
      throw error
    }
  }

  async cleanup(
    repository: SnapshotVaultCleanupRepository,
    options: { orphanGracePeriodMs?: number; limit?: number } = {},
  ): Promise<SnapshotVaultCleanupResult> {
    const limit = options.limit ?? 200
    let unreferencedDeleted = 0
    for (const blob of repository.listUnreferencedBlobs(limit)) {
      if (blob.ref_count !== 0) continue
      const claimed = repository.deleteBlobRecordIfUnreferenced(blob.id)
      if (claimed == null) continue
      await this.deleteBlob(blob.storage_key)
      unreferencedDeleted += 1
    }

    const knownStorageKeys = new Set(repository.listBlobStorageKeys())
    const gracePeriodMs = options.orphanGracePeriodMs ?? DEFAULT_ORPHAN_GRACE_PERIOD_MS
    const cutoff = Date.now() - gracePeriodMs
    let orphanFilesDeleted = 0
    for (const entry of await this.listEncryptedFiles()) {
      if (knownStorageKeys.has(entry)) continue
      const fileStat = await stat(this.resolveStoragePath(entry))
      if (fileStat.mtimeMs > cutoff) continue
      if (await this.deleteBlob(entry)) orphanFilesDeleted += 1
    }

    return { unreferencedDeleted, orphanFilesDeleted }
  }

  private async loadKey(): Promise<Buffer> {
    const key = await this.keyProvider.getKey()
    if (key.length !== 32) throw new Error('Snapshot Vault requires a 256-bit key')
    return Buffer.from(key)
  }

  private async writeAtomically(storageKey: string, encrypted: Buffer): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 })
    await chmod(this.rootDirectory, 0o700)
    const finalPath = this.resolveStoragePath(storageKey)
    const temporaryPath = join(
      this.rootDirectory,
      `.${storageKey}.${randomBytes(12).toString('hex')}.tmp`,
    )
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(
        temporaryPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o600,
      )
      await handle.writeFile(encrypted)
      await handle.sync()
      await handle.close()
      handle = null
      await rename(temporaryPath, finalPath)
      await chmod(finalPath, 0o600)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private resolveStoragePath(storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new Error('Invalid snapshot storage key')
    }
    return join(this.rootDirectory, storageKey)
  }

  private async listEncryptedFiles(): Promise<string[]> {
    try {
      return (await readdir(this.rootDirectory)).filter((entry) => STORAGE_KEY_PATTERN.test(entry))
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return []
      throw error
    }
  }
}

function validateBlobIdentity(blobId: string, kind: SnapshotVaultBlobKind): void {
  if (blobId.length < 1 || blobId.length > 200 || containsControlCharacters(blobId)) {
    throw new Error('Invalid snapshot blob identity')
  }
  if (kind !== 'image' && kind !== 'text' && kind !== 'preview') {
    throw new Error('Invalid snapshot blob kind')
  }
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true
  }
  return false
}

function createAad(blobId: string, kind: SnapshotVaultBlobKind): Buffer {
  return Buffer.from(
    JSON.stringify({ domain: 'spark.snapshot-vault', formatVersion: FORMAT_VERSION, blobId, kind }),
    'utf8',
  )
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
