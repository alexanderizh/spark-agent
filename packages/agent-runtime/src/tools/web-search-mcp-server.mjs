#!/usr/bin/env node
/**
 * spark_search MCP server — 内置联网搜索 + 网页抓取。
 *
 * 存在意义：当 agent 走第三方 OpenAI-compatible provider 时，SDK 自带的
 * WebSearch / WebFetch（Anthropic 第一方服务端工具）会被剥离失效。本 MCP
 * server 在独立 Node 子进程内自己发 HTTP，和模型 provider 完全解耦 —— 谁家
 * 模型都能用，且对所有 session 默认挂载，开箱即用。
 *
 * 协议：stdio JSON-RPC 2.0（与 tools/image-generation-mcp-server.mjs 一致）。
 *
 * 工具（SDK 命名空间 mcp__spark_search__）：
 *   web_search  — 联网搜索，返回排序后的 [{title, url, snippet}]
 *   fetch_url   — 抓取网页正文并清洗为可读文本（替代失效的 WebFetch）
 *
 * 搜索后端（多后端自动降级，国内优先）：
 *   ① 免密默认链（零 key 零配置）：cn.bing.com → 百度 → DuckDuckGo
 *   ② 填 key 增强（自动优先）：bocha(博查) / tavily / serper(Google)
 *
 * 配置全部来自环境变量（API key 仅在本子进程内存内，不外泄）：
 *   SPARK_SEARCH_PROVIDER   auto | bocha | tavily | serper | bing | baidu | duckduckgo（默认 auto）
 *   SPARK_SEARCH_API_KEY    keyed provider 的 API key（仅 bocha/tavily/serper 需要）
 *   SPARK_SEARCH_BASE_URL   keyed provider 的 base url 覆盖（可选）
 *   SPARK_SEARCH_TIMEOUT_MS 单次请求超时，默认 15000
 *   SPARK_SEARCH_FETCH_MAX_CHARS fetch_url 默认正文上限，默认 8000
 */
import readline from 'node:readline'

const env = process.env

const PROVIDER = (env.SPARK_SEARCH_PROVIDER || 'auto').trim().toLowerCase()
const API_KEY = (env.SPARK_SEARCH_API_KEY || '').trim()
const BASE_URL = (env.SPARK_SEARCH_BASE_URL || '').trim()
const TIMEOUT_MS = Number.parseInt(env.SPARK_SEARCH_TIMEOUT_MS || '', 10) || 15000
const FETCH_MAX_CHARS = Number.parseInt(env.SPARK_SEARCH_FETCH_MAX_CHARS || '', 10) || 8000

const KEYED = new Set(['bocha', 'tavily', 'serper'])
const KEYLESS = new Set(['bing', 'baidu', 'duckduckgo'])

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ── JSON-RPC framing ───────────────────────────────────────────────────────
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}
function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}
function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

// ── HTTP helpers ───────────────────────────────────────────────────────────
async function httpFetch(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS)
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(options.headers || {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

async function httpText(url, options) {
  const res = await httpFetch(url, options)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

async function httpJson(url, options) {
  const res = await httpFetch(url, options)
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 300)}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 300)}`)
  }
}

// ── HTML utilities (no deps) ───────────────────────────────────────────────
const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&middot;': '·', '&hellip;': '…', '&mdash;': '—',
  '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”',
}
function decodeEntities(str) {
  if (!str) return ''
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number.parseInt(d, 10)))
    .replace(/&[a-zA-Z]+;/g, (m) => ENTITIES[m] ?? m)
}
function safeCodePoint(cp) {
  try {
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : ''
  } catch {
    return ''
  }
}
function stripTags(html) {
  if (!html) return ''
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/** 抽取整页可读文本：去脚本/样式，块级标签转换行，去标签，归一空白。 */
function htmlToText(html) {
  let s = html
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<(script|style|noscript|template|svg|head)[\s\S]*?<\/\1>/gi, ' ')
  // 优先正文容器
  const main = s.match(/<(article|main)[\s\S]*?<\/\1>/i)
  if (main) s = main[0]
  s = s.replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|header|footer)>/gi, '\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
  s = s.replace(/[ \t\u00a0]+/g, ' ')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.split('\n').map((line) => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function buildQuery(query, site) {
  return site && site.trim() ? `${query} site:${site.trim()}` : query
}

// ── 免密引擎：HTML 抓取 ─────────────────────────────────────────────────────
async function searchBing(query, count, site) {
  const q = encodeURIComponent(buildQuery(query, site))
  const html = await httpText(`https://cn.bing.com/search?q=${q}&setlang=zh-CN&ensearch=0`)
  const out = []
  const blocks = html.split(/<li class="b_algo"/i).slice(1)
  for (const block of blocks) {
    const a = block.match(/<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!a) continue
    const url = decodeEntities(a[1])
    const title = stripTags(a[2])
    if (!url || !title || !/^https?:/i.test(url)) continue
    const p =
      block.match(/<p class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ||
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    out.push({ title, url, snippet: p ? stripTags(p[1]) : '' })
    if (out.length >= count) break
  }
  return out
}

async function searchBaidu(query, count, site) {
  const q = encodeURIComponent(buildQuery(query, site))
  const html = await httpText(`https://www.baidu.com/s?wd=${q}&rn=${Math.min(count * 2, 50)}`, {
    headers: { Referer: 'https://www.baidu.com/' },
  })
  const out = []
  const blocks = html.split(/<div[^>]*class="[^"]*result[^"]*c-container[^"]*"/i).slice(1)
  for (const block of blocks) {
    const a = block.match(/<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!a) continue
    // 百度结果是 /link?url= 跳转链接；fetch_url 会自动跟随重定向，这里直接保留。
    const url = decodeEntities(a[1])
    const title = stripTags(a[2])
    if (!url || !title) continue
    const c =
      block.match(/class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/(span|div)>/i) ||
      block.match(/class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/(span|div)>/i)
    out.push({ title, url, snippet: c ? stripTags(c[1]) : '' })
    if (out.length >= count) break
  }
  return out
}

async function searchDuckDuckGo(query, count, site) {
  const q = encodeURIComponent(buildQuery(query, site))
  const html = await httpText(`https://html.duckduckgo.com/html/?q=${q}&kl=wt-wt`)
  const decodeUddg = (href) => {
    let url = decodeEntities(href)
    const uddg = url.match(/[?&]uddg=([^&]+)/) // DDG 跳转链接：//duckduckgo.com/l/?uddg=<encoded>
    if (uddg) {
      try { url = decodeURIComponent(uddg[1]) } catch { /* keep raw */ }
    }
    return url
  }
  // result__a 与 result__snippet 在 DOM 中相距较远，按出现顺序并行收集再 zip。
  const titles = []
  const reA = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = reA.exec(html)) !== null) {
    const url = decodeUddg(m[1])
    const title = stripTags(m[2])
    if (url && title && /^https?:/i.test(url)) titles.push({ title, url })
  }
  const snippets = []
  const reS = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
  while ((m = reS.exec(html)) !== null) snippets.push(stripTags(m[1]))
  return titles.slice(0, count).map((t, i) => ({ ...t, snippet: snippets[i] ?? '' }))
}

// ── Keyed providers：JSON API ───────────────────────────────────────────────
function bochaFreshness(timeRange) {
  switch (timeRange) {
    case 'day': return 'oneDay'
    case 'week': return 'oneWeek'
    case 'month': return 'oneMonth'
    case 'year': return 'oneYear'
    default: return 'noLimit'
  }
}
async function searchBocha(query, count, site, timeRange) {
  if (!API_KEY) throw new Error('bocha provider requires SPARK_SEARCH_API_KEY')
  const base = BASE_URL || 'https://api.bochaai.com'
  const data = await httpJson(`${base.replace(/\/+$/, '')}/v1/web-search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: buildQuery(query, site),
      count: Math.min(count, 20),
      freshness: bochaFreshness(timeRange),
      summary: true,
    }),
  })
  const value = data?.data?.webPages?.value ?? []
  return value.slice(0, count).map((r) => ({
    title: r.name ?? '',
    url: r.url ?? '',
    snippet: r.summary || r.snippet || '',
    ...(r.siteName ? { source: r.siteName } : {}),
    ...(r.dateLastCrawled ? { date: r.dateLastCrawled } : {}),
  }))
}

async function searchTavily(query, count, site, timeRange) {
  if (!API_KEY) throw new Error('tavily provider requires SPARK_SEARCH_API_KEY')
  const base = BASE_URL || 'https://api.tavily.com'
  const days = timeRange === 'day' ? 1 : timeRange === 'week' ? 7 : timeRange === 'month' ? 30 : undefined
  const data = await httpJson(`${base.replace(/\/+$/, '')}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: API_KEY,
      query: buildQuery(query, site),
      max_results: Math.min(count, 20),
      search_depth: 'basic',
      include_answer: true,
      ...(days != null ? { topic: 'news', days } : {}),
    }),
  })
  const results = (data?.results ?? []).slice(0, count).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
    ...(typeof r.score === 'number' ? { score: r.score } : {}),
  }))
  return { results, ...(data?.answer ? { answer: data.answer } : {}) }
}

async function searchSerper(query, count, site, timeRange) {
  if (!API_KEY) throw new Error('serper provider requires SPARK_SEARCH_API_KEY')
  const base = BASE_URL || 'https://google.serper.dev'
  const tbs = timeRange === 'day' ? 'qdr:d' : timeRange === 'week' ? 'qdr:w'
    : timeRange === 'month' ? 'qdr:m' : timeRange === 'year' ? 'qdr:y' : undefined
  const data = await httpJson(`${base.replace(/\/+$/, '')}/search`, {
    method: 'POST',
    headers: { 'X-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: buildQuery(query, site), num: Math.min(count, 20), ...(tbs ? { tbs } : {}) }),
  })
  const results = (data?.organic ?? []).slice(0, count).map((r) => ({
    title: r.title ?? '',
    url: r.link ?? '',
    snippet: r.snippet ?? '',
    ...(r.date ? { date: r.date } : {}),
  }))
  const answer = data?.answerBox?.answer || data?.answerBox?.snippet || data?.knowledgeGraph?.description
  return { results, ...(answer ? { answer } : {}) }
}

// ── 后端选择 + 免密链降级 ───────────────────────────────────────────────────
async function runKeylessChain(query, count, site) {
  const chain = [
    ['bing', searchBing],
    ['baidu', searchBaidu],
    ['duckduckgo', searchDuckDuckGo],
  ]
  const errors = []
  for (const [name, fn] of chain) {
    try {
      const results = await fn(query, count, site)
      if (results.length > 0) return { provider: name, results }
      errors.push(`${name}: 0 results`)
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(`All keyless engines failed. ${errors.join(' | ')}`)
}

async function webSearch(args) {
  const query = String(args.query ?? '').trim()
  if (!query) throw new Error('query is required')
  const count = Math.max(1, Math.min(Number(args.count) || 8, 20))
  const site = typeof args.site === 'string' ? args.site : ''
  const timeRange = typeof args.time_range === 'string' ? args.time_range : 'all'

  // 显式 keyed provider，或 auto 且配了 key → 走 keyed
  const wantsKeyed = KEYED.has(PROVIDER) || (PROVIDER === 'auto' && API_KEY)
  if (wantsKeyed) {
    const keyedProvider = KEYED.has(PROVIDER) ? PROVIDER : 'bocha'
    let payload
    if (keyedProvider === 'bocha') payload = { results: await searchBocha(query, count, site, timeRange) }
    else if (keyedProvider === 'tavily') payload = await searchTavily(query, count, site, timeRange)
    else payload = await searchSerper(query, count, site, timeRange)
    const results = Array.isArray(payload) ? payload : payload.results
    if (results && results.length > 0) {
      return { provider: keyedProvider, query, results, ...(payload.answer ? { answer: payload.answer } : {}) }
    }
    // keyed 无结果 → 降级到免密链兜底
  }

  // 显式单一免密引擎
  if (KEYLESS.has(PROVIDER)) {
    const fn = PROVIDER === 'bing' ? searchBing : PROVIDER === 'baidu' ? searchBaidu : searchDuckDuckGo
    const results = await fn(query, count, site)
    return { provider: PROVIDER, query, results }
  }

  const { provider, results } = await runKeylessChain(query, count, site)
  return { provider, query, results }
}

async function fetchUrl(args) {
  const url = String(args.url ?? '').trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('A valid http(s) url is required')
  const maxChars = Math.max(500, Math.min(Number(args.max_chars) || FETCH_MAX_CHARS, 50000))
  const res = await httpFetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const finalUrl = res.url || url
  const contentType = res.headers.get('content-type') || ''
  const raw = await res.text()
  let title = ''
  let text
  if (/json/i.test(contentType)) {
    text = raw
  } else if (/html|xml|^$/i.test(contentType) || /<html/i.test(raw)) {
    const t = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    title = t ? stripTags(t[1]) : ''
    text = htmlToText(raw)
  } else {
    text = raw
  }
  const truncated = text.length > maxChars
  return {
    url: finalUrl,
    ...(title ? { title } : {}),
    contentType,
    truncated,
    chars: Math.min(text.length, maxChars),
    text: truncated ? `${text.slice(0, maxChars)}\n\n…[truncated, ${text.length} chars total]` : text,
  }
}

// ── Tool 定义 ───────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'web_search',
    description:
      'Search the web and return ranked results (title, url, snippet). Works regardless of model provider — use this whenever you need current information, facts to verify, or to discover pages to read with fetch_url. Prefer this over the built-in WebSearch which is unavailable on third-party providers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query. Supports operators like site:, quotes, OR.' },
        count: { type: 'number', description: 'Number of results to return (1-20, default 8).' },
        time_range: { type: 'string', enum: ['day', 'week', 'month', 'year', 'all'], description: 'Restrict to recent results. Default all. Only honored by keyed providers (bocha/tavily/serper).' },
        site: { type: 'string', description: 'Optional domain to restrict results to, e.g. "github.com".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description:
      'Fetch a web page and return its readable text content (HTML stripped to text). Works regardless of model provider — use this instead of the built-in WebFetch, which is unavailable on third-party providers. Good for reading a result found via web_search.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
        max_chars: { type: 'number', description: 'Max characters of body text to return (default 8000, max 50000).' },
      },
      required: ['url'],
    },
  },
]

function summarize(data) {
  if (Array.isArray(data.results)) {
    const lines = data.results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
    return [
      `Search (${data.provider}) — ${data.results.length} results for "${data.query}":`,
      ...(data.answer ? [`\nAnswer: ${data.answer}\n`] : []),
      ...lines,
    ].join('\n')
  }
  return `Fetched ${data.url}${data.title ? ` — ${data.title}` : ''} (${data.chars} chars${data.truncated ? ', truncated' : ''})\n\n${data.text}`
}

async function handle(request) {
  const id = request.id
  try {
    if (request.method === 'initialize') {
      result(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'spark-search', version: '0.1.0' } })
      return
    }
    if (request.method === 'tools/list') {
      result(id, { tools: TOOLS })
      return
    }
    if (request.method === 'tools/call') {
      const name = request.params?.name
      const args = request.params?.arguments || {}
      let data
      if (name === 'web_search') data = await webSearch(args)
      else if (name === 'fetch_url') data = await fetchUrl(args)
      else throw new Error(`Unknown tool: ${name}`)
      result(id, { content: [{ type: 'text', text: summarize(data) }], structuredContent: data })
      return
    }
    if (id !== undefined) result(id, {})
  } catch (err) {
    error(id, -32000, err instanceof Error ? err.message : String(err))
  }
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  try {
    void handle(JSON.parse(line))
  } catch (err) {
    error(null, -32700, err instanceof Error ? err.message : String(err))
  }
})
