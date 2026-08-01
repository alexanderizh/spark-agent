import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type {
  NativeHostCapabilityManifest,
  NativeHostRequest,
  NativeHostResponse,
} from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { VerifiedNativeHostArtifact } from './NativeHostArtifact.js'
import {
  NativeHostClient,
  type NativeHostChildProcess,
  type NativeHostSpawn,
} from './NativeHostClient.js'
import {
  NativeHostFrameDecoder,
  encodeNativeHostFrame,
  encodeNativeHostJsonFrame,
} from './NativeHostFrameCodec.js'

const CAPABILITIES: NativeHostCapabilityManifest = {
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

describe('NativeHostClient', () => {
  it('uses an inherited-pipe-only process and completes a version-bound capability handshake', async () => {
    const process = new FakeNativeHostProcess()
    const requests = observeRequests(process)
    const spawnProcess = vi.fn<NativeHostSpawn>(() => process)
    const connecting = NativeHostClient.connect({ artifact: ARTIFACT, spawnProcess })
    const handshake = requireRequest(await requests.next())
    expect(handshake).toMatchObject({ protocolVersion: 1, type: 'get_capabilities' })
    process.send({
      protocolVersion: 1,
      requestId: handshake.requestId,
      type: 'capabilities',
      manifest: CAPABILITIES,
    })

    const client = await connecting

    await expect(client.getCapabilities()).resolves.toEqual(CAPABILITIES)
    expect(spawnProcess).toHaveBeenCalledWith(
      ARTIFACT.executablePath,
      [],
      expect.objectContaining({ shell: false, stdio: ['pipe', 'pipe', 'pipe'] }),
    )
    expect(spawnProcess.mock.calls[0]?.[2]?.env).toEqual({ LANG: 'C', LC_ALL: 'C' })
    await client.close()
  })

  it('enables unsigned-parent authorization only for a verified local artifact', async () => {
    const process = new FakeNativeHostProcess()
    const requests = observeRequests(process)
    const spawnProcess = vi.fn<NativeHostSpawn>(() => process)
    const connecting = NativeHostClient.connect({
      artifact: { ...ARTIFACT, trustMode: 'local' },
      spawnProcess,
    })
    await completeHandshake(process, requests)
    const client = await connecting

    expect(spawnProcess.mock.calls[0]?.[2]?.env).toEqual({
      LANG: 'C',
      LC_ALL: 'C',
      SPARK_COMPUTER_LOCAL_TRUST: '1',
    })
    await client.close()
  })

  it('preserves bounded Host stderr when the process exits during handshake', async () => {
    const process = new FakeNativeHostProcess()
    const connecting = NativeHostClient.connect({ artifact: ARTIFACT, spawnProcess: () => process })
    process.stderr.write(
      '[spark-computer-host] parent process authorization failed: publisher mismatch',
    )
    process.emit('exit', 77, null)

    await expect(connecting).rejects.toMatchObject({
      code: 'native_host_incompatible',
      message: expect.stringContaining('publisher mismatch'),
    })
  })

  it('keeps a capture response adjacent to its binary frame and verifies the payload digest', async () => {
    const process = new FakeNativeHostProcess()
    const requests = observeRequests(process)
    const connecting = NativeHostClient.connect({ artifact: ARTIFACT, spawnProcess: () => process })
    await completeHandshake(process, requests)
    const client = await connecting
    const capture = client.captureWindow({ snapshotId: 'snapshot-1', windowId: 'window-1' })
    const request = requireRequest(await requests.next())
    const payload = Buffer.from('png-binary-payload')
    process.send(
      {
        protocolVersion: 1,
        requestId: request.requestId,
        type: 'capture_result',
        snapshotId: 'snapshot-1',
        width: 640,
        height: 480,
        payload: {
          kind: 'image_png',
          byteLength: payload.length,
          sha256: createHash('sha256').update(payload).digest('hex'),
        },
      },
      payload,
    )

    await expect(capture).resolves.toMatchObject({ width: 640, height: 480, bytes: payload })
    await client.close()
  })

  it('returns the refreshed manifest after an explicit bounded permission request', async () => {
    const process = new FakeNativeHostProcess()
    const requests = observeRequests(process)
    const connecting = NativeHostClient.connect({ artifact: ARTIFACT, spawnProcess: () => process })
    await completeHandshake(process, requests)
    const client = await connecting
    const requested = client.requestPermissions(['screen'])
    const request = requireRequest(await requests.next())
    expect(request).toMatchObject({ type: 'request_permissions', permissions: ['screen'] })
    const refreshed = {
      ...CAPABILITIES,
      permissions: { ...CAPABILITIES.permissions, screen: 'granted' as const },
    }
    process.send({
      protocolVersion: 1,
      requestId: request.requestId,
      type: 'capabilities',
      manifest: refreshed,
    })

    await expect(requested).resolves.toEqual(refreshed)
    await client.close()
  })

  it('refreshes cached permissions after the bounded capability interval', async () => {
    vi.useFakeTimers()
    try {
      const process = new FakeNativeHostProcess()
      const requests = observeRequests(process)
      const connecting = NativeHostClient.connect({
        artifact: ARTIFACT,
        spawnProcess: () => process,
      })
      await completeHandshake(process, requests)
      const client = await connecting
      await vi.advanceTimersByTimeAsync(1_001)

      const refreshing = client.getCapabilities()
      const request = requireRequest(await requests.next())
      expect(request).toMatchObject({ type: 'get_capabilities' })
      const refreshed = {
        ...CAPABILITIES,
        permissions: { ...CAPABILITIES.permissions, accessibility: 'granted' as const },
      }
      process.send({
        protocolVersion: 1,
        requestId: request.requestId,
        type: 'capabilities',
        manifest: refreshed,
      })

      await expect(refreshing).resolves.toEqual(refreshed)
      await client.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('terminates the host and rejects a capture whose binary digest is invalid', async () => {
    const process = new FakeNativeHostProcess()
    const requests = observeRequests(process)
    const connecting = NativeHostClient.connect({ artifact: ARTIFACT, spawnProcess: () => process })
    await completeHandshake(process, requests)
    const client = await connecting
    const capture = client.captureWindow({ snapshotId: 'snapshot-1', windowId: 'window-1' })
    const request = requireRequest(await requests.next())
    const payload = Buffer.from('tampered')
    process.send(
      {
        protocolVersion: 1,
        requestId: request.requestId,
        type: 'capture_result',
        snapshotId: 'snapshot-1',
        width: 1,
        height: 1,
        payload: { kind: 'image_png', byteLength: payload.length, sha256: 'a'.repeat(64) },
      },
      payload,
    )

    await expect(capture).rejects.toMatchObject({ code: 'native_host_incompatible' })
    expect(process.kills).toContain('SIGKILL')
  })

  it('fails closed on timeout and rejects every in-flight request after killing the host', async () => {
    vi.useFakeTimers()
    try {
      const process = new FakeNativeHostProcess()
      const requests = observeRequests(process)
      const connecting = NativeHostClient.connect({
        artifact: ARTIFACT,
        spawnProcess: () => process,
        requestTimeoutMs: 100,
      })
      await completeHandshake(process, requests)
      const client = await connecting
      const first = client.listWindows()
      const second = client.ping()
      const firstRejection = expect(first).rejects.toMatchObject({ code: 'action_timeout' })
      const secondRejection = expect(second).rejects.toMatchObject({ code: 'action_timeout' })
      await requests.next()
      await requests.next()

      await vi.advanceTimersByTimeAsync(101)

      await Promise.all([firstRejection, secondRejection])
      expect(process.kills).toEqual([])
      await vi.advanceTimersByTimeAsync(300)
      expect(process.kills).toContain('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('forwards the Host-declared retryable flag on a recoverable error response', async () => {
    const process = new FakeNativeHostProcess()
    const requests = observeRequests(process)
    const connecting = NativeHostClient.connect({
      artifact: ARTIFACT,
      spawnProcess: () => process,
    })
    await completeHandshake(process, requests)
    const client = await connecting

    const ping = client.ping()
    const request = requireRequest(await requests.next())
    process.send({
      protocolVersion: 1,
      requestId: request.requestId,
      type: 'error',
      error: {
        code: 'native_host_incompatible',
        message: 'transient hiccup',
        retryable: true,
      },
    })

    await expect(ping).rejects.toMatchObject({
      code: 'native_host_incompatible',
      retryable: true,
    })
  })

  it('sends the persistent-capture extension only when explicitly requested', async () => {
    const process = new FakeNativeHostProcess()
    const requests = observeRequests(process)
    const connecting = NativeHostClient.connect({ artifact: ARTIFACT, spawnProcess: () => process })
    await completeHandshake(process, requests)
    const client = await connecting

    const observing = client.observe({
      snapshotId: 'snapshot-1',
      appId: 'app-1',
      windowId: 'window-1',
      previousTreeVersion: null,
      fullTree: true,
      persistentCapture: true,
    })
    const request = requireRequest(await requests.next())
    expect(request).toMatchObject({ type: 'observe', persistentCapture: true })
    process.send({
      protocolVersion: 1,
      requestId: request.requestId,
      type: 'error',
      error: { code: 'environment_unavailable', message: 'test stop', retryable: false },
    })
    await expect(observing).rejects.toMatchObject({ code: 'environment_unavailable' })
    await client.close()
  })

  it('extends the request deadline for a bounded native action instead of killing it mid-input', async () => {
    vi.useFakeTimers()
    try {
      const process = new FakeNativeHostProcess()
      const requests = observeRequests(process)
      const connecting = NativeHostClient.connect({
        artifact: ARTIFACT,
        spawnProcess: () => process,
        requestTimeoutMs: 100,
      })
      await completeHandshake(process, requests)
      const client = await connecting
      const envelope = {
        computerSessionId: 'computer-session-1',
        actionId: 'action-1',
        actuatorLeaseId: 'lease-1',
        observedFrameId: 'frame-1',
        observedTreeVersion: 'tree-1',
        targetAppId: 'app-1',
        targetWindowId: 'window-1',
        action: {
          type: 'drag' as const,
          from: { x: 0.1, y: 0.1 },
          to: { x: 0.9, y: 0.9 },
          durationMs: 250,
        },
        policyContext: {
          effect: 'external_write' as const,
          target: { kind: 'window' as const, id: 'window-1' },
          dataClasses: [],
        },
        intent: 'Move the selected item',
      }
      const executing = client.executeAction(envelope)
      const request = requireRequest(await requests.next())

      await vi.advanceTimersByTimeAsync(101)
      expect(process.kills).toEqual([])
      process.send({
        protocolVersion: 1,
        requestId: request.requestId,
        type: 'action_result',
        actionId: 'action-1',
        status: 'executed',
      })
      await expect(executing).resolves.toMatchObject({ status: 'executed' })
      await client.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds the in-flight request map before writing more work to the host pipe', async () => {
    const process = new FakeNativeHostProcess()
    const requests = observeRequests(process)
    const connecting = NativeHostClient.connect({
      artifact: ARTIFACT,
      spawnProcess: () => process,
      requestTimeoutMs: 100,
    })
    await completeHandshake(process, requests)
    const client = await connecting
    const pending = Array.from({ length: 64 }, () => client.ping().catch(() => undefined))

    await expect(client.ping()).rejects.toMatchObject({ code: 'actuator_lease_conflict' })

    await client.close()
    await Promise.all(pending)
  })
})

const ARTIFACT: VerifiedNativeHostArtifact = {
  executablePath: '/trusted/SparkComputerHost',
  manifestPath: '/trusted/manifest.json',
  manifest: {
    schemaVersion: 1,
    protocolVersion: 1,
    hostVersion: '0.1.0',
    platform: 'macos',
    architecture: 'arm64',
    executableFileName: 'SparkComputerHost',
    sha256: 'b'.repeat(64),
    signingIdentifier: 'com.spark-agent.desktop.computer-host',
    signingTeamIdentifier: 'ABCDE12345',
  },
}

class FakeNativeHostProcess extends EventEmitter implements NativeHostChildProcess {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kills: NodeJS.Signals[] = []

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.kills.push(signal)
    return true
  }

  send(response: NativeHostResponse, payload?: Buffer): void {
    this.stdout.write(encodeNativeHostJsonFrame(response))
    if (payload != null) this.stdout.write(encodeNativeHostFrame('binary', payload))
  }
}

function observeRequests(process: FakeNativeHostProcess): AsyncGenerator<NativeHostRequest> {
  const decoder = new NativeHostFrameDecoder()
  const queue: NativeHostRequest[] = []
  const waiters: Array<(request: NativeHostRequest) => void> = []
  process.stdin.on('data', (chunk: Buffer) => {
    for (const frame of decoder.push(chunk)) {
      const request = JSON.parse(frame.payload.toString('utf8')) as NativeHostRequest
      const waiter = waiters.shift()
      if (waiter == null) queue.push(request)
      else waiter(request)
    }
  })
  return (async function* () {
    while (true) {
      const queued = queue.shift()
      if (queued != null) yield queued
      else yield await new Promise<NativeHostRequest>((resolve) => waiters.push(resolve))
    }
  })()
}

async function completeHandshake(
  process: FakeNativeHostProcess,
  requests: AsyncGenerator<NativeHostRequest>,
): Promise<void> {
  const handshake = requireRequest(await requests.next())
  process.send({
    protocolVersion: 1,
    requestId: handshake.requestId,
    type: 'capabilities',
    manifest: CAPABILITIES,
  })
}

function requireRequest(result: IteratorResult<NativeHostRequest>): NativeHostRequest {
  if (result.done) throw new Error('Native Host request stream ended unexpectedly')
  return result.value
}
