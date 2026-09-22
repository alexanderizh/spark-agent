/**
 * registerResourceMonitorIpc 单测：三通道桥接、推流 sink 注入 + start 启动、
 * 订阅以 webContents id 为键 + destroyed 自动退订。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: unknown, event: unknown) => Promise<unknown>>(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (
    channel: string,
    handler: (request: unknown, event: unknown) => Promise<unknown>,
  ) => harness.handlers.set(channel, handler),
}))

vi.mock('../windows/index.js', () => ({
  broadcastToAppWindows: vi.fn(),
}))

import { registerResourceMonitorIpc } from './registerResourceMonitorIpc'
import { broadcastToAppWindows } from '../windows/index.js'
import type { ResourceMonitorService } from '@spark/agent-runtime'

function makeMonitorFixture() {
  const calls = {
    start: 0,
    subscriptions: [] as Array<{
      id: string
      enabled: boolean
      minIntervalMs?: number | undefined
    }>,
  }
  const monitor = {
    start: vi.fn(() => {
      calls.start += 1
    }),
    setStreamSink: vi.fn(),
    getSnapshot: vi.fn((detail: string) => ({
      summary: { monitorEnabled: true, sampledAt: 't', detail },
      full: null,
    })),
    getHistory: vi.fn((windowMs?: number) => [
      { sampledAt: 't', level: 'nominal', windowMs: windowMs ?? null },
    ]),
    getRecentPressureEvents: vi.fn((limit?: number) => [
      {
        id: `e${limit ?? 20}`,
        fromLevel: 'nominal',
        toLevel: 'warning',
        occurredAt: 't',
        indicators: [],
      },
    ]),
    setSubscription: vi.fn((id: string, enabled: boolean, minIntervalMs?: number) => {
      calls.subscriptions.push({ id, enabled, minIntervalMs })
      return {
        subscriberCount: enabled ? 1 : 0,
        minIntervalMs: enabled ? (minIntervalMs ?? 60_000) : null,
      }
    }),
  } as unknown as ResourceMonitorService & { setStreamSink: (sink: unknown) => void }
  return { monitor, calls }
}

/** 模拟 SessionService（monitor getter + 工作流治理回显源 + 闸门诊断源）。 */
function makeSessionFactory(
  monitor: ResourceMonitorService,
  workflowGovernance: unknown = null,
  governorDiagnostics: unknown = null,
) {
  return () =>
    ({
      getResourceMonitor: () => monitor,
      getWorkflowExecutionGovernance: () => workflowGovernance,
      getDispatchGovernorDiagnostics: () => governorDiagnostics,
    }) as never
}

/** 模拟 webContents（含 once/destroyed 事件簿记）。 */
function makeSender(id: number) {
  const onceHandlers = new Map<string, () => void>()
  return {
    sender: {
      id,
      once: (event: string, handler: () => void) => onceHandlers.set(event, handler),
      destroy: () => onceHandlers.get('destroyed')?.(),
    },
    onceHandlers,
  }
}

describe('registerResourceMonitorIpc', () => {
  beforeEach(() => {
    harness.handlers.clear()
    vi.mocked(broadcastToAppWindows).mockClear()
  })

  it('注册时注入推流 sink 并启动监控', () => {
    const { monitor, calls } = makeMonitorFixture()
    registerResourceMonitorIpc(makeSessionFactory(monitor))
    expect(monitor.setStreamSink).toHaveBeenCalledTimes(1)
    expect(calls.start).toBe(1)
    // sink 桥接到 broadcastToAppWindows
    const injected = vi.mocked(monitor.setStreamSink).mock.calls[0]?.[0] as unknown as (
      channel: string,
      payload: unknown,
    ) => void
    injected('stream:resource-monitor:pressure-changed', { level: 'warning' })
    expect(broadcastToAppWindows).toHaveBeenCalledWith('stream:resource-monitor:pressure-changed', {
      level: 'warning',
    })
  })

  it('get-snapshot / get-history 桥接到 monitor', async () => {
    const { monitor } = makeMonitorFixture()
    registerResourceMonitorIpc(makeSessionFactory(monitor))
    await expect(
      harness.handlers.get('resource-monitor:get-snapshot')?.({ detail: 'summary' }, {}),
    ).resolves.toEqual({
      summary: expect.objectContaining({ detail: 'summary' }),
      full: null,
    })
    await expect(
      harness.handlers.get('resource-monitor:get-history')?.({ windowMs: 5_000 }, {}),
    ).resolves.toEqual({
      points: [expect.objectContaining({ windowMs: 5_000 })],
    })
  })

  it('get-pressure-events 桥接到 monitor.getRecentPressureEvents 并透传 limit', async () => {
    const { monitor } = makeMonitorFixture()
    registerResourceMonitorIpc(makeSessionFactory(monitor))
    await expect(
      harness.handlers.get('resource-monitor:get-pressure-events')?.({ limit: 15 }, {}),
    ).resolves.toEqual({
      events: [expect.objectContaining({ id: 'e15', fromLevel: 'nominal', toLevel: 'warning' })],
    })
  })

  it('dispatch-governor:get-diagnostics 桥接 session 诊断；null 时 available=false', async () => {
    const { monitor } = makeMonitorFixture()
    const diagnostics = { mainInUse: 1, mainCapacity: 8, nestedInUse: 0, nestedCapacity: 2 }
    registerResourceMonitorIpc(makeSessionFactory(monitor, null, diagnostics))
    await expect(
      harness.handlers.get('dispatch-governor:get-diagnostics')?.({}, {}),
    ).resolves.toEqual({
      available: true,
      diagnostics,
    })
    // handler 防御位：mock 返回 null → available=false（生产路径 session 侧
    // 已触发惰性创建、恒返回诊断，此分支仅覆盖异常兜底语义）
    const { monitor: bare } = makeMonitorFixture()
    registerResourceMonitorIpc(makeSessionFactory(bare, null, null))
    await expect(
      harness.handlers.get('dispatch-governor:get-diagnostics')?.({}, {}),
    ).resolves.toEqual({
      available: false,
      diagnostics: null,
    })
  })

  it('full 快照合并 workflowGovernance 回显；null 治理保持 null', async () => {
    const { monitor } = makeMonitorFixture()
    ;(monitor.getSnapshot as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      summary: { monitorEnabled: true, sampledAt: 't' },
      full: { monitorEnabled: true, sampledAt: 't', workflowGovernance: null },
    }))
    registerResourceMonitorIpc(
      makeSessionFactory(monitor, {
        waveWidth: 4,
        fanoutClamp: 4,
        loopFanoutProductCap: 32,
        maxDispatchesPerRun: 80,
      }),
    )
    await expect(
      harness.handlers.get('resource-monitor:get-snapshot')?.({ detail: 'full' }, {}),
    ).resolves.toEqual({
      summary: expect.anything(),
      full: expect.objectContaining({
        workflowGovernance: {
          waveWidth: 4,
          fanoutClamp: 4,
          loopFanoutProductCap: 32,
          maxDispatchesPerRun: 80,
        },
      }),
    })
    // 治理未设置 → null 保持
    const { monitor: bare } = makeMonitorFixture()
    ;(bare.getSnapshot as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      summary: { monitorEnabled: true, sampledAt: 't' },
      full: { monitorEnabled: true, sampledAt: 't', workflowGovernance: null },
    }))
    registerResourceMonitorIpc(makeSessionFactory(bare, null))
    await expect(
      harness.handlers.get('resource-monitor:get-snapshot')?.({ detail: 'full' }, {}),
    ).resolves.toEqual({
      summary: expect.anything(),
      full: expect.objectContaining({ workflowGovernance: null }),
    })
  })

  it('subscribe 以 webContents id 为 subscriberId；destroyed 自动退订', async () => {
    const { monitor } = makeMonitorFixture()
    registerResourceMonitorIpc(makeSessionFactory(monitor))
    const { sender } = makeSender(42)
    const response = (await harness.handlers.get('resource-monitor:subscribe')?.(
      { enabled: true, minIntervalMs: 5_000 },
      { sender },
    )) as { ok: boolean; subscriberCount: number; minIntervalMs: number | null }
    expect(response).toEqual({ ok: true, subscriberCount: 1, minIntervalMs: 5_000 })
    // 窗口销毁 → 自动退订
    sender.destroy()
    const calls = vi.mocked(
      (monitor as unknown as { setSubscription: ReturnType<typeof vi.fn> }).setSubscription,
    ).mock.calls as unknown as Array<[string, boolean, number | undefined]>
    expect(calls).toEqual([
      ['42', true, 5_000],
      ['42', false],
    ])
  })
})
