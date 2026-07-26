import { describe, expect, it, vi } from 'vitest'
import {
  describeNetworkError,
  fetchJson,
  fetchText,
  HttpError,
  isRetryableHttpError,
  sanitizeRequestUrl,
} from './http-retry.js'

function makeResponse(
  ok: boolean,
  status: number,
  body: unknown,
  binary = false,
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const buf = binary ? Buffer.from(body as string) : undefined
  const bytes = buf ?? Buffer.from(text)
  return {
    ok,
    status,
    text: async () => text,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as Response
}

function networkError(message: string, cause?: unknown): Error {
  const err = new Error(message)
  if (cause !== undefined) {
    ;(err as { cause?: unknown }).cause = cause
  }
  return err
}

describe('http-retry', () => {
  describe('fetchJson', () => {
    it('returns parsed JSON on 2xx', async () => {
      const fetchImpl = vi.fn(async () => makeResponse(true, 200, { hello: 'world' }))
      const result = await fetchJson<{ hello: string }>('https://example.com/api', { fetchImpl })
      expect(result).toEqual({ hello: 'world' })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('rejects malformed JSON on 2xx without retrying', async () => {
      const fetchImpl = vi.fn(async () => makeResponse(true, 200, 'not-json'))
      await expect(
        fetchJson('https://example.com/protocol', { fetchImpl }),
      ).rejects.toMatchObject({
        name: 'HttpError',
        code: 'invalid_json_response',
        statusCode: 200,
      })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('throws HttpError on 4xx without retry', async () => {
      const fetchImpl = vi
        .fn(async () => makeResponse(false, 404, { error: 'not found' }))
      await expect(
        fetchJson('https://example.com/missing', { fetchImpl }),
      ).rejects.toMatchObject({
        name: 'HttpError',
        statusCode: 404,
      })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('retries on 5xx up to maxRetries', async () => {
      const fetchImpl = vi
        .fn(async () => makeResponse(false, 503, { error: 'unavailable' }))
        .mockResolvedValueOnce(makeResponse(false, 503, { error: 'unavailable' }))
        .mockResolvedValueOnce(makeResponse(false, 503, { error: 'unavailable' }))
        .mockResolvedValueOnce(makeResponse(false, 503, { error: 'unavailable' }))
        .mockResolvedValueOnce(makeResponse(false, 503, { error: 'unavailable' }))

      const onRetry = vi.fn()
      await expect(
        fetchJson('https://example.com/flaky', {
          fetchImpl,
          maxRetries: 2,
          retryBackoffMs: 1,
          onRetry,
        }),
      ).rejects.toMatchObject({ name: 'HttpError', statusCode: 503 })

      // 1 initial + 2 retries = 3 total
      expect(fetchImpl).toHaveBeenCalledTimes(3)
      expect(onRetry).toHaveBeenCalledTimes(2)
    })

    it('eventually succeeds after transient 5xx', async () => {
      const fetchImpl = vi.fn(async () => makeResponse(true, 200, { ok: true }))
      fetchImpl
        .mockResolvedValueOnce(makeResponse(false, 503, {}))
        .mockResolvedValueOnce(makeResponse(false, 502, {}))
        .mockResolvedValueOnce(makeResponse(true, 200, { ok: true }))

      const result = await fetchJson<{ ok: boolean }>('https://example.com/recover', {
        fetchImpl,
        maxRetries: 3,
        retryBackoffMs: 1,
      })
      expect(result).toEqual({ ok: true })
      expect(fetchImpl).toHaveBeenCalledTimes(3)
    })

    it('retries on network error (fetch failed)', async () => {
      const fetchImpl = vi
        .fn()
        .mockRejectedValueOnce(networkError('fetch failed', { code: 'ECONNRESET' }))
        .mockRejectedValueOnce(networkError('fetch failed', { code: 'ECONNRESET' }))
        .mockResolvedValueOnce(makeResponse(true, 200, { recovered: true }))

      const result = await fetchJson<{ recovered: boolean }>('https://example.com/net', {
        fetchImpl,
        maxRetries: 3,
        retryBackoffMs: 1,
      })
      expect(result).toEqual({ recovered: true })
      expect(fetchImpl).toHaveBeenCalledTimes(3)
    })

    it('does NOT retry when maxRetries=0', async () => {
      const fetchImpl = vi.fn(async () => makeResponse(false, 500, {}))
      await expect(
        fetchJson('https://example.com/no-retry', {
          fetchImpl,
          maxRetries: 0,
        }),
      ).rejects.toMatchObject({ statusCode: 500 })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('wraps timeout as HttpError', async () => {
      const fetchImpl = vi.fn<typeof fetch>(async (_input, _init) => {
        // Simulate abort by waiting then throwing
        return new Promise((_, reject) => {
          setTimeout(() => {
            const err = new Error('The operation was aborted')
            err.name = 'AbortError'
            reject(err)
          }, 5)
        })
      })
      await expect(
        fetchJson('https://example.com/slow', {
          fetchImpl,
          timeoutMs: 1,
          maxRetries: 0,
        }),
      ).rejects.toMatchObject({ name: 'HttpError' })
    })

    it('respects errorFactory for custom error types', async () => {
      class CustomError extends Error {
        public statusCode: number
        constructor(status: number, message: string) {
          super(message)
          this.name = 'CustomError'
          this.statusCode = status
        }
      }
      const fetchImpl = vi.fn(async () => makeResponse(false, 422, { reason: 'bad' }))
      await expect(
        fetchJson('https://example.com/custom', {
          fetchImpl,
          errorFactory: (status, _body, rawText) =>
            new CustomError(status, `custom ${status}: ${rawText.slice(0, 50)}`),
        }),
      ).rejects.toMatchObject({ name: 'CustomError', statusCode: 422 })
    })

    it('returns Buffer when binary=true', async () => {
      const payload = Buffer.from('hello-binary-payload')
      const fetchImpl = vi.fn(async () => {
        const res = {
          ok: true,
          status: 200,
          text: async () => '',
          arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
        }
        return res as unknown as Response
      })
      const result = await fetchJson<Buffer>('https://example.com/blob', {
        fetchImpl,
        binary: true,
      })
      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result.toString('utf8')).toBe('hello-binary-payload')
    })

    it('passes method/headers/body to fetch', async () => {
      const fetchImpl = vi.fn(async () => makeResponse(true, 201, { created: true }))
      await fetchJson('https://example.com/create', {
        fetchImpl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      })
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://example.com/create',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    it('respects custom isRetryable', async () => {
      const fetchImpl = vi.fn(async () => makeResponse(false, 418, {}))
      // Treat 418 as retryable just for this test
      await expect(
        fetchJson('https://example.com/teapot', {
          fetchImpl,
          maxRetries: 2,
          retryBackoffMs: 1,
          isRetryable: (err) =>
            err instanceof HttpError ? err.statusCode === 418 : false,
        }),
      ).rejects.toMatchObject({ statusCode: 418 })
      expect(fetchImpl).toHaveBeenCalledTimes(3)
    })
  })

  describe('fetchText', () => {
    it('uses the shared retry path without requiring JSON', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(makeResponse(false, 503, 'temporarily unavailable', true))
        .mockResolvedValueOnce(makeResponse(true, 200, '# Skill\n正文', true))

      await expect(
        fetchText('https://example.com/SKILL.md', {
          fetchImpl,
          maxRetries: 1,
          retryBackoffMs: 1,
        }),
      ).resolves.toBe('# Skill\n正文')
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })
  })

  describe('isRetryableHttpError', () => {
    it('returns true for HttpError with 5xx', () => {
      expect(isRetryableHttpError(new HttpError('provider_http_error', 'x', 500))).toBe(true)
      expect(isRetryableHttpError(new HttpError('provider_http_error', 'x', 503))).toBe(true)
    })

    it('returns false for HttpError with 4xx', () => {
      expect(isRetryableHttpError(new HttpError('provider_http_error', 'x', 400))).toBe(false)
      expect(isRetryableHttpError(new HttpError('provider_http_error', 'x', 404))).toBe(false)
    })

    it('returns true for HttpError without statusCode (network)', () => {
      expect(isRetryableHttpError(new HttpError('provider_http_error', 'fetch failed'))).toBe(true)
    })

    it('returns false for non-provider HttpError codes', () => {
      expect(isRetryableHttpError(new HttpError('task_failed', 'x'))).toBe(false)
    })

    it('returns true for generic Error with 5xx statusCode property', () => {
      const err = new Error('x') as Error & { statusCode?: number }
      err.statusCode = 500
      expect(isRetryableHttpError(err)).toBe(true)
    })

    it('returns true for generic Error without statusCode (network)', () => {
      expect(isRetryableHttpError(new Error('fetch failed'))).toBe(true)
    })
  })

  describe('describeNetworkError', () => {
    it('returns readable message for fetch failed with cause', () => {
      const err = networkError('fetch failed', new Error('ECONNRESET'))
      const msg = describeNetworkError(err, 'GET', 'https://api.example.com/path?key=secret')
      expect(msg).toContain('GET https://api.example.com/path')
      expect(msg).toContain('ECONNRESET')
      // Should NOT contain the secret key
      expect(msg).not.toContain('secret')
    })

    it('returns undefined for non-network errors', () => {
      expect(describeNetworkError(new Error('some other error'), 'GET', 'https://x.com')).toBeUndefined()
    })

    it('handles various network error markers', () => {
      expect(describeNetworkError(new Error('socket hang up'), 'POST', 'https://x.com')).toBeDefined()
      expect(describeNetworkError(new Error('ETIMEDOUT'), 'GET', 'https://x.com')).toBeDefined()
      expect(describeNetworkError(new Error('ENOTFOUND'), 'GET', 'https://x.com')).toBeDefined()
    })
  })

  describe('sanitizeRequestUrl', () => {
    it('strips query and hash', () => {
      expect(sanitizeRequestUrl('https://api.example.com/path?token=secret#hash')).toBe(
        'https://api.example.com/path',
      )
    })

    it('returns origin+pathname for normal url', () => {
      expect(sanitizeRequestUrl('https://example.com/v1/list')).toBe(
        'https://example.com/v1/list',
      )
    })

    it('handles invalid urls', () => {
      expect(sanitizeRequestUrl('not-a-url')).toBe('not-a-url')
    })
  })
})
