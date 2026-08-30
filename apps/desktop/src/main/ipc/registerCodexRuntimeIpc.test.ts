import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: unknown) => Promise<unknown>>(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: unknown) => Promise<unknown>) =>
    harness.handlers.set(channel, handler),
}))

import { registerCodexRuntimeIpc } from './registerCodexRuntimeIpc'

describe('registerCodexRuntimeIpc', () => {
  beforeEach(() => {
    harness.handlers.clear()
    delete process.env.SPARK_CODEX_PERSISTENT_RUNTIME
  })

  it('exposes redacted diagnostics and idle-only restart through typed IPC', async () => {
    const diagnostics = {
      disposed: false,
      activeRuntimeCount: 0,
      leasedRuntimeCount: 0,
      processCount: 0,
      totalRssBytes: null,
      totalHandleCount: null,
      counters: {
        acquireCount: 0,
        coldStartCount: 0,
        warmHitCount: 0,
        warmHitRate: 0,
        fingerprintRotationCount: 0,
        crashReplacementCount: 0,
        invalidationCount: 0,
        startFailureCount: 0,
        ttlEvictionCount: 0,
        lruEvictionCount: 0,
        manualRestartCount: 0,
        threadLoadedCount: 0,
        threadResumeCount: 0,
        threadStartCount: 0,
        threadResumeFallbackCount: 0,
      },
      latency: {
        coldAcquire: { count: 0, p50Ms: null, p95Ms: null, maxMs: null },
        warmAcquire: { count: 0, p50Ms: null, p95Ms: null, maxMs: null },
        coldTurnStart: { count: 0, p50Ms: null, p95Ms: null, maxMs: null },
        warmTurnStart: { count: 0, p50Ms: null, p95Ms: null, maxMs: null },
      },
      runtimes: [],
    }
    const backend = {
      getDiagnostics: vi.fn(async () => diagnostics),
      restartIdle: vi.fn(async () => ({ restartedLeaseIds: ['lease-a'], busyLeaseIds: [] })),
    }
    registerCodexRuntimeIpc(backend)

    await expect(harness.handlers.get('codex-runtime:diagnostics')?.({})).resolves.toEqual({
      enabled: true,
      source: 'default',
      diagnostics,
    })
    await expect(harness.handlers.get('codex-runtime:restart-idle')?.({})).resolves.toEqual({
      enabled: true,
      result: { restartedLeaseIds: ['lease-a'], busyLeaseIds: [] },
    })
  })

  it('honors the process-level rollback without constructing diagnostics', async () => {
    process.env.SPARK_CODEX_PERSISTENT_RUNTIME = '0'
    const backend = {
      getDiagnostics: vi.fn(async () => null),
      restartIdle: vi.fn(async () => null),
    }
    registerCodexRuntimeIpc(backend)

    await expect(harness.handlers.get('codex-runtime:diagnostics')?.({})).resolves.toEqual({
      enabled: false,
      source: 'environment',
      diagnostics: null,
    })
    await expect(harness.handlers.get('codex-runtime:restart-idle')?.({})).resolves.toEqual({
      enabled: false,
      result: null,
    })
    expect(backend.getDiagnostics).not.toHaveBeenCalled()
    expect(backend.restartIdle).not.toHaveBeenCalled()
  })
})
