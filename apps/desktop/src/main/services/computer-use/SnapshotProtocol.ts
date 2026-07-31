import { app, protocol, type CustomScheme } from 'electron'
import { join } from 'node:path'
import { ApplicationSnapshotRepository } from '@spark/storage'
import { createLogger } from '@spark/shared'
import { getDatabase } from '../../db.js'
import { SnapshotVault, type SnapshotVaultBlobRecord } from './SnapshotVault.js'
import { SnapshotVaultKeyProvider } from './SnapshotVaultKeyProvider.js'
import {
  getSnapshotPreviewCapabilityService,
  snapshotPreviewUrl,
} from './SnapshotPreviewCapability.js'

export { snapshotPreviewUrl } from './SnapshotPreviewCapability.js'

export const SNAPSHOT_SCHEME = 'spark-snapshot'

const log = createLogger('snapshot-protocol')
const BASE_RESPONSE_HEADERS = {
  'cache-control': 'private, no-store',
  'content-security-policy': "default-src 'none'; sandbox",
  'cross-origin-resource-policy': 'cross-origin',
  'x-content-type-options': 'nosniff',
}

export interface SnapshotProtocolDependencies {
  authorizePreview(snapshotId: string, token: string): boolean
  resolvePreview(
    snapshotId: string,
  ): SnapshotVaultBlobRecord | null | Promise<SnapshotVaultBlobRecord | null>
  readPreview(record: SnapshotVaultBlobRecord): Uint8Array | Promise<Uint8Array>
}

/** Electron 启动前由应用级统一注册器一次性声明。 */
export const SNAPSHOT_PRIVILEGED_SCHEME: CustomScheme = {
  scheme: SNAPSHOT_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    corsEnabled: true,
    supportFetchAPI: true,
    stream: true,
  },
}

export function createSnapshotProtocolHandler(
  dependencies: SnapshotProtocolDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const preview = parsePreviewRequest(request.url)
    if (preview == null) return textResponse('Invalid snapshot preview URL', 400)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('Method Not Allowed', 405)
    }
    if (!dependencies.authorizePreview(preview.snapshotId, preview.token)) {
      return textResponse('Not Found', 404)
    }

    try {
      const record = await dependencies.resolvePreview(preview.snapshotId)
      if (record == null || (record.kind !== 'image' && record.kind !== 'preview')) {
        return textResponse('Not Found', 404)
      }
      const image = Buffer.from(await dependencies.readPreview(record))
      const contentType = detectImageContentType(image)
      if (contentType == null) return textResponse('Unsupported Media Type', 415)

      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers: imageHeaders(contentType, image.length) })
      }
      return new Response(new Uint8Array(image), {
        status: 200,
        headers: imageHeaders(contentType, image.length),
      })
    } catch {
      // Snapshot plaintext, filesystem paths, and crypto errors must never reach logs or Renderer.
      return textResponse('Internal Error', 500)
    }
  }
}

export function registerSnapshotProtocol(): void {
  const repository = new ApplicationSnapshotRepository(getDatabase())
  const vault = new SnapshotVault({
    rootDirectory: join(app.getPath('userData'), 'snapshot-vault', 'blobs'),
    keyProvider: new SnapshotVaultKeyProvider(),
  })
  const handler = createSnapshotProtocolHandler({
    authorizePreview: (snapshotId, token) =>
      getSnapshotPreviewCapabilityService().authorize(snapshotId, token),
    resolvePreview(snapshotId) {
      const snapshot = repository.get(snapshotId)
      if (snapshot == null || snapshot.deleted_at != null) return null
      const blob = repository.getPreviewBlob(snapshotId)
      if (blob == null) return null
      return {
        blobId: blob.id,
        kind: blob.kind,
        storageKey: blob.storage_key,
        byteLength: blob.byte_length,
        plaintextSha256: blob.plaintext_sha256,
        cipherSha256: blob.cipher_sha256,
      }
    },
    readPreview: (record) => vault.readBlob(record),
  })

  protocol.handle(SNAPSHOT_SCHEME, handler)
  log.info('spark-snapshot:// protocol registered')
}

function parsePreviewRequest(rawUrl: string): { snapshotId: string; token: string } | null {
  try {
    const url = new URL(rawUrl)
    if (
      url.protocol !== `${SNAPSHOT_SCHEME}:` ||
      url.hostname !== 'snapshot' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      url.hash !== ''
    ) {
      return null
    }
    const match = url.pathname.match(/^\/([^/]+)\/preview$/)
    if (match == null) return null
    const encodedSnapshotId = match[1]
    if (encodedSnapshotId == null) return null
    const snapshotId = decodeURIComponent(encodedSnapshotId)
    validateSnapshotId(snapshotId)
    if ([...url.searchParams.keys()].some((key) => key !== 'cap')) return null
    const tokens = url.searchParams.getAll('cap')
    if (tokens.length !== 1 || tokens[0] == null) return null
    const token = tokens[0]
    if (snapshotPreviewUrl(snapshotId, token) !== url.toString()) return null
    return { snapshotId, token }
  } catch {
    return null
  }
}

function validateSnapshotId(snapshotId: string): void {
  if (
    snapshotId.length < 1 ||
    snapshotId.length > 200 ||
    snapshotId.trim() !== snapshotId ||
    containsControlCharacters(snapshotId)
  ) {
    throw new Error('Invalid snapshot ID')
  }
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true
  }
  return false
}

function detectImageContentType(bytes: Buffer): string | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (bytes.length >= 6) {
    const signature = bytes.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  return null
}

function imageHeaders(contentType: string, contentLength: number): Record<string, string> {
  return {
    ...BASE_RESPONSE_HEADERS,
    'content-length': String(contentLength),
    'content-type': contentType,
  }
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { ...BASE_RESPONSE_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
  })
}
