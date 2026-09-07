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
 *   spark_app_developer_guide / spark_app_validate / spark_app_scaffold /
 *   spark_app_project_status / spark_app_project_read_file /
 *   spark_app_project_write_file / spark_app_project_publish /
 *   spark_app_connections_list / spark_app_connections_bind / spark_app_connections_unbind /
 *   spark_app_service_status / spark_app_service_logs / spark_app_service_restart /
 *   spark_app_jobs_create / spark_app_jobs_get / spark_app_jobs_list / spark_app_jobs_cancel /
 *   spark_app_diagnose /
 *   spark_app_create / spark_app_list / spark_app_get / spark_app_update_draft /
 *   spark_app_publish / spark_app_list_releases / spark_app_delete_release /
 *   spark_app_rollback /
 *   spark_app_set_enabled / spark_app_archive / spark_app_delete /
 *   spark_app_data_get / spark_app_data_list / spark_app_data_set /
 *   spark_app_data_delete
 *
 * 配置来自环境变量（由 session.service 注入）：
 *   SPARK_PLATFORM_BRIDGE_PORT  PlatformBridgeService 端口（必需）
 *   SPARK_SESSION_ID            当前会话 id（注入备用，当前工具不消费）
 *   SPARK_WORKSPACE_ROOT         当前会话工作区根目录（源码文件引用边界）
 */
import { request as httpRequest } from 'node:http'
import readline from 'node:readline'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  compactSubAppDetails,
  exportWorkspaceSubAppSource,
  readWorkspaceSubAppSource,
} from './sub-app-source-store.mjs'
import {
  querySubAppDeveloperGuide,
  SUB_APP_GUIDE_TOPICS,
  SUB_APP_SOURCE_HARD_LIMIT,
} from './sub-app-developer-contract.mjs'
import { validateSubAppSource } from './sub-app-validator.mjs'

const BRIDGE_PORT = Number(process.env.SPARK_PLATFORM_BRIDGE_PORT || 0)
const BRIDGE_HOST = '127.0.0.1'
const WORKSPACE_ROOT = process.env.SPARK_WORKSPACE_ROOT || ''

// ─── 子应用图标 ────────────────────────────────────────────────────────
// 与前端受控注册表同步维护：apps/desktop/src/renderer/design/sub-app/subAppIconOptions.ts。
// 图标一律使用 builtin:<name>，不使用 Emoji。
const SUB_APP_ICON_NAMES = [
  'list-todo',
  'book',
  'calendar',
  'sticky-note',
  'note',
  'kanban',
  'table',
  'presentation',
  'file-text',
  'search',
  'translate',
  'study',
  'lightbulb',
  'timer',
  'clock',
  'bell',
  'chat',
  'mail',
  'agent',
  'code',
  'terminal',
  'git',
  'workflow',
  'puzzle',
  'key',
  'calculator',
  'database',
  'canvas',
  'palette',
  'image',
  'video',
  'music',
  'camera',
  'globe',
  'folder',
  'weather',
  'health',
  'fitness',
  'habit',
  'wallet',
  'shopping',
  'cooking',
  'travel',
  'game',
  'star',
  'users',
  'chart',
].join('、')

const SUB_APP_ICON_CREATE_DESCRIPTION =
  `图标标识（可选）：必须使用受控图标 builtin:<name>（name 从中选：${SUB_APP_ICON_NAMES}）。` +
  '按应用用途选择语义最贴近的图标；不要使用 Emoji 作为图标，也不要传多词说明文本。'

const SUB_APP_ICON_UPDATE_DESCRIPTION =
  `新图标标识：必须使用受控图标 builtin:<name>（name 从中选：${SUB_APP_ICON_NAMES}）。` +
  '不要使用 Emoji；传 null 可恢复默认应用图标。'

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
  '兼容旧版本的 manifest 字段（能力名，如 runtime/theme/ui/data/browser）；当前 SparkWork 子应用按平台核心内部应用运行，宿主不会用它裁剪平台 IPC、MCP、Plugin、Skill、Provider 或模型能力'

const DESIGN_PREVIEW_WORKFLOW_GUIDE = [
  '开发流程（设计先行）：创建新应用或大幅改版时，必须先产出界面设计预览给用户确认（用会话内可用的预览手段，如 render_html 渲染静态界面效果图或低仿真原型），根据用户反馈不断迭代调整设计；用户明确确认界面方案后，才开发完整实现写入草稿。',
  '用户确认设计之前不要直接开发落地，更不要未经确认就发布。',
].join(' ')

function runtimeToolDefinitions() {
  const appOnly = { type: 'object', required: ['appId'], properties: { appId: { type: 'string' } } }
  return [
    {
      name: 'spark_app_service_status',
      description: '查询子应用受管后台服务状态、当前 release、启动时间、崩溃与重启次数。',
      inputSchema: appOnly,
    },
    {
      name: 'spark_app_service_logs',
      description: '查询子应用后台服务的有界内存日志；日志不包含请求 payload 或凭据。',
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: {
          appId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
        },
      },
    },
    {
      name: 'spark_app_service_restart',
      description: '手动停止并重启已发布 V2 子应用的受管后台服务。',
      inputSchema: appOnly,
    },
    {
      name: 'spark_app_jobs_create',
      description: '创建并异步启动一个固定到当前 release 的持久子应用任务。',
      inputSchema: {
        type: 'object',
        required: ['appId', 'type'],
        properties: { appId: { type: 'string' }, type: { type: 'string' }, input: {} },
      },
    },
    {
      name: 'spark_app_jobs_get',
      description: '查询持久任务的状态、进度、checkpoint、结果或错误。',
      inputSchema: {
        type: 'object',
        required: ['appId', 'jobId'],
        properties: { appId: { type: 'string' }, jobId: { type: 'string' } },
      },
    },
    {
      name: 'spark_app_jobs_list',
      description: '分页列出子应用持久任务。',
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: {
          appId: { type: 'string' },
          status: {
            type: 'string',
            enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'],
          },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
    },
    {
      name: 'spark_app_jobs_cancel',
      description: '请求取消一个排队中或运行中的持久任务。',
      inputSchema: {
        type: 'object',
        required: ['appId', 'jobId'],
        properties: { appId: { type: 'string' }, jobId: { type: 'string' } },
      },
    },
    {
      name: 'spark_app_diagnose',
      description:
        '联合诊断 V2 项目/发布制品、后台服务和可执行状态，返回 correlationId 与结构化问题。',
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: {
          appId: { type: 'string' },
          mode: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
          includeService: { type: 'boolean', default: true },
        },
      },
    },
  ]
}

function toolDefinitions() {
  return [
    // ── 开发契约与校验 ──
    {
      name: 'spark_app_developer_guide',
      description:
        '按需查询当前 SparkWork 子应用运行时的权威开发契约。无参数只返回主题目录；复杂应用在编码前按 topic 或精确 symbol 查询，不能根据规划文档猜测未实现 API。',
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            enum: Object.keys(SUB_APP_GUIDE_TOPICS),
            description: '按能力主题查询。',
          },
          query: { type: 'string', maxLength: 160, description: '按自然语言关键词搜索契约。' },
          symbol: {
            type: 'string',
            maxLength: 160,
            description: '精确 SDK 符号，例如 sparkApp.data.upsert。',
          },
          surface: {
            type: 'string',
            enum: ['content', 'panel', 'overlay', 'global-window', 'desktop-pet'],
            description: '查询某个展示面的布局、背景和生命周期。',
          },
          includeExamples: { type: 'boolean', default: true, description: '是否返回最小示例。' },
        },
      },
    },
    {
      name: 'spark_app_validate',
      description: [
        '静态校验 V1 单 HTML 源码或已保存的子应用草稿/发布版本，返回 error、warning、suggestion、检测到的能力和契约 digest。',
        'error 是可确定的运行边界问题并阻断 readyToPreview/readyToPublish；warning 和 suggestion 不冒充确定缺陷。',
        'appId、draftHtml、draftFilePath 三种来源只能选择一种；appId 可配 releaseVersion 校验历史版本。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: '已保存子应用 ID；默认校验当前草稿。' },
          releaseVersion: {
            type: 'integer',
            minimum: 1,
            description: '配合 appId 校验历史发布版本。',
          },
          draftHtml: {
            type: 'string',
            maxLength: SUB_APP_SOURCE_HARD_LIMIT,
            description: '要校验的完整 V1 HTML 源码。',
          },
          draftFilePath: {
            type: 'string',
            description: '工作区内的 .html/.htm 文件路径；与 appId、draftHtml 互斥。',
          },
          surface: {
            type: 'string',
            enum: ['content', 'panel', 'overlay', 'global-window', 'desktop-pet'],
            description: '直接校验源码时的展示面，默认 content。',
          },
        },
      },
    },
    {
      name: 'spark_app_scaffold',
      description:
        '创建 V2 受管多文件子应用骨架。frontend 仅生成前端；fullstack 同时生成受管 Node 后台服务。不会自动发布。',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', maxLength: 400 },
          icon: { type: 'string', maxLength: 240 },
          surface: {
            type: 'string',
            enum: ['content', 'panel', 'overlay', 'global-window', 'desktop-pet'],
          },
          template: { type: 'string', enum: ['frontend', 'fullstack'], default: 'frontend' },
        },
      },
    },
    {
      name: 'spark_app_project_status',
      description: '读取 V2 受管项目的文件列表、manifest、草稿 revision 和静态校验结果。',
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: {
          appId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    {
      name: 'spark_app_project_read_file',
      description: '读取 V2 受管项目中的一个文件。',
      inputSchema: {
        type: 'object',
        required: ['appId', 'path'],
        properties: {
          appId: { type: 'string' },
          path: { type: 'string' },
          encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
        },
      },
    },
    {
      name: 'spark_app_project_write_file',
      description:
        '以 CAS 方式写入 V2 项目单文件；每次写入生成新的不可变草稿 revision，并返回全包校验。',
      inputSchema: {
        type: 'object',
        required: ['appId', 'expectedRevision', 'path', 'content'],
        properties: {
          appId: { type: 'string' },
          expectedRevision: { type: 'integer', minimum: 1 },
          path: { type: 'string' },
          content: { type: 'string' },
          encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
        },
      },
    },
    {
      name: 'spark_app_project_delete_file',
      description: '以 CAS 方式删除 V2 项目文件；不允许删除 spark-app.json。',
      inputSchema: {
        type: 'object',
        required: ['appId', 'expectedRevision', 'path'],
        properties: {
          appId: { type: 'string' },
          expectedRevision: { type: 'integer', minimum: 1 },
          path: { type: 'string' },
        },
      },
    },
    {
      name: 'spark_app_project_publish',
      description:
        '校验并发布 V2 项目为内容寻址的不可变制品，候选 service 健康后才切换前端、service、manifest 和契约。每次 V2 发布后都保持禁用，需用户查看 OS effects 后显式重新启用。',
      inputSchema: {
        type: 'object',
        required: ['appId', 'expectedRevision'],
        properties: {
          appId: { type: 'string' },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
      },
    },
    {
      name: 'spark_app_project_export',
      description:
        '把 V2 草稿导出为工作区内 .spark-agent/sub-app-projects/ 下的多文件项目，同 revision 内容不一致时拒绝覆盖。',
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: { appId: { type: 'string' } },
      },
    },
    {
      name: 'spark_app_project_import',
      description:
        '从当前工作区目录导入一个完整 V2 项目为新子应用草稿；先校验 spark-app.json、路径、体积与入口。',
      inputSchema: {
        type: 'object',
        required: ['projectDir'],
        properties: { projectDir: { type: 'string' } },
      },
    },
    {
      name: 'spark_app_migration_report',
      description:
        '扫描 V1 子应用对 raw IPC、Provider 明文密钥、相对资源和浏览器存储的依赖，评估迁移 V2 前需要处理的项目。',
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: { appId: { type: 'string' } },
      },
    },
    {
      name: 'spark_app_migrate_v1',
      description:
        '把当前 V1 单 HTML 草稿显式转换为同 appId 的 V2 多文件草稿；不自动发布，原 V1 历史 release 保留。',
      inputSchema: {
        type: 'object',
        required: ['appId', 'expectedRevision'],
        properties: {
          appId: { type: 'string' },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
      },
    },
    {
      name: 'spark_app_connections_list',
      description: '列出 V2 子应用的连接槽绑定（不返回密钥）。',
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: { appId: { type: 'string' } },
      },
    },
    {
      name: 'spark_app_connections_bind',
      description:
        '把 manifest 声明的连接槽绑定到已有 API Connection 或 Provider；授权 origin 不能超出发布包声明。',
      inputSchema: {
        type: 'object',
        required: ['appId', 'slot', 'bindingKind', 'bindingId'],
        properties: {
          appId: { type: 'string' },
          slot: { type: 'string' },
          bindingKind: { type: 'string', enum: ['api-connection', 'provider-profile'] },
          bindingId: { type: 'string' },
          grantedOrigins: { type: 'array', items: { type: 'string' } },
          allowPrivateNetwork: { type: 'boolean' },
        },
      },
    },
    {
      name: 'spark_app_connections_unbind',
      description: '解除子应用连接槽绑定，不删除 Provider 或 API Connection 本身。',
      inputSchema: {
        type: 'object',
        required: ['appId', 'slot'],
        properties: { appId: { type: 'string' }, slot: { type: 'string' } },
      },
    },
    ...runtimeToolDefinitions(),
    // ── 应用生命周期 ──
    {
      name: 'spark_app_create',
      description: [
        '创建一个新的自定义子应用（SparkWork 平台内置应用，运行在平台的应用入口/悬浮窗/桌面宠物里，源码存于平台数据库，不是外部项目文件）。创建后处于草稿态（draft、未启用），需要先发布（spark_app_publish）才会出现在应用入口。',
        '何时调用：仅当用户明确要求平台内置子应用时——用户明确提到「子应用」「内置应用」「SparkWork 应用」「桌面宠物」，或要求应用出现在平台应用入口、悬浮窗等宿主界面中。',
        '何时不要调用：用户要求开发一个应用/小工具/网页/服务端但没有说明要内置到平台时，默认是外部项目开发——直接在当前工作目录创建普通项目文件，不要调用本工具。拿不准时先问用户「要平台内置子应用，还是当前目录的外部项目」，不要默认创建子应用。',
        DESIGN_PREVIEW_WORKFLOW_GUIDE,
        '复杂应用先调用 spark_app_developer_guide 查询所需 SDK；写入前调用 spark_app_validate。创建结果会附带静态校验摘要，但不会自动发布。',
        '源码较长时先写入工作区 HTML 文件并传 draftFilePath，避免把完整源码作为工具参数反复带入上下文。draftHtml 与 draftFilePath 二选一。',
        '返回紧凑详情，其中的 draft.revision 是后续修改草稿要用的 CAS 基线。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120, description: '应用名称' },
          description: { type: 'string', maxLength: 400, description: '应用描述（可选）' },
          draftHtml: {
            type: 'string',
            maxLength: SUB_APP_SOURCE_HARD_LIMIT,
            description:
              '初始草稿源码：完整的自包含 HTML 文档（内联 CSS/JS，或经 CDN 引入外部库；不引外部本地文件）。可选，之后可用 spark_app_update_draft 替换。',
          },
          draftFilePath: {
            type: 'string',
            description: '工作区内的 .html/.htm 源码文件路径；长源码优先使用。与 draftHtml 互斥。',
          },
          permissions: {
            type: 'array',
            items: { type: 'string', maxLength: 80 },
            maxItems: 64,
            default: ['data'],
            description: `${PERMISSIONS_DESCRIPTION}；不传时默认仍写入兼容性的 data 值。`,
          },
          surface: {
            type: 'string',
            enum: ['content', 'panel', 'overlay', 'global-window', 'desktop-pet'],
            description: SURFACE_DESCRIPTION,
          },
          icon: {
            type: 'string',
            maxLength: 240,
            description: SUB_APP_ICON_CREATE_DESCRIPTION,
          },
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
        'draft 与 publishedRelease 都只返回源码指纹和最多 2000 字符的头尾预览；需要完整源码时调用 spark_app_export_source，把源码导出为工作区文件后按文件编辑。',
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
      name: 'spark_app_export_source',
      description: [
        '把子应用完整草稿或指定历史发布版本导出到当前工作区的 .spark-agent/sub-app-sources/。',
        '返回稳定文件路径、SHA-256、字符数和字节数；相同内容复用同一文件。需要检查或修改既有完整源码时先调用本工具，再用文件工具按范围读取/编辑。',
        '默认导出当前草稿；传 releaseVersion 时导出对应发布快照。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
          releaseVersion: {
            type: 'integer',
            minimum: 1,
            description: '可选；导出指定历史发布版本，缺省导出当前草稿',
          },
        },
      },
    },
    {
      name: 'spark_app_update_draft',
      description: [
        '修改子应用草稿。可更新源码（draftHtml 或 draftFilePath）、名称、描述、权限、展示面、图标、入口中的任意字段。',
        '涉及界面大改版时同样遵循设计先行：先出界面设计预览给用户确认，再写入完整实现。',
        '复杂应用先调用 spark_app_developer_guide；写入前调用 spark_app_validate。更新结果会附带静态校验摘要，但不会自动发布。',
        'CAS 语义：必须传 spark_app_get 拿到的当前 expectedRevision；若期间草稿已被其他操作更新会返回冲突（SUBAPP_CONFLICT），此时应重新 get 拿新 revision 再重试，不要盲目覆盖。',
        '源码是整篇替换语义；长源码优先传工作区 draftFilePath，避免完整 HTML 常驻工具调用历史。draftHtml 与 draftFilePath 二选一。成功后 revision +1。',
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
            maxLength: SUB_APP_SOURCE_HARD_LIMIT,
            description: '新的完整草稿源码（自包含 HTML 文档，可经 CDN 引入外部库）',
          },
          draftFilePath: {
            type: 'string',
            description: '工作区内的 .html/.htm 源码文件路径；长源码优先使用。与 draftHtml 互斥。',
          },
          name: { type: 'string', minLength: 1, maxLength: 120, description: '新名称' },
          description: { type: 'string', maxLength: 400, description: '新描述' },
          permissions: {
            type: 'array',
            items: { type: 'string', maxLength: 80 },
            maxItems: 64,
            description: `${PERMISSIONS_DESCRIPTION}；数据 API 可直接使用，完整平台能力请通过 sparkApp.ipc 调用。`,
          },
          surface: {
            type: 'string',
            enum: ['content', 'panel', 'overlay', 'global-window', 'desktop-pet'],
            description: SURFACE_DESCRIPTION,
          },
          icon: {
            type: 'string',
            maxLength: 240,
            description: SUB_APP_ICON_UPDATE_DESCRIPTION,
          },
          entry: { type: 'string', minLength: 1, maxLength: 240, description: '新入口文件名' },
        },
      },
    },
    {
      name: 'spark_app_publish',
      description: [
        '把当前草稿发布为新版本：生成一条不可变的发布快照（版本号自增），应用转为 published 态。',
        '何时调用：草稿改完、界面设计已经用户预览确认、且用户明确同意上线时。发布后应用才可被启用并出现在应用入口。',
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
      name: 'spark_app_delete_release',
      description: [
        '删除某个子应用的历史发布版本。当前正在使用的发布版本不能删除，以保证已发布应用始终可运行。',
        '这是不可恢复操作；调用前必须向用户说明会移除指定版本，并获得明确确认。版本号不会重排，后续发布仍会使用新的递增版本号。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId', 'releaseVersion'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
          releaseVersion: { type: 'integer', minimum: 1, description: '要删除的历史版本号' },
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
        '启用/禁用子应用。禁用后应用不再出现在应用入口但数据与版本都保留。',
        'V2 应用包含 service 或 OS effects 时，启用前必须向用户明确展示其以当前用户权限运行且非安全沙箱；只有用户同意后才传 confirmTrustedLocal=true。',
        '已归档应用不能直接启用，需先回滚草稿重新发布。',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['appId', 'enabled'],
        properties: {
          appId: { type: 'string', description: '应用 ID' },
          enabled: { type: 'boolean', description: 'true=启用，false=禁用' },
          confirmTrustedLocal: {
            type: 'boolean',
            description: '已向用户展示 V2 后台/OS effects 且获得明确同意',
          },
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
    case 'spark_app_developer_guide':
      return querySubAppDeveloperGuide({
        topic: str(args.topic),
        query: str(args.query),
        symbol: str(args.symbol),
        surface: str(args.surface),
        includeExamples: optBool(args.includeExamples),
      })

    case 'spark_app_validate':
      return resolveValidation(args)

    case 'spark_app_scaffold':
      return rpc(
        'subapp.scaffold',
        defined({
          name: str(args.name),
          description: str(args.description),
          icon: str(args.icon),
          surface: str(args.surface),
          template: str(args.template),
        }),
      )
    case 'spark_app_project_status':
      return compactProjectStatus(
        await rpc('subapp.project_status', { appId }),
        optPositiveInt(args.limit) ?? 100,
        optNonNegativeInt(args.offset) ?? 0,
      )
    case 'spark_app_project_read_file':
      return rpc('subapp.project_read_file', {
        appId,
        path: str(args.path),
        encoding: str(args.encoding),
      })
    case 'spark_app_project_write_file':
      return rpc('subapp.project_write_file', {
        appId,
        expectedDraftRevision: optPositiveInt(args.expectedRevision),
        path: str(args.path),
        content: str(args.content),
        encoding: str(args.encoding),
      })
    case 'spark_app_project_delete_file':
      return rpc('subapp.project_delete_file', {
        appId,
        expectedDraftRevision: optPositiveInt(args.expectedRevision),
        path: str(args.path),
      })
    case 'spark_app_project_publish':
      return rpc('subapp.project_publish', {
        appId,
        expectedDraftRevision: optPositiveInt(args.expectedRevision),
      })
    case 'spark_app_project_export':
      return exportManagedProject(appId)
    case 'spark_app_project_import':
      return importManagedProject(str(args.projectDir))
    case 'spark_app_migration_report': {
      const details = await rpc('subapp.get', { appId })
      const validation = validateSubAppSource({
        source: details.draft.source,
        surface: details.draft.manifest?.surface,
      })
      return {
        appId,
        format: details.draft.format ?? details.format ?? 'v1',
        readyForMechanicalMigration: validation.diagnostics.every(
          (item) =>
            !['LEGACY_RAW_IPC', 'LEGACY_PROVIDER_SECRET_ACCESS', 'V1_RELATIVE_RESOURCE'].includes(
              item.code,
            ),
        ),
        migrationDiagnostics: validation.diagnostics.filter((item) =>
          [
            'LEGACY_RAW_IPC',
            'LEGACY_PROVIDER_SECRET_ACCESS',
            'V1_RELATIVE_RESOURCE',
            'NON_DURABLE_BROWSER_STORAGE',
          ].includes(item.code),
        ),
      }
    }
    case 'spark_app_migrate_v1':
      return rpc('subapp.migrate_v1', {
        appId,
        expectedDraftRevision: optPositiveInt(args.expectedRevision),
      })
    case 'spark_app_connections_list':
      return rpc('subapp.connections_list', { appId })
    case 'spark_app_connections_bind':
      return rpc('subapp.connections_bind', {
        appId,
        slot: str(args.slot),
        bindingKind: str(args.bindingKind),
        bindingId: str(args.bindingId),
        grantedOrigins: optStringArray(args.grantedOrigins),
        allowPrivateNetwork: optBool(args.allowPrivateNetwork),
      })
    case 'spark_app_connections_unbind':
      return rpc('subapp.connections_unbind', { appId, slot: str(args.slot) })
    case 'spark_app_service_status':
      return rpc('subapp.service_status', { appId })
    case 'spark_app_service_logs':
      return rpc('subapp.service_logs', { appId, limit: optPositiveInt(args.limit) })
    case 'spark_app_service_restart':
      return rpc('subapp.service_restart', { appId })
    case 'spark_app_jobs_create':
      return rpc('subapp.jobs_create', { appId, type: str(args.type), input: args.input })
    case 'spark_app_jobs_get':
      return rpc('subapp.jobs_get', { appId, jobId: str(args.jobId) })
    case 'spark_app_jobs_list':
      return rpc('subapp.jobs_list', {
        appId,
        status: str(args.status),
        limit: optPositiveInt(args.limit),
        offset: optNonNegativeInt(args.offset),
      })
    case 'spark_app_jobs_cancel':
      return rpc('subapp.jobs_cancel', { appId, jobId: str(args.jobId) })
    case 'spark_app_diagnose':
      return rpc('subapp.diagnose', {
        appId,
        mode: str(args.mode),
        includeService: optBool(args.includeService),
      })

    case 'spark_app_create': {
      const source = await resolveDraftSource(args)
      const created = await rpc('subapp.create', {
        name: str(args.name),
        description: str(args.description),
        // 工具参数叫 draftHtml，bridge RPC 字段统一叫 source（与 update_draft 一致）。
        // 曾因两侧字段名不一致导致创建出的应用源码为空、运行白屏。
        source,
        permissions: optStringArray(args.permissions),
        surface: str(args.surface),
        icon: args.icon === null ? null : str(args.icon),
        entry: str(args.entry),
      })
      return attachValidation(
        created,
        source ?? created?.draft?.source,
        str(args.draftFilePath),
        str(args.surface) ?? created?.draft?.manifest?.surface ?? created?.surface,
      )
    }

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

    case 'spark_app_export_source': {
      if (appId == null || appId.trim().length === 0) throw new Error('appId 必填。')
      const releaseVersion = optPositiveInt(args.releaseVersion)
      const details = await rpc('subapp.get', { appId, releaseVersion })
      const owner = releaseVersion == null ? details?.draft : details?.publishedRelease
      if (owner == null || typeof owner !== 'object' || typeof owner.source !== 'string') {
        throw new Error(
          releaseVersion == null ? '当前草稿源码不存在。' : `发布版本 ${releaseVersion} 不存在。`,
        )
      }
      const version =
        releaseVersion == null ? optPositiveInt(owner.revision) : optPositiveInt(owner.version)
      const exported = await exportWorkspaceSubAppSource({
        workspaceRoot: WORKSPACE_ROOT,
        appId,
        source: owner.source,
      })
      return {
        appId,
        kind: releaseVersion == null ? 'draft' : 'release',
        ...(releaseVersion == null ? { revision: version } : { version }),
        ...exported,
      }
    }

    case 'spark_app_update_draft': {
      const source = await resolveDraftSource(args)
      const patch = defined({
        source,
        name: str(args.name),
        description: str(args.description),
        permissions: optStringArray(args.permissions),
        surface: str(args.surface),
        icon: args.icon === undefined ? undefined : args.icon === null ? null : str(args.icon),
        entry: str(args.entry),
      })
      const updated = await rpc('subapp.update_draft', {
        appId,
        expectedDraftRevision: optPositiveInt(args.expectedRevision),
        patch,
      })
      const resultingSource = source ?? updated?.draft?.source
      const resultingSurface =
        str(args.surface) ?? updated?.draft?.manifest?.surface ?? updated?.surface
      return attachValidation(updated, resultingSource, str(args.draftFilePath), resultingSurface)
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

    case 'spark_app_delete_release':
      return rpc('subapp.delete_release', {
        appId,
        releaseVersion: optPositiveInt(args.releaseVersion),
      })

    case 'spark_app_rollback':
      return rpc('subapp.rollback', {
        appId,
        releaseVersion: optPositiveInt(args.releaseVersion),
        expectedDraftRevision: optPositiveInt(args.expectedRevision),
      })

    case 'spark_app_set_enabled': {
      if (optBool(args.enabled) === true) {
        const details = await rpc('subapp.get', { appId })
        if (details?.draft?.format === 'v2') {
          const status = await rpc('subapp.project_status', { appId })
          const effects = status?.manifest?.permissions?.osEffects ?? []
          if (
            (status?.manifest?.service != null || effects.length > 0) &&
            optBool(args.confirmTrustedLocal) !== true
          ) {
            throw new Error(
              `V2 应用启用前必须展示 trusted-local 风险并获得用户同意；OS effects: ${effects.join(', ') || 'none'}`,
            )
          }
        }
      }
      return rpc('subapp.set_enabled', {
        appId,
        enabled: optBool(args.enabled),
      })
    }

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

function present(name, data) {
  if (
    name === 'spark_app_get' ||
    name === 'spark_app_create' ||
    name === 'spark_app_update_draft' ||
    name === 'spark_app_publish' ||
    name === 'spark_app_rollback'
  ) {
    return JSON.stringify(
      compactSubAppDetails(data, { includePreview: name === 'spark_app_get' }),
      null,
      2,
    )
  }
  if (name === 'spark_app_data_get' && data == null) {
    return '未找到该数据键（键不存在或已被删除）。'
  }
  return JSON.stringify(data, null, 2)
}

async function resolveValidation(args) {
  const appId = str(args.appId)
  const inlineSource = str(args.draftHtml)
  const filePath = str(args.draftFilePath)
  const sourceCount = [appId, inlineSource, filePath].filter((value) => value != null).length
  if (sourceCount !== 1) {
    throw new Error('appId、draftHtml、draftFilePath 必须且只能提供一个。')
  }
  if (appId != null) {
    const releaseVersion = optPositiveInt(args.releaseVersion)
    const details = await rpc('subapp.get', { appId, releaseVersion })
    const owner = releaseVersion == null ? details?.draft : details?.publishedRelease
    if (owner == null || typeof owner.source !== 'string') {
      throw new Error(
        releaseVersion == null ? '当前草稿源码不存在。' : `发布版本 ${releaseVersion} 不存在。`,
      )
    }
    return {
      target: {
        appId,
        kind: releaseVersion == null ? 'draft' : 'release',
        ...(releaseVersion ? { releaseVersion } : {}),
      },
      ...validateSubAppSource({
        source: owner.source,
        surface: owner.manifest?.surface ?? details?.surface,
      }),
    }
  }
  const source =
    filePath == null ? inlineSource : await readWorkspaceSubAppSource(filePath, WORKSPACE_ROOT)
  return {
    target: {
      kind: filePath == null ? 'inline' : 'workspace-file',
      ...(filePath ? { file: filePath } : {}),
    },
    ...validateSubAppSource({ source, file: filePath, surface: str(args.surface) }),
  }
}

function attachValidation(data, source, file, surface) {
  if (data == null || typeof data !== 'object' || typeof source !== 'string') return data
  const validation = validateSubAppSource({ source, file, surface })
  return {
    ...data,
    validation: {
      valid: validation.valid,
      readyToPreview: validation.readyToPreview,
      readyToPublish: validation.readyToPublish,
      detectedCapabilities: validation.detectedCapabilities,
      summary: validation.summary,
      contractDigest: validation.contractDigest,
      topDiagnostics: validation.diagnostics.slice(0, 5),
    },
  }
}

async function resolveDraftSource(args) {
  const inlineSource = str(args.draftHtml)
  const filePath = str(args.draftFilePath)
  if (inlineSource != null && filePath != null) {
    throw new Error('draftHtml 与 draftFilePath 互斥，只能传一个。')
  }
  if (filePath != null) return readWorkspaceSubAppSource(filePath, WORKSPACE_ROOT)
  return inlineSource
}

async function exportManagedProject(appId) {
  if (!appId) throw new Error('appId 必填。')
  const status = await rpc('subapp.project_status', { appId })
  if (!Array.isArray(status?.files) || status.files.length === 0)
    throw new Error('子应用没有 V2 项目文件。')
  const target = path.join(
    WORKSPACE_ROOT,
    '.spark-agent',
    'sub-app-projects',
    appId,
    `rev-${status.revision}`,
  )
  await assertWorkspaceTarget(target)
  const exists = await fs
    .lstat(target)
    .then(() => true)
    .catch((error) => {
      if (error.code === 'ENOENT') return false
      throw error
    })
  if (exists) throw new Error('导出目录已存在；为避免覆盖用户编辑，请使用新草稿 revision 再导出。')
  const staging = `${target}.staging-${process.pid}`
  await fs.mkdir(staging, { recursive: true })
  try {
    for (const item of status.files) {
      const relative = safeProjectRelativePath(item.path)
      const result = await rpc('subapp.project_read_file', {
        appId,
        path: relative,
        encoding: 'base64',
      })
      const destination = path.join(staging, relative)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, Buffer.from(result.content, 'base64'), { flag: 'wx' })
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.rename(staging, target)
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true })
    throw error
  }
  return { appId, directory: target, revision: status.revision, files: status.files.length }
}

async function importManagedProject(projectDir) {
  if (!projectDir) throw new Error('projectDir 必填。')
  const root = await resolveWorkspaceDirectory(projectDir)
  const files = await collectWorkspaceProjectFiles(root)
  const manifestFile = files.find((item) => item.path === 'spark-app.json')
  if (manifestFile == null) throw new Error('项目缺少 spark-app.json。')
  let manifest
  try {
    manifest = JSON.parse(manifestFile.content.toString('utf8'))
  } catch {
    throw new Error('spark-app.json 不是有效 JSON。')
  }
  if (manifest?.schemaVersion !== 2 || typeof manifest.name !== 'string')
    throw new Error('spark-app.json 必须是有效 V2 manifest。')
  const created = await rpc('subapp.scaffold', {
    name: manifest.name,
    description: typeof manifest.description === 'string' ? manifest.description : undefined,
    icon: typeof manifest.icon === 'string' ? manifest.icon : undefined,
    surface: typeof manifest.surface === 'string' ? manifest.surface : undefined,
    template: manifest.service ? 'fullstack' : 'frontend',
  })
  let revision = created.draftRevision
  const existing = new Set(created.project.files.map((item) => item.path))
  for (const item of files) {
    const updated = await rpc('subapp.project_write_file', {
      appId: created.appId,
      expectedDraftRevision: revision,
      path: item.path,
      content: item.content.toString('base64'),
      encoding: 'base64',
    })
    revision = updated.revision
    existing.delete(item.path)
  }
  for (const extra of existing) {
    if (extra === 'spark-app.json') continue
    const updated = await rpc('subapp.project_delete_file', {
      appId: created.appId,
      expectedDraftRevision: revision,
      path: extra,
    })
    revision = updated.revision
  }
  const status = await rpc('subapp.project_status', { appId: created.appId })
  if (!status.validation?.readyToPublish)
    throw new Error(`导入后校验失败：${JSON.stringify(status.validation?.diagnostics ?? [])}`)
  return { appId: created.appId, draftRevision: revision, project: status }
}

async function collectWorkspaceProjectFiles(root) {
  const output = []
  let total = 0
  const walk = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('导入项目不允许符号链接。')
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const relative = safeProjectRelativePath(
        path.relative(root, absolute).split(path.sep).join('/'),
      )
      const content = await fs.readFile(absolute)
      if (content.byteLength > 5 * 1024 * 1024) throw new Error(`单文件超过 5 MB：${relative}`)
      total += content.byteLength
      if (total > 20 * 1024 * 1024) throw new Error('项目总大小超过 20 MB。')
      output.push({ path: relative, content })
      if (output.length > 1000) throw new Error('项目文件数超过 1000。')
    }
  }
  await walk(root)
  return output.sort((a, b) => a.path.localeCompare(b.path))
}

async function resolveWorkspaceDirectory(input) {
  if (!WORKSPACE_ROOT) throw new Error('当前会话没有可用工作区。')
  const workspace = await fs.realpath(WORKSPACE_ROOT)
  const candidate = await fs.realpath(path.resolve(workspace, input))
  if (candidate !== workspace && !candidate.startsWith(workspace + path.sep))
    throw new Error('项目目录必须位于当前工作区内。')
  if (!(await fs.lstat(candidate)).isDirectory()) throw new Error('projectDir 不是目录。')
  return candidate
}

async function assertWorkspaceTarget(target) {
  if (!WORKSPACE_ROOT) throw new Error('当前会话没有可用工作区。')
  const workspace = path.resolve(WORKSPACE_ROOT)
  const resolved = path.resolve(target)
  if (!resolved.startsWith(workspace + path.sep)) throw new Error('导出路径逃逸工作区。')
  let current = workspace
  for (const segment of path.relative(workspace, path.dirname(resolved)).split(path.sep)) {
    current = path.join(current, segment)
    const stat = await fs.lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (stat?.isSymbolicLink()) throw new Error('导出路径包含符号链接，已拒绝写入。')
  }
}

function safeProjectRelativePath(value) {
  if (
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  )
    throw new Error(`非法项目路径：${value}`)
  return value
}

function compactProjectStatus(status, limit, offset) {
  const files = Array.isArray(status?.files) ? status.files : []
  return {
    ...status,
    files: files.slice(offset, offset + limit),
    filePage: { total: files.length, limit, offset, hasMore: offset + limit < files.length },
  }
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
