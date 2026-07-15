import { describe, expect, it, vi } from 'vitest'
import { SessionServiceShutdownRegistry } from './session-service-shutdown.js'

describe('SessionServiceShutdownRegistry', () => {
  it('disposes the registered service and rejects late registrations after shutdown starts', async () => {
    const registry = new SessionServiceShutdownRegistry()
    const activeService = { dispose: vi.fn(async () => undefined) }
    const lateService = { dispose: vi.fn(async () => undefined) }

    expect(registry.register(activeService)).toBe(true)
    await registry.dispose()

    expect(registry.isShuttingDown()).toBe(true)
    expect(activeService.dispose).toHaveBeenCalledOnce()
    expect(registry.register(lateService)).toBe(false)
    expect(lateService.dispose).toHaveBeenCalledOnce()
  })
})
