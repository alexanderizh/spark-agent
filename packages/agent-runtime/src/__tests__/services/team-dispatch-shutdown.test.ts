import { describe, expect, it } from 'vitest'
import { TeamDispatchService } from '../../services/team-dispatch.service.js'

describe('TeamDispatchService shutdown', () => {
  it('aborts and waits for active and queued dispatch runs', async () => {
    let finishRun: (() => void) | undefined
    const activeRun = new Promise<void>((resolve) => {
      finishRun = resolve
    })
    const controller = new AbortController()
    const service = Object.create(TeamDispatchService.prototype) as {
      activeRunPromises: Set<Promise<unknown>>
      cancelAllAndWait: () => Promise<void>
      controllers: Map<string, AbortController>
    }
    service.activeRunPromises = new Set([activeRun])
    service.controllers = new Map([['dispatch-1', controller]])

    let shutdownFinished = false
    const shutdown = service.cancelAllAndWait().then(() => {
      shutdownFinished = true
    })
    await Promise.resolve()

    expect(controller.signal.aborted).toBe(true)
    expect(shutdownFinished).toBe(false)

    finishRun?.()
    await shutdown

    expect(shutdownFinished).toBe(true)
  })
})
