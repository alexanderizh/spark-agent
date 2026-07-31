import type {
  ComputerActionEnvelope,
  ComputerObservation,
  NativeHostCapabilityManifest,
  NativeWindowDescriptor,
} from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import { ComputerUseMetricsCollector } from './ComputerUseMetricsCollector.js'
import {
  NativeHostComputerUseBackend,
  type NativeHostConnection,
} from './NativeHostComputerUseBackend.js'

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
  permissions: {
    screen: 'granted',
    accessibility: 'not_determined',
    input: 'unsupported',
  },
  limits: {
    maxMessageBytes: 67_108_864,
    maxScreenshotWidth: 16_384,
    maxScreenshotHeight: 16_384,
    maxTreeElements: 100_000,
  },
}

const CONTROL_MANIFEST: NativeHostCapabilityManifest = {
  ...MANIFEST,
  platform: 'windows',
  architecture: 'x64',
  backends: {
    screen: 'windows_graphics_capture',
    accessibility: 'uia',
    input: 'send_input',
  },
  features: {
    ...MANIFEST.features,
    fullTree: true,
    diffTree: true,
    semanticActions: true,
    absolutePointer: true,
    keyboard: true,
  },
  permissions: { screen: 'granted', accessibility: 'granted', input: 'granted' },
}

const FOCUSED_WINDOW = {
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
  display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
  focused: true,
  minimized: false,
} satisfies NativeWindowDescriptor

const OBSERVATION: ComputerObservation = {
  frameId: 'frame-1',
  treeVersion: 'tree-1',
  capturedAt: '2026-07-28T08:00:00.000Z',
  display: FOCUSED_WINDOW.display,
  foreground: { app: FOCUSED_WINDOW.app, window: FOCUSED_WINDOW.window },
  screenshot: { snapshotId: 'snapshot-1', width: 800, height: 600 },
  tree: { mode: 'full', text: 'window "Document"', elementCount: 0 },
  elements: [],
  loading: false,
  sensitiveRegions: [],
}

describe('NativeHostComputerUseBackend', () => {
  it('connects once and exposes only the capabilities proven by the host handshake', async () => {
    const connection = createConnection()
    const connect = vi.fn(async () => connection)
    const backend = new NativeHostComputerUseBackend({ platform: 'macos', connect })

    await expect(
      Promise.all([backend.getCapabilities(), backend.getCapabilities()]),
    ).resolves.toEqual([
      {
        available: true,
        platform: 'macos',
        nativeHost: MANIFEST,
        permissions: MANIFEST.permissions,
      },
      {
        available: true,
        platform: 'macos',
        nativeHost: MANIFEST,
        permissions: MANIFEST.permissions,
      },
    ])
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('records content-free capability latency dimensions', async () => {
    const metrics = new ComputerUseMetricsCollector()
    const backend = new NativeHostComputerUseBackend({
      platform: 'macos',
      connect: async () => createConnection(),
      metrics,
      metricDimensions: () => ({
        platform: 'macos',
        architecture: 'arm64',
        appVersion: '0.8.14',
        hostVersion: '0.1.0',
        trustMode: 'signed',
      }),
    })

    await backend.getCapabilities()

    expect(metrics.snapshot()).toEqual([
      expect.objectContaining({
        name: 'native_host_capability_ms',
        count: 1,
        failures: 0,
        dimensions: expect.objectContaining({ appVersion: '0.8.14', trustMode: 'signed' }),
      }),
    ])
  })

  it('preserves exact trust diagnostics separately from handshake failures', async () => {
    const diagnostic = {
      diagnosticCode: 'artifact_digest_mismatch',
      stage: 'verify' as const,
      repairAction: 'reinstall',
    }
    const backend = new NativeHostComputerUseBackend({
      platform: 'macos',
      connect: async () => {
        throw new ComputerUseBrokerError('native_host_untrusted', 'digest mismatch', undefined, {
          diagnostic,
        })
      },
    })

    await expect(backend.diagnoseNativeHost()).resolves.toMatchObject({
      diagnostic,
      errorCode: 'native_host_untrusted',
      message: 'digest mismatch',
    })
  })

  it('reports a missing or untrusted host honestly and keeps control unavailable', async () => {
    const backend = new NativeHostComputerUseBackend({
      platform: 'macos',
      connect: async () => {
        throw new ComputerUseBrokerError('native_host_untrusted', 'invalid signature')
      },
    })

    await expect(backend.getCapabilities()).resolves.toEqual({
      available: false,
      platform: 'macos',
      nativeHost: null,
      permissions: { screen: 'unsupported', accessibility: 'unsupported', input: 'unsupported' },
      unavailableReason: 'native_host_untrusted',
    })
    await expect(backend.listWindows()).rejects.toMatchObject({ code: 'native_host_untrusted' })
  })

  it('uses the strict host window inventory and closes the child during disposal', async () => {
    const windows = [{ window: { id: 'window-1' } }] as NativeWindowDescriptor[]
    const connection = createConnection(windows)
    const backend = new NativeHostComputerUseBackend({
      platform: 'macos',
      connect: async () => connection,
    })

    await expect(backend.listWindows()).resolves.toBe(windows)
    await backend.dispose()

    expect(connection.close).toHaveBeenCalledTimes(1)
  })

  it('transparently retries idempotent listWindows when the Host reports a recoverable failure', async () => {
    const windows = [{ window: { id: 'window-1' } }] as NativeWindowDescriptor[]
    const connection = createConnection(windows)
    let attempts = 0
    vi.mocked(connection.listWindows).mockImplementation(async () => {
      attempts += 1
      if (attempts === 1) {
        throw new ComputerUseBrokerError(
          'native_host_incompatible',
          'transient host hiccup',
          undefined,
          { retryable: true },
        )
      }
      return windows
    })
    const backend = new NativeHostComputerUseBackend({
      platform: 'macos',
      connect: async () => connection,
    })

    await expect(backend.listWindows()).resolves.toBe(windows)
    expect(attempts).toBe(2)
  })

  it('does not retry a non-retryable failure', async () => {
    const connection = createConnection()
    let attempts = 0
    vi.mocked(connection.listWindows).mockImplementation(async () => {
      attempts += 1
      throw new ComputerUseBrokerError('native_host_incompatible', 'hard failure')
    })
    const backend = new NativeHostComputerUseBackend({
      platform: 'macos',
      connect: async () => connection,
    })

    await expect(backend.listWindows()).rejects.toMatchObject({
      code: 'native_host_incompatible',
    })
    expect(attempts).toBe(1)
  })

  it('shares the trusted connection for permission refresh and digest-verified captures', async () => {
    const connection = createConnection()
    const backend = new NativeHostComputerUseBackend({
      platform: 'macos',
      connect: async () => connection,
    })

    await expect(backend.requestPermissions(['screen'])).resolves.toBe(MANIFEST)
    await expect(
      backend.captureWindow({ snapshotId: 'snapshot-1', windowId: 'window-1' }),
    ).resolves.toMatchObject({ bytes: Buffer.from('png') })
  })

  it('does not advertise or emulate observation and input features absent from the manifest', async () => {
    const backend = new NativeHostComputerUseBackend({
      platform: 'macos',
      connect: async () => createConnection(),
    })

    await expect(
      backend.observe({
        computerSessionId: 'computer-1',
        fullTree: false,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'environment_unavailable' })
  })

  it('persists a trusted focused-window observation before exposing it to the broker', async () => {
    const connection = createControlConnection()
    const evidenceSink = { persist: vi.fn(async () => undefined) }
    const backend = new NativeHostComputerUseBackend({
      platform: 'windows',
      connect: async () => connection,
      evidenceSink,
      createId: () => 'snapshot-1',
    })

    await expect(
      backend.observe({
        computerSessionId: 'computer-1',
        fullTree: false,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(OBSERVATION)

    expect(connection.observe).toHaveBeenCalledWith({
      snapshotId: 'snapshot-1',
      appId: 'app-1',
      windowId: 'window-1',
      previousTreeVersion: null,
      fullTree: true,
      signal: expect.any(AbortSignal),
    })
    expect(evidenceSink.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        computerSessionId: 'computer-1',
        kind: 'execution_before',
        observation: OBSERVATION,
        bytes: Buffer.from('png'),
      }),
    )
  })

  it('continues observation when an Electron app replaces its focused window', async () => {
    const replacementWindow = {
      ...FOCUSED_WINDOW,
      window: { ...FOCUSED_WINDOW.window, id: 'window-2', title: 'Search overlay' },
    }
    const replacementObservation = {
      ...OBSERVATION,
      frameId: 'frame-2',
      treeVersion: 'tree-2',
      foreground: { app: FOCUSED_WINDOW.app, window: replacementWindow.window },
      screenshot: { ...OBSERVATION.screenshot, snapshotId: 'snapshot-2' },
    }
    const connection = createControlConnection([OBSERVATION, replacementObservation])
    vi.mocked(connection.listWindows)
      .mockResolvedValueOnce([FOCUSED_WINDOW])
      .mockResolvedValueOnce([replacementWindow])
    const ids = ['snapshot-1', 'snapshot-2']
    const backend = new NativeHostComputerUseBackend({
      platform: 'macos',
      connect: async () => connection,
      evidenceSink: { persist: vi.fn(async () => undefined) },
      createId: () => ids.shift() ?? 'unexpected',
    })
    const signal = new AbortController().signal

    await expect(
      backend.observe({ computerSessionId: 'computer-1', fullTree: true, signal }),
    ).resolves.toEqual(OBSERVATION)
    await expect(
      backend.observe({ computerSessionId: 'computer-1', fullTree: false, signal }),
    ).resolves.toEqual(replacementObservation)

    expect(connection.observe).toHaveBeenLastCalledWith({
      snapshotId: 'snapshot-2',
      appId: 'app-1',
      windowId: 'window-2',
      previousTreeVersion: 'tree-1',
      fullTree: false,
      signal,
    })
  })

  it('executes through the native host and captures a post-action diff observation', async () => {
    const after = {
      ...OBSERVATION,
      frameId: 'frame-2',
      treeVersion: 'tree-2',
      screenshot: { ...OBSERVATION.screenshot, snapshotId: 'snapshot-2' },
      tree: { ...OBSERVATION.tree, mode: 'diff' as const, text: '+ button "Saved"' },
    }
    const connection = createControlConnection([OBSERVATION, after])
    const evidenceSink = { persist: vi.fn(async () => undefined) }
    const ids = ['snapshot-1', 'snapshot-2']
    const backend = new NativeHostComputerUseBackend({
      platform: 'windows',
      connect: async () => connection,
      evidenceSink,
      createId: () => ids.shift() ?? 'unexpected',
    })
    const signal = new AbortController().signal
    await backend.observe({ computerSessionId: 'computer-1', fullTree: true, signal })
    const envelope = {
      computerSessionId: 'computer-1',
      actionId: 'action-1',
      targetAppId: 'app-1',
      targetWindowId: 'window-1',
      action: { type: 'click', point: { x: 0.5, y: 0.5 } },
    } as ComputerActionEnvelope

    await expect(backend.execute({ envelope, observation: OBSERVATION, signal })).resolves.toEqual({
      observation: after,
      noop: false,
    })
    expect(connection.executeAction).toHaveBeenCalledWith(envelope, signal)
    expect(connection.observe).toHaveBeenLastCalledWith({
      snapshotId: 'snapshot-2',
      appId: 'app-1',
      windowId: 'window-1',
      previousTreeVersion: 'tree-1',
      fullTree: false,
      signal,
    })
    expect(evidenceSink.persist).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'execution_after', observation: after }),
    )
  })

  it('trusts an executed Host action even when its immediate visual evidence is unchanged', async () => {
    const unchanged = {
      ...OBSERVATION,
      frameId: 'frame-2',
      treeVersion: 'tree-2',
      screenshot: { ...OBSERVATION.screenshot, snapshotId: 'snapshot-2' },
      tree: {
        ...OBSERVATION.tree,
        mode: 'diff' as const,
        text: '{"changed":[],"removed":[]}',
      },
      elements: OBSERVATION.elements.map((element) => ({
        ...element,
        treeVersion: 'tree-2',
      })),
    }
    const connection = createControlConnection(
      [OBSERVATION, unchanged],
      ['a'.repeat(64), 'a'.repeat(64)],
    )
    const ids = ['snapshot-1', 'snapshot-2']
    const backend = new NativeHostComputerUseBackend({
      platform: 'macos',
      connect: async () => connection,
      evidenceSink: { persist: vi.fn(async () => undefined) },
      createId: () => ids.shift() ?? 'unexpected',
    })
    const signal = new AbortController().signal
    await backend.observe({ computerSessionId: 'computer-1', fullTree: true, signal })
    const envelope = {
      computerSessionId: 'computer-1',
      actionId: 'action-1',
      targetAppId: 'app-1',
      targetWindowId: 'window-1',
      action: { type: 'keypress', keys: ['META', 'S'] },
    } as ComputerActionEnvelope

    await expect(backend.execute({ envelope, observation: OBSERVATION, signal })).resolves.toEqual({
      observation: unchanged,
      noop: false,
    })
  })

  it('does not classify a successful wait condition as noop merely because the frame is unchanged', async () => {
    const unchanged = {
      ...OBSERVATION,
      frameId: 'frame-2',
      treeVersion: 'tree-2',
      screenshot: { ...OBSERVATION.screenshot, snapshotId: 'snapshot-2' },
    }
    const connection = createControlConnection(
      [OBSERVATION, unchanged],
      ['a'.repeat(64), 'a'.repeat(64)],
    )
    const ids = ['snapshot-1', 'snapshot-2']
    const backend = new NativeHostComputerUseBackend({
      platform: 'windows',
      connect: async () => connection,
      evidenceSink: { persist: vi.fn(async () => undefined) },
      createId: () => ids.shift() ?? 'unexpected',
    })
    const signal = new AbortController().signal
    await backend.observe({ computerSessionId: 'computer-1', fullTree: true, signal })
    const envelope = {
      computerSessionId: 'computer-1',
      actionId: 'action-1',
      targetAppId: 'app-1',
      targetWindowId: 'window-1',
      action: { type: 'wait_for', condition: { kind: 'loading_stopped' }, timeoutMs: 1_000 },
    } as ComputerActionEnvelope

    await expect(
      backend.execute({ envelope, observation: OBSERVATION, signal }),
    ).resolves.toMatchObject({
      noop: false,
    })
  })

  it('allows semantic UI actions when accessibility is available without CGEvent or SendInput', async () => {
    const semanticManifest: NativeHostCapabilityManifest = {
      ...CONTROL_MANIFEST,
      backends: { ...CONTROL_MANIFEST.backends, input: 'unavailable' },
      features: {
        ...CONTROL_MANIFEST.features,
        absolutePointer: false,
        keyboard: false,
      },
      permissions: { ...CONTROL_MANIFEST.permissions, input: 'denied' },
    }
    const connection = createControlConnection([
      OBSERVATION,
      { ...OBSERVATION, frameId: 'frame-2' },
    ])
    vi.mocked(connection.getCapabilities).mockResolvedValue(semanticManifest)
    const backend = new NativeHostComputerUseBackend({
      platform: 'macos',
      connect: async () => connection,
      evidenceSink: { persist: vi.fn(async () => undefined) },
      createId: () => 'snapshot-1',
    })
    const signal = new AbortController().signal
    await backend.observe({ computerSessionId: 'computer-1', fullTree: true, signal })
    const envelope = {
      computerSessionId: 'computer-1',
      actionId: 'action-1',
      targetAppId: 'app-1',
      targetWindowId: 'window-1',
      action: { type: 'invoke_element', elementId: 'save-button', action: 'invoke' },
    } as ComputerActionEnvelope

    await expect(
      backend.execute({ envelope, observation: OBSERVATION, signal }),
    ).resolves.toBeDefined()
  })

  it('does not let dynamic PNG fingerprints interrupt an executed Host action', async () => {
    const changedMetadata = {
      ...OBSERVATION,
      frameId: 'frame-2',
      treeVersion: 'tree-2',
      screenshot: { ...OBSERVATION.screenshot, snapshotId: 'snapshot-2' },
    }
    const connection = createControlConnection(
      [OBSERVATION, changedMetadata],
      ['a'.repeat(64), 'b'.repeat(64)],
    )
    const ids = ['snapshot-1', 'snapshot-2']
    const backend = new NativeHostComputerUseBackend({
      platform: 'windows',
      connect: async () => connection,
      evidenceSink: {
        persist: vi
          .fn()
          .mockResolvedValueOnce({ visualFingerprint: '0000000000000000' })
          .mockResolvedValueOnce({ visualFingerprint: '0000000000000001' }),
      },
      createId: () => ids.shift() ?? 'unexpected',
    })
    const signal = new AbortController().signal
    await backend.observe({ computerSessionId: 'computer-1', fullTree: true, signal })
    const envelope = {
      computerSessionId: 'computer-1',
      actionId: 'action-1',
      targetAppId: 'app-1',
      targetWindowId: 'window-1',
      action: { type: 'keypress', keys: ['Meta', 'S'] },
    } as ComputerActionEnvelope

    await expect(
      backend.execute({ envelope, observation: OBSERVATION, signal }),
    ).resolves.toMatchObject({
      noop: false,
    })
  })

  it('drops a crashed protocol connection and reconnects on the next bounded operation', async () => {
    const first = createConnection()
    vi.mocked(first.listWindows).mockRejectedValueOnce(
      new ComputerUseBrokerError('native_host_incompatible', 'host crashed'),
    )
    const second = createConnection([])
    const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const backend = new NativeHostComputerUseBackend({ platform: 'macos', connect })

    await expect(backend.listWindows()).rejects.toMatchObject({ code: 'native_host_incompatible' })
    await expect(backend.listWindows()).resolves.toEqual([])

    expect(connect).toHaveBeenCalledTimes(2)
    expect(first.close).toHaveBeenCalledTimes(1)
  })

  it('reconnects the Host after a recoverable execution timeout', async () => {
    const first = createControlConnection([OBSERVATION])
    vi.mocked(first.executeAction).mockRejectedValueOnce(
      new ComputerUseBrokerError('action_timeout', 'Host timed out'),
    )
    const reconnectedObservation = {
      ...OBSERVATION,
      frameId: 'frame-2',
      screenshot: { ...OBSERVATION.screenshot, snapshotId: 'snapshot-2' },
    }
    const second = createControlConnection([reconnectedObservation])
    const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const ids = ['snapshot-1', 'snapshot-2']
    const backend = new NativeHostComputerUseBackend({
      platform: 'macos',
      connect,
      evidenceSink: { persist: vi.fn(async () => undefined) },
      createId: () => ids.shift() ?? 'unexpected',
    })
    const signal = new AbortController().signal
    await backend.observe({ computerSessionId: 'computer-1', fullTree: true, signal })

    await expect(
      backend.execute({
        envelope: {
          computerSessionId: 'computer-1',
          actionId: 'action-1',
          targetAppId: 'app-1',
          targetWindowId: 'window-1',
          action: { type: 'keypress', keys: ['Meta', 'K'] },
        } as ComputerActionEnvelope,
        observation: OBSERVATION,
        signal,
      }),
    ).rejects.toMatchObject({ code: 'action_timeout' })
    await expect(
      backend.observe({ computerSessionId: 'computer-1', fullTree: true, signal }),
    ).resolves.toEqual(reconnectedObservation)
    expect(first.close).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('observes the explicitly bound window instead of following a newly focused window', async () => {
    const boundWindow = { ...FOCUSED_WINDOW, focused: false }
    const otherWindow = {
      ...FOCUSED_WINDOW,
      app: { ...FOCUSED_WINDOW.app, id: 'app-2', name: 'Other' },
      window: { ...FOCUSED_WINDOW.window, id: 'window-2', title: 'Other document' },
      focused: true,
    }
    const connection = createControlConnection([OBSERVATION])
    vi.mocked(connection.listWindows).mockResolvedValue([otherWindow, boundWindow])
    const backend = new NativeHostComputerUseBackend({
      platform: 'windows',
      connect: async () => connection,
      evidenceSink: { persist: vi.fn(async () => undefined) },
      createId: () => 'snapshot-1',
    })
    backend.bindSessionTarget({
      computerSessionId: 'computer-1',
      appId: 'app-1',
      windowId: 'window-1',
    })

    await backend.observe({
      computerSessionId: 'computer-1',
      fullTree: true,
      signal: new AbortController().signal,
    })

    expect(connection.observe).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'app-1', windowId: 'window-1' }),
    )
  })

  it('fails closed when the explicitly bound window disappears', async () => {
    const otherWindow = {
      ...FOCUSED_WINDOW,
      app: { ...FOCUSED_WINDOW.app, id: 'app-2', name: 'Other' },
      window: { ...FOCUSED_WINDOW.window, id: 'window-2', title: 'Other document' },
    }
    const connection = createControlConnection([OBSERVATION])
    vi.mocked(connection.listWindows).mockResolvedValue([otherWindow])
    const backend = new NativeHostComputerUseBackend({
      platform: 'windows',
      connect: async () => connection,
      evidenceSink: { persist: vi.fn(async () => undefined) },
    })
    backend.bindSessionTarget({
      computerSessionId: 'computer-1',
      appId: 'app-1',
      windowId: 'window-1',
    })

    await expect(
      backend.observe({
        computerSessionId: 'computer-1',
        fullTree: true,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'focus_mismatch' })
    expect(connection.observe).not.toHaveBeenCalled()
  })
})

function createConnection(windows: NativeWindowDescriptor[] = []): NativeHostConnection {
  return {
    getCapabilities: vi.fn(async () => MANIFEST),
    listWindows: vi.fn(async () => windows),
    requestPermissions: vi.fn(async () => MANIFEST),
    captureWindow: vi.fn(async () => ({
      snapshotId: 'snapshot-1',
      width: 1,
      height: 1,
      payload: {
        kind: 'image_png' as const,
        byteLength: 3,
        sha256: 'a'.repeat(64),
      },
      bytes: Buffer.from('png'),
    })),
    observe: vi.fn(async () => {
      throw new ComputerUseBrokerError('environment_unavailable', 'observation unavailable')
    }),
    executeAction: vi.fn(async () => {
      throw new ComputerUseBrokerError('environment_unavailable', 'execution unavailable')
    }),
    cancelSession: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
}

function createControlConnection(
  observations: ComputerObservation[] = [OBSERVATION],
  payloadHashes: string[] = observations.map((_, index) => (index === 0 ? 'a' : 'b').repeat(64)),
): NativeHostConnection & {
  observe: ReturnType<typeof vi.fn>
  executeAction: ReturnType<typeof vi.fn>
} {
  const pending = [...observations]
  const pendingPayloadHashes = [...payloadHashes]
  return {
    ...createConnection([FOCUSED_WINDOW]),
    getCapabilities: vi.fn(async () => CONTROL_MANIFEST),
    observe: vi.fn(async () => ({
      response: {
        protocolVersion: 1 as const,
        requestId: 'request-1',
        type: 'observation' as const,
        observation: pending.shift() ?? OBSERVATION,
        payload: {
          kind: 'image_png' as const,
          byteLength: 3,
          sha256: pendingPayloadHashes.shift() ?? 'a'.repeat(64),
        },
      },
      bytes: Buffer.from('png'),
    })),
    executeAction: vi.fn(async () => ({
      protocolVersion: 1 as const,
      requestId: 'request-2',
      type: 'action_result' as const,
      actionId: 'action-1',
      status: 'executed' as const,
    })),
  } as NativeHostConnection & {
    observe: ReturnType<typeof vi.fn>
    executeAction: ReturnType<typeof vi.fn>
  }
}
