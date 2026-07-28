/* eslint-disable @typescript-eslint/no-non-null-assertion -- registered handlers are the test subject */
import type { ApplicationSnapshotCapabilities, ApplicationSnapshotRef } from '@spark/protocol'
import type { ApplicationSnapshotRow, SnapshotBlobRow } from '@spark/storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: any, event: any) => Promise<any>>(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: any, event: any) => Promise<any>) => {
    harness.handlers.set(channel, handler)
  },
}))

vi.mock('../db.js', () => ({ getDatabase: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/spark-test') } }))

import { registerApplicationSnapshotIpc } from './registerApplicationSnapshotIpc.js'

const ROW: ApplicationSnapshotRow = {
  id: 'snapshot-1',
  session_id: 'session-1',
  turn_id: 'turn-1',
  computer_session_id: null,
  kind: 'user_context',
  app_id: 'app-1',
  app_name: 'Test App',
  window_id: 'window-1',
  window_title: 'Ready',
  bounds_json: JSON.stringify({ x: 10, y: 20, width: 800, height: 600 }),
  display_json: JSON.stringify({ id: 'display-1', width: 1512, height: 982, scaleFactor: 2 }),
  image_blob_id: 'blob-image',
  text_blob_id: null,
  preview_blob_id: 'blob-preview',
  image_sha256: 'a'.repeat(64),
  perceptual_hash: null,
  tree_version: null,
  accessible_text_mode: 'visible_only',
  redaction_json: JSON.stringify({
    applied: true,
    reasonCodes: ['secure_text_field'],
    regionCount: 1,
  }),
  retention_mode: 'session',
  expires_at: null,
  created_at: '2026-07-28T05:00:00.000Z',
  deleted_at: null,
}

const REF: ApplicationSnapshotRef = {
  id: ROW.id,
  kind: ROW.kind,
  sessionId: ROW.session_id,
  turnId: ROW.turn_id,
  computerSessionId: ROW.computer_session_id,
  app: { id: ROW.app_id, name: ROW.app_name },
  window: {
    id: ROW.window_id,
    title: ROW.window_title,
    bounds: { x: 10, y: 20, width: 800, height: 600 },
  },
  display: { id: 'display-1', width: 1512, height: 982, scaleFactor: 2 },
  capturedAt: ROW.created_at,
  previewUrl: `spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`,
  accessibleTextMode: ROW.accessible_text_mode,
  redaction: { applied: true, reasonCodes: ['secure_text_field'], regionCount: 1 },
  imageSha256: ROW.image_sha256,
}

const BLOB: SnapshotBlobRow = {
  id: 'blob-preview',
  kind: 'preview',
  storage_key: `${'a'.repeat(48)}.svb`,
  byte_length: 100,
  plaintext_sha256: 'b'.repeat(64),
  cipher_sha256: 'c'.repeat(64),
  ref_count: 0,
  created_at: ROW.created_at,
}

function createRepository() {
  return {
    get: vi.fn((id: string) => (id === ROW.id ? ROW : null)),
    listBySession: vi.fn((sessionId: string) => (sessionId === ROW.session_id ? [ROW] : [])),
    delete: vi.fn((id: string) => (id === ROW.id ? [BLOB] : [])),
    updateRetention: vi.fn((id: string, retention: any) =>
      id === ROW.id
        ? {
            ...ROW,
            retention_mode: retention.mode,
            expires_at: retention.expiresAt,
          }
        : null,
    ),
    deleteBlobRecordIfUnreferenced: vi.fn(() => BLOB),
  }
}

function createServices() {
  return {
    backend: {
      getCapabilities: vi.fn(async () => ({
        available: false,
        platform: 'macos' as const,
        nativeHost: null,
        permissions: {
          screen: 'unsupported' as const,
          accessibility: 'unsupported' as const,
          input: 'unsupported' as const,
        },
        unavailableReason: 'trusted_native_host_missing',
      })),
    },
  }
}

function register(
  options: {
    repository?: ReturnType<typeof createRepository>
    services?: ReturnType<typeof createServices>
    capture?: {
      getCapabilities(): Promise<ApplicationSnapshotCapabilities>
      requestPermissions(
        permissions: Array<'screen' | 'accessibility'>,
      ): Promise<ApplicationSnapshotCapabilities>
      captureFrontmost(request: unknown): Promise<ApplicationSnapshotRef>
    }
    createCapture?: () => {
      getCapabilities(): Promise<ApplicationSnapshotCapabilities>
      requestPermissions(
        permissions: Array<'screen' | 'accessibility'>,
      ): Promise<ApplicationSnapshotCapabilities>
      captureFrontmost(request: unknown): Promise<ApplicationSnapshotRef>
    }
    vault?: { deleteBlob(storageKey: string): Promise<boolean> }
    previewCapabilities?: {
      issue(input: { snapshotId: string; sessionId: string | null; turnId: string | null }): {
        token: string
        previewUrl: string
        expiresAt: string
      }
      revokeSnapshot(snapshotId: string): void
    }
    authorizeRenderer?: (event: unknown) => boolean
  } = {},
) {
  const repository = options.repository ?? createRepository()
  const services = options.services ?? createServices()
  const vault = options.vault ?? { deleteBlob: vi.fn(async () => true) }
  const previewCapabilities = options.previewCapabilities ?? {
    issue: vi.fn(() => ({
      token: 'a'.repeat(43),
      previewUrl: `spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`,
      expiresAt: '2026-07-28T05:05:00.000Z',
    })),
    revokeSnapshot: vi.fn(),
  }
  registerApplicationSnapshotIpc({
    repository,
    vault,
    getServices: () => services as any,
    previewCapabilities,
    authorizeRenderer: options.authorizeRenderer ?? (() => true),
    ...(options.capture == null ? {} : { capture: options.capture }),
    ...(options.createCapture == null ? {} : { createCapture: options.createCapture }),
  })
  return { repository, services, vault, previewCapabilities }
}

describe('registerApplicationSnapshotIpc', () => {
  beforeEach(() => harness.handlers.clear())

  it('registers the complete application snapshot IPC contract', () => {
    register()

    expect([...harness.handlers.keys()].sort()).toEqual(
      [
        'app-snapshot:get-capabilities',
        'app-snapshot:request-permissions',
        'app-snapshot:capture-frontmost',
        'app-snapshot:get',
        'app-snapshot:list-for-session',
        'app-snapshot:delete',
        'app-snapshot:update-retention',
      ].sort(),
    )
  })

  it('reports capture unavailable when no trusted capture service is installed', async () => {
    register()

    await expect(harness.handlers.get('app-snapshot:get-capabilities')!({}, {})).resolves.toEqual({
      available: false,
      platform: 'macos',
      permissions: { screen: 'unsupported', accessibility: 'unsupported' },
      supportsAppExposedText: false,
      unavailableReason: 'trusted_native_host_missing',
    })
    await expect(
      harness.handlers.get('app-snapshot:capture-frontmost')!(
        { sessionId: null, turnId: null, accessibleTextMode: 'visible_only' },
        {},
      ),
    ).rejects.toMatchObject({ code: 'native_host_missing' })
  })

  it('rejects snapshot access from an untrusted renderer before touching capture or storage', async () => {
    const capture = {
      getCapabilities: vi.fn(),
      requestPermissions: vi.fn(),
      captureFrontmost: vi.fn(),
    }
    const { repository } = register({ capture, authorizeRenderer: () => false })

    await expect(
      harness.handlers.get('app-snapshot:capture-frontmost')!(
        { sessionId: 'session-1', turnId: 'turn-1', accessibleTextMode: 'visible_only' },
        { sender: { id: 999 } },
      ),
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
    expect(capture.captureFrontmost).not.toHaveBeenCalled()
    expect(repository.get).not.toHaveBeenCalled()
  })

  it('delegates permission and capture only to an installed production capture service', async () => {
    const capabilities: ApplicationSnapshotCapabilities = {
      available: true,
      platform: 'macos',
      permissions: { screen: 'granted', accessibility: 'granted' },
      supportsAppExposedText: true,
    }
    const capture = {
      getCapabilities: vi.fn(async () => capabilities),
      requestPermissions: vi.fn(async () => capabilities),
      captureFrontmost: vi.fn(async () => REF),
    }
    register({ capture })

    await expect(
      harness.handlers.get('app-snapshot:request-permissions')!(
        { permissions: ['screen', 'accessibility'] },
        {},
      ),
    ).resolves.toEqual(capabilities)
    await expect(
      harness.handlers.get('app-snapshot:capture-frontmost')!(
        { sessionId: 'session-1', turnId: 'turn-1', accessibleTextMode: 'visible_only' },
        {},
      ),
    ).resolves.toEqual({ snapshot: REF })
  })

  it('constructs the production capture service from the trusted backend by default', async () => {
    const capabilities: ApplicationSnapshotCapabilities = {
      available: true,
      platform: 'macos',
      permissions: { screen: 'granted', accessibility: 'not_determined' },
      supportsAppExposedText: false,
    }
    const capture = {
      getCapabilities: vi.fn(async () => capabilities),
      requestPermissions: vi.fn(async () => capabilities),
      captureFrontmost: vi.fn(async () => REF),
    }
    const createCapture = vi.fn(() => capture)
    register({ createCapture })

    await expect(
      harness.handlers.get('app-snapshot:capture-frontmost')!(
        { sessionId: 'session-1', turnId: 'turn-1', accessibleTextMode: 'visible_only' },
        {},
      ),
    ).resolves.toEqual({ snapshot: REF })
    expect(createCapture).toHaveBeenCalledTimes(1)
  })

  it('maps stored metadata to authenticated preview references', async () => {
    const { previewCapabilities } = register()

    await expect(harness.handlers.get('app-snapshot:get')!({ id: ROW.id }, {})).resolves.toEqual({
      snapshot: REF,
    })
    await expect(
      harness.handlers.get('app-snapshot:list-for-session')!({ sessionId: ROW.session_id }, {}),
    ).resolves.toEqual({ snapshots: [REF] })
    expect(previewCapabilities.issue).toHaveBeenCalledWith({
      snapshotId: ROW.id,
      sessionId: ROW.session_id,
      turnId: ROW.turn_id,
    })
  })

  it('fails closed when persisted snapshot metadata does not satisfy the protocol', async () => {
    const repository = createRepository()
    repository.get.mockReturnValue({ ...ROW, bounds_json: '{"width":0}' })
    register({ repository })

    await expect(
      harness.handlers.get('app-snapshot:get')!({ id: ROW.id }, {}),
    ).rejects.toMatchObject({ code: 'native_host_incompatible' })
  })

  it('claims zero-reference records before deleting encrypted blobs', async () => {
    const order: string[] = []
    const repository = createRepository()
    repository.deleteBlobRecordIfUnreferenced.mockImplementation(() => {
      order.push('record')
      return BLOB
    })
    const vault = {
      deleteBlob: vi.fn(async () => {
        order.push('file')
        return true
      }),
    }
    const { previewCapabilities } = register({ repository, vault })

    await expect(harness.handlers.get('app-snapshot:delete')!({ id: ROW.id }, {})).resolves.toEqual(
      { deleted: true },
    )
    expect(order).toEqual(['record', 'file'])
    expect(previewCapabilities.revokeSnapshot).toHaveBeenCalledWith(ROW.id)
  })

  it('validates and returns retention updates as snapshot references', async () => {
    register()
    const expiresAt = '2026-08-01T05:00:00.000Z'

    await expect(
      harness.handlers.get('app-snapshot:update-retention')!(
        { id: ROW.id, retention: { mode: 'ttl', expiresAt } },
        {},
      ),
    ).resolves.toEqual({ snapshot: REF })
  })
})
