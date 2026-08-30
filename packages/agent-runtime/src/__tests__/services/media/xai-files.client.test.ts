import { describe, expect, it } from 'vitest'
import { XAI_MAX_FILE_BYTES, XaiFilesClient } from '../../../services/media/xai-files.client.js'

describe('XaiFilesClient', () => {
  it('lists and deletes files with official paths', async () => {
    const calls: Array<{ url: string; method: string }> = []
    const client = new XaiFilesClient({
      apiKey: 'key',
      apiEndpoint: 'https://api.x.ai/v1',
      fetch: (async (input, init) => {
        calls.push({ url: String(input), method: init?.method ?? 'GET' })
        return new Response(
          JSON.stringify(String(input).includes('/files/file-1')
            ? { deleted: true, id: 'file-1' }
            : { data: [], pagination_token: 'next' }),
        )
      }) as typeof fetch,
    })

    await expect(client.list({ limit: 100, order: 'desc', sortBy: 'created_at' })).resolves.toEqual({
      data: [],
      pagination_token: 'next',
    })
    await expect(client.delete('file-1')).resolves.toEqual({ deleted: true, id: 'file-1' })
    expect(calls).toEqual([
      {
        url: 'https://api.x.ai/v1/files?limit=100&order=desc&sort_by=created_at',
        method: 'GET',
      },
      { url: 'https://api.x.ai/v1/files/file-1', method: 'DELETE' },
    ])
  })

  it('places expires_after before file and enforces limits', async () => {
    let keys: string[] = []
    const client = new XaiFilesClient({
      apiKey: 'key',
      apiEndpoint: 'https://api.x.ai/v1',
      fetch: (async (_input, init) => {
        keys = [...(init?.body as FormData).keys()]
        return new Response(JSON.stringify({
          id: 'file-1', filename: 'image.png', bytes: 3, created_at: 1, object: 'file', purpose: 'vision',
        }))
      }) as typeof fetch,
    })

    await client.upload({ buffer: Buffer.from('abc'), filename: 'image.png', expiresAfter: 3600 })
    expect(keys).toEqual(['expires_after', 'file'])
    await expect(
      client.upload({ buffer: Buffer.alloc(XAI_MAX_FILE_BYTES + 1), filename: 'too-large.bin' }),
    ).rejects.toThrow('48 MiB')
    await expect(
      client.upload({ buffer: Buffer.from('x'), filename: 'x.bin', expiresAfter: 3599 }),
    ).rejects.toThrow('3600–2592000')
  })

  it('uses only the official file sorting fields', async () => {
    const urls: string[] = []
    const client = new XaiFilesClient({
      apiKey: 'key',
      apiEndpoint: 'https://api.x.ai/v1',
      fetch: (async (input) => {
        urls.push(String(input))
        return new Response(JSON.stringify({ data: [], pagination_token: '' }))
      }) as typeof fetch,
    })
    await client.list({ sortBy: 'filename', order: 'asc' })
    await client.list({ sortBy: 'size', order: 'desc' })
    expect(urls[0]).toContain('sort_by=filename')
    expect(urls[1]).toContain('sort_by=size')
  })

  it('preserves HTTP status for non-JSON provider errors', async () => {
    const client = new XaiFilesClient({
      apiKey: 'test-key',
      apiEndpoint: 'https://api.x.ai/v1',
      fetch: async () => new Response('<html>upstream unavailable</html>', { status: 502 }),
    })

    await expect(client.list()).rejects.toMatchObject({
      code: 'provider_http_error',
      statusCode: 502,
    })
  })

  it('times out stalled file requests with a phase-specific error', async () => {
    const client = new XaiFilesClient({
      apiKey: 'test-key',
      apiEndpoint: 'https://api.x.ai/v1',
      timeoutMs: 5,
      fetch: ((_: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })) as typeof fetch,
    })

    await expect(client.list()).rejects.toThrow('xAI Files GET /files timed out after 5ms')
  })
})
