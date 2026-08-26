/**
 * Hardened HTTP boundary for the release protocol (latest.json, checksum
 * sidecars, tarballs). Every hop must be https — plain http is only tolerated
 * for loopback hosts so the protocol can be exercised against a local static
 * server in tests — redirects must stay on the origin of the first request,
 * responses are bounded by size and the whole chain by a deadline. Failures
 * throw `NetworkError` with a machine-readable `code`.
 */

export type NetworkErrorCode =
  | 'invalid-url'
  | 'redirect-missing-location'
  | 'cross-origin-redirect'
  | 'too-many-redirects'
  | 'http-status'
  | 'size-exceeded'
  | 'timeout'
  | 'network'

export class NetworkError extends Error {
  readonly code: NetworkErrorCode
  constructor(code: NetworkErrorCode, message: string) {
    super(message)
    this.name = 'NetworkError'
    this.code = code
  }
}

export interface BoundedFetchOptions {
  /** Deadline for the whole chain, including redirects. */
  readonly timeoutMs: number
  readonly maxBytes: number
  readonly maxRedirects?: number
}

export interface BoundedFetchResult {
  readonly bytes: Buffer
  readonly finalUrl: string
}

const DEFAULT_MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAXIMUM_BYTES_HARD_CAP = 512 * 1024 * 1024

export function validateReleaseUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new NetworkError('invalid-url', `not a valid URL: ${raw}`)
  }
  if (parsed.username || parsed.password) {
    throw new NetworkError('invalid-url', 'embedded credentials are not allowed in release URLs')
  }
  if (parsed.protocol === 'https:') return parsed
  if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) return parsed
  throw new NetworkError(
    'invalid-url',
    `release URLs must be https (http is only allowed on loopback hosts): ${raw}`,
  )
}

export function validateReleaseBaseUrl(raw: string): URL {
  const parsed = validateReleaseUrl(raw)
  if (parsed.search || parsed.hash) {
    throw new NetworkError(
      'invalid-url',
      'release base URLs cannot contain a query string or fragment',
    )
  }
  return parsed
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

export async function fetchBounded(
  url: string,
  options: BoundedFetchOptions,
): Promise<BoundedFetchResult> {
  const origin = validateReleaseUrl(url).origin
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const maxBytes = Math.min(options.maxBytes, MAXIMUM_BYTES_HARD_CAP)
  const deadline = Date.now() + options.timeoutMs

  let current = url
  for (let hop = 0; ; hop += 1) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new NetworkError(
        'timeout',
        `request to ${current} exceeded the ${options.timeoutMs}ms deadline`,
      )
    }
    const target = validateReleaseUrl(current)
    let response: Response
    try {
      response = await fetch(target, {
        redirect: 'manual',
        signal: AbortSignal.timeout(remaining),
        headers: { 'user-agent': 'spark-cli-update' },
      })
    } catch (error) {
      if (error instanceof NetworkError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      if (isTimeoutError(error)) {
        throw new NetworkError('timeout', `request to ${current} timed out: ${reason}`)
      }
      throw new NetworkError('network', `request to ${current} failed: ${reason}`)
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      if (hop >= maxRedirects) {
        throw new NetworkError(
          'too-many-redirects',
          `${url} exceeded ${maxRedirects} redirects (last hop: ${current})`,
        )
      }
      const location = response.headers.get('location')
      if (!location) {
        throw new NetworkError(
          'redirect-missing-location',
          `${current} redirected without a Location header`,
        )
      }
      let next: URL
      try {
        next = new URL(location, target)
      } catch {
        throw new NetworkError(
          'invalid-url',
          `${current} redirected to an invalid URL: ${location}`,
        )
      }
      if (next.origin !== origin) {
        throw new NetworkError(
          'cross-origin-redirect',
          `${current} redirected to ${next.href}, which leaves the release origin ${origin}`,
        )
      }
      current = next.href
      continue
    }

    if (response.status < 200 || response.status >= 300) {
      throw new NetworkError('http-status', `${current} returned HTTP ${response.status}`)
    }
    return { bytes: await readBody(response, current, maxBytes), finalUrl: current }
  }
}

async function readBody(response: Response, url: string, maxBytes: number): Promise<Buffer> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > maxBytes) {
      throw new NetworkError(
        'size-exceeded',
        `${url} declares ${length} bytes, over the ${maxBytes} byte limit`,
      )
    }
  }
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const read = await reader.read()
    if (read.done) break
    // lib.dom types the reader as ReadableStreamDefaultReader<any>, so the
    // value is asserted to its runtime type before any typed APIs consume it.
    const chunk = Uint8Array.from(read.value as Uint8Array)
    total += chunk.length
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new NetworkError('size-exceeded', `${url} exceeded the ${maxBytes} byte limit`)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}
