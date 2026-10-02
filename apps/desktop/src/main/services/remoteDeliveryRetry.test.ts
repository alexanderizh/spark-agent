import { describe, expect, it, vi } from 'vitest'

import {
  deliverWithRetry,
  describeDeliveryError,
  isTransientDeliveryError,
} from './remoteDeliveryRetry.js'

describe('isTransientDeliveryError', () => {
  it('treats undici fetch-failed with network cause as retryable', () => {
    const error = new TypeError('fetch failed')
    ;(error as { cause?: unknown }).cause = new Error('connect ECONNRESET api.telegram.org')
    expect(isTransientDeliveryError(error)).toBe(true)
  })

  it('treats common network/timeout messages as retryable', () => {
    expect(isTransientDeliveryError(new TypeError('fetch failed'))).toBe(true)
    expect(isTransientDeliveryError(new Error('socket hang up'))).toBe(true)
    expect(isTransientDeliveryError(new Error('POST https://x/y timed out after 30000ms'))).toBe(
      true,
    )
    expect(isTransientDeliveryError(new Error('https://x/y failed: 502 Bad Gateway'))).toBe(true)
    expect(isTransientDeliveryError(new Error('https://x/y failed: 429 Too Many Requests'))).toBe(
      true,
    )
  })

  it('does not retry request-level rejections', () => {
    expect(isTransientDeliveryError(new Error('https://x/y failed: 400 Bad Request'))).toBe(false)
    expect(isTransientDeliveryError(new Error('https://x/y failed: 401 Unauthorized'))).toBe(false)
    expect(isTransientDeliveryError(new Error('Telegram token 无效'))).toBe(false)
    expect(isTransientDeliveryError(new Error('Pairing code expired'))).toBe(false)
  })

  it('follows nested cause chains', () => {
    const root = new Error('getaddrinfo ENOTFOUND api.telegram.org')
    const middle = new TypeError('fetch failed')
    ;(middle as { cause?: unknown }).cause = root
    expect(isTransientDeliveryError(middle)).toBe(true)
  })
})

describe('describeDeliveryError', () => {
  it('includes the underlying cause for fetch failed', () => {
    const error = new TypeError('fetch failed')
    ;(error as { cause?: unknown }).cause = new Error('connect ETIMEDOUT 1.2.3.4:443')
    expect(describeDeliveryError(error)).toBe('fetch failed (cause: connect ETIMEDOUT 1.2.3.4:443)')
  })

  it('returns plain message when there is no cause', () => {
    expect(describeDeliveryError(new Error('boom'))).toBe('boom')
    expect(describeDeliveryError('plain string')).toBe('plain string')
  })
})

describe('deliverWithRetry', () => {
  it('retries transient failures with the configured delays and succeeds', async () => {
    let attempts = 0
    const onRetry = vi.fn()
    await deliverWithRetry(
      async () => {
        attempts += 1
        if (attempts < 3) throw new TypeError('fetch failed')
      },
      { delaysMs: [1, 1, 1], onRetry },
    )
    expect(attempts).toBe(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('gives up after exhausting retries and rethrows the last error', async () => {
    let attempts = 0
    await expect(
      deliverWithRetry(
        async () => {
          attempts += 1
          throw new TypeError('fetch failed')
        },
        { delaysMs: [1, 1] },
      ),
    ).rejects.toThrow('fetch failed')
    expect(attempts).toBe(3)
  })

  it('does not retry non-transient errors', async () => {
    let attempts = 0
    await expect(
      deliverWithRetry(
        async () => {
          attempts += 1
          throw new Error('https://x/y failed: 400 Bad Request')
        },
        { delaysMs: [1, 1, 1] },
      ),
    ).rejects.toThrow('400')
    expect(attempts).toBe(1)
  })

  it('resolves immediately when the first delivery succeeds', async () => {
    const onRetry = vi.fn()
    await deliverWithRetry(async () => undefined, { delaysMs: [1], onRetry })
    expect(onRetry).not.toHaveBeenCalled()
  })
})
