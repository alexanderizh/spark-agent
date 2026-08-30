// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexRuntimeDiagnosticsResponse } from '@spark/protocol'

const diagnostics: CodexRuntimeDiagnosticsResponse = {
  enabled: true,
  source: 'default',
  diagnostics: {
    disposed: false,
    activeRuntimeCount: 1,
    leasedRuntimeCount: 0,
    processCount: 1,
    totalRssBytes: 64 * 1024 * 1024,
    totalHandleCount: 24,
    counters: {
      acquireCount: 6,
      coldStartCount: 1,
      warmHitCount: 5,
      warmHitRate: 5 / 6,
      fingerprintRotationCount: 0,
      crashReplacementCount: 0,
      invalidationCount: 0,
      startFailureCount: 0,
      ttlEvictionCount: 0,
      lruEvictionCount: 0,
      manualRestartCount: 0,
      threadLoadedCount: 5,
      threadResumeCount: 0,
      threadStartCount: 1,
      threadResumeFallbackCount: 0,
    },
    latency: {
      coldAcquire: { count: 1, p50Ms: 210, p95Ms: 210, maxMs: 210 },
      warmAcquire: { count: 5, p50Ms: 2, p95Ms: 4, maxMs: 4 },
      coldTurnStart: { count: 1, p50Ms: 180, p95Ms: 180, maxMs: 180 },
      warmTurnStart: { count: 5, p50Ms: 22, p95Ms: 40, maxMs: 40 },
    },
    runtimes: [
      {
        leaseId: 'a1b2c3d4e5f6',
        state: 'idle',
        lastUsedAt: '2026-08-21T12:00:00.000Z',
        resourceCount: 1,
        pid: 1234,
        rssBytes: 64 * 1024 * 1024,
        handleCount: 24,
        loadedThreadCount: 1,
      },
    ],
  },
}

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

import { CodexRuntimeDiagnosticsCard } from './CodexRuntimeDiagnosticsCard'

describe('CodexRuntimeDiagnosticsCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mocks.invoke.mockReset()
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'codex-runtime:diagnostics') return diagnostics
      if (channel === 'codex-runtime:restart-idle') {
        return {
          enabled: true,
          result: { restartedLeaseIds: ['a1b2c3d4e5f6'], busyLeaseIds: [] },
        }
      }
      throw new Error(`unexpected channel: ${channel}`)
    })
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke: mocks.invoke },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
  })

  it('renders redacted resource and warm latency diagnostics', async () => {
    await act(async () => {
      root.render(<CodexRuntimeDiagnosticsCard />)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Codex Runtime 诊断')
    expect(container.textContent).toContain('83%')
    expect(container.textContent).toContain('40ms')
    expect(container.textContent).toContain('Runtime a1b2c3d4e5f6')
    expect(container.textContent).not.toContain('session')
  })

  it('restarts only idle runtimes and refreshes diagnostics', async () => {
    await act(async () => {
      root.render(<CodexRuntimeDiagnosticsCard />)
      await Promise.resolve()
    })
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('重启空闲 Runtime'),
    )
    await act(async () => {
      button?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('已重启 1 个空闲 Runtime')
    expect(mocks.invoke).toHaveBeenCalledWith('codex-runtime:restart-idle', {})
    expect(mocks.invoke).toHaveBeenCalledTimes(3)
  })

  it('surfaces release threshold warnings without exposing runtime identities', async () => {
    const healthyDiagnostics = diagnostics.diagnostics
    if (healthyDiagnostics == null) throw new Error('healthy diagnostics fixture is missing')
    const warningSnapshot: CodexRuntimeDiagnosticsResponse = {
      ...diagnostics,
      diagnostics: {
        ...healthyDiagnostics,
        totalRssBytes: 2 * 1024 * 1024 * 1024,
        totalHandleCount: 3_000,
        counters: {
          ...healthyDiagnostics.counters,
          acquireCount: 10,
          warmHitCount: 2,
          warmHitRate: 0.2,
          startFailureCount: 1,
          crashReplacementCount: 1,
        },
        latency: {
          ...healthyDiagnostics.latency,
          warmTurnStart: { count: 10, p50Ms: 120, p95Ms: 450, maxMs: 600 },
        },
      },
    }
    mocks.invoke.mockResolvedValue(warningSnapshot)

    await act(async () => {
      root.render(<CodexRuntimeDiagnosticsCard />)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('需关注')
    expect(container.textContent).toContain('总内存超过 1 GiB')
    expect(container.textContent).toContain('总句柄数超过 2048')
    expect(container.textContent).toContain('暖 turn/start p95 为 450ms')
    expect(container.textContent).toContain('暖启动命中率低于 60%')
    expect(container.textContent).toContain('1 次启动失败、1 次崩溃替换')
  })
})
