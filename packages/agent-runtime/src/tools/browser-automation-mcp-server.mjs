#!/usr/bin/env node
/**
 * spark_browser MCP server — visible in-app browser automation bridge.
 *
 * This stdio JSON-RPC server is intentionally thin. BrowserWindow state lives
 * in the Electron main process BrowserBridgeServer; this process only proxies
 * tool calls to http://127.0.0.1:<SPARK_BROWSER_PORT> with SPARK_BROWSER_SID.
 */
import readline from 'node:readline'

const env = process.env
const PORT = Number.parseInt(env.SPARK_BROWSER_PORT || '', 10) || 0
const SID = (env.SPARK_BROWSER_SID || '').trim()
const BASE = PORT ? `http://127.0.0.1:${PORT}` : ''

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}
function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}
function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function call(method, path, body) {
  if (!BASE) throw new Error('Browser bridge port not configured (SPARK_BROWSER_PORT missing)')
  const sidBody = body != null ? { sid: SID, ...body } : undefined
  const url = method === 'GET'
    ? `${BASE}${path}${path.includes('?') ? '&' : '?'}sid=${encodeURIComponent(SID)}`
    : `${BASE}${path}`
  const res = await fetch(url, {
    method,
    headers: sidBody != null ? { 'Content-Type': 'application/json' } : undefined,
    body: sidBody != null ? JSON.stringify(sidBody) : undefined,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Bad response from browser bridge: ${text.slice(0, 200)}`)
  }
  if (json?.ok === false) {
    const err = json.error
    if (err && typeof err === 'object') throw new Error(`${err.code || 'BROWSER_ERROR'}: ${err.message || 'browser bridge error'}`)
    throw new Error(String(err || 'browser bridge error'))
  }
  return json
}

function qs(args, extra = {}) {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...args, ...extra })) {
    if (value !== undefined && value !== null && value !== '') q.set(key, String(value))
  }
  return q.toString()
}

async function open(args) {
  return call('POST', '/open', {
    url: args.url,
    show: args.show !== false,
    profileId: args.profileId,
    reuse: args.reuse === true,
  })
}
async function navigate(args) {
  return call('POST', '/navigate', { windowId: args.windowId, url: args.url })
}
async function evalJs(args) {
  return call('POST', '/eval', { windowId: args.windowId, code: args.code })
}
async function injectScript(args) {
  return call('POST', '/inject', { windowId: args.windowId, code: args.code, scriptId: args.scriptId })
}
async function removeScript(args) {
  return call('POST', '/remove_script', { windowId: args.windowId, scriptId: args.scriptId })
}
async function screenshot(args) {
  return call('GET', `/screenshot?${qs(args)}`)
}
async function getUrl(args) {
  return call('GET', `/url?${qs(args)}`)
}
async function getTitle(args) {
  return call('GET', `/title?${qs(args)}`)
}
async function listWindows() {
  return call('GET', '/windows')
}
async function close(args) {
  return call('POST', '/close', { windowId: args.windowId })
}
async function consoleStart(args) {
  return call('POST', '/console/start', { windowId: args.windowId })
}
async function consoleEvents(args) {
  return call('GET', `/console/events?${qs({ windowId: args.windowId, sinceSeq: args.sinceSeq })}`)
}
async function consoleClear(args) {
  return call('POST', '/console/clear', { windowId: args.windowId })
}
async function networkSetRules(args) {
  return call('POST', '/network/rules', { windowId: args.windowId, rules: args.rules || [] })
}
async function networkEvents(args) {
  return call('GET', `/network/events?${qs({ windowId: args.windowId, sinceSeq: args.sinceSeq })}`)
}
async function networkClear(args) {
  return call('POST', '/network/clear', { windowId: args.windowId, ruleIds: args.ruleIds })
}
async function clearProfile(args) {
  return call('POST', '/profile/clear', { profileId: args.profileId, scope: args.scope })
}

const WINDOW_ID_PROP = { type: 'string', description: 'Window id returned by open/list_windows. Omit to target the first open spark_browser window.' }

const TOOLS = [
  {
    name: 'open',
    description: 'Open a visible in-app BrowserWindow and navigate to a URL. Supports http/https/file/data URLs. Use profileId to persist cookies/localStorage/cache across turns; same profileId reuses login state.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open. Local HTML should use file:///absolute/path.html.' },
        show: { type: 'boolean', description: 'Whether to show the window. Defaults to true.' },
        profileId: { type: 'string', description: 'Persistent browser profile id, e.g. default, github-work, local-debug.' },
        reuse: { type: 'boolean', description: 'Reuse an existing window with the same profileId if present.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'navigate',
    description: 'Navigate an existing spark_browser window to a new URL.',
    inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP, url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'eval',
    description: 'Execute JavaScript in the page and return the JSON-serializable result. For DOM nodes, cyclic objects, or complex values, stringify inside the code yourself.',
    inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP, code: { type: 'string' } }, required: ['code'] },
  },
  {
    name: 'inject_script',
    description: 'Persistently inject JavaScript into a window. The script is re-run after future navigations. Remove it with remove_script or close the window when finished.',
    inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP, code: { type: 'string' }, scriptId: { type: 'string' } }, required: ['code'] },
  },
  {
    name: 'remove_script',
    description: 'Remove a persistent script so it will not be re-injected on future navigations.',
    inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP, scriptId: { type: 'string' } }, required: ['scriptId'] },
  },
  { name: 'screenshot', description: 'Capture the current window as a PNG dataUrl plus url/title.', inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP } } },
  { name: 'get_url', description: 'Read the current URL of a spark_browser window, including user manual navigation.', inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP } } },
  { name: 'get_title', description: 'Read the current page title of a spark_browser window.', inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP } } },
  { name: 'list_windows', description: 'List open spark_browser windows with profile, visibility, url/title, script count, network rule count, and console buffer count.', inputSchema: { type: 'object', properties: {} } },
  { name: 'close', description: 'Close a spark_browser window and clear its scripts, network rules, and event buffers. Profile storage is preserved unless clear_profile is called.', inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP } } },
  { name: 'console_start', description: 'Start capturing console messages (log/warn/error) from a window.', inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP } } },
  { name: 'console_events', description: 'Read captured console events. Use sinceSeq to poll incrementally.', inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP, sinceSeq: { type: 'number' } } } },
  { name: 'console_clear', description: 'Clear captured console events for a window.', inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP } } },
  {
    name: 'network_set_rules',
    description: 'Observe and modify window network traffic. Supports record, block, redirect, and set_headers rules. Response-body mock_response is intentionally unsupported in this build and returns NETWORK_RULE_UNSUPPORTED.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: WINDOW_ID_PROP,
        rules: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              match: { type: 'string', description: 'URL substring or regex string.' },
              action: { type: 'string', enum: ['record', 'block', 'redirect', 'set_headers', 'mock_response'] },
              redirectUrl: { type: 'string' },
              headers: { type: 'object' },
            },
            required: ['match', 'action'],
          },
        },
      },
      required: ['rules'],
    },
  },
  { name: 'network_events', description: 'Read recorded request/completion/error events for a window. Use sinceSeq to poll incrementally.', inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP, sinceSeq: { type: 'number' } } } },
  { name: 'network_clear', description: 'Clear network rules and events, or only the supplied ruleIds.', inputSchema: { type: 'object', properties: { windowId: WINDOW_ID_PROP, ruleIds: { type: 'array', items: { type: 'string' } } } } },
  { name: 'clear_profile', description: 'Clear persistent spark_browser profile data such as cookies, cache, localStorage, and IndexedDB. This signs pages out for that profile.', inputSchema: { type: 'object', properties: { profileId: { type: 'string' }, scope: { type: 'array', items: { type: 'string', enum: ['cookies', 'cache', 'localStorage', 'indexedDB', 'all'] } } }, required: ['profileId'] } },
]

function summarize(name, data) {
  if (name === 'screenshot') return `Screenshot captured for ${data.url || 'window'} (${data.title || 'untitled'}). dataUrl length=${data.dataUrl?.length || 0}`
  return JSON.stringify(data, null, 2)
}

async function handle(request) {
  const id = request.id
  try {
    if (request.method === 'initialize') {
      result(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'spark-browser', version: '0.1.0' } })
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
      if (name === 'open') data = await open(args)
      else if (name === 'navigate') data = await navigate(args)
      else if (name === 'eval') data = await evalJs(args)
      else if (name === 'inject_script') data = await injectScript(args)
      else if (name === 'remove_script') data = await removeScript(args)
      else if (name === 'screenshot') data = await screenshot(args)
      else if (name === 'get_url') data = await getUrl(args)
      else if (name === 'get_title') data = await getTitle(args)
      else if (name === 'list_windows') data = await listWindows(args)
      else if (name === 'close') data = await close(args)
      else if (name === 'console_start') data = await consoleStart(args)
      else if (name === 'console_events') data = await consoleEvents(args)
      else if (name === 'console_clear') data = await consoleClear(args)
      else if (name === 'network_set_rules') data = await networkSetRules(args)
      else if (name === 'network_events') data = await networkEvents(args)
      else if (name === 'network_clear') data = await networkClear(args)
      else if (name === 'clear_profile') data = await clearProfile(args)
      else throw new Error(`Unknown tool: ${name}`)
      result(id, { content: [{ type: 'text', text: summarize(name, data) }], structuredContent: data })
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
