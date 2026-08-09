import type { BrowserLinkMetadata } from '@spark/protocol'

const LINK_METADATA_CACHE_TTL_MS = 5 * 60 * 1000
const LINK_METADATA_CACHE_LIMIT = 128
const LINK_METADATA_TIMEOUT_MS = 3500
const MAX_HTML_LENGTH = 512 * 1024

type CacheEntry = {
  expiresAt: number
  metadata: BrowserLinkMetadata | null
}

const metadataCache = new Map<string, CacheEntry>()

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, token: string) => {
      const lower = token.toLowerCase()
      if (lower === 'amp') return '&'
      if (lower === 'lt') return '<'
      if (lower === 'gt') return '>'
      if (lower === 'quot') return '"'
      if (lower === 'apos') return "'"
      if (lower === 'nbsp') return ' '
      const codePoint = lower.startsWith('#x')
        ? Number.parseInt(lower.slice(2), 16)
        : Number.parseInt(lower.slice(1), 10)
      if (!Number.isFinite(codePoint)) return entity
      try {
        return String.fromCodePoint(codePoint)
      } catch {
        return entity
      }
    },
  )
}

function readAttribute(tag: string, attribute: string): string | null {
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return match?.[2] != null ? decodeHtmlEntities(match[2]) : null
}

function findMetaContent(html: string, names: string[]): string | null {
  const acceptedNames = new Set(names.map((name) => name.toLowerCase()))
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of metaTags) {
    const name = readAttribute(tag, 'property') ?? readAttribute(tag, 'name')
    const content = readAttribute(tag, 'content')
    if (name != null && content != null && acceptedNames.has(name.toLowerCase())) {
      const normalized = content.replace(/\s+/g, ' ').trim()
      if (normalized.length > 0) return normalized
    }
  }
  return null
}

function findIconUrl(html: string, pageUrl: string): string | undefined {
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? []
  for (const tag of linkTags) {
    const rel = readAttribute(tag, 'rel')
    const href = readAttribute(tag, 'href')
    if (rel == null || href == null) continue
    if (!rel.toLowerCase().split(/\s+/).includes('icon')) continue
    try {
      return new URL(href, pageUrl).toString()
    } catch {
      return undefined
    }
  }
  return undefined
}

export function parseLinkMetadata(html: string, pageUrl: string): BrowserLinkMetadata | null {
  const title =
    findMetaContent(html, ['og:title', 'twitter:title']) ??
    (() => {
      const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
      return match?.[1] == null
        ? null
        : decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim()
    })()

  if (title == null || title.length === 0) return null

  const faviconUrl = findIconUrl(html, pageUrl)
  return {
    title: title.slice(0, 240),
    ...(faviconUrl != null ? { faviconUrl } : {}),
  }
}

function normalizeHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

function setCache(url: string, metadata: BrowserLinkMetadata | null): void {
  metadataCache.set(url, {
    expiresAt: Date.now() + LINK_METADATA_CACHE_TTL_MS,
    metadata,
  })
  while (metadataCache.size > LINK_METADATA_CACHE_LIMIT) {
    const oldestKey = metadataCache.keys().next().value
    if (oldestKey == null) break
    metadataCache.delete(oldestKey)
  }
}

export function clearLinkMetadataCache(): void {
  metadataCache.clear()
}

export async function fetchLinkMetadata(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<BrowserLinkMetadata | null> {
  const normalizedUrl = normalizeHttpUrl(url)
  if (normalizedUrl == null) return null

  const cached = metadataCache.get(normalizedUrl)
  if (cached != null && cached.expiresAt > Date.now()) return cached.metadata
  if (cached != null) metadataCache.delete(normalizedUrl)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), LINK_METADATA_TIMEOUT_MS)
  try {
    const response = await fetcher(normalizedUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Spark-Agent Link Preview',
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!response.ok || (contentType.length > 0 && !contentType.includes('text/html'))) {
      setCache(normalizedUrl, null)
      return null
    }

    const html = (await response.text()).slice(0, MAX_HTML_LENGTH)
    const metadata = parseLinkMetadata(html, response.url || normalizedUrl)
    if (metadata != null && metadata.faviconUrl == null) {
      metadata.faviconUrl = new URL('/favicon.ico', response.url || normalizedUrl).toString()
    }
    setCache(normalizedUrl, metadata)
    return metadata
  } catch {
    setCache(normalizedUrl, null)
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}
