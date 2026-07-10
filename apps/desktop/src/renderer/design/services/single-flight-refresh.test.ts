import { describe, expect, it, vi } from 'vitest'
import { createSingleFlightRefresh } from './single-flight-refresh'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('createSingleFlightRefresh', () => {
  it('shares one promise for concurrent refreshes', async () => {
    const request = deferred()
    const refresh = vi.fn(() => request.promise)
    const coordinator = createSingleFlightRefresh(refresh)

    const first = coordinator.run()
    const second = coordinator.run()

    expect(first).toBe(second)
    expect(refresh).toHaveBeenCalledTimes(1)
    request.resolve()
    await first
  })

  it('coalesces invalidations into one trailing refresh', async () => {
    const firstRequest = deferred()
    const secondRequest = deferred()
    const thirdRequest = deferred()
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise)
      .mockReturnValueOnce(thirdRequest.promise)
    const coordinator = createSingleFlightRefresh(refresh)

    const current = coordinator.run()
    const firstInvalidation = coordinator.invalidate()
    const secondInvalidation = coordinator.invalidate()

    expect(firstInvalidation).toBe(secondInvalidation)
    expect(refresh).toHaveBeenCalledTimes(1)

    firstRequest.resolve()
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))

    const invalidatedDuringTrailingRefresh = coordinator.invalidate()
    secondRequest.resolve()
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(3))

    thirdRequest.resolve()
    await Promise.all([current, firstInvalidation, invalidatedDuringTrailingRefresh])
  })
})
