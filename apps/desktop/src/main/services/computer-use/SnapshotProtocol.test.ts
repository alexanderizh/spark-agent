import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  registerSchemesAsPrivileged: vi.fn(),
  userData: '/private/spark-agent',
}))

vi.mock('electron', () => ({
  app: { getPath: () => electronMocks.userData },
  protocol: {
    handle: electronMocks.handle,
    registerSchemesAsPrivileged: electronMocks.registerSchemesAsPrivileged,
  },
}))

vi.mock('../../db.js', () => ({
  getDatabase: vi.fn(),
}))

import {
  createSnapshotProtocolHandler,
  registerSnapshotSchemes,
  snapshotPreviewUrl,
} from './SnapshotProtocol.js'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('SnapshotProtocol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers a dedicated secure streaming scheme without bypassing CSP', () => {
    registerSnapshotSchemes()

    expect(electronMocks.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: 'spark-snapshot',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
        },
      },
    ])
  })

  it('builds preview URLs from snapshot IDs rather than paths', () => {
    expect(snapshotPreviewUrl('snapshot id/一', 'a'.repeat(43))).toBe(
      `spark-snapshot://snapshot/snapshot%20id%2F%E4%B8%80/preview?cap=${'a'.repeat(43)}`,
    )
  })

  it('serves an authenticated image preview with hardened response headers', async () => {
    const resolvePreview = vi.fn().mockReturnValue({
      blobId: 'blob-preview',
      kind: 'preview',
      storageKey: 'a'.repeat(48) + '.svb',
      byteLength: 100,
      plaintextSha256: 'a'.repeat(64),
      cipherSha256: 'b'.repeat(64),
    })
    const readPreview = vi.fn().mockResolvedValue(png)
    const authorizePreview = vi.fn(() => true)
    const handler = createSnapshotProtocolHandler({
      authorizePreview,
      resolvePreview,
      readPreview,
    })

    const response = await handler(
      new Request(`spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`),
    )

    expect(authorizePreview).toHaveBeenCalledWith('snapshot-1', 'a'.repeat(43))
    expect(resolvePreview).toHaveBeenCalledWith('snapshot-1')
    expect(readPreview).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe(String(png.length))
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
  })

  it.each([
    'spark-snapshot://blob/snapshot-1/preview',
    'spark-snapshot://snapshot/snapshot-1/raw',
    'spark-snapshot://snapshot/snapshot-1/preview?path=%2Fetc%2Fpasswd',
    'spark-snapshot://snapshot/a/b/preview',
  ])('rejects non-canonical URLs without consulting storage: %s', async (url) => {
    const resolvePreview = vi.fn()
    const handler = createSnapshotProtocolHandler({
      authorizePreview: vi.fn(() => true),
      resolvePreview,
      readPreview: vi.fn(),
    })

    const response = await handler(new Request(url))

    expect(response.status).toBe(400)
    expect(resolvePreview).not.toHaveBeenCalled()
  })

  it('rejects expired or mismatched preview capabilities before storage access', async () => {
    const resolvePreview = vi.fn()
    const handler = createSnapshotProtocolHandler({
      authorizePreview: vi.fn(() => false),
      resolvePreview,
      readPreview: vi.fn(),
    })

    const response = await handler(
      new Request(`spark-snapshot://snapshot/snapshot-1/preview?cap=${'b'.repeat(43)}`),
    )

    expect(response.status).toBe(404)
    expect(resolvePreview).not.toHaveBeenCalled()
  })

  it('returns not found without exposing blob storage details', async () => {
    const readPreview = vi.fn()
    const handler = createSnapshotProtocolHandler({
      authorizePreview: vi.fn(() => true),
      resolvePreview: () => null,
      readPreview,
    })

    const response = await handler(
      new Request(`spark-snapshot://snapshot/missing-snapshot/preview?cap=${'a'.repeat(43)}`),
    )

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
    expect(readPreview).not.toHaveBeenCalled()
  })

  it('rejects unsupported methods before reading snapshot metadata or ciphertext', async () => {
    const resolvePreview = vi.fn()
    const readPreview = vi.fn()
    const handler = createSnapshotProtocolHandler({
      authorizePreview: vi.fn(() => true),
      resolvePreview,
      readPreview,
    })

    const response = await handler(
      new Request(`spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`, {
        method: 'POST',
      }),
    )

    expect(response.status).toBe(405)
    expect(resolvePreview).not.toHaveBeenCalled()
    expect(readPreview).not.toHaveBeenCalled()
  })

  it('refuses decrypted content that is not a supported image', async () => {
    const handler = createSnapshotProtocolHandler({
      authorizePreview: vi.fn(() => true),
      resolvePreview: () => ({
        blobId: 'blob-preview',
        kind: 'preview',
        storageKey: 'a'.repeat(48) + '.svb',
        byteLength: 100,
        plaintextSha256: 'a'.repeat(64),
        cipherSha256: 'b'.repeat(64),
      }),
      readPreview: async () => Buffer.from('<script>alert(1)</script>'),
    })

    const response = await handler(
      new Request(`spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`),
    )

    expect(response.status).toBe(415)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
