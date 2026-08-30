import { describe, expect, it, vi } from 'vitest'
import { ComputerDesktopExecutionCoordinator } from './ComputerDesktopExecutionCoordinator.js'

describe('ComputerDesktopExecutionCoordinator', () => {
  it('claims an idle desktop without stopping another session', async () => {
    const stopSession = vi.fn(async () => undefined)
    const coordinator = new ComputerDesktopExecutionCoordinator({ stopSession })

    await coordinator.claim('session-a')

    expect(stopSession).not.toHaveBeenCalled()
    expect(coordinator.activeSessionId()).toBe('session-a')
  })

  it('stops the previous session before a new session takes control', async () => {
    let finishStop: (() => void) | undefined
    const stopSession = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve
        }),
    )
    const coordinator = new ComputerDesktopExecutionCoordinator({ stopSession })
    await coordinator.claim('session-a')

    const claim = coordinator.claim('session-b')

    await vi.waitFor(() => expect(stopSession).toHaveBeenCalledWith('session-a'))
    expect(coordinator.activeSessionId()).toBe('session-a')
    finishStop?.()
    await claim
    expect(coordinator.activeSessionId()).toBe('session-b')
  })

  it('treats a repeated claim by the active session as idempotent', async () => {
    const stopSession = vi.fn(async () => undefined)
    const coordinator = new ComputerDesktopExecutionCoordinator({ stopSession })
    await coordinator.claim('session-a')

    await coordinator.claim('session-a')

    expect(stopSession).not.toHaveBeenCalled()
    expect(coordinator.activeSessionId()).toBe('session-a')
  })

  it('clears the old owner when stopping it fails so a retry can recover', async () => {
    const stopSession = vi.fn(async () => {
      throw new Error('native cleanup failed')
    })
    const coordinator = new ComputerDesktopExecutionCoordinator({ stopSession })
    await coordinator.claim('session-a')

    await expect(coordinator.claim('session-b')).rejects.toThrow('native cleanup failed')

    expect(coordinator.activeSessionId()).toBeNull()
  })

  it('only lets the active owner release the desktop', async () => {
    const coordinator = new ComputerDesktopExecutionCoordinator({
      stopSession: vi.fn(async () => undefined),
    })
    await coordinator.claim('session-a')

    coordinator.release('session-b')
    expect(coordinator.activeSessionId()).toBe('session-a')

    coordinator.release('session-a')
    expect(coordinator.activeSessionId()).toBeNull()
  })

  it('stops and clears the active owner during disposal', async () => {
    const stopSession = vi.fn(async () => undefined)
    const coordinator = new ComputerDesktopExecutionCoordinator({ stopSession })
    await coordinator.claim('session-a')

    await coordinator.dispose()

    expect(stopSession).toHaveBeenCalledWith('session-a')
    expect(coordinator.activeSessionId()).toBeNull()
  })
})
