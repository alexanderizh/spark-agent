import type { ComputerObservation } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import { ComputerObservationEvidenceStore } from './ComputerObservationEvidenceStore.js'

const OBSERVATION: ComputerObservation = {
  frameId: 'frame-1',
  treeVersion: 'tree-1',
  capturedAt: '2026-07-28T08:00:00.000Z',
  display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
  foreground: {
    app: {
      id: 'app-1',
      name: 'Editor',
      processId: 42,
      executableIdentity: 'signed:publisher/editor.exe',
    },
    window: {
      id: 'window-1',
      title: 'Document',
      bounds: { x: 10, y: 20, width: 800, height: 600 },
    },
  },
  screenshot: { snapshotId: 'snapshot-1', width: 800, height: 600 },
  tree: { mode: 'full', text: 'window "Document"', elementCount: 0 },
  elements: [],
  loading: false,
  sensitiveRegions: [],
}
const PNG_SHA256 = createHash('sha256').update('png').digest('hex')

describe('ComputerObservationEvidenceStore', () => {
  it('keeps execution-before raw pixels in bounded memory and persists only a sanitized thumbnail', async () => {
    const repository = { createWithBlobs: vi.fn(() => undefined as never) }
    const preview = Buffer.from('preview')
    const vault = {
      writeManyRegistered: vi.fn(async (inputs, register) =>
        register(
          inputs.map((input: { blobId: string; kind: 'image'; plaintext: Buffer }) => ({
            blobId: input.blobId,
            kind: input.kind,
            storageKey: `vault/${input.blobId}`,
            byteLength: input.plaintext.length,
            plaintextSha256: createHash('sha256').update(input.plaintext).digest('hex'),
            cipherSha256: 'c'.repeat(64),
          })),
        ),
      ),
    }
    const store = new ComputerObservationEvidenceStore({
      repository,
      vault,
      imageProcessor: vi.fn(() => ({
        bytes: preview,
        perceptualHash: 'a'.repeat(16),
      })),
    })

    await store.persist({
      computerSessionId: 'computer-1',
      kind: 'execution_before',
      observation: OBSERVATION,
      payload: { kind: 'image_png', byteLength: 3, sha256: PNG_SHA256 },
      bytes: Buffer.from('png'),
    })
    await store.flushPendingWrites()

    expect(vault.writeManyRegistered).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: 'image', plaintext: preview })],
      expect.any(Function),
    )
    expect(vault.writeManyRegistered).not.toHaveBeenCalledWith(
      [expect.objectContaining({ plaintext: Buffer.from('png') })],
      expect.any(Function),
    )
    expect(repository.createWithBlobs).toHaveBeenCalledWith({
      snapshot: expect.objectContaining({
        kind: 'execution_before',
        textBlobId: null,
        retention: { mode: 'ttl', expiresAt: expect.any(String) },
      }),
      blobs: [expect.objectContaining({ kind: 'image' })],
    })
    await expect(store.readLatestImage('computer-1', 'snapshot-1')).resolves.toEqual(
      Buffer.from('png'),
    )
  })

  it('persists only a redacted thumbnail with TTL after execution', async () => {
    const repository = { createWithBlobs: vi.fn(() => undefined as never) }
    const vault = {
      writeManyRegistered: vi.fn(async (inputs, register) =>
        register(
          inputs.map((input: { blobId: string; kind: 'image'; plaintext: Buffer }) => ({
            blobId: input.blobId,
            kind: input.kind,
            storageKey: `vault/${input.blobId}`,
            byteLength: input.plaintext.length,
            plaintextSha256: createHash('sha256').update(input.plaintext).digest('hex'),
            cipherSha256: 'c'.repeat(64),
          })),
        ),
      ),
    }
    const redacted = Buffer.from('redacted-thumbnail')
    const imageProcessor = vi.fn(() => ({ bytes: redacted, perceptualHash: 'f'.repeat(16) }))
    const store = new ComputerObservationEvidenceStore({
      repository,
      vault,
      imageProcessor,
      createId: () => 'image-1',
      now: () => new Date('2026-07-28T08:01:00.000Z'),
    })
    const sensitiveObservation = {
      ...OBSERVATION,
      sensitiveRegions: [{ x: 20, y: 30, width: 100, height: 40 }],
    }

    await expect(
      store.persist({
        computerSessionId: 'computer-1',
        kind: 'execution_after',
        observation: sensitiveObservation,
        payload: { kind: 'image_png', byteLength: 3, sha256: PNG_SHA256 },
        bytes: Buffer.from('png'),
      }),
    ).resolves.toEqual({ visualFingerprint: 'f'.repeat(16) })
    await store.flushPendingWrites()

    expect(imageProcessor).toHaveBeenCalledWith(Buffer.from('png'), sensitiveObservation)
    expect(vault.writeManyRegistered).toHaveBeenCalledWith(
      [{ blobId: 'image-1', kind: 'image', plaintext: redacted }],
      expect.any(Function),
    )
    expect(repository.createWithBlobs).toHaveBeenCalledWith({
      snapshot: expect.objectContaining({
        imageBlobId: 'image-1',
        textBlobId: null,
        previewBlobId: null,
        perceptualHash: 'f'.repeat(16),
        redaction: { applied: true, reasonCodes: ['sensitive_region'], regionCount: 1 },
        retention: { mode: 'ttl', expiresAt: '2026-07-29T08:01:00.000Z' },
      }),
      blobs: [expect.objectContaining({ id: 'image-1', kind: 'image' })],
    })
  })

  it('rejects mismatched image evidence before writing to the vault', async () => {
    const vault = { writeManyRegistered: vi.fn() }
    const store = new ComputerObservationEvidenceStore({
      repository: { createWithBlobs: vi.fn(() => undefined as never) },
      vault,
      imageProcessor: vi.fn(() => ({
        bytes: Buffer.from('preview'),
        perceptualHash: 'a'.repeat(16),
      })),
    })

    await expect(
      store.persist({
        computerSessionId: 'computer-1',
        kind: 'execution_after',
        observation: OBSERVATION,
        payload: { kind: 'image_png', byteLength: 3, sha256: 'f'.repeat(64) },
        bytes: Buffer.from('png'),
      }),
    ).rejects.toBeInstanceOf(ComputerUseBrokerError)
    expect(vault.writeManyRegistered).not.toHaveBeenCalled()
  })

  it('keeps low-risk persistence asynchronous but fails closed when high-risk evidence is flushed', async () => {
    const store = new ComputerObservationEvidenceStore({
      repository: { createWithBlobs: vi.fn(() => undefined as never) },
      vault: {
        writeManyRegistered: vi.fn(async () => {
          throw new Error('disk full')
        }),
      },
      imageProcessor: vi.fn(() => ({
        bytes: Buffer.from('preview'),
        perceptualHash: 'a'.repeat(16),
      })),
    })

    await expect(
      store.persist({
        computerSessionId: 'computer-1',
        kind: 'execution_before',
        observation: OBSERVATION,
        payload: { kind: 'image_png', byteLength: 3, sha256: PNG_SHA256 },
        bytes: Buffer.from('png'),
      }),
    ).resolves.toEqual({ visualFingerprint: 'a'.repeat(16) })

    await expect(store.flushPendingWrites()).resolves.toBeUndefined()
    await expect(store.flushPendingWritesOrThrow('computer-1')).rejects.toMatchObject({
      code: 'environment_unavailable',
      diagnostic: {
        diagnosticCode: 'high_risk_evidence_persist_failed',
        stage: 'persist',
      },
    })
    store.clearSession('computer-1')
    await expect(store.flushPendingWritesOrThrow('computer-1')).resolves.toBeUndefined()
  })

  it('evicts old in-memory raw frames when the byte budget is reached', async () => {
    const store = new ComputerObservationEvidenceStore({
      repository: { createWithBlobs: vi.fn(() => undefined as never) },
      vault: { writeManyRegistered: vi.fn() },
      imageProcessor: vi.fn(() => ({
        bytes: Buffer.from('preview'),
        perceptualHash: 'a'.repeat(16),
      })),
      maxCachedBytes: 3,
    })
    await store.persist({
      computerSessionId: 'computer-1',
      kind: 'execution_before',
      observation: OBSERVATION,
      payload: { kind: 'image_png', byteLength: 3, sha256: PNG_SHA256 },
      bytes: Buffer.from('png'),
    })
    await store.persist({
      computerSessionId: 'computer-2',
      kind: 'execution_before',
      observation: {
        ...OBSERVATION,
        screenshot: { ...OBSERVATION.screenshot, snapshotId: 'snapshot-2' },
      },
      payload: { kind: 'image_png', byteLength: 3, sha256: PNG_SHA256 },
      bytes: Buffer.from('png'),
    })

    await expect(store.readLatestImage('computer-1', 'snapshot-1')).rejects.toMatchObject({
      code: 'stale_frame',
    })
    await expect(store.readLatestImage('computer-2', 'snapshot-2')).resolves.toEqual(
      Buffer.from('png'),
    )
  })
})
import { createHash } from 'node:crypto'
