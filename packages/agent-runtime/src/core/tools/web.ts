import type { RegisteredTool, ToolContext, ToolResult } from '../tool-registry.js'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_FETCH_BYTES = 1_000_000
const MAX_OUTPUT_CHARS = 30_000
const USER_AGENT = 'SparkAgent/0.1 (+https://github.com/spark-agent)'

/**
 * web_fetch — Fetch a URL and return cleaned-up text content.
 *
 * Returns at most ~30k characters; HTML is converted to plain text
 * (script/style stripped, tags removed). Use it to read docs, blog posts,
 * RFCs, or pull-request bodies that the user references by URL.
 */
export const webFetchTool: RegisteredTool = {
  definition: {
    name: 'web_fetch',
    description: 'Fetch a URL and return its text content (HTML is auto-stripped to plain text, capped at 30k chars). Use for reading docs, RFCs, blog posts.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute HTTP/HTTPS URL to fetch' },
        timeoutMs: { type: 'number', description: 'Override timeout (default 30s, max 60s)' },
      },
      required: ['url'],
    },
  },
  async execute(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now()
    const url = String(input['url'] ?? '')
    const timeoutMs = clampTimeout(input['timeoutMs'])

    const validation = validateUrl(url)
    if (validation != null) return { status: 'error', error: validation, durationMs: Date.now() - start }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
        redirect: 'follow',
      })
      const contentType = res.headers.get('content-type') ?? ''
      const buffer = await readBoundedBody(res, MAX_FETCH_BYTES)
      const text = decodeBody(buffer, contentType)
      const cleaned = contentType.includes('html') ? htmlToText(text) : text
      const truncated = cleaned.length > MAX_OUTPUT_CHARS
      const output = truncated ? `${cleaned.slice(0, MAX_OUTPUT_CHARS)}\n...<truncated>` : cleaned
      return {
        status: 'success',
        output: { url: res.url, status: res.status, contentType, length: cleaned.length, truncated, content: output },
        durationMs: Date.now() - start,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { status: 'error', error: `fetch failed: ${msg}`, durationMs: Date.now() - start }
    } finally {
      clearTimeout(timer)
    }
  },
}

/**
 * web_search — Lightweight web search via DuckDuckGo's HTML endpoint.
 *
 * Returns up to 10 results (title, url, snippet). For better quality results
 * configure an API-backed provider (Tavily/Brave/Serper) in a future PR.
 */
export const webSearchTool: RegisteredTool = {
  definition: {
    name: 'web_search',
    description: 'Search the web and return up to 10 results (title, url, snippet). Use to find docs, API references, error messages, recent changes.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max results to return (default 10, capped at 20)' },
      },
      required: ['query'],
    },
  },
  async execute(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now()
    const query = String(input['query'] ?? '').trim()
    if (query.length === 0) return { status: 'error', error: 'query is required', durationMs: Date.now() - start }
    const maxResults = clampMaxResults(input['maxResults'])

    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT },
      })
      if (!res.ok) {
        return { status: 'error', error: `search failed: HTTP ${res.status}`, durationMs: Date.now() - start }
      }
      const html = await res.text()
      const results = parseDuckDuckGoResults(html).slice(0, maxResults)
      return {
        status: 'success',
        output: { query, count: results.length, results },
        durationMs: Date.now() - start,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { status: 'error', error: `search failed: ${msg}`, durationMs: Date.now() - start }
    } finally {
      clearTimeout(timer)
    }
  },
}

function validateUrl(raw: string): string | null {
  if (raw.length === 0) return 'url is required'
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return 'url is not a valid URL'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `only http/https URLs are supported (got ${parsed.protocol})`
  }
  // SSRF basic guard: refuse loopback / link-local literals.
  // 注：不对所有 DNS 做解析（开销大）；如果用户在受信任的内网，需要明确配置代理或允许列表。
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')) {
    return 'loopback URLs are blocked'
  }
  if (host === '0.0.0.0' || host.startsWith('169.254.')) {
    return 'link-local URLs are blocked'
  }
  return null
}

function clampTimeout(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TIMEOUT_MS
  return Math.max(1000, Math.min(60_000, n))
}

function clampMaxResults(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 10
  return Math.max(1, Math.min(20, Math.floor(n)))
}

async function readBoundedBody(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader()
  if (reader == null) return new Uint8Array(await res.arrayBuffer())
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value != null) {
      chunks.push(value)
      total += value.byteLength
      if (total >= maxBytes) {
        try { await reader.cancel() } catch { /* ignore */ }
        break
      }
    }
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

function decodeBody(buffer: Uint8Array, contentType: string): string {
  const charsetMatch = /charset=([\w-]+)/i.exec(contentType)
  const charset = charsetMatch?.[1]?.toLowerCase() ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

/**
 * Convert HTML to plain text:
 * 1. Drop <script>/<style>/<noscript> blocks entirely.
 * 2. Replace block-level tags with newlines.
 * 3. Strip all remaining tags.
 * 4. Decode HTML entities (basic set).
 * 5. Collapse whitespace.
 *
 * This is intentionally minimal — no full DOM parsing. For the agent's
 * "skim a doc page" use case it's sufficient.
 */
function htmlToText(html: string): string {
  let s = html
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|main|nav|aside)>/gi, '\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  // collapse whitespace
  s = s.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

interface SearchResult { title: string; url: string; snippet: string }

/**
 * Minimal DuckDuckGo HTML SERP parser.
 * DDG's structure changes occasionally; we look for `<a class="result__a">` anchors
 * and `<a class="result__snippet">` siblings. If parsing fails we return [] (agent
 * will degrade gracefully).
 */
function parseDuckDuckGoResults(html: string): SearchResult[] {
  const out: SearchResult[] = []
  const blockRe = /<div class="result results_links[^"]*"[\s\S]*?<\/div>\s*<\/div>/g
  const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(html)) != null) {
    const block = match[0]
    const tm = titleRe.exec(block)
    const sm = snippetRe.exec(block)
    if (tm == null) continue
    const href = tm[1] ?? ''
    const title = decodeEntities(stripTags(tm[2] ?? '')).trim()
    const snippet = sm ? decodeEntities(stripTags(sm[1] ?? '')).trim() : ''
    // DDG redirects via /l/?uddg=... — unwrap.
    const realUrl = unwrapDuckDuckGoUrl(href)
    if (realUrl.length === 0 || title.length === 0) continue
    out.push({ title, url: realUrl, snippet })
  }
  return out
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

function unwrapDuckDuckGoUrl(href: string): string {
  if (href.startsWith('//')) href = 'https:' + href
  try {
    const u = new URL(href, 'https://duckduckgo.com')
    const target = u.searchParams.get('uddg')
    if (target != null) return decodeURIComponent(target)
    return u.toString()
  } catch {
    return ''
  }
}
