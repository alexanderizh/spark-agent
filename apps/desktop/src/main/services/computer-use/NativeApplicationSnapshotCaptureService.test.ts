import { createHash } from 'node:crypto'
import type {
  ComputerUseCapabilitySummary,
  NativeHostCapabilityManifest,
  NativeWindowDescriptor,
} from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  NativeApplicationSnapshotCaptureService,
  type NativeSnapshotCaptureBackend,
  type SnapshotCaptureVault,
} from './NativeApplicationSnapshotCaptureService.js'

const PNG = Buffer.from('trusted-png')
const PREVIEW = Buffer.from('trusted-preview')

describe('NativeApplicationSnapshotCaptureService', () => {
  it('captures the single focused window and atomically registers encrypted image evidence', async () => {
    const backend = createBackend()
    const repository = { createWithBlobs: vi.fn((input) => input) }
    const vault = createVault()
    const capture = new NativeApplicationSnapshotCaptureService({
      backend,
      repository,
      vault,
      imageProcessor: {
        inspectAndCreatePreview: () => ({ width: 1, height: 1, preview: PREVIEW }),
      },
      createId: sequenceIds(['snapshot-1', 'snapshot-image-1', 'snapshot-preview-1']),
      now: () => new Date('2026-07-28T07:00:00.000Z'),
      previewCapabilities: {
        issue: vi.fn(() => ({
          token: 'a'.repeat(43),
          previewUrl: `spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`,
          expiresAt: '2026-07-28T07:05:00.000Z',
        })),
      },
    })

    const result = await capture.captureFrontmost({
      sessionId: 'session-1',
      turnId: 'turn-1',
      accessibleTextMode: 'visible_only',
    })

    expect(backend.captureWindow).toHaveBeenCalledWith({
      snapshotId: 'snapshot-1',
      windowId: 'window-1',
    })
    expect(vault.writeManyRegistered).toHaveBeenCalledTimes(1)
    expect(repository.createWithBlobs).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          id: 'snapshot-1',
          imageBlobId: 'snapshot-image-1',
          previewBlobId: 'snapshot-preview-1',
          retention: { mode: 'session', expiresAt: null },
        }),
      }),
    )
    expect(result).toMatchObject({
      id: 'snapshot-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      app: { id: 'com.spark.Editor', name: 'Editor' },
      window: { id: 'window-1', title: 'Project' },
      previewUrl: `spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`,
      accessibleTextMode: 'visible_only',
      imageSha256: sha256(PNG),
    })
  })

  it('fails closed when app-exposed text was requested without an AX observation backend', async () => {
    const backend = createBackend()
    const capture = new NativeApplicationSnapshotCaptureService({
      backend,
      repository: { createWithBlobs: vi.fn() },
      vault: createVault(),
      imageProcessor: {
        inspectAndCreatePreview: () => ({ width: 1, height: 1, preview: PREVIEW }),
      },
    })

    await expect(
      capture.captureFrontmost({
        sessionId: null,
        turnId: null,
        accessibleTextMode: 'app_exposed',
      }),
    ).rejects.toMatchObject({ code: 'environment_unavailable' })
    expect(backend.captureWindow).not.toHaveBeenCalled()
  })

  it('rejects ambiguous native focus instead of guessing which application to capture', async () => {
    const backend = createBackend([
      WINDOW,
      { ...WINDOW, window: { ...WINDOW.window, id: 'window-2' } },
    ])
    const capture = new NativeApplicationSnapshotCaptureService({
      backend,
      repository: { createWithBlobs: vi.fn() },
      vault: createVault(),
      imageProcessor: {
        inspectAndCreatePreview: () => ({ width: 1, height: 1, preview: PREVIEW }),
      },
    })

    await expect(
      capture.captureFrontmost({
        sessionId: null,
        turnId: null,
        accessibleTextMode: 'visible_only',
      }),
    ).rejects.toMatchObject({ code: 'native_host_incompatible' })
  })

  it('blocks credential and system-authentication applications before capture', async () => {
    const backend = createBackend([
      {
        ...WINDOW,
        app: {
          ...WINDOW.app,
          id: 'com.apple.SecurityAgent',
          bundleId: 'com.apple.SecurityAgent',
          name: 'SecurityAgent',
        },
      },
    ])
    const capture = new NativeApplicationSnapshotCaptureService({
      backend,
      repository: { createWithBlobs: vi.fn() },
      vault: createVault(),
      imageProcessor: {
        inspectAndCreatePreview: () => ({ width: 1, height: 1, preview: PREVIEW }),
      },
    })

    await expect(
      capture.captureFrontmost({
        sessionId: 'session-1',
        turnId: 'turn-1',
        accessibleTextMode: 'visible_only',
      }),
    ).rejects.toMatchObject({ code: 'sensitive_input_blocked' })
    expect(backend.captureWindow).not.toHaveBeenCalled()
  })

  it('rejects focus or process identity drift between listing and completed capture', async () => {
    const backend = createBackend()
    vi.mocked(backend.listWindows)
      .mockResolvedValueOnce([WINDOW])
      .mockResolvedValueOnce([
        {
          ...WINDOW,
          app: { ...WINDOW.app, processId: 99 },
        },
      ])
    const repository = { createWithBlobs: vi.fn() }
    const capture = new NativeApplicationSnapshotCaptureService({
      backend,
      repository,
      vault: createVault(),
      imageProcessor: {
        inspectAndCreatePreview: () => ({ width: 1, height: 1, preview: PREVIEW }),
      },
      createId: sequenceIds(['snapshot-focus', 'image-focus', 'preview-focus']),
    })
    vi.mocked(backend.captureWindow).mockResolvedValueOnce({
      snapshotId: 'snapshot-focus',
      width: 1,
      height: 1,
      payload: { kind: 'image_png', byteLength: PNG.length, sha256: sha256(PNG) },
      bytes: PNG,
    })

    await expect(
      capture.captureFrontmost({
        sessionId: 'session-1',
        turnId: 'turn-1',
        accessibleTextMode: 'visible_only',
      }),
    ).rejects.toMatchObject({ code: 'focus_mismatch' })
    expect(repository.createWithBlobs).not.toHaveBeenCalled()
  })

  it('rejects a decompression-bomb-sized pixel surface before Electron decodes it', async () => {
    const backend = createBackend()
    vi.mocked(backend.captureWindow).mockResolvedValueOnce({
      snapshotId: 'snapshot-bomb',
      width: 16_384,
      height: 16_384,
      payload: { kind: 'image_png', byteLength: PNG.length, sha256: sha256(PNG) },
      bytes: PNG,
    })
    const inspectAndCreatePreview = vi.fn(() => ({
      width: 16_384,
      height: 16_384,
      preview: PREVIEW,
    }))
    const capture = new NativeApplicationSnapshotCaptureService({
      backend,
      repository: { createWithBlobs: vi.fn() },
      vault: createVault(),
      imageProcessor: { inspectAndCreatePreview },
      createId: sequenceIds(['snapshot-bomb', 'image-bomb', 'preview-bomb']),
    })

    await expect(
      capture.captureFrontmost({
        sessionId: null,
        turnId: null,
        accessibleTextMode: 'visible_only',
      }),
    ).rejects.toMatchObject({ code: 'native_host_incompatible' })
    expect(inspectAndCreatePreview).not.toHaveBeenCalled()
  })
})

function createBackend(
  windows: NativeWindowDescriptor[] = [WINDOW],
): NativeSnapshotCaptureBackend & {
  captureWindow: ReturnType<typeof vi.fn>
  listWindows: ReturnType<typeof vi.fn>
} {
  const captureWindow = vi.fn(async () => ({
    snapshotId: 'snapshot-1',
    width: 1,
    height: 1,
    payload: { kind: 'image_png' as const, byteLength: PNG.length, sha256: sha256(PNG) },
    bytes: PNG,
  }))
  return {
    getCapabilities: async (): Promise<ComputerUseCapabilitySummary> => ({
      available: true,
      platform: 'macos',
      nativeHost: MANIFEST,
      permissions: MANIFEST.permissions,
    }),
    requestPermissions: async () => MANIFEST,
    listWindows: vi.fn(async () => windows),
    captureWindow,
  }
}

function createVault(): SnapshotCaptureVault & { writeManyRegistered: ReturnType<typeof vi.fn> } {
  const writeManyRegistered = vi.fn(
    async <T>(
      inputs: Array<{ blobId: string; kind: 'image' | 'preview'; plaintext: Uint8Array }>,
      register: (records: Array<Record<string, unknown>>) => T,
    ) =>
      register(
        inputs.map((input) => ({
          blobId: input.blobId,
          kind: input.kind,
          storageKey: `${input.blobId}.svb`,
          byteLength: input.plaintext.byteLength + 36,
          plaintextSha256: sha256(input.plaintext),
          cipherSha256: 'c'.repeat(64),
        })),
      ),
  )
  return { writeManyRegistered } as unknown as SnapshotCaptureVault & {
    writeManyRegistered: ReturnType<typeof vi.fn>
  }
}

function sequenceIds(values: string[]): () => string {
  return () => {
    const value = values.shift()
    if (value == null) throw new Error('No fixture ID remains')
    return value
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

const WINDOW: NativeWindowDescriptor = {
  app: {
    id: 'com.spark.Editor',
    name: 'Editor',
    processId: 42,
    bundleId: 'com.spark.Editor',
    executableIdentity: 'com.spark.Editor',
    signingIdentity: 'ABCDE12345',
  },
  window: {
    id: 'window-1',
    title: 'Project',
    bounds: { x: 100, y: 80, width: 800, height: 600 },
  },
  display: { id: 'display-1', width: 1_600, height: 1_200, scaleFactor: 2 },
  focused: true,
  minimized: false,
}

const MANIFEST: NativeHostCapabilityManifest = {
  protocolVersion: 1,
  hostVersion: '0.1.0',
  platform: 'macos',
  architecture: 'arm64',
  backends: {
    screen: 'screen_capture_kit',
    accessibility: 'unavailable',
    input: 'unavailable',
  },
  features: {
    listWindows: true,
    captureWindow: true,
    fullTree: false,
    diffTree: false,
    semanticActions: false,
    absolutePointer: false,
    keyboard: false,
    clipboard: false,
  },
  permissions: { screen: 'granted', accessibility: 'not_determined', input: 'unsupported' },
  limits: {
    maxMessageBytes: 67_108_864,
    maxScreenshotWidth: 16_384,
    maxScreenshotHeight: 16_384,
    maxTreeElements: 100_000,
  },
}
