import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearLinkMetadataCache,
  fetchLinkMetadata,
  parseLinkMetadata,
} from './LinkMetadataService.js'

describe('LinkMetadataService', () => {
  afterEach(() => {
    clearLinkMetadataCache()
    vi.restoreAllMocks()
  })

  it('prefers the page title and resolves the site icon against the final URL', () => {
    expect(
      parseLinkMetadata(
        `
          <head>
            <meta property="og:title" content="Spark &amp; Work" />
            <link rel="shortcut icon" href="/assets/icon.svg" />
            <title>Fallback title</title>
          </head>
        `,
        'https://example.com/docs/start',
      ),
    ).toEqual({
      title: 'Spark & Work',
      faviconUrl: 'https://example.com/assets/icon.svg',
    })
  })

  it('returns null when the response is not an HTML document with a title', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response('<body>not enough metadata</body>', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    await expect(fetchLinkMetadata('https://example.com/plain', fetcher)).resolves.toBeNull()
  })

  it('caches successful metadata requests for the same URL', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response('<title>Example</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    await expect(fetchLinkMetadata('https://example.com', fetcher)).resolves.toEqual({
      title: 'Example',
      faviconUrl: 'https://example.com/favicon.ico',
    })
    await expect(fetchLinkMetadata('https://example.com', fetcher)).resolves.toEqual({
      title: 'Example',
      faviconUrl: 'https://example.com/favicon.ico',
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
