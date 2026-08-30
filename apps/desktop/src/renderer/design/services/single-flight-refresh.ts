export interface SingleFlightRefresh {
  run: () => Promise<void>
  invalidate: () => Promise<void>
}

export function createSingleFlightRefresh(refresh: () => Promise<void>): SingleFlightRefresh {
  let current: Promise<void> | null = null
  let requestedRevision = 0

  const run = (): Promise<void> => {
    if (current != null) return current
    const request = (async () => {
      let completedRevision = -1
      while (completedRevision !== requestedRevision) {
        const revision = requestedRevision
        await refresh()
        completedRevision = revision
      }
    })()
    current = request
    void request.then(
      () => {
        if (current === request) current = null
      },
      () => {
        if (current === request) current = null
      },
    )
    return request
  }

  const invalidate = (): Promise<void> => {
    requestedRevision += 1
    return run()
  }

  return { run, invalidate }
}
