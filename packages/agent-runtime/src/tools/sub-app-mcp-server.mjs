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
import {
  compactSubAppDetails,
  exportWorkspaceSubAppSource,
  readWorkspaceSubAppSource,
} from './sub-app-source-store.mjs'

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
  '权限声明列表（能力名，如 runtime/theme/ui/data/clipboard/notifications），应用运行时按声明获得对应宿主能力'

const THEME_INTEGRATION_GUIDE =
  '界面必须适配 SparkWork 宿主主题：使用 sparkApp.theme.get()/onChange 或 --spark-* CSS 变量（如 --spark-color-bg-container、--spark-color-text、--spark-color-primary），不要把深浅色背景和文字颜色硬编码为固定值。除非用户明确要求独立背景或特殊视觉效果，默认不要给应用根容器、页面或主布局设置 background/background-color/background-image，让 SparkWork 主应用自带的背景自然透出；确需自定义背景时也必须使用宿主主题 token。例外：surface=overlay 的悬浮窗应用，其悬浮弹窗容器背景是透明的，必须给应用根容器（弹窗容器本体）显式设置宿主主题背景色（如 background: var(--spark-color-bg-container)），否则界面会呈透明悬浮、文字与背后内容叠透。运行时会自动把宿主 token 同步为这些 CSS 变量。'

const DATA_PERSISTENCE_GUIDE = [
  '数据持久化契约：凡是用户创建、编辑、删除后还应在重新打开或重启 SparkWork 后保留的数据，必须使用 sparkApp.data.get/list/upsert/delete 写入应用专属持久化库。',
  '源码调用 sparkApp.data 时必须让 permissions 包含 data；未传 permissions 的新应用默认拥有自身隔离的 data 能力，显式传 [] 仍会拒绝。',
  '推荐更新模式：先 await sparkApp.data.get("app", "todos")，再把返回的 revision 传给 sparkApp.data.upsert("app", "todos", value, revision)；首次创建键时不传 revision。',
  '删除必须先读取当前 revision，再调用 sparkApp.data.delete(namespace, key, revision)。',
  '不要把 localStorage、sessionStorage、IndexedDB、内存数组或 URL 参数作为唯一数据源；它们不能替代 SparkWork 应用数据持久化。',
].join(' ')

const DESIGN_PREVIEW_WORKFLOW_GUIDE = [
  '开发流程（设计先行）：创建新应用或大幅改版时，必须先产出界面设计预览给用户确认（用会话内可用的预览手段，如 render_html 渲染静态界面效果图或低仿真原型），根据用户反馈不断迭代调整设计；用户明确确认界面方案后，才开发完整实现写入草稿。',
  '用户确认设计之前不要直接开发落地，更不要未经确认就发布。',
].join(' ')

const LIBRARY_DEV_GUIDE = [
  '外部库与框架开发指引：应用沙箱默认放行外部网络与 unsafe-eval，可直接使用 React/Vue 等框架和组件库开发。',
  '推荐引入方式：UMD（<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script> + react-dom）或 ESM（<script type="module"> + import ... from "https://esm.sh/react@18"）。',
  '可使用 babel-standalone（<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script> + <script type="text/babel">）直接写 JSX；组件库优先选有 UMD/ESM 构建的（如 antd、echarts）。',
  '应用内可直接 fetch/XHR 任意 https/http 接口（无需经宿主），但需要持久化的数据仍必须走 sparkApp.data。',
  '离线或 CDN 不可用时外部依赖会加载失败，重要依赖可考虑内联；源码无长度限制（5 MB 硬上限内）。',
].join(' ')

function toolDefinitions() {
  return [
    // ── 应用生命周期 ──
    {
      name: 'spark_app_create',
      description: [
        '创建一个新的自定义子应用（SparkWork 平台内置应用，运行在平台的应用入口/悬浮窗/桌面宠物里，源码存于平台数据库，不是外部项目文件）。创建后处于草稿态（draft、未启用），需要先发布（spark_app_publish）才会出现在应用入口。',
        '何时调用：仅当用户明确要求平台内置子应用时——用户明确提到「子应用」「内置应用」「SparkWork 应用」「桌面宠物」，或要求应用出现在平台应用入口、悬浮窗等宿主界面中。',
        '何时不要调用：用户要求开发一个应用/小工具/网页/服务端但没有说明要内置到平台时，默认是外部项目开发——直接在当前工作目录创建普通项目文件，不要调用本工具。拿不准时先问用户「要平台内置子应用，还是当前目录的外部项目」，不要默认创建子应用。',
        DESIGN_PREVIEW_WORKFLOW_GUIDE,
        THEME_INTEGRATION_GUIDE,
        DATA_PERSISTENCE_GUIDE,
        LIBRARY_DEV_GUIDE,
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
            description: `${PERMISSIONS_DESCRIPTION} 未传时默认包含 data；显式传 [] 才表示不授予 data。`,
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
        THEME_INTEGRATION_GUIDE,
        DATA_PERSISTENCE_GUIDE,
        LIBRARY_DEV_GUIDE,
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
            description: `${PERMISSIONS_DESCRIPTION} 若源码使用 sparkApp.data，必须包含 data。`,
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
    case 'spark_app_create': {
      const source = await resolveDraftSource(args)
      return rpc('subapp.create', {
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

async function resolveDraftSource(args) {
  const inlineSource = str(args.draftHtml)
  const filePath = str(args.draftFilePath)
  if (inlineSource != null && filePath != null) {
    throw new Error('draftHtml 与 draftFilePath 互斥，只能传一个。')
  }
  if (filePath != null) return readWorkspaceSubAppSource(filePath, WORKSPACE_ROOT)
  return inlineSource
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
