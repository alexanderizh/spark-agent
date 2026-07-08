#!/usr/bin/env node
/**
 * spark_memory MCP server — 长期记忆的 agent 工具桥（codex CLI / claude CLI 路径）。
 *
 * 存在意义：claude SDK 路径用 in-process SDK MCP（createSdkMcpServer，闭包直访 this.db），
 * 但 codex CLI / claude CLI 是独立子进程，消费不了 type='sdk' 的 server（会被
 * filterCliCompatibleMcpServers 和 buildCodexMcpConfigArgs 同时跳过）。本 server 是
 * **瘦桥接**：把 agent 的 search_memory / recall_memory 工具调用代理到 PlatformBridgeService
 * HTTP RPC（memory.search / memory.recall），bridge 再回调 SessionService 的
 * bridgeMemorySearch / bridgeMemoryRecall —— 与 claude SDK 路径复用同一套
 * MemorySearchService / MemoryReaderService，保证两条路径 agent 看到的记忆范围、排序、
 * 降级语义完全一致。
 *
 * 协议：stdio JSON-RPC 2.0（与 tools/debug-mode-mcp-server.mjs 一致）。
 *
 * 工具（SDK 命名空间 mcp__spark_memory__，与 in-process 版本同名同语义）：
 *   search_memory  — 按语义/关键词检索 user/project/agent 三层长期记忆（FTS5+向量 RRF）
 *   recall_memory  — 读取某条记忆的完整正文（含 Why / How to apply）
 *
 * 配置来自环境变量（由 session.service 注入）：
 *   SPARK_PLATFORM_BRIDGE_PORT  PlatformBridgeService 端口（必需，与 platform-management MCP 同源）
 *   SPARK_MEMORY_SID            本对话对应的 spark 会话 id（必需，用于解析 scope 集合）
 */
import readline from 'node:readline'

const env = process.env
const PORT = Number.parseInt(env.SPARK_PLATFORM_BRIDGE_PORT || '', 10) || 0
const SID = (env.SPARK_MEMORY_SID || '').trim()
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
  if (!SID) throw new Error('Session id not configured (SPARK_MEMORY_SID missing)')
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
async function searchMemory(args) {
  const query = typeof args.query === 'string' ? args.query : ''
  if (!query) throw new Error('query is required')
  const params = {
    sessionId: SID,
    query,
    ...(args.type != null ? { type: args.type } : {}),
    ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
  }
  return rpc('memory.search', params)
}

async function recallMemory(args) {
  const id = typeof args.id === 'string' ? args.id : ''
  if (!id) throw new Error('id is required')
  return rpc('memory.recall', { sessionId: SID, id })
}

// ── Tool definitions（与 in-process SDK MCP 版本同义同描述）─────────────────
const TOOLS = [
  {
    name: 'search_memory',
    description: [
      '按语义/关键词搜索长期记忆（user/project/agent 三层，自动混合 FTS+向量检索）。',
      '返回匹配条目的 id + 摘要列表；需要某条的完整正文时再用 recall_memory。',
      '何时调用：system prompt 里的记忆摘要不足以决策、或想确认是否有相关历史记忆时。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词或语义描述（1-500 字符）。' },
        type: {
          type: 'string',
          enum: ['user', 'feedback', 'project', 'reference'],
          description: '可选：仅返回该类型的记忆。',
        },
        limit: { type: 'number', description: '返回条数上限（默认 8，最大 20）。' },
      },
      required: ['query'],
    },
  },
  {
    name: 'recall_memory',
    description:
      '读取一条长期记忆的完整正文（含 Why / How to apply）。传入 search_memory 返回或 system prompt 摘要里方括号内的 id。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '记忆条目 id（search_memory 返回的方括号内值）。' } },
      required: ['id'],
    },
  },
]

// ── Summarize（把结构化结果转成给 agent 看的文本）────────────────────────────
function summarize(name, data) {
  if (name === 'search_memory') {
    const hits = Array.isArray(data.hits) ? data.hits : []
    const related = Array.isArray(data.related) ? data.related : []
    if (data.degraded) return '记忆检索暂不可用（已降级）。'
    if (hits.length === 0) return '没有匹配的长期记忆。'
    const lines = hits.map((h) => `- [${h.id}] ${h.name} (${h.type}): ${h.description}`)
    let text = lines.join('\n')
    if (related.length > 0) {
      const relLines = related.map((r) => `- [${r.id}] ${r.name} (${r.type}): ${r.description}`)
      text += `\n\n经实体关联的其他记忆：\n${relLines.join('\n')}`
    }
    return text
  }
  if (name === 'recall_memory') {
    if (data.error) return `recall 失败：${data.error}`
    return data.content || '(空正文)'
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
        serverInfo: { name: 'spark_memory', version: '1.0.0' },
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
      if (name === 'search_memory') data = await searchMemory(args)
      else if (name === 'recall_memory') data = await recallMemory(args)
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
