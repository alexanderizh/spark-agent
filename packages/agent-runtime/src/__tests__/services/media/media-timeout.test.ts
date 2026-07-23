import { describe, expect, it } from 'vitest'
import {
  configuredMediaInterfaceTimeoutMs,
  mediaPollTimeoutOptions,
  resolveMediaInterfaceTimeoutMs,
} from '../../../services/media/media-timeout.js'

describe('media interface timeout', () => {
  it('prefers the provider-wide timeout over the legacy polling timeout', () => {
    const defaults = {
      timeoutMs: 6_000_000,
      polling: { timeoutMs: 600_000 },
    }

    expect(configuredMediaInterfaceTimeoutMs(defaults)).toBe(6_000_000)
    expect(resolveMediaInterfaceTimeoutMs(defaults, 180_000)).toBe(6_000_000)
  })

  it('falls back to the legacy polling timeout', () => {
    const defaults = { polling: { timeoutMs: 600_000 } }

    expect(configuredMediaInterfaceTimeoutMs(defaults)).toBe(600_000)
    expect(resolveMediaInterfaceTimeoutMs(defaults, 180_000)).toBe(600_000)
  })

  it('uses the adapter fallback when no valid configured timeout exists', () => {
    expect(configuredMediaInterfaceTimeoutMs(undefined)).toBeUndefined()
    expect(resolveMediaInterfaceTimeoutMs(undefined, 180_000)).toBe(180_000)
  })

  it('keeps positive legacy test and compatibility timeouts', () => {
    expect(configuredMediaInterfaceTimeoutMs({ polling: { timeoutMs: 5 } })).toBe(5)
    expect(configuredMediaInterfaceTimeoutMs({ timeoutMs: 0 })).toBeUndefined()
  })

  it('only overrides the per-request polling timeout when the provider configured one', () => {
    expect(mediaPollTimeoutOptions({ timeoutMs: 6_000_000 }, 600_000)).toEqual({
      timeoutMs: 6_000_000,
      requestTimeoutMs: 6_000_000,
    })
    expect(mediaPollTimeoutOptions(undefined, 600_000)).toEqual({ timeoutMs: 600_000 })
  })
})
