import { NULL_RUNTIME_LOGGER, type RuntimeLogger } from '../observability/logger.js'
import type { ToolCallContext, ToolExecutor } from '../seams.js'
import type { ResolvedToolCall, ToolDefinition, ToolOutcome } from './contract.js'

const DEFAULT_MAX_RESULTS = 5
const MAX_RESULTS_HARD_CAP = 10
const QUERY_MAX_CHARS = 512
const SEARCH_TIMEOUT_MS = 20_000
const SNIPPET_MAX_CHARS = 320

export const webSearchToolDefinition: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the public web and return ranked results (title, URL, snippet). Use for current information, facts to verify, or pages to read in full with web_fetch. Quality improves when an API key is configured (BOCHA_API_KEY, TAVILY_API_KEY, or SERPER_API_KEY); without one it falls back to a keyless search feed.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: QUERY_MAX_CHARS },
      max_results: { type: 'integer', minimum: 1, maximum: MAX_RESULTS_HARD_CAP },
    },
    required: ['query'],
    additionalProperties: false,
  },
  // Mirrors web_fetch: 'external' class pairs with readonly=false so the
  // registry's class/readonly consistency rule holds; search is still
  // approval-free because the query never carries caller credentials.
  readonly: false,
  permissionClass: 'external',
  approval: 'never',
  concurrency: 'parallel',
  timeoutMs: SEARCH_TIMEOUT_MS,
  interruptible: true,
  costClass: 'network',
}

export interface WebSearchResultItem {
  readonly title: string
  readonly url: string
  readonly snippet: string
}

/** Search providers in preference order; the keyless feed is the floor. */
type SearchProvider = 'bocha' | 'tavily' | 'serper' | 'bing'

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface WebSearchExecutorOptions {
  readonly logger?: RuntimeLogger
  readonly environment?: NodeJS.ProcessEnv
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchImpl?: FetchLike
}

export class WebSearchToolExecutor implements ToolExecutor {
  readonly #logger: RuntimeLogger
  readonly #environment: NodeJS.ProcessEnv
  readonly #fetchImpl: FetchLike

  constructor(options: WebSearchExecutorOptions = {}) {
    this.#logger = options.logger ?? NULL_RUNTIME_LOGGER
    this.#environment = options.environment ?? process.env
    this.#fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  }

  hasTool(name: string): boolean {
    return name === webSearchToolDefinition.name
  }

  async execute(call: ResolvedToolCall, context: ToolCallContext): Promise<ToolOutcome> {
    context.signal.throwIfAborted()
    const args = asRecord(call.args)
    if (args === undefined) return { ok: false, content: 'web_search arguments must be an object' }
    let query = ''
    try {
      query = searchQuery(args)
      const maxResults = boundedMaxResults(args.max_results)
      const provider = pickProvider(this.#environment)
      this.#logger.info(
        `web_search started provider=${provider} query=${JSON.stringify(query.slice(0, 120))}`,
      )
      const results = await this.#search(provider, query, maxResults, context.signal)
      this.#logger.info(`web_search completed provider=${provider} results=${results.length}`)
      return { ok: true, content: renderResults(query, results) }
    } catch (error) {
      if (context.signal.aborted) throw error
      const message = errorMessage(error)
      this.#logger.warn(
        `web_search failed query=${JSON.stringify(query.slice(0, 120))} reason=${message}`,
      )
      return { ok: false, content: message }
    }
  }

  async #search(
    provider: SearchProvider,
    query: string,
    maxResults: number,
    signal: AbortSignal,
  ): Promise<readonly WebSearchResultItem[]> {
    switch (provider) {
      case 'bocha':
        return searchViaBocha(query, maxResults, this.#environment, this.#fetchImpl, signal)
      case 'tavily':
        return searchViaTavily(query, maxResults, this.#environment, this.#fetchImpl, signal)
      case 'serper':
        return searchViaSerper(query, maxResults, this.#environment, this.#fetchImpl, signal)
      case 'bing':
        return searchViaBingFeed(query, maxResults, this.#fetchImpl, signal)
    }
  }
}

/**
 * First keyed provider wins; without any key the keyless Bing feed keeps the
 * tool usable everywhere at a lower result quality.
 */
export function pickProvider(environment: NodeJS.ProcessEnv): SearchProvider {
  if (nonEmpty(environment.BOCHA_API_KEY)) return 'bocha'
  if (nonEmpty(environment.TAVILY_API_KEY)) return 'tavily'
  if (nonEmpty(environment.SERPER_API_KEY)) return 'serper'
  return 'bing'
}

async function searchViaBocha(
  query: string,
  maxResults: number,
  environment: NodeJS.ProcessEnv,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<readonly WebSearchResultItem[]> {
  const payload = await postJson(
    'https://api.bochaai.com/v1/web-search',
    { query, count: maxResults, summary: true },
    { authorization: `Bearer ${environment.BOCHA_API_KEY}` },
    fetchImpl,
    signal,
  )
  const pages = asRecord(asRecord(payload?.data)?.webPages)?.value
  return (
    (Array.isArray(pages) ? pages : [])
      .map((entry) => {
        const record = asRecord(entry)
        return {
          title: text(record?.name),
          url: text(record?.url),
          snippet: text(record?.summary) || text(record?.snippet),
        }
      })
      // Bocha can include sitelinks without summaries; keep them out of the
      // numbered list so every rendered row carries real snippet content.
      .filter((entry) => entry.title !== '' && entry.url !== '' && entry.snippet !== '')
      .slice(0, maxResults)
  )
}

async function searchViaTavily(
  query: string,
  maxResults: number,
  environment: NodeJS.ProcessEnv,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<readonly WebSearchResultItem[]> {
  const payload = await postJson(
    'https://api.tavily.com/search',
    { query, max_results: maxResults },
    { authorization: `Bearer ${environment.TAVILY_API_KEY}` },
    fetchImpl,
    signal,
  )
  const results = Array.isArray(payload?.results) ? payload.results : []
  return results
    .map((entry) => {
      const record = asRecord(entry)
      return {
        title: text(record?.title),
        url: text(record?.url),
        snippet: text(record?.content),
      }
    })
    .filter((entry) => entry.title !== '' && entry.url !== '')
    .slice(0, maxResults)
}

async function searchViaSerper(
  query: string,
  maxResults: number,
  environment: NodeJS.ProcessEnv,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<readonly WebSearchResultItem[]> {
  const payload = await postJson(
    'https://google.serper.dev/search',
    { q: query, num: maxResults },
    { 'x-api-key': `${environment.SERPER_API_KEY}` },
    fetchImpl,
    signal,
  )
  const organic = Array.isArray(payload?.organic) ? payload.organic : []
  return organic
    .map((entry) => {
      const record = asRecord(entry)
      return {
        title: text(record?.title),
        url: text(record?.link),
        snippet: text(record?.snippet),
      }
    })
    .filter((entry) => entry.title !== '' && entry.url !== '')
    .slice(0, maxResults)
}

/**
 * Keyless fallback: Bing's RSS output for a web query. The feed is stable,
 * structured XML, and reachable from mainland networks, so search works with
 * zero configuration at the cost of snippet quality.
 */
async function searchViaBingFeed(
  query: string,
  maxResults: number,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<readonly WebSearchResultItem[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=${maxResults}`
  let response: Response
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]),
      headers: { 'user-agent': 'spark-cli-web-search', accept: 'application/rss+xml, text/xml' },
    })
  } catch (error) {
    throw new WebSearchError(
      `web_search keyless feed failed: ${errorMessage(error)}. Configure BOCHA_API_KEY, TAVILY_API_KEY, or SERPER_API_KEY for a keyed search provider.`,
      { cause: error },
    )
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new WebSearchError(
      `web_search keyless feed returned HTTP ${response.status}. Configure BOCHA_API_KEY, TAVILY_API_KEY, or SERPER_API_KEY for a keyed search provider.`,
    )
  }
  const xml = await response.text()
  return parseRssItems(xml, maxResults)
}

/** Extracts `<item><title/><link/><description/></item>` rows from an RSS feed. */
export function parseRssItems(xml: string, maxResults: number): readonly WebSearchResultItem[] {
  const items: WebSearchResultItem[] = []
  const pattern = /<item>([\s\S]*?)<\/item>/giu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null && items.length < maxResults) {
    // Unwrap CDATA sections first: their payload would otherwise be eaten by
    // the tag stripper below (`<![CDATA[...]]>` parses as one bogus tag).
    const block = (match[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    // Decode entities before stripping tags: encoded entities (&lt;b&gt;) only
    // become real tags after decoding, so the reverse order leaves markup in.
    const title = stripTags(decodeXmlEntities(extractTag(block, 'title')))
    const link = stripTags(decodeXmlEntities(extractTag(block, 'link')))
    const snippet = clampSnippet(stripTags(decodeXmlEntities(extractTag(block, 'description'))))
    if (title === '' || link === '') continue
    items.push({ title, url: link, snippet })
  }
  return items
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Readonly<Record<string, string>>,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<Record<string, unknown> | undefined> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      signal: AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]),
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new WebSearchError(`web_search request failed: ${errorMessage(error)}`, { cause: error })
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new WebSearchError(`web_search provider returned HTTP ${response.status}`)
  }
  try {
    return asRecord(JSON.parse(await response.text()))
  } catch (error) {
    throw new WebSearchError('web_search provider returned invalid JSON', { cause: error })
  }
}

function renderResults(query: string, results: readonly WebSearchResultItem[]): string {
  if (results.length === 0) return `No results found for ${JSON.stringify(query)}.`
  const lines = [`Web results for ${JSON.stringify(query)} (${results.length}):`]
  for (const [index, item] of results.entries()) {
    lines.push(`${index + 1}. ${item.title}`)
    lines.push(`   URL: ${item.url}`)
    if (item.snippet !== '') lines.push(`   ${clampSnippet(item.snippet)}`)
  }
  return lines.join('\n')
}

function searchQuery(args: Record<string, unknown>): string {
  const value = args.query
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WebSearchError('query must be a non-empty string')
  }
  const trimmed = value.trim()
  if (trimmed.length > QUERY_MAX_CHARS) {
    throw new WebSearchError(`query must be at most ${QUERY_MAX_CHARS} characters`)
  }
  return trimmed
}

function boundedMaxResults(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_RESULTS
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new WebSearchError('max_results must be an integer')
  }
  if (value < 1 || value > MAX_RESULTS_HARD_CAP) {
    throw new WebSearchError(`max_results must be an integer from 1 to ${MAX_RESULTS_HARD_CAP}`)
  }
  return value
}

function extractTag(block: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'iu').exec(block)
  return match?.[1] ?? ''
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .trim()
}

function clampSnippet(value: string): string {
  const flattened = value.replaceAll(/\s+/gu, ' ').trim()
  return flattened.length <= SNIPPET_MAX_CHARS
    ? flattened
    : `${flattened.slice(0, SNIPPET_MAX_CHARS - 1)}…`
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, "'")
    .replace(/&#(x[\da-f]+|\d+);/giu, (_match, raw: string) => {
      const codePoint = raw.toLowerCase().startsWith('x')
        ? Number.parseInt(raw.slice(1), 16)
        : Number.parseInt(raw, 10)
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ''
    })
    .replace(/&amp;/giu, '&')
}

export class WebSearchError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'WebSearchError'
  }
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
