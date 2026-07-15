import { describe, expect, it, vi } from 'vitest'
import {
  createAppShutdownCoordinator,
  registerEmergencySessionShutdown,
  runShutdownCleanupSteps,
} from './app-shutdown.js'

describe('app shutdown coordination', () => {
  it('continues local cleanup after an earlier step fails', async () => {
    const order: string[] = []
    const onError = vi.fn()

    await runShutdownCleanupSteps(
      [
        { name: 'watchers', run: () => { order.push('watchers'); throw new Error('failed') } },
        { name: 'database', run: () => { order.push('database') } },
      ],
      onError,
    )

    expect(order).toEqual(['watchers', 'database'])
    expect(onError).toHaveBeenCalledWith('watchers', expect.any(Error))
  })

  it('force-disposes Agent sessions when the main process exits outside Electron quit', () => {
    let onExit: (() => void) | undefined
    const process = {
      once: vi.fn((event: 'exit', listener: () => void) => {
        expect(event).toBe('exit')
        onExit = listener
      }),
    }
    const disposeSessionService = vi.fn(async () => undefined)

    registerEmergencySessionShutdown(process, disposeSessionService)
    onExit?.()

    expect(disposeSessionService).toHaveBeenCalledOnce()
  })

  it('prevents the first quit and waits for agent disposal before cleanup and re-quit', async () => {
    const order: string[] = []
    let finishSessionDisposal: (() => void) | undefined
    const sessionDisposed = new Promise<void>((resolve) => {
      finishSessionDisposal = resolve
    })
    const app = { quit: vi.fn(() => order.push('quit')) }
    const cleanup = vi.fn(() => {
      order.push('cleanup')
    })
    const onBeforeQuit = createAppShutdownCoordinator({
      app,
      disposeSessionService: vi.fn(async () => {
        order.push('dispose:start')
        await sessionDisposed
        order.push('dispose:end')
      }),
      cleanup,
    })
    const firstEvent = { preventDefault: vi.fn() }
    const duplicateEvent = { preventDefault: vi.fn() }

    onBeforeQuit(firstEvent)
    onBeforeQuit(duplicateEvent)
    await Promise.resolve()

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(duplicateEvent.preventDefault).toHaveBeenCalledOnce()
    expect(cleanup).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()

    finishSessionDisposal?.()
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())

    expect(order).toEqual(['dispose:start', 'dispose:end', 'cleanup', 'quit'])

    const finalEvent = { preventDefault: vi.fn() }
    onBeforeQuit(finalEvent)
    expect(finalEvent.preventDefault).not.toHaveBeenCalled()
  })

  it('still performs local cleanup and re-quits when session disposal fails', async () => {
    const onError = vi.fn()
    const app = { quit: vi.fn() }
    const cleanup = vi.fn()
    const onBeforeQuit = createAppShutdownCoordinator({
      app,
      disposeSessionService: vi.fn(async () => {
        throw new Error('dispose failed')
      }),
      cleanup,
      onError,
    })

    onBeforeQuit({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())

    expect(onError).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('re-quits after a bounded wait when session disposal never settles', async () => {
    const onError = vi.fn()
    const app = { quit: vi.fn() }
    const cleanup = vi.fn()
    const onBeforeQuit = createAppShutdownCoordinator({
      app,
      disposeSessionService: () => new Promise<void>(() => undefined),
      disposeTimeoutMs: 5,
      cleanup,
      onError,
    })

    onBeforeQuit({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())

    expect(cleanup).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Timed out waiting for Agent shutdown after 5ms' }),
    )
  })
})
