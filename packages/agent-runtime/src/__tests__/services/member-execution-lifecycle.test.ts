import { describe, expect, it, vi } from 'vitest'
import { runMemberExecutorIfActive } from '../../services/member-execution-lifecycle.js'

describe('member execution lifecycle', () => {
  it('does not start an executor when shutdown aborted the signal during preflight', async () => {
    const controller = new AbortController()
    controller.abort()
    const cancel = vi.fn()
    const execute = vi.fn(async () => undefined)

    const started = await runMemberExecutorIfActive({
      signal: controller.signal,
      isDisposing: () => false,
      cancel,
      execute,
    })

    expect(started).toBe(false)
    expect(cancel).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()
  })

  it('cancels an executor when shutdown begins after execution starts', async () => {
    const controller = new AbortController()
    let finishExecution: (() => void) | undefined
    const executionDone = new Promise<void>((resolve) => {
      finishExecution = resolve
    })
    const cancel = vi.fn()
    const execute = vi.fn(() => executionDone)

    const running = runMemberExecutorIfActive({
      signal: controller.signal,
      isDisposing: () => false,
      cancel,
      execute,
    })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    controller.abort()
    finishExecution?.()

    await expect(running).resolves.toBe(false)
    expect(cancel).toHaveBeenCalledOnce()
  })
})
