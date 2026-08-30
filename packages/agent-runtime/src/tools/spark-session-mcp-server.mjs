#!/usr/bin/env node
/**
 * spark_session MCP server — 会话 worktree 状态上报工具桥（codex / claude CLI 路径）。
 *
 * 存在意义：claude SDK 路径用 in-process SDK MCP（createSdkMcpServer，闭包直访
 * SessionService），但 codex CLI / claude CLI 是独立子进程，消费不了 type='sdk' 的
 * server（会被 buildCodexMcpConfig 跳过）。本 server 是瘦桥接：把 agent 的
 * set_worktree_state 工具调用代理到 PlatformBridgeService HTTP RPC
 * （session.set_worktree_state），bridge 再回调 SessionService 的
 * setSessionRuntimeWorktree —— 与 claude SDK 路径复用同一套校验与持久化，保证两条
 * 路径语义完全一致。
 *
 * 协议：stdio JSON-RPC 2.0（与 spark-memory-mcp-server.mjs 一致）。
 *
 * 工具（SDK 命名空间 mcp__spark_session__，与 in-process 版本同名同语义）：
 *   set_worktree_state — 上报当前会话进入/退出引擎级 worktree 的状态
 *
 * 配置来自环境变量（由 session.service 注入）：
 *   SPARK_PLATFORM_BRIDGE_PORT  PlatformBridgeService 端口（必需）
 *   SPARK_SESSION_SID           本对话对应的 spark 会话 id（必需）
 */
import readline from 'node:readline'

const env = process.env
const PORT = Number.parseInt(env.SPARK_PLATFORM_BRIDGE_PORT || '', 10) || 0
const SID = (env.SPARK_SESSION_SID || '').trim()
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
  if (!SID) throw new Error('Session id not configured (SPARK_SESSION_SID missing)')
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
async function setWorktreeState(args) {
  const action = args.action === 'exit' ? 'exit' : args.action === 'enter' ? 'enter' : null
  if (action == null) throw new Error('action must be "enter" or "exit"')
  return rpc('session.set_worktree_state', {
    sessionId: SID,
    action,
    ...(typeof args.path === 'string' ? { path: args.path } : {}),
    ...(typeof args.branch === 'string' ? { branch: args.branch } : {}),
  })
}

// ── Tool definitions（与 in-process SDK MCP 版本同义同描述）─────────────────
const TOOL_DESCRIPTION = [
  '更新当前会话的 worktree 运行状态，应用界面据此显示会话的真实分支并点亮 worktree 标记。',
  '调用时机（务必遵守）：',
  '1) 通过 EnterWorktree 等工具进入 worktree、或手动执行 git worktree add 创建 worktree 后，立即以 action="enter" 调用，path 传 worktree 根目录绝对路径；',
  '2) 后续所有开发都在该 worktree 中进行期间无需重复调用；',
  '3) 退出或删除 worktree、回到主仓库开发时，以 action="exit" 调用清除状态。',
  '注意：仅本工具不改变任何 git 状态，它只是向应用上报展示信息；分支名会由应用从该路径自动解析，branch 参数仅在 detached HEAD 时作展示兜底。',
].join(' ')

const TOOLS = [
  {
    name: 'set_worktree_state',
    description: TOOL_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['enter', 'exit'],
          description: 'enter=进入/已在 worktree 开发；exit=退出 worktree 回到主仓库。',
        },
        path: {
          type: 'string',
          description: 'worktree 根目录的绝对路径（action=enter 时必填）。',
        },
        branch: {
          type: 'string',
          description: '可选分支名；缺省由应用从 path 解析，仅在 detached HEAD 时用于展示。',
        },
      },
      required: ['action'],
    },
  },
]

// ── Summarize（把结构化结果转成给 agent 看的文本）────────────────────────────
function summarize(data) {
  if (data && data.ok === false) {
    return `更新失败：${data.error || '未知原因'}。请确认 path 是存在的 git worktree 目录绝对路径后重试。`
  }
  if (data && data.worktree == null) return '已清除会话 worktree 状态。'
  if (data && data.worktree) {
    const w = data.worktree
    return `会话 worktree 状态已更新：${w.path}${w.branch ? `（分支 ${w.branch}）` : ''}`
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
        serverInfo: { name: 'spark_session', version: '1.0.0' },
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
      if (name === 'set_worktree_state') data = await setWorktreeState(args)
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
