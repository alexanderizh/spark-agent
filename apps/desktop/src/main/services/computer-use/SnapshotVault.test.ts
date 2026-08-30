import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { SnapshotVault, type SnapshotVaultBlobRecord } from './SnapshotVault.js'

class FixedKeyProvider {
  constructor(private readonly key: Buffer) {}

  async getKey(): Promise<Buffer> {
    return Buffer.from(this.key)
  }
}

describe('SnapshotVault', () => {
  let rootDirectory: string

  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'spark-snapshot-vault-'))
  })

  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true })
  })

  it('encrypts blobs with random nonces and decrypts only with matching AAD', async () => {
    const vault = new SnapshotVault({
      rootDirectory,
      keyProvider: new FixedKeyProvider(randomBytes(32)),
    })
    const plaintext = Buffer.from('private accessibility text: account 1234')

    const first = await vault.writeBlob({ blobId: 'blob-1', kind: 'text', plaintext })
    const second = await vault.writeBlob({ blobId: 'blob-2', kind: 'text', plaintext })
    const firstCiphertext = readFileSync(join(rootDirectory, first.storageKey))
    const secondCiphertext = readFileSync(join(rootDirectory, second.storageKey))

    expect(first.storageKey).toMatch(/^[0-9a-f]{48}\.svb$/)
    expect(first.plaintextSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(first.cipherSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(firstCiphertext.includes(plaintext)).toBe(false)
    expect(firstCiphertext.equals(secondCiphertext)).toBe(false)
    await expect(vault.readBlob(first)).resolves.toEqual(plaintext)
    await expect(vault.readBlob({ ...first, blobId: 'wrong-blob' })).rejects.toThrow(
      'Snapshot blob authentication failed',
    )
    await expect(vault.readBlob({ ...first, kind: 'image' })).rejects.toThrow(
      'Snapshot blob authentication failed',
    )
  })

  it('rejects tampered ciphertext and keys from another installation', async () => {
    const vault = new SnapshotVault({
      rootDirectory,
      keyProvider: new FixedKeyProvider(Buffer.alloc(32, 1)),
    })
    const record = await vault.writeBlob({
      blobId: 'blob-1',
      kind: 'image',
      plaintext: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
    })
    const filePath = join(rootDirectory, record.storageKey)
    const ciphertext = readFileSync(filePath)
    const lastByteIndex = ciphertext.length - 1
    const lastByte = ciphertext[lastByteIndex]
    expect(lastByte).toBeDefined()
    ciphertext[lastByteIndex] = (lastByte ?? 0) ^ 0xff
    await import('node:fs/promises').then(({ writeFile }) => writeFile(filePath, ciphertext))

    await expect(vault.readBlob(record)).rejects.toThrow('Snapshot blob authentication failed')

    const otherInstallationVault = new SnapshotVault({
      rootDirectory,
      keyProvider: new FixedKeyProvider(Buffer.alloc(32, 2)),
    })
    await expect(otherInstallationVault.readBlob(record)).rejects.toThrow(
      'Snapshot blob authentication failed',
    )
  })

  it.runIf(process.platform !== 'win32')(
    'creates the vault directory as 0700 and encrypted files as 0600',
    async () => {
      const nestedRoot = join(rootDirectory, 'private', 'blobs')
      const vault = new SnapshotVault({
        rootDirectory: nestedRoot,
        keyProvider: new FixedKeyProvider(randomBytes(32)),
      })

      const record = await vault.writeBlob({
        blobId: 'blob-1',
        kind: 'preview',
        plaintext: Buffer.from('preview'),
      })

      expect(statSync(nestedRoot).mode & 0o777).toBe(0o700)
      expect(statSync(join(nestedRoot, record.storageKey)).mode & 0o777).toBe(0o600)
    },
  )

  it('removes the new encrypted file if metadata registration rolls back', async () => {
    const vault = new SnapshotVault({
      rootDirectory,
      keyProvider: new FixedKeyProvider(randomBytes(32)),
    })
    let created: SnapshotVaultBlobRecord | undefined

    await expect(
      vault.writeRegistered(
        { blobId: 'blob-1', kind: 'image', plaintext: Buffer.from('image bytes') },
        async (record) => {
          created = record
          throw new Error('database transaction rolled back')
        },
      ),
    ).rejects.toThrow('database transaction rolled back')

    expect(created).toBeDefined()
    if (created == null) throw new Error('Expected the registration callback to receive a blob')
    const storageKey = created.storageKey
    expect(() => readFileSync(join(rootDirectory, storageKey))).toThrow()
  })

  it('removes every newly written blob when multi-blob snapshot registration rolls back', async () => {
    const vault = new SnapshotVault({
      rootDirectory,
      keyProvider: new FixedKeyProvider(randomBytes(32)),
    })
    let created: SnapshotVaultBlobRecord[] = []

    await expect(
      vault.writeManyRegistered(
        [
          { blobId: 'blob-image', kind: 'image', plaintext: Buffer.from('image bytes') },
          { blobId: 'blob-text', kind: 'text', plaintext: Buffer.from('AX text') },
          { blobId: 'blob-preview', kind: 'preview', plaintext: Buffer.from('preview bytes') },
        ],
        async (records) => {
          created = records
          throw new Error('snapshot metadata transaction rolled back')
        },
      ),
    ).rejects.toThrow('snapshot metadata transaction rolled back')

    expect(created).toHaveLength(3)
    for (const record of created) {
      expect(() => readFileSync(join(rootDirectory, record.storageKey))).toThrow()
    }
  })

  it('cleans zero-reference records and encrypted files orphaned from the database', async () => {
    const vault = new SnapshotVault({
      rootDirectory,
      keyProvider: new FixedKeyProvider(randomBytes(32)),
    })
    const referenced = await vault.writeBlob({
      blobId: 'blob-referenced',
      kind: 'image',
      plaintext: Buffer.from('referenced'),
    })
    const unreferenced = await vault.writeBlob({
      blobId: 'blob-unreferenced',
      kind: 'text',
      plaintext: Buffer.from('unreferenced'),
    })
    const orphan = await vault.writeBlob({
      blobId: 'blob-orphan',
      kind: 'preview',
      plaintext: Buffer.from('orphan'),
    })
    const deletedRecords: string[] = []
    const repository = {
      listUnreferencedBlobs: () => [
        { id: unreferenced.blobId, storage_key: unreferenced.storageKey, ref_count: 0 },
      ],
      listBlobStorageKeys: () => [referenced.storageKey, unreferenced.storageKey],
      deleteBlobRecordIfUnreferenced: (id: string) => {
        deletedRecords.push(id)
        return id === unreferenced.blobId ? { id } : null
      },
    }

    await expect(vault.cleanup(repository, { orphanGracePeriodMs: 0 })).resolves.toEqual({
      unreferencedDeleted: 1,
      orphanFilesDeleted: 1,
    })
    expect(deletedRecords).toEqual(['blob-unreferenced'])
    expect(() => readFileSync(join(rootDirectory, referenced.storageKey))).not.toThrow()
    expect(() => readFileSync(join(rootDirectory, unreferenced.storageKey))).toThrow()
    expect(() => readFileSync(join(rootDirectory, orphan.storageKey))).toThrow()
  })

  it('keeps the encrypted file when a zero-reference database record cannot be claimed', async () => {
    const vault = new SnapshotVault({
      rootDirectory,
      keyProvider: new FixedKeyProvider(randomBytes(32)),
    })
    const raced = await vault.writeBlob({
      blobId: 'blob-raced',
      kind: 'image',
      plaintext: Buffer.from('now referenced by another transaction'),
    })
    const repository = {
      listUnreferencedBlobs: () => [
        { id: raced.blobId, storage_key: raced.storageKey, ref_count: 0 },
      ],
      listBlobStorageKeys: () => [raced.storageKey],
      deleteBlobRecordIfUnreferenced: () => null,
    }

    await expect(vault.cleanup(repository)).resolves.toEqual({
      unreferencedDeleted: 0,
      orphanFilesDeleted: 0,
    })
    expect(() => readFileSync(join(rootDirectory, raced.storageKey))).not.toThrow()
  })

  it('rejects path-like storage keys without touching files outside the vault', async () => {
    const vault = new SnapshotVault({
      rootDirectory,
      keyProvider: new FixedKeyProvider(randomBytes(32)),
    })

    await expect(
      vault.readBlob({
        blobId: 'blob-1',
        kind: 'image',
        storageKey: '../outside.svb',
        byteLength: 1,
        plaintextSha256: 'a'.repeat(64),
        cipherSha256: 'b'.repeat(64),
      }),
    ).rejects.toThrow('Invalid snapshot storage key')
  })

  it('does not expose the vault path when an encrypted blob is missing', async () => {
    const vault = new SnapshotVault({
      rootDirectory,
      keyProvider: new FixedKeyProvider(randomBytes(32)),
    })

    const read = vault.readBlob({
      blobId: 'blob-missing',
      kind: 'image',
      storageKey: 'a'.repeat(48) + '.svb',
      byteLength: 1,
      plaintextSha256: 'a'.repeat(64),
      cipherSha256: 'b'.repeat(64),
    })

    await expect(read).rejects.toThrow('Snapshot blob authentication failed')
    await expect(read).rejects.not.toThrow(rootDirectory)
  })
})
