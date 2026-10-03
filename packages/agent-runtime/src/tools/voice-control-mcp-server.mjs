#!/usr/bin/env node
/**
 * spark_voice MCP server — 语音会话应用控制工具桥（全引擎通用）。
 *
 * 存在意义：语音助手的会话 agent 需要切换项目/会话/模型的应用控制能力，
 * 但 platform-management MCP 只有当前会话自切换。本 server 是瘦桥接：把 agent 的
 * voice_* 工具调用代理到 PlatformBridgeService HTTP RPC（voice.*），bridge 再回调
 * desktop 侧 VoiceControlExecutor —— 与语音正则命令执行器收敛到同一批实现，
 * 保证两条通道（本地命令 / agent 工具）行为完全一致。
 *
 * 形态选择：stdio（而非 in-process SDK MCP）——spark 引擎消费不了 type='sdk' 的
 * server（isSparkSupportedMcpServer 明确跳过），而 stdio 在 claude-sdk / spark /
 * claude CLI / codex CLI 四条路径都可挂载，一份实现覆盖所有语音会话引擎。
 *
 * 挂载条件：仅语音路由绑定的会话（session-mcp-tooling.resolveVoiceControlMcpServer
 * 比对 app_settings voice-assistant/route 的 defaultSessionId），普通会话不挂载。
 *
 * 协议：stdio JSON-RPC 2.0（与 spark-session-mcp-server.mjs 一致）。
 *
 * 工具（SDK 命名空间 mcp__spark_voice__）：
 *   list_projects / switch_project / list_sessions / switch_session /
 *   new_session / list_models / switch_model
 *
 * 配置来自环境变量（由 session.service 注入）：
 *   SPARK_PLATFORM_BRIDGE_PORT  PlatformBridgeService 端口（必需）
 *   SPARK_VOICE_SID             本语音会话对应的 spark 会话 id（必需）
 */
import readline from 'node:readline'

const env = process.env
const PORT = Number.parseInt(env.SPARK_PLATFORM_BRIDGE_PORT || '', 10) || 0
const SID = (env.SPARK_VOICE_SID || '').trim()
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
  if (!BASE)
    throw new Error('Platform bridge port not configured (SPARK_PLATFORM_BRIDGE_PORT missing)')
  if (!SID) throw new Error('Session id not configured (SPARK_VOICE_SID missing)')
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
/** name/id 二选一的参数规整：都缺或都给时报错，id 优先精确、name 宽松匹配 */
function pickTarget(args) {
  const name = typeof args.name === 'string' ? args.name.trim() : ''
  const id = typeof args.id === 'string' ? args.id.trim() : ''
  if (name.length === 0 && id.length === 0) {
    throw new Error('必须提供 name（宽松名称匹配）或 id（精确标识）其中之一')
  }
  return { ...(name.length > 0 ? { name } : {}), ...(id.length > 0 ? { id } : {}) }
}

async function listProjects() {
  return rpc('voice.list_projects', { sessionId: SID })
}

async function switchProject(args) {
  return rpc('voice.switch_project', { sessionId: SID, ...pickTarget(args) })
}

async function listSessions(args) {
  const limit =
    typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 50) : 20
  return rpc('voice.list_sessions', { sessionId: SID, limit })
}

async function switchSession(args) {
  return rpc('voice.switch_session', { sessionId: SID, ...pickTarget(args) })
}

async function newSession() {
  return rpc('voice.new_session', { sessionId: SID })
}

async function listModels() {
  return rpc('voice.list_models', { sessionId: SID })
}

async function switchModel(args) {
  return rpc('voice.switch_model', { sessionId: SID, ...pickTarget(args) })
}

// ── Tool definitions ─────────────────────────────────────────────────────────
const SWITCH_HINT =
  '仅语音会话可用。切换在下一轮对话生效，应用界面会自动跳转聚焦；完成后请用一句话向用户确认。'

const TOOLS = [
  {
    name: 'list_projects',
    description: [
      '列出可切换的项目（工作区），当前语音会话所在项目会标记 isCurrent=true。',
      '用户想看有哪些项目、或表达「换个项目/切到 XX 项目」意图时，先调用本工具获取准确名称，再调用 switch_project。',
    ].join(' '),
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'switch_project',
    description: [
      '把语音会话切换到指定项目（工作区）：有最近会话则改绑续聊，没有则在该项目下新建会话。',
      SWITCH_HINT,
      '参数用 list_projects 返回的准确名称或 id；名称不唯一或未命中时会返回候选列表，请向用户澄清后重试。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '项目名称（宽松匹配，来自 list_projects）。' },
        id: { type: 'string', description: '项目精确标识（来自 list_projects）。' },
      },
    },
  },
  {
    name: 'list_sessions',
    description: [
      '列出最近的会话（默认 20 条），当前语音绑定会话标记 isCurrent=true。',
      '用户想回顾或切换到某个历史会话时，先调用本工具，再调用 switch_session。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '返回条数上限（1-50，默认 20）。',
        },
      },
    },
  },
  {
    name: 'switch_session',
    description: [
      '把语音助手切换到指定会话（改绑语音路由，后续语音轮次都发生在该会话）。',
      SWITCH_HINT,
      '参数用 list_sessions 返回的准确标题或 id；名称不唯一或未命中时会返回候选列表，请向用户澄清后重试。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '会话标题（宽松匹配，来自 list_sessions）。' },
        id: { type: 'string', description: '会话精确标识（来自 list_sessions）。' },
      },
    },
  },
  {
    name: 'new_session',
    description: [
      '为语音助手新建一个会话并改绑（之后的语音轮次都发生在新会话）。',
      '用户说「新开个会话/换个话题重新聊」等意图时调用。',
      SWITCH_HINT,
    ].join(' '),
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_models',
    description: [
      '列出当前语音会话渠道的可选模型（与界面模型选择器同一口径，含渠道默认标记）。',
      '内置 CLI / 智能路由渠道不支持切换模型时会返回 unsupported 说明。',
      '用户想看模型列表或换模型时，先调用本工具，再调用 switch_model。',
    ].join(' '),
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'switch_model',
    description: [
      '切换当前语音会话使用的模型（下一轮对话生效）。',
      SWITCH_HINT,
      '参数用 list_models 返回的准确模型名或 id；未命中时会返回候选列表，请向用户澄清后重试。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '模型名（宽松匹配，来自 list_models）。' },
        id: { type: 'string', description: '模型精确标识（来自 list_models）。' },
      },
    },
  },
]

// ── Summarize（把结构化结果转成给 agent 看的文本）────────────────────────────
function formatItems(items) {
  return items
    .map((item, index) => {
      const label = item.title ?? item.name ?? item.id ?? String(item)
      const current = item.isCurrent === true ? '（当前）' : ''
      return `${index + 1}. ${label}${current}${item.id ? ` [id=${item.id}]` : ''}`
    })
    .join('\n')
}

function summarize(data) {
  if (data == null || typeof data !== 'object') return JSON.stringify(data)
  if (data.ok === false) {
    const hint =
      data.candidates && Array.isArray(data.candidates) && data.candidates.length > 0
        ? `可选：${formatItems(data.candidates)}`
        : ''
    return `操作失败：${data.message || '未知原因'}${hint ? `。${hint}` : ''}`
  }
  if (Array.isArray(data.items)) {
    if (data.items.length === 0) return data.message || '列表为空。'
    return `${data.message || '列表如下'}：\n${formatItems(data.items)}`
  }
  return data.message || JSON.stringify(data)
}

// ── JSON-RPC dispatch ───────────────────────────────────────────────────────
async function handle(request) {
  const id = request.id
  try {
    if (request.method === 'initialize') {
      result(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'spark_voice', version: '0.1.0' },
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
      if (name === 'list_projects') data = await listProjects()
      else if (name === 'switch_project') data = await switchProject(args)
      else if (name === 'list_sessions') data = await listSessions(args)
      else if (name === 'switch_session') data = await switchSession(args)
      else if (name === 'new_session') data = await newSession()
      else if (name === 'list_models') data = await listModels()
      else if (name === 'switch_model') data = await switchModel(args)
      else throw new Error(`Unknown tool: ${name}`)
      result(id, { content: [{ type: 'text', text: summarize(data) }] })
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
