#!/usr/bin/env node
/**
 * spark_wiki MCP server — 知识库 / Wiki 的 agent 工具桥（codex CLI / claude CLI 路径）。
 *
 * 存在意义：claude SDK 路径用 in-process SDK MCP（createSdkMcpServer，闭包直访 this.db），
 * 但 codex CLI / claude CLI 是独立子进程，消费不了 type='sdk' 的 server。本 server 是
 * **瘦桥接**：把 agent 的 wiki_* 工具调用代理到 PlatformBridgeService HTTP RPC
 * （wiki.* 系列），bridge 再回调 SessionService 的 bridgeWiki* 方法 —— 与 claude SDK
 * 路径复用同一套 Wiki 服务层、统一写入原语与 WikiContextBudget 裁剪，保证两条路径
 * agent 看到的范围、排序、降级语义完全一致。
 *
 * 工具定义与描述的单一事实源：wiki-tool-contract.ts（本文件保持同步复制，改动须两处同步）。
 *
 * 配置来自环境变量（由 session.service 注入）：
 *   SPARK_PLATFORM_BRIDGE_PORT   PlatformBridgeService 端口（必需）
 *   SPARK_WIKI_SID               本对话对应的 spark 会话 id（必需，用于解析 scope 集合）
 *   SPARK_WIKI_HELP_DISCLOSURE   '1' = 低频工具收进 wiki_admin 二级入口（可选）
 */
import readline from 'node:readline'

const env = process.env
const PORT = Number.parseInt(env.SPARK_PLATFORM_BRIDGE_PORT || '', 10) || 0
const SID = (env.SPARK_WIKI_SID || '').trim()
const HELP_DISCLOSURE = env.SPARK_WIKI_HELP_DISCLOSURE === '1'
const BASE = PORT ? `http://127.0.0.1:${PORT}` : ''

// ── 工具集划分（与 wiki-tool-contract.ts 同步）─────────────────────────────
const CORE_TOOLS = ['wiki_list_spaces', 'wiki_search', 'wiki_read', 'wiki_list', 'wiki_write']
const DEFERRED_TOOLS = [
  'wiki_update',
  'wiki_backlinks',
  'wiki_archive',
  'wiki_delete',
  'wiki_link',
  // S3：技能提议是偶发决策，与更新/删除同级收进二级入口
  'wiki_propose_skill',
]
const ALL_TOOLS = [...CORE_TOOLS, ...DEFERRED_TOOLS]
const ADMIN_TOOL = 'wiki_admin'
const VISIBLE_TOOLS = HELP_DISCLOSURE ? CORE_TOOLS : ALL_TOOLS

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

function str(v) {
  return typeof v === 'string' ? v : ''
}
function optionalStr(v) {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function optionalNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

// ── Tool implementations ────────────────────────────────────────────────────
const IMPL = {
  async wiki_list_spaces() {
    return rpc('wiki.list_spaces', { sessionId: SID })
  },
  async wiki_search(args) {
    const query = str(args.query)
    if (!query) throw new Error('query is required')
    return rpc('wiki.search', {
      sessionId: SID,
      query,
      ...(optionalStr(args.space_id) != null ? { spaceId: args.space_id } : {}),
      ...(optionalNum(args.limit) != null ? { limit: args.limit } : {}),
    })
  },
  async wiki_read(args) {
    const id = str(args.id)
    if (!id) throw new Error('id is required')
    return rpc('wiki.read', {
      sessionId: SID,
      pageId: id,
      ...(optionalNum(args.offset) != null && args.offset > 0 ? { offset: args.offset } : {}),
    })
  },
  async wiki_list(args) {
    const spaceId = str(args.space_id)
    if (!spaceId) throw new Error('space_id is required')
    return rpc('wiki.list', {
      sessionId: SID,
      spaceId,
      ...(optionalStr(args.parent_id) != null ? { parentId: args.parent_id } : {}),
    })
  },
  async wiki_backlinks(args) {
    const id = str(args.id)
    if (!id) throw new Error('id is required')
    return rpc('wiki.backlinks', { sessionId: SID, pageId: id })
  },
  async wiki_write(args) {
    const spaceId = str(args.space_id)
    const title = str(args.title)
    const body = str(args.body)
    if (!spaceId || !title || !body) throw new Error('space_id / title / body are required')
    return rpc('wiki.write', {
      sessionId: SID,
      spaceId,
      title,
      body,
      ...(optionalStr(args.kind) != null ? { kind: args.kind } : {}),
      ...(optionalStr(args.summary) != null ? { summary: args.summary } : {}),
      ...(Array.isArray(args.tags) ? { tags: args.tags.filter((t) => typeof t === 'string') } : {}),
    })
  },
  async wiki_update(args) {
    const id = str(args.id)
    const expectedVersion = optionalNum(args.expected_version)
    if (!id || expectedVersion == null) throw new Error('id / expected_version are required')
    return rpc('wiki.update', {
      sessionId: SID,
      pageId: id,
      expectedVersion,
      ...(optionalStr(args.title) != null ? { title: args.title } : {}),
      ...(optionalStr(args.body) != null ? { body: args.body } : {}),
      ...(optionalStr(args.summary) != null ? { summary: args.summary } : {}),
      ...(Array.isArray(args.tags) ? { tags: args.tags.filter((t) => typeof t === 'string') } : {}),
    })
  },
  async wiki_archive(args) {
    const id = str(args.id)
    if (!id) throw new Error('id is required')
    return rpc('wiki.archive', { sessionId: SID, pageId: id })
  },
  async wiki_delete(args) {
    const id = str(args.id)
    if (!id) throw new Error('id is required')
    return rpc('wiki.delete', { sessionId: SID, pageId: id })
  },
  async wiki_link(args) {
    const fromId = str(args.from_id)
    const toId = str(args.to_id)
    if (!fromId || !toId) throw new Error('from_id / to_id are required')
    return rpc('wiki.link', {
      sessionId: SID,
      fromPageId: fromId,
      toPageId: toId,
      ...(args.remove === true ? { remove: true } : {}),
    })
  },
  async wiki_propose_skill(args) {
    const name = str(args.name)
    const purpose = str(args.purpose)
    const skillDraft = str(args.skill_draft)
    const pageIds = Array.isArray(args.source_page_ids)
      ? args.source_page_ids.filter((v) => typeof v === 'string')
      : []
    if (!name || !purpose || !skillDraft) {
      throw new Error('name / purpose / skill_draft are required')
    }
    return rpc('wiki.propose_skill', {
      sessionId: SID,
      name,
      purpose,
      skillDraft,
      sourcePageIds: pageIds,
    })
  },
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
      '按关键词检索知识库页面（FTS 全文，中英文均可）。只返回 id+标题+摘要+标签，不返回正文；需要全文时再用 wiki_read。',
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
        offset: { type: 'number', description: '续读偏移（上一页的 nextOffset）。' },
      },
      required: ['id'],
    },
  },
  {
    name: 'wiki_list',
    description:
      '列出一个空间内的页面目录树（每节点 id+标题+类型+有无子节点，无正文摘要）。浏览结构时用。',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: '空间 id。' },
        parent_id: { type: 'string', description: '只列该父节点的子层（缺省根层）。' },
      },
      required: ['space_id'],
    },
  },
  {
    name: 'wiki_backlinks',
    description: '查一个页面的反向链接（谁引用了它，每边一行）。追溯知识关联时用。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '页面 id。' } },
      required: ['id'],
    },
  },
  {
    name: 'wiki_write',
    description: '在知识库新建页面。回执只含 id/title/version，不回显正文。',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: '目标空间 id。' },
        title: { type: 'string', description: '页面标题。' },
        body: { type: 'string', description: 'Markdown 正文。' },
        kind: {
          type: 'string',
          enum: ['knowledge', 'experience', 'pattern', 'reference', 'note'],
          description: '类型，默认 knowledge。',
        },
        summary: { type: 'string', description: '摘要（检索展示用）。' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签。' },
      },
      required: ['space_id', 'title', 'body'],
    },
  },
  {
    name: 'wiki_update',
    description: '更新页面（CAS：带 expectedVersion，失配拒绝并回传当前版本）。回执不含正文。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '页面 id。' },
        expected_version: { type: 'number', description: 'CAS 期望版本。' },
        title: { type: 'string', description: '新标题（须同时带 body）。' },
        body: { type: 'string', description: '新正文。' },
        summary: { type: 'string', description: '新摘要（须同时带 body）。' },
        tags: { type: 'array', items: { type: 'string' }, description: '新标签。' },
      },
      required: ['id', 'expected_version'],
    },
  },
  {
    name: 'wiki_archive',
    description: '归档页面（可恢复，非物理删除）。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '页面 id。' } },
      required: ['id'],
    },
  },
  {
    name: 'wiki_delete',
    description: '物理删除页面（进入删除屏障，清理正文与版本快照；不可恢复）。仅在明确要求时使用。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '页面 id。' } },
      required: ['id'],
    },
  },
  {
    name: 'wiki_link',
    description: '建立/移除两个页面的显式关联（reference 边）。正文内 [[标题]] 自动建 wiki 边。',
    inputSchema: {
      type: 'object',
      properties: {
        from_id: { type: 'string', description: '来源页面 id。' },
        to_id: { type: 'string', description: '目标页面 id。' },
        remove: { type: 'boolean', description: 'true = 移除。' },
      },
      required: ['from_id', 'to_id'],
    },
  },
  {
    name: 'wiki_propose_skill',
    description: '从知识页提议一个技能（只写提议区，不创建技能；须经用户确认）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名称。' },
        purpose: { type: 'string', description: '为何创建 / 解决哪个问题。' },
        source_page_ids: { type: 'array', items: { type: 'string' }, description: '溯源页面 id。' },
        skill_draft: { type: 'string', description: 'SKILL.md 草稿。' },
      },
      required: ['name', 'purpose', 'source_page_ids', 'skill_draft'],
    },
  },
]

const ADMIN_TOOL_DEF = {
  name: ADMIN_TOOL,
  description:
    '知识库低频入口。tool 取 enum 中的子工具名，args 传其入参：' +
    'wiki_update(id,expected_version)、wiki_backlinks(id)、wiki_archive(id)、' +
    'wiki_delete(id)、wiki_link(from_id,to_id)、' +
    'wiki_propose_skill(name,purpose,source_page_ids,skill_draft)。',
  inputSchema: {
    type: 'object',
    properties: {
      tool: { type: 'string', enum: DEFERRED_TOOLS },
      args: { type: 'object' },
    },
    required: ['tool'],
  },
}

function visibleTools() {
  const tools = TOOLS.filter((t) => VISIBLE_TOOLS.includes(t.name))
  if (HELP_DISCLOSURE) tools.push(ADMIN_TOOL_DEF)
  return tools
}

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
      .map(
        (h) =>
          `- [${h.id}] ${h.title} (${h.kind}): ${h.summary}${h.tags.length > 0 ? ` [${h.tags.join(',')}]` : ''}`,
      )
      .join('\n')
  }
  if (name === 'wiki_list') {
    const items = Array.isArray(data.items) ? data.items : []
    if (items.length === 0) return '该层级下没有页面。'
    const lines = items.map(
      (p) => `- [${p.id}] ${p.title} (${p.kind}${p.hasChildren ? ', 含子页面' : ''})`,
    )
    let text = lines.join('\n')
    if (data.truncated) text += `\n（该层共 ${data.total} 个节点，仅显示前 ${items.length} 个）`
    return text
  }
  if (name === 'wiki_read') {
    if (data.error) return `wiki_read 失败：${data.error}`
    let text = data.body || '(空正文)'
    if (data.truncated) {
      text += `\n\n[truncated] 正文超单页上限，已返回前 ${data.tokens} token；续读请传 offset=${data.nextOffset}`
    }
    return text
  }
  if (name === 'wiki_backlinks') {
    const items = Array.isArray(data.items) ? data.items : []
    if (items.length === 0) return '没有页面引用该页。'
    let text = items
      .map(
        (b) =>
          `- [${b.id}] ${b.title} (${b.kind}${b.linkType === 'reference' ? ', 显式关联' : ''})`,
      )
      .join('\n')
    if (data.truncated) text += `\n（共 ${data.total} 条引用，仅显示前 ${items.length} 条）`
    return text
  }
  if (name === 'wiki_write' || name === 'wiki_update') {
    if (data.ok === false || data.error)
      return `${name} 失败：${data.error || data.message || '未知错误'}`
    return `已写入 [${data.id}] ${data.title}（v${data.version}${data.indexReady === false ? '，检索索引未就绪' : ''}）`
  }
  if (name === 'wiki_archive') {
    if (data.ok === false || data.error) return `wiki_archive 失败：${data.error || data.message}`
    return `已归档 [${data.id}] ${data.title}${data.alreadyArchived ? '（此前已归档）' : ''}`
  }
  if (name === 'wiki_delete') {
    if (data.ok === false || data.error) return `wiki_delete 失败：${data.error || data.message}`
    const extra = [
      data.fileCleaned === false ? '正文文件待清理' : null,
      data.revisionsCleaned === false ? '版本快照待清理' : null,
    ]
      .filter(Boolean)
      .join('、')
    return `已删除 [${data.id}] ${data.title}${extra ? `（${extra}）` : ''}`
  }
  if (name === 'wiki_link') {
    if (data.ok === false || data.error) return `wiki_link 失败：${data.error || data.message}`
    return data.changed ? '关联已更新。' : '关联已是最新状态（无变化）。'
  }
  if (name === 'wiki_propose_skill') {
    if (data.ok === false || data.error) {
      return `wiki_propose_skill 失败：${data.error || data.message || '未知错误'}`
    }
    // 提议只是草案：回执必须讲清"还需用户确认"，不能让模型以为技能已创建
    const lines = [`已记录技能提议 [${data.id}]「${data.name}」（待用户在界面确认）。`]
    if (Array.isArray(data.rejectionHistory) && data.rejectionHistory.length > 0) {
      lines.push(`注意：该名称此前的提议被拒，原因 —— ${data.rejectionHistory.join('；')}`)
    }
    return lines.join('\n')
  }
  return JSON.stringify(data)
}

// ── JSON-RPC dispatch ───────────────────────────────────────────────────────
async function callTool(name, args) {
  if (name === ADMIN_TOOL) {
    const target = str(args.tool)
    if (!DEFERRED_TOOLS.includes(target))
      throw new Error(`Unknown admin tool: ${target || '(empty)'}`)
    const inner = args.args != null && typeof args.args === 'object' ? args.args : {}
    const data = await IMPL[target](inner)
    return { data, summarizedAs: target }
  }
  const impl = IMPL[name]
  if (impl == null) throw new Error(`Unknown tool: ${name}`)
  const data = await impl(args)
  return { data, summarizedAs: name }
}

async function handle(request) {
  const id = request.id
  try {
    if (request.method === 'initialize') {
      result(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'spark_wiki', version: '1.1.0' },
      })
      return
    }
    if (request.method === 'tools/list') {
      result(id, { tools: visibleTools() })
      return
    }
    if (request.method === 'tools/call') {
      const name = request.params?.name
      const args = request.params?.arguments || {}
      const { data, summarizedAs } = await callTool(name, args)
      result(id, { content: [{ type: 'text', text: summarize(summarizedAs, data) }] })
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
