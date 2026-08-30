import { describe, expect, it } from 'vitest'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { NativeHostConnection } from './NativeHostComputerUseBackend.js'
import type { NativeHostHealthServiceOptions } from './NativeHostHealthService.js'
import { NativeHostSupervisor } from './NativeHostSupervisor.js'

/**
 * Deterministic health service — records lifecycle calls and lets the test
 * drive an "unhealthy" verdict on demand instead of waiting on real timers.
 */
class FakeHealthService {
  startedCount = 0
  stoppedCount = 0
  resetCount = 0
  private readonly onUnhealthy: () => void

  constructor(options: NativeHostHealthServiceOptions) {
    this.onUnhealthy = options.onUnhealthy
  }

  start(): void {
    this.startedCount += 1
  }
  stop(): void {
    this.stoppedCount += 1
  }
  reset(): void {
    this.resetCount += 1
  }
  triggerUnhealthy(): void {
    this.onUnhealthy()
  }
}

interface FakeConnection extends NativeHostConnection {
  readonly id: string
  closed: boolean
}

function createFakeConnection(id: string): FakeConnection {
  const stub = {
    id,
    closed: false,
    async getCapabilities() {
      return null
    },
    async requestPermissions() {
      return null
    },
    async listWindows() {
      return []
    },
    async captureWindow() {
      throw new Error('not used')
    },
    async observe() {
      throw new Error('not used')
    },
    async executeAction() {
      throw new Error('not used')
    },
    async cancelSession() {},
    async close() {
      stub.closed = true
    },
  }
  return stub as unknown as FakeConnection
}

interface BuiltSupervisor {
  supervisor: NativeHostSupervisor
  connections: FakeConnection[]
  health: { current: FakeHealthService | null }
  getConnectCalls(): number
}

/**
 * The supervisor's reconnect path is fully microtask-driven (close → connect →
 * then/catch/finally). A couple of `await Promise.resolve()` is not enough to
 * settle the whole chain, so tests flush a generous batch of microtasks.
 */
async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

function buildSupervisor(
  config: {
    maxRestarts?: number
    onRebound?: () => void
    probe?: () => Promise<void>
    connectImpl?: () => Promise<FakeConnection>
  } = {},
): BuiltSupervisor {
  const connections: FakeConnection[] = []
  let connectCalls = 0
  let sequence = 0
  const rebound = { count: 0 }
  const health: { current: FakeHealthService | null } = { current: null }
  const supervisor = new NativeHostSupervisor({
    connect:
      config.connectImpl ??
      (async () => {
        connectCalls += 1
        sequence += 1
        const connection = createFakeConnection(`conn-${sequence}`)
        connections.push(connection)
        return connection
      }),
    probe:
      config.probe ??
      (async () => {
        /* healthy by default */
      }),
    onRebound: () => {
      rebound.count += 1
      config.onRebound?.()
    },
    maxRestartsPerSession: config.maxRestarts ?? 1,
    createHealthService: (options) => {
      const service = new FakeHealthService(options)
      health.current = service
      return service
    },
  })
  return { supervisor, connections, health, getConnectCalls: () => connectCalls }
}

describe('NativeHostSupervisor', () => {
  it('lazily connects on first acquire and reuses the same connection', async () => {
    const { supervisor, connections, getConnectCalls } = buildSupervisor()

    const first = await supervisor.acquire()
    const second = await supervisor.acquire()

    expect(getConnectCalls()).toBe(1)
    expect(first).toBe(second)
    expect(connections).toHaveLength(1)
    expect(supervisor.getState()).toBe('ready')
  })

  it('dedups concurrent acquires into a single connect call', async () => {
    let resolveConnect: ((value: FakeConnection) => void) | null = null
    let connectCalls = 0
    const { supervisor } = buildSupervisor({
      connectImpl: () => {
        connectCalls += 1
        return new Promise<FakeConnection>((resolve) => {
          resolveConnect = (value) => resolve(value)
        })
      },
    })

    const a = supervisor.acquire()
    const b = supervisor.acquire()
    expect(connectCalls).toBe(1)

    const resolvePending = resolveConnect as ((value: FakeConnection) => void) | null
    if (resolvePending == null) throw new Error('connect resolver was not installed')
    resolvePending(createFakeConnection('shared'))
    await expect(a).resolves.toBe(await b)
  })

  it('reconnects within budget after a terminal failure and fires onRebound', async () => {
    const rebound = { count: 0 }
    const { supervisor, connections } = buildSupervisor({
      onRebound: () => {
        rebound.count += 1
      },
    })

    const first = await supervisor.acquire()
    expect(rebound.count).toBe(0)

    await supervisor.reportTerminalFailure(
      first,
      new ComputerUseBrokerError('native_host_incompatible', 'boom'),
    )
    expect(supervisor.getState()).toBe('degraded')

    const second = await supervisor.acquire()
    expect(second).not.toBe(first)
    expect(connections).toHaveLength(2)
    expect(supervisor.getState()).toBe('ready')
    expect(rebound.count).toBe(1)
    expect(supervisor.getRestartCount()).toBe(1)
  })

  it('fails once the restart budget is exhausted', async () => {
    const { supervisor } = buildSupervisor({ maxRestarts: 1 })

    const first = await supervisor.acquire()
    await supervisor.reportTerminalFailure(
      first,
      new ComputerUseBrokerError('native_host_incompatible', 'first death'),
    )
    // Budget of 1 permits exactly one restart.
    const second = await supervisor.acquire()
    expect(second).not.toBe(first)

    await supervisor.reportTerminalFailure(
      second,
      new ComputerUseBrokerError('native_host_incompatible', 'second death'),
    )
    expect(supervisor.getState()).toBe('failed')

    await expect(supervisor.acquire()).rejects.toMatchObject({
      code: 'native_host_incompatible',
    })
  })

  it('resets an exhausted restart budget when a governed task ends', async () => {
    const { supervisor } = buildSupervisor({ maxRestarts: 1 })
    const first = await supervisor.acquire()
    await supervisor.reportTerminalFailure(
      first,
      new ComputerUseBrokerError('native_host_incompatible', 'first death'),
    )
    const second = await supervisor.acquire()
    await supervisor.reportTerminalFailure(
      second,
      new ComputerUseBrokerError('native_host_incompatible', 'second death'),
    )
    expect(supervisor.getState()).toBe('failed')

    supervisor.resetSessionBudget()

    expect(supervisor.getState()).toBe('absent')
    expect(supervisor.getRestartCount()).toBe(0)
    await expect(supervisor.acquire()).resolves.toBeDefined()
  })

  it('reclaims and restarts the connection when the heartbeat goes unhealthy', async () => {
    const rebound = { count: 0 }
    const { supervisor, connections, health } = buildSupervisor({
      onRebound: () => {
        rebound.count += 1
      },
    })

    const first = await supervisor.acquire()
    expect(health.current?.startedCount).toBeGreaterThanOrEqual(1)

    health.current?.triggerUnhealthy()
    await flushMicrotasks()

    expect(connections[0]?.closed).toBe(true)
    expect(supervisor.getState()).toBe('ready')
    expect(connections).toHaveLength(2)
    expect(rebound.count).toBe(1)

    const second = await supervisor.acquire()
    expect(second).not.toBe(first)
  })

  it('fails when the heartbeat goes unhealthy with no restart budget left', async () => {
    const { supervisor, health } = buildSupervisor({ maxRestarts: 0 })

    await supervisor.acquire()
    health.current?.triggerUnhealthy()
    await flushMicrotasks()

    expect(supervisor.getState()).toBe('failed')
    await expect(supervisor.acquire()).rejects.toMatchObject({
      code: 'native_host_incompatible',
    })
  })

  it('does not double-count a connection that was never live when reporting failure', async () => {
    const { supervisor } = buildSupervisor()
    const foreign = createFakeConnection('foreign')

    await supervisor.acquire()
    // Reporting failure for a connection the supervisor does not own is a no-op.
    await supervisor.reportTerminalFailure(
      foreign,
      new ComputerUseBrokerError('native_host_incompatible', 'stray'),
    )
    expect(supervisor.getState()).toBe('ready')
    expect(supervisor.getRestartCount()).toBe(0)
  })

  it('dispose stops the heartbeat and closes the live connection', async () => {
    const { supervisor, connections, health } = buildSupervisor()

    await supervisor.acquire()
    expect(connections[0]?.closed).toBe(false)

    await supervisor.dispose()

    expect(connections[0]?.closed).toBe(true)
    expect(health.current?.stoppedCount).toBeGreaterThanOrEqual(1)
    expect(supervisor.getState()).toBe('failed')
    await expect(supervisor.acquire()).rejects.toMatchObject({ code: 'session_canceled' })
  })
})
