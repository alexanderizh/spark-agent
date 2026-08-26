import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { fetchBounded, NetworkError, validateReleaseUrl } from '../../src/cli/net.js'

const closers: (() => Promise<void>)[] = []
const roots: string[] = []

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('release URL validation', () => {
  it('accepts https and loopback http, rejects everything else', () => {
    expect(validateReleaseUrl('https://releases.example.com/base').protocol).toBe('https:')
    expect(validateReleaseUrl('http://127.0.0.1:8080/x').protocol).toBe('http:')
    expect(validateReleaseUrl('http://localhost/x').protocol).toBe('http:')
    for (const invalid of [
      'http://releases.example.com/base',
      'ftp://releases.example.com/base',
      'file:///etc/passwd',
      'https://user:pass@releases.example.com/base',
      'not a url',
    ]) {
      expect(() => validateReleaseUrl(invalid), invalid).toThrow(NetworkError)
    }
  })
})

describe('bounded fetch', () => {
  it('downloads a loopback http body', async () => {
    const { baseUrl, close } = await serve((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"ok":true}')
    })
    const result = await fetchBounded(`${baseUrl}/latest.json`, {
      timeoutMs: 5_000,
      maxBytes: 1024,
    })
    expect(result.bytes.toString('utf8')).toBe('{"ok":true}')
    await close()
  })

  it('follows same-origin redirects but refuses cross-origin ones', async () => {
    const target = await serve((request, response) => {
      response.writeHead(200).end('arrived')
    })
    const redirector = await serve((request, response) => {
      if (request.url === '/start') {
        response.writeHead(302, { location: '/next' })
        response.end()
        return
      }
      if (request.url === '/next') {
        response.writeHead(200).end('arrived')
        return
      }
      if (request.url === '/cross') {
        response.writeHead(302, { location: `${target.baseUrl}/final` })
        response.end()
        return
      }
      response.writeHead(404).end()
    })
    const sameOrigin = await fetchBounded(`${redirector.baseUrl}/start`, {
      timeoutMs: 5_000,
      maxBytes: 1024,
      maxRedirects: 3,
    })
    expect(sameOrigin.bytes.toString('utf8')).toBe('arrived')

    await expect(
      fetchBounded(`${redirector.baseUrl}/cross`, { timeoutMs: 5_000, maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'cross-origin-redirect' })
    await Promise.all([redirector.close(), target.close()])
  })

  it('enforces the redirect budget', async () => {
    const { baseUrl, close } = await serve((request, response) => {
      response.writeHead(302, { location: request.url })
      response.end()
    })
    await expect(
      fetchBounded(`${baseUrl}/loop`, { timeoutMs: 5_000, maxBytes: 1024, maxRedirects: 2 }),
    ).rejects.toMatchObject({ code: 'too-many-redirects' })
    await close()
  })

  it('rejects a redirect without a Location header', async () => {
    const { baseUrl, close } = await serve((_request, response) => {
      response.writeHead(302).end()
    })
    await expect(
      fetchBounded(`${baseUrl}/x`, { timeoutMs: 5_000, maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'redirect-missing-location' })
    await close()
  })

  it('rejects error statuses', async () => {
    const { baseUrl, close } = await serve((_request, response) => {
      response.writeHead(500).end()
    })
    await expect(
      fetchBounded(`${baseUrl}/x`, { timeoutMs: 5_000, maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'http-status' })
    await close()
  })

  it('enforces the size cap from content-length and from the stream', async () => {
    const declared = await serve((_request, response) => {
      response.writeHead(200, { 'content-length': '999999' })
      response.end('x')
    })
    await expect(
      fetchBounded(`${declared.baseUrl}/x`, { timeoutMs: 5_000, maxBytes: 16 }),
    ).rejects.toMatchObject({ code: 'size-exceeded' })
    await declared.close()

    const streamed = await serve((_request, response) => {
      response.writeHead(200)
      response.end('x'.repeat(64))
    })
    await expect(
      fetchBounded(`${streamed.baseUrl}/x`, { timeoutMs: 5_000, maxBytes: 16 }),
    ).rejects.toMatchObject({ code: 'size-exceeded' })
    await streamed.close()
  })

  it('times out against a stalled server', async () => {
    const { baseUrl, close } = await serve(() => {
      // Intentionally never responds.
    })
    await expect(
      fetchBounded(`${baseUrl}/x`, { timeoutMs: 300, maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'timeout' })
    await close()
  })

  it('fails with a network error when the server is gone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-net-'))
    roots.push(root)
    await expect(
      fetchBounded(`http://127.0.0.1:1/x`, { timeoutMs: 2_000, maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'network' })
  })
})

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer(handler)
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server failed to bind')
  const close = () =>
    new Promise<void>((resolveClose) => {
      server.close(() => {
        resolveClose()
      })
    })
  closers.push(close)
  return { baseUrl: `http://127.0.0.1:${address.port}`, close }
}
