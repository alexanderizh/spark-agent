#!/usr/bin/env node
/**
 * spark_app MCP server — 自定义子应用管理工具桥。
 *
 * 存在意义：子应用的持久化与生命周期归主进程的 SubAppRepository 管（桌面端走
 * subAppBackend IPC），agent-runtime 子进程消费不了主进程 IPC。本 server 是瘦
 * 桥接：把 agent 的 spark_app_* 工具调用代理到 PlatformBridgeService HTTP RPC
 * （subapp.*），bridge 再直访 SubAppRepository —— 与桌面端 IPC 路径复用同一套
 * 草稿 CAS 语义与领域错误（冲突 / 未找到 / 状态非法）。
 *
 * 协议：stdio JSON-RPC 2.0（与 platform-management-mcp-server.mjs 一致，
 * 由独立 Node 进程执行，不能依赖 app.asar 内的模块）。
 *
 * 工具（SDK 命名空间 mcp__spark_app__）：
 *   spark_app_create / spark_app_list / spark_app_get / spark_app_update_draft /
 *   spark_app_publish / spark_app_list_releases / spark_app_rollback /
 *   spark_app_set_enabled / spark_app_archive / spark_app_delete /
 *   spark_app_data_get / spark_app_data_list / spark_app_data_set /
 *   spark_app_data_delete
 *
 * 配置来自环境变量（由 session.service 注入）：
 *   SPARK_PLATFORM_BRIDGE_PORT  PlatformBridgeService 端口（必需）
 *   SPARK_SESSION_ID            当前会话 id（注入备用，当前工具不消费）
 */
import { request as httpRequest } from 'node:http'
import readline from 'node:readline'

const BRIDGE_PORT = Number(process.env.SPARK_PLATFORM_BRIDGE_PORT || 0)
const BRIDGE_HOST = '127.0.0.1'

// ─── JSON-RPC helpers ────────────────────────────────────────────────

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

// ─── Bridge RPC ──────────────────────────────────────────────────────

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params })
    const options = {
      hostname: BRIDGE_HOST,
      port: BRIDGE_PORT,
      path: '/rpc',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const req = httpRequest(options, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          if (parsed.ok) {
            resolve(parsed.data)
          } else {
            reject(new Error(parsed.error || 'Unknown bridge error'))
          }
        } catch (e) {
          reject(new Error(`Bridge response parse error: ${e.message}`))
        }
      })
    })

    req.on('error', (e) => reject(new Error(`Bridge connection error: ${e.message}`)))
    req.write(body)
    req.end()
  })
}

// ─── 参数归一化（宽松读取，非法类型直接丢弃交由 bridge 兜底校验）──────────

function str(value) {
  return typeof value === 'string' ? value : undefined
}

function optPositiveInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function optNonNegativeInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function optBool(value) {
  return typeof value === 'boolean' ? value : undefined
}

function optStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}

function defined(object) {
  const out = {}
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/** 应用数据命名空间缺省值；应用运行时通常使用自己声明的 namespace。 */
const DEFAULT_DATA_NAMESPACE = 'app'

// ─── Tool Definitions ────────────────────────────────────────────────

const SURFACE_DESCRIPTION =
  '展示面：content=普通内容区 iframe（默认），panel=侧边面板，overlay=悬浮层，global-window=独立窗口，desktop-pet=桌面宠物'

const PERMISSIONS_DESCRIPTION =
  '权限声明列表（能力名，如 runtime/theme/ui/data/clipboard/notifications），应用运行时按声明获得对应宿主能力'

function toolDefinitions() {
  return [
    // ── 应用生命周期 ──
    {
      name: 'spark_app_create',
      description: [
        '创建一个新的自定义子应用。创建后处于草稿态（draft、未启用），需要先发布（spark_app_publish）才会出现在应用入口。',
        '何时调用：用户想要一个新的小工具/小组件/桌面宠物等自包含 HTML 应用时。',
        '返回完整详情，其中的 draft.revision 是后续修改草稿要用的 CAS 基线。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120, description: '应用名称' },
          description: { type: 'string', maxLength: 400, description: '应用描述（可选）' },
          draftHtml: {
            type: 'string',
            maxLength: 200_000,
            description:
              '初始草稿源码：完整的自包含 HTML 文档（内联 CSS/JS，不引外部本地文件）。可选，之后可用 spark_app_update_draft 替换。',
          },
          permissions: {
            type: 'array',
            items: { type: 'string', maxLength: 80 },
            maxItems: 64,
            description: PERMISSIONS_DESCRIPTION,
          },
          surface: {
            type: 'string',
            enum: ['content', 'panel', 'overlay', 'global-window', 'desktop-pet'],
            description: SURFACE_DESCRIPTION,
          },
          icon: { type: 'string', maxLength: 240, description: '图标标识（可选）' },
          entry: { type: 'string', maxLength: 240, description: '入口文件名，默认 index.html' },
        },
      },
    },
    {
      name: 'spark_app_list',
      description: [
        '列出子应用（默认排除已归档）。返回摘要列表：id、名称、发布状态、是否启用、草稿 revision、已发布版本号、更新时间。',
        '何时调用：需要盘点现有应用、按名称找到某个应用的 appId 时。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          includeArchived: { type: 'boolean', description: '是否包含已归档应用，默认 false' },
          query: { type: 'string', maxLength: 120, description: '按名称/描述模糊过滤（可选）' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: '每页数量，默认 100' },
          offset: { type: 'integer', minimum: 0, description: '分页偏移，默认 0' },
        },
      },
    },
    {
      name: 'spark_app_get',
      description: [
        '取单个子应用详情：当前草稿（含源码摘要、manifest、revision）与已发布版本摘要。',
        '何时调用：修改草稿/发布/回滚前必先调用，拿到最新 draft.revision 作为 CAS 基线。',
        '注意：draft 源码过长时会截断显示（省 token）；更新草稿是整篇替换语义，直接用 spark_app_update_draft 传入新的完整 HTML 即可，不需要基于旧文做局部补丁。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: {
          appId: {
            type: 'string',
            description: '应用 ID（来自 spark_app_list / spark_app_create）',
          },
          releaseVersion: {
            type: 'integer',
            minimum: 1,
            description: '可选；指定时返回该历史发布版本的详情而非当前发布态',
          },
        },
      },
    },
    {
      name: 'spark_app_update_draft',
      description: [
        '修改子应用草稿。可更新源码（draftHtml）、名称、描述、权限、展示面、图标、入口中的任意字段。',
        'CAS 语义：必须传 spark_app_get 拿到的当前 expectedRevision；若期间草稿已被其他操作更新会返回冲突（SUBAPP_CONFLICT），此时应重新 get 拿新 revision 再重试，不要盲目覆盖。',
        'draftHtml 是整篇替换：传入新的完整 HTML 文档，而非增量补丁。成功后 revision +1。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId', 'expectedRevision'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
          expectedRevision: {
            type: 'integer',
            minimum: 1,
            description: '期望的当前草稿 revision（CAS 基线，来自 spark_app_get）',
          },
          draftHtml: {
            type: 'string',
            maxLength: 200_000,
            description: '新的完整草稿源码（自包含 HTML 文档）',
          },
          name: { type: 'string', minLength: 1, maxLength: 120, description: '新名称' },
          description: { type: 'string', maxLength: 400, description: '新描述' },
          permissions: {
            type: 'array',
            items: { type: 'string', maxLength: 80 },
            maxItems: 64,
            description: PERMISSIONS_DESCRIPTION,
          },
          surface: {
            type: 'string',
            enum: ['content', 'panel', 'overlay', 'global-window', 'desktop-pet'],
            description: SURFACE_DESCRIPTION,
          },
          icon: { type: 'string', maxLength: 240, description: '新图标标识' },
          entry: { type: 'string', minLength: 1, maxLength: 240, description: '新入口文件名' },
        },
      },
    },
    {
      name: 'spark_app_publish',
      description: [
        '把当前草稿发布为新版本：生成一条不可变的发布快照（版本号自增），应用转为 published 态。',
        '何时调用：草稿改完、用户确认要上线时。发布后应用才可被启用并出现在应用入口。',
        '同样受 CAS 约束：传 spark_app_get 拿到的当前 revision；冲突时重新 get 再试。',
        '注意：版本记录保存的是发布时刻的完整草稿快照，暂不支持附加 changelog 文案；如需变更说明可写进应用 description。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId', 'expectedRevision'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
          expectedRevision: {
            type: 'integer',
            minimum: 1,
            description: '期望的当前草稿 revision（CAS 基线）',
          },
        },
      },
    },
    {
      name: 'spark_app_list_releases',
      description: [
        '列出某个子应用的发布版本历史（版本号、名称、描述、发布时间、是否当前发布态），按版本号倒序。',
        '何时调用：需要回滚选版本、或向用户汇报版本演进时。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: '每页数量，默认 50' },
          offset: { type: 'integer', minimum: 0, description: '分页偏移，默认 0' },
        },
      },
    },
    {
      name: 'spark_app_rollback',
      description: [
        '把草稿回滚到某个历史发布版本的内容（名称/描述/源码/权限等整体回到该版本快照），当前发布态不受影响，回滚后仍需 publish 才会生效到线上。',
        '受 CAS 约束：expectedRevision 传当前草稿 revision（来自 spark_app_get）；目标 releaseVersion 来自 spark_app_list_releases。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId', 'releaseVersion', 'expectedRevision'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
          releaseVersion: { type: 'integer', minimum: 1, description: '回滚目标发布版本号' },
          expectedRevision: {
            type: 'integer',
            minimum: 1,
            description: '期望的当前草稿 revision（CAS 基线）',
          },
        },
      },
    },
    {
      name: 'spark_app_set_enabled',
      description: [
        '启用/禁用子应用。只有已发布（published）的应用才能启用；禁用后应用不再出现在应用入口但数据与版本都保留。',
        '已归档应用不能直接启用，需先回滚草稿重新发布。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId', 'enabled'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
          enabled: { type: 'boolean', description: 'true=启用，false=禁用' },
        },
      },
    },
    {
      name: 'spark_app_archive',
      description: [
        '归档子应用：从应用入口移除并置为不可修改（archived，enabled=false），但应用、版本历史与应用数据都保留，可随时查阅。',
        '这是可逆的低风险收尾操作；确实要彻底移除数据才用 spark_app_delete。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
        },
      },
    },
    {
      name: 'spark_app_delete',
      description: [
        '硬删除子应用及其全部发布版本与应用数据，不可恢复。这是破坏性操作：调用前必须先向用户说明影响范围并获得明确确认。',
        '优先考虑 spark_app_archive（可逆）代替删除。',
        '幂等语义：应用已不存在时不报错，返回 deleted=false 的幂等空操作结果。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: {
          appId: { type: 'string', description: '要删除的应用 ID' },
        },
      },
    },

    // ── 应用数据命名空间 ──
    {
      name: 'spark_app_data_get',
      description: [
        '读取应用数据命名空间里的单个键值（JSON 值 + revision）。',
        '何时调用：需要读取应用的持久化状态，或准备做带 revision 的条件写入时。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId', 'key'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
          key: { type: 'string', minLength: 1, maxLength: 240, description: '数据键名' },
          namespace: {
            type: 'string',
            minLength: 1,
            maxLength: 120,
            description: `数据命名空间，默认 "${DEFAULT_DATA_NAMESPACE}"；要与某个运行中应用的存取互通时传该应用自己使用的 namespace`,
          },
        },
      },
    },
    {
      name: 'spark_app_data_list',
      description: [
        '列出应用数据命名空间里的键值（可按 key 前缀过滤），返回 items + total。',
        '何时调用：盘点应用持久化了哪些数据时。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
          namespace: {
            type: 'string',
            minLength: 1,
            maxLength: 120,
            description: `数据命名空间，默认 "${DEFAULT_DATA_NAMESPACE}"`,
          },
          prefix: { type: 'string', maxLength: 240, description: 'key 前缀过滤（可选）' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: '每页数量，默认 100' },
          offset: { type: 'integer', minimum: 0, description: '分页偏移，默认 0' },
        },
      },
    },
    {
      name: 'spark_app_data_set',
      description: [
        '写入/更新应用数据命名空间里的一个键值（整体替换该键的 JSON 值，上限 512KB）。',
        '乐观锁：传入 spark_app_data_get 拿到的当前 revision（expectedRevision）可避免覆盖他人并发写入；不传则强制写入（最后写赢）。',
        '键不存在且传了 expectedRevision 会冲突；此时去掉 expectedRevision 即为创建新键。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId', 'key', 'value'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
          key: { type: 'string', minLength: 1, maxLength: 240, description: '数据键名' },
          value: { description: '要持久化的 JSON 值（任意可序列化 JSON）' },
          expectedRevision: {
            type: 'integer',
            minimum: 1,
            description: '可选；期望的当前数据 revision，不匹配则冲突，用于并发安全更新',
          },
          namespace: {
            type: 'string',
            minLength: 1,
            maxLength: 120,
            description: `数据命名空间，默认 "${DEFAULT_DATA_NAMESPACE}"`,
          },
        },
      },
    },
    {
      name: 'spark_app_data_delete',
      description: [
        '删除应用数据命名空间里的一个键值。必须传该键当前 revision（来自 spark_app_data_get）；revision 不匹配会冲突，防止误删并发更新后的数据。',
        '删除后不可恢复；删除不存在的键返回未找到（SUBAPP_NOT_FOUND）。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId', 'key', 'expectedRevision'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
          key: { type: 'string', minLength: 1, maxLength: 240, description: '数据键名' },
          expectedRevision: {
            type: 'integer',
            minimum: 1,
            description: '该键当前 revision（必填，并发保护）',
          },
          namespace: {
            type: 'string',
            minLength: 1,
            maxLength: 120,
            description: `数据命名空间，默认 "${DEFAULT_DATA_NAMESPACE}"`,
          },
        },
      },
    },
  ]
}

// ─── Tool Call Handler ───────────────────────────────────────────────

async function handleToolCall(name, args) {
  try {
    const data = await dispatchTool(name, args || {})
    return { content: [{ type: 'text', text: present(name, data) }] }
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Error: ${e.message}` }],
      isError: true,
    }
  }
}

async function dispatchTool(name, args) {
  const appId = str(args.appId)
  const namespace = str(args.namespace) || DEFAULT_DATA_NAMESPACE
  const key = str(args.key)

  switch (name) {
    case 'spark_app_create':
      return rpc('subapp.create', {
        name: str(args.name),
        description: str(args.description),
        draftHtml: str(args.draftHtml),
        permissions: optStringArray(args.permissions),
        surface: str(args.surface),
        icon: args.icon === null ? null : str(args.icon),
        entry: str(args.entry),
      })

    case 'spark_app_list':
      return rpc('subapp.list', {
        includeArchived: optBool(args.includeArchived),
        query: str(args.query),
        limit: optPositiveInt(args.limit),
        offset: optNonNegativeInt(args.offset),
      })

    case 'spark_app_get':
      return rpc('subapp.get', {
        appId,
        releaseVersion: optPositiveInt(args.releaseVersion),
      })

    case 'spark_app_update_draft': {
      const patch = defined({
        source: str(args.draftHtml),
        name: str(args.name),
        description: str(args.description),
        permissions: optStringArray(args.permissions),
        surface: str(args.surface),
        icon: args.icon === undefined ? undefined : args.icon === null ? null : str(args.icon),
        entry: str(args.entry),
      })
      return rpc('subapp.update_draft', {
        appId,
        expectedDraftRevision: optPositiveInt(args.expectedRevision),
        patch,
      })
    }

    case 'spark_app_publish':
      return rpc('subapp.publish', {
        appId,
        expectedDraftRevision: optPositiveInt(args.expectedRevision),
      })

    case 'spark_app_list_releases':
      return rpc('subapp.list_releases', {
        appId,
        limit: optPositiveInt(args.limit),
        offset: optNonNegativeInt(args.offset),
      })

    case 'spark_app_rollback':
      return rpc('subapp.rollback', {
        appId,
        releaseVersion: optPositiveInt(args.releaseVersion),
        expectedDraftRevision: optPositiveInt(args.expectedRevision),
      })

    case 'spark_app_set_enabled':
      return rpc('subapp.set_enabled', {
        appId,
        enabled: optBool(args.enabled),
      })

    case 'spark_app_archive':
      return rpc('subapp.archive', { appId })

    case 'spark_app_delete':
      return rpc('subapp.delete', { appId })

    case 'spark_app_data_get':
      return rpc('subapp.data_get', { appId, namespace, key })

    case 'spark_app_data_list':
      return rpc('subapp.data_list', {
        appId,
        namespace,
        prefix: str(args.prefix),
        limit: optPositiveInt(args.limit),
        offset: optNonNegativeInt(args.offset),
      })

    case 'spark_app_data_set':
      return rpc('subapp.data_set', {
        appId,
        namespace,
        key,
        value: args.value,
        expectedRevision: optPositiveInt(args.expectedRevision),
      })

    case 'spark_app_data_delete':
      return rpc('subapp.data_delete', {
        appId,
        namespace,
        key,
        expectedRevision: optPositiveInt(args.expectedRevision),
      })

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ─── Summarize（把结构化结果转成给 agent 看的文本）────────────────────

/** draft 源码过长时截断展示，避免大 HTML 吃满上下文；更新语义是整篇替换。 */
const SOURCE_PREVIEW_LIMIT = 2000

function truncateSource(source) {
  if (typeof source !== 'string' || source.length <= SOURCE_PREVIEW_LIMIT) return source
  return `${source.slice(0, SOURCE_PREVIEW_LIMIT)}\n…[草稿源码已截断：完整长度 ${source.length} 字符；更新时直接传新的完整 HTML 即可]`
}

function withTruncatedDraft(details) {
  if (details == null || typeof details !== 'object') return details
  if (details.draft == null || typeof details.draft !== 'object') return details
  return { ...details, draft: { ...details.draft, source: truncateSource(details.draft.source) } }
}

function present(name, data) {
  if (
    name === 'spark_app_get' ||
    name === 'spark_app_create' ||
    name === 'spark_app_update_draft' ||
    name === 'spark_app_publish' ||
    name === 'spark_app_rollback'
  ) {
    return JSON.stringify(withTruncatedDraft(data), null, 2)
  }
  if (name === 'spark_app_data_get' && data == null) {
    return '未找到该数据键（键不存在或已被删除）。'
  }
  return JSON.stringify(data, null, 2)
}

// ─── Main loop ───────────────────────────────────────────────────────

function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false })

  rl.on('line', (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }

    if (msg.method === 'initialize') {
      result(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'spark_app', version: '1.0.0' },
      })
      return
    }

    if (msg.method === 'notifications/initialized') {
      // No response needed for notifications
      return
    }

    if (msg.method === 'tools/list') {
      result(msg.id, { tools: toolDefinitions() })
      return
    }

    if (msg.method === 'resources/list') {
      result(msg.id, { resources: [] })
      return
    }

    if (msg.method === 'resources/templates/list') {
      result(msg.id, { resourceTemplates: [] })
      return
    }

    if (msg.method === 'prompts/list') {
      result(msg.id, { prompts: [] })
      return
    }

    if (msg.method === 'tools/call') {
      const toolName = msg.params?.name
      const toolArgs = msg.params?.arguments ?? {}
      handleToolCall(toolName, toolArgs)
        .then((toolResult) => result(msg.id, toolResult))
        .catch((e) => error(msg.id, -32603, e.message))
      return
    }

    // ping
    if (msg.method === 'ping') {
      result(msg.id, {})
      return
    }

    if (msg.id != null) {
      error(msg.id, -32601, `Method not found: ${msg.method}`)
    }
  })

  rl.on('close', () => {
    process.exit(0)
  })
}

main()
