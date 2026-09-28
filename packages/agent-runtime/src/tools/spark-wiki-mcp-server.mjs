#!/usr/bin/env node
/**
 * spark_wiki MCP server — 知识库 / Wiki 的 agent 工具桥（codex CLI / claude CLI 路径）。
 *
 * 存在意义：claude SDK 路径用 in-process SDK MCP（createSdkMcpServer，闭包直访 this.db），
 * 但 codex CLI / claude CLI 是独立子进程，消费不了 type='sdk' 的 server。本 server 是
 * **瘦桥接**：把 agent 的 wiki_* 工具调用代理到 PlatformBridgeService HTTP RPC
 * （wiki.search / wiki.read / wiki.list_spaces），bridge 再回调 SessionService 的
 * bridgeWiki* 方法 —— 与 claude SDK 路径复用同一套 Wiki 服务层与 WikiContextBudget
 * 裁剪，保证两条路径 agent 看到的范围、排序、降级语义完全一致。
 *
 * 工具定义与描述的单一事实源：wiki-tool-contract.ts（本文件保持同步复制）。
 *
 * 配置来自环境变量（由 session.service 注入）：
 *   SPARK_PLATFORM_BRIDGE_PORT  PlatformBridgeService 端口（必需）
 *   SPARK_WIKI_SID              本对话对应的 spark 会话 id（必需，用于解析 scope 集合）
 */
import readline from 'node:readline'

const env = process.env
const PORT = Number.parseInt(env.SPARK_PLATFORM_BRIDGE_PORT || '', 10) || 0
const SID = (env.SPARK_WIKI_SID || '').trim()
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

// ── HTTP bridge to PlatformBridgeService ────────────────────────────────────
async function rpc(method, params) {
  if (!BASE) throw new Error('Platform bridge port not configured (SPARK_PLATFORM_BRIDGE_PORT missing)')
  if (!SID) throw new Error('Session id not configured (SPARK_WIKI_SID missing)')
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Bad response from platform bridge: ${text.slice(0, 200)}`)
  }
  if (!json || json.ok === false) throw new Error(json?.error || 'platform bridge error')
  return json.data
}

// ── Tool implementations ────────────────────────────────────────────────────
async function listSpaces() {
  return rpc('wiki.list_spaces', { sessionId: SID })
}

async function searchWiki(args) {
  const query = typeof args.query === 'string' ? args.query : ''
  if (!query) throw new Error('query is required')
  return rpc('wiki.search', {
    sessionId: SID,
    query,
    ...(typeof args.space_id === 'string' && args.space_id ? { spaceId: args.space_id } : {}),
    ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
  })
}

async function readWiki(args) {
  const id = typeof args.id === 'string' ? args.id : ''
  if (!id) throw new Error('id is required')
  return rpc('wiki.read', {
    sessionId: SID,
    pageId: id,
    ...(typeof args.offset === 'number' && args.offset > 0 ? { offset: args.offset } : {}),
  })
}

// ── Tool definitions（与 wiki-tool-contract.ts 同义同描述）──────────────────
const TOOLS = [
  {
    name: 'wiki_list_spaces',
    description:
      '列出当前会话可访问的知识库空间（每空间一行：id+名称+页面数）。开始取用 wiki 前先看有哪些空间。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'wiki_search',
    description:
      '按关键词检索知识库页面（FTS 全文，中英文均可）。只返回 id+标题+摘要（≤240字）+标签，不返回正文；需要全文时再用 wiki_read。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词或语义描述（1-500 字符）。' },
        space_id: { type: 'string', description: '可选：限定检索的空间 id。' },
        limit: { type: 'number', description: '返回条数上限（默认 8，最大 20）。' },
      },
      required: ['query'],
    },
  },
  {
    name: 'wiki_read',
    description:
      '读取一个知识页面的正文（默认单页 ≤3000 token）。超长页返回 truncated + nextOffset，传 offset 续读。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '页面 id（wiki_search 返回的 id）。' },
        offset: { type: 'number', description: '续读偏移（token 数，上一页返回的 nextOffset）。' },
      },
      required: ['id'],
    },
  },
]

// ── Summarize（结构化结果 → agent 可读文本）─────────────────────────────────
function summarize(name, data) {
  if (name === 'wiki_list_spaces') {
    const items = Array.isArray(data.items) ? data.items : []
    if (items.length === 0) return '当前会话没有可访问的知识库空间。'
    const lines = items.map((s) => `- [${s.id}] ${s.name} (${s.spaceType}, ${s.pageCount} 页)`)
    let text = lines.join('\n')
    if (data.truncated) text += `\n（仅显示前 ${items.length} 个空间）`
    return text
  }
  if (name === 'wiki_search') {
    if (data.gateExceeded) {
      return `本会话 wiki 注入已达上限（已用 ${data.usedTokens} token），请先总结已读内容再继续检索。`
    }
    const items = Array.isArray(data.items) ? data.items : []
    if (items.length === 0) return '没有匹配的知识页面。'
    return items
      .map((h) => `- [${h.id}] ${h.title} (${h.kind}): ${h.summary}${h.tags.length > 0 ? ` [${h.tags.join(',')}]` : ''}`)
      .join('\n')
  }
  if (name === 'wiki_read') {
    if (data.error) return `wiki_read 失败：${data.error}`
    let text = data.body || '(空正文)'
    if (data.truncated) {
      text += `\n\n[truncated] 正文超单页上限，已返回前 ${data.tokens} token；续读请传 offset=${data.nextOffset}`
    }
    return text
  }
  return JSON.stringify(data)
}

// ── JSON-RPC dispatch ───────────────────────────────────────────────────────
async function handle(request) {
  const id = request.id
  try {
    if (request.method === 'initialize') {
      result(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'spark_wiki', version: '1.0.0' },
      })
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
      if (name === 'wiki_list_spaces') data = await listSpaces()
      else if (name === 'wiki_search') data = await searchWiki(args)
      else if (name === 'wiki_read') data = await readWiki(args)
      else throw new Error(`Unknown tool: ${name}`)
      result(id, { content: [{ type: 'text', text: summarize(name, data) }] })
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
