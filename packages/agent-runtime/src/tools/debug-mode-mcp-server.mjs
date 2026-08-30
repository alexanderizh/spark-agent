#!/usr/bin/env node
/**
 * spark_debug MCP server — 调试模式 (debug mode) 的 agent 工具桥。
 *
 * 存在意义：调试模式的"假设→插桩→复现→读日志→修复→清理"闭环里，日志接收
 * 服务（DebugLogServer）必须活在跨 turn 的长驻主进程里——用户在两个 turn 之间
 * 去复现 bug，per-session 的 MCP 子进程随时可能重启。所以本 server 只是一个
 * **瘦桥接**：把 agent 的工具调用代理到 `http://127.0.0.1:<port>` 上的
 * DebugLogServer，自己不持有任何状态。
 *
 * 协议：stdio JSON-RPC 2.0（与 tools/web-search-mcp-server.mjs 一致）。
 *
 * 工具（SDK 命名空间 mcp__spark_debug__）：
 *   begin       — 开/续一个调试会话，返回 sid/port/round + 可直接粘贴的插桩上报器
 *   read        — 读取「本轮（默认）」收到的日志
 *   next_round  — 验证完一轮、要再插桩时推进轮次并登记新假设，返回新一轮上报器
 *   status      — 当前轮次 / 日志计数 / 已尝试假设台账（判断用户是否真复现）
 *   finish      — 清空日志 + 返回需从代码中删除的插桩标记，用于交付前清理
 *
 * 配置来自环境变量（由 session.service 注入）：
 *   SPARK_DEBUG_LOG_PORT  DebugLogServer 端口（必需）
 *   SPARK_DEBUG_SID       本对话对应的稳定 sid（= spark 会话 id），跨 turn 不变
 */
import readline from 'node:readline'

const env = process.env
const PORT = Number.parseInt(env.SPARK_DEBUG_LOG_PORT || '', 10) || 0
const ENV_SID = (env.SPARK_DEBUG_SID || '').trim()
const BASE = PORT ? `http://127.0.0.1:${PORT}` : ''

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

// ── HTTP bridge to DebugLogServer ────────────────────────────────────────────
async function call(method, path, body) {
  if (!BASE) throw new Error('Debug log server port not configured (SPARK_DEBUG_LOG_PORT missing)')
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Bad response from debug log server: ${text.slice(0, 200)}`)
  }
  if (json && json.ok === false) throw new Error(json.error || 'debug log server error')
  return json
}

// ── Instrumentation snippets (placeholders filled with real sid/port/round) ──
function buildSnippets(sid, round) {
  const js = `// __SPARK_DEBUG_START__ sid=${sid} round=${round}
function __sparkDebug(tag, data) {
  try {
    fetch('http://127.0.0.1:${PORT}/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: '${sid}', round: ${round}, tag, data, ts: Date.now(), source: 'browser' }),
      keepalive: true,
    }).catch(() => {})
  } catch (_) {}
}
// __SPARK_DEBUG_END__`

  const python = `# __SPARK_DEBUG_START__ sid=${sid} round=${round}
import json, urllib.request, threading, time
def __spark_debug(tag, data=None):
    def _send():
        try:
            req = urllib.request.Request(
                'http://127.0.0.1:${PORT}/ingest',
                data=json.dumps({'sid':'${sid}','round':${round},'tag':tag,'data':data,'ts':int(time.time()*1000),'source':'node'}).encode(),
                headers={'Content-Type':'application/json'})
            urllib.request.urlopen(req, timeout=2)
        except Exception:
            pass
    threading.Thread(target=_send, daemon=True).start()
# __SPARK_DEBUG_END__`

  return { js, python }
}

// ── Tool implementations ─────────────────────────────────────────────────────
async function begin(args) {
  const sid = (args.sid || ENV_SID || '').trim() || undefined
  const data = await call('POST', '/session', { sid })
  const realSid = data.sid
  const round = data.round
  return {
    sid: realSid,
    port: PORT,
    round,
    ingestUrl: `http://127.0.0.1:${PORT}/ingest`,
    snippets: buildSnippets(realSid, round),
  }
}

function currentSid(args) {
  return (args.sid || ENV_SID || '').trim()
}

async function read(args) {
  const sid = currentSid(args)
  if (!sid) throw new Error('No debug session — call begin first')
  const q = new URLSearchParams({ sid })
  if (args.round != null) q.set('round', String(args.round))
  const data = await call('GET', `/logs?${q.toString()}`)
  return { round: data.round, total: data.total, entries: data.entries }
}

async function nextRound(args) {
  const sid = currentSid(args)
  if (!sid) throw new Error('No debug session — call begin first')
  const hypothesis = String(args.hypothesis || '')
  const data = await call('POST', '/round', { sid, hypothesis })
  return {
    round: data.round,
    ingestUrl: `http://127.0.0.1:${PORT}/ingest`,
    snippets: buildSnippets(sid, data.round),
  }
}

async function status(args) {
  const sid = currentSid(args)
  if (!sid) throw new Error('No debug session — call begin first')
  const data = await call('GET', `/status?${new URLSearchParams({ sid }).toString()}`)
  return data
}

async function finish(args) {
  const sid = currentSid(args)
  if (!sid) throw new Error('No debug session — call begin first')
  const data = await call('DELETE', `/logs?${new URLSearchParams({ sid }).toString()}`)
  return {
    cleared: data.cleared,
    markers: ['__SPARK_DEBUG_START__', '__SPARK_DEBUG_END__'],
    instructions:
      'Now remove ALL instrumentation: grep the repo for "__SPARK_DEBUG" and delete every ' +
      '`// __SPARK_DEBUG_START__ ... // __SPARK_DEBUG_END__` block (and Python `# __SPARK_DEBUG_*` blocks) ' +
      'plus every __sparkDebug(...) / __spark_debug(...) call you added. Then grep once more to confirm zero matches before delivering.',
  }
}

// ── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'begin',
    description:
      'Start or resume the debug session for this conversation. Returns a stable session id (sid), the log-ingest URL, the current round, and ready-to-paste instrumentation snippets (JS/TS and Python) with sid/round/port already filled in. Call this first, before instrumenting code.',
    inputSchema: { type: 'object', properties: { sid: { type: 'string', description: 'Optional explicit session id; normally omit to use the conversation default.' } } },
  },
  {
    name: 'read',
    description:
      'Read the debug logs the app-under-test reported for the current round (default) or a specific round. Call this after the user confirms they reproduced the bug. Returns { round, total, entries }.',
    inputSchema: { type: 'object', properties: { round: { type: 'number', description: 'Round to read; omit for the current round.' } } },
  },
  {
    name: 'next_round',
    description:
      'Advance to the next debugging round and record the hypothesis you are about to test. Use this when you have analyzed the current logs and are inserting a new batch of instrumentation. Returns the new round and fresh snippets. The hypothesis ledger prevents repeating already-ruled-out theories.',
    inputSchema: {
      type: 'object',
      properties: { hypothesis: { type: 'string', description: 'The hypothesis this round will verify (1-2 sentences).' } },
      required: ['hypothesis'],
    },
  },
  {
    name: 'status',
    description:
      'Get the debug session status: current round, total entries, entries received this round (thisRound), and the hypothesis ledger. Use thisRound to tell whether the user actually reproduced (thisRound > 0).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'finish',
    description:
      'Wipe the buffered debug logs and get the list of instrumentation markers to strip from the code. Call this when the user confirms the bug is resolved, then remove all instrumentation and verify zero residue before delivering.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function summarize(name, data) {
  switch (name) {
    case 'begin':
      return `Debug session ready (sid=${data.sid}, round=${data.round}). Ingest URL: ${data.ingestUrl}\n\nPaste this instrumentation (JS/TS):\n${data.snippets.js}`
    case 'read': {
      if (!data.total) return `No logs received for round ${data.round} yet. The user may not have hit the instrumented path — adjust and ask them to reproduce again.`
      const lines = data.entries.map((e, i) => `${i + 1}. [${e.tag}] ${e.message}${e.data !== undefined ? ` ${JSON.stringify(e.data)}` : ''}`)
      return `Round ${data.round} — ${data.total} log entries:\n${lines.join('\n')}`
    }
    case 'next_round':
      return `Advanced to round ${data.round}. Paste the new instrumentation (JS/TS):\n${data.snippets.js}`
    case 'status':
      return `Round ${data.round} · total ${data.total} entries · ${data.thisRound} this round.\nHypotheses tried: ${data.hypotheses.length ? data.hypotheses.map((h) => `(r${h.round}) ${h.text}`).join('; ') : 'none'}`
    case 'finish':
      return `Cleared ${data.cleared} log entries. ${data.instructions}`
    default:
      return JSON.stringify(data)
  }
}

async function handle(request) {
  const id = request.id
  try {
    if (request.method === 'initialize') {
      result(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'spark-debug', version: '0.1.0' } })
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
      if (name === 'begin') data = await begin(args)
      else if (name === 'read') data = await read(args)
      else if (name === 'next_round') data = await nextRound(args)
      else if (name === 'status') data = await status(args)
      else if (name === 'finish') data = await finish(args)
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
