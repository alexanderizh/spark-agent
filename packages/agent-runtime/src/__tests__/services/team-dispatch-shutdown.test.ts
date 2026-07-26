import { describe, expect, it } from 'vitest'
import { TeamDispatchService } from '../../services/team-dispatch.service.js'

type DispatchControllerEntry = { controller: AbortController; sessionId: string }

type TeamDispatchInternals = {
  activeRunPromises: Set<Promise<unknown>>
  cancelAllAndWait: () => Promise<void>
  cancelBySession: (sessionId: string) => number
  controllers: Map<string, DispatchControllerEntry>
}

function makeService(
  entries: Array<[string, DispatchControllerEntry]> = [],
  activeRuns: Array<Promise<unknown>> = [],
): TeamDispatchInternals {
  const service = Object.create(TeamDispatchService.prototype) as TeamDispatchInternals
  service.activeRunPromises = new Set(activeRuns)
  service.controllers = new Map(entries)
  return service
}

describe('TeamDispatchService shutdown', () => {
  it('aborts and waits for active and queued dispatch runs', async () => {
    let finishRun: (() => void) | undefined
    const activeRun = new Promise<void>((resolve) => {
      finishRun = resolve
    })
    const controller = new AbortController()
    const service = makeService([['dispatch-1', { controller, sessionId: 'session-a' }]], [activeRun])

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

describe('TeamDispatchService.cancelBySession', () => {
  it('only aborts dispatches belonging to the target session', () => {
    // 多会话并行跑团队协作时，取消 A 不能动 B——这是 cancelAll() 曾经的跨会话副作用。
    const aOne = new AbortController()
    const aTwo = new AbortController()
    const bOne = new AbortController()
    const service = makeService([
      ['dispatch-a1', { controller: aOne, sessionId: 'session-a' }],
      ['dispatch-b1', { controller: bOne, sessionId: 'session-b' }],
      ['dispatch-a2', { controller: aTwo, sessionId: 'session-a' }],
    ])

    expect(service.cancelBySession('session-a')).toBe(2)

    expect(aOne.signal.aborted).toBe(true)
    expect(aTwo.signal.aborted).toBe(true)
    expect(bOne.signal.aborted).toBe(false)
    // 已取消的条目要从表里摘掉，未取消的必须保留，否则后续 cancel 会漏
    expect([...service.controllers.keys()]).toEqual(['dispatch-b1'])
  })

  it('is a no-op for a session with no active dispatches', () => {
    const other = new AbortController()
    const service = makeService([['dispatch-b1', { controller: other, sessionId: 'session-b' }]])

    expect(service.cancelBySession('session-a')).toBe(0)
    expect(other.signal.aborted).toBe(false)
    expect(service.controllers.size).toBe(1)
  })
})
