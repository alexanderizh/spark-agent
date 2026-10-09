/**
 * 工具链清单聚合（设置 → 工具链，只读）。
 *
 * 把 agent 会话实际可见的四层工具面收拢成一份带「引擎差异」标注的清单：
 *  1. SDK 内置工具（Claude Agent SDK 原生，PascalCase；spark 引擎有 snake_case 映射名）
 *  2. 平台内置服务器（spark_* 系列进程内/stdio MCP，工具名常量为权威来源）
 *  3. MCP 扩展（用户/托管配置的外部 MCP 服务器，按传输类型标注引擎兼容性）
 *  4. 统一目录（自定义工具/工具包/连接器，经 spark_plugins 投影为 mcp__spark_plugins__*）
 *
 * 引擎差异的事实依据（改动兼容性时同步更新）：
 *  - claude-sdk（含历史值 'claude'）：唯一支持 type='sdk' 进程内服务器（spark_verify）的引擎；
 *    SSE 传输也仅此引擎消费。
 *  - codex：buildCodexMcpConfig 跳过 type='sdk'；stdio/Streamable HTTP 均可挂载。
 *  - spark：isSparkSupportedMcpServer 明确排除 sse 与 sdk；内置工具名走
 *    tool-name-mapper 的 snake_case 映射（read_file/bash/grep…）。
 *
 * 本模块是纯聚合（无 IO、无进程拉起），IPC 层负责喂数据 —— 与「仅查看」语义一致：
 * 未连接的 MCP 扩展不主动启动，只展示状态与已知工具数。
 */
import type {
  ToolchainAdapterKind,
  ToolchainInventoryGroup,
  ToolchainInventoryResponse,
  ToolchainInventoryTool,
} from '@spark/protocol'
import { WORKFLOW_RESTRICTABLE_TOOLS } from '@spark/protocol'
import { BROWSER_TOOL_NAMES } from '../browser-automation-prompt.js'
import { SPARK_MEDIA_TOOL_NAMES } from '../media/media-mcp-contract.js'
import { resolveMcpConfig } from '../../mcp/config-normalize.js'
import { mapSDKToolName } from '../../sdk/tool-name-mapper.js'
import {
  DEBUG_TOOL_NAMES,
  PLATFORM_TOOL_NAMES,
  PRESENT_FILES_TOOL_NAMES,
  QUICK_REPLIES_TOOL_NAMES,
  RENDER_DIAGRAM_TOOL_NAMES,
  RENDER_HTML_TOOL_NAMES,
  SEARCH_TOOL_NAMES,
  SUB_APP_TOOL_NAMES,
  TOOL_RESULT_TOOL_NAMES,
  VALIDATION_SUGGESTION_TOOL_NAMES,
  VOICE_CONTROL_TOOL_NAMES,
} from '../session-mcp-tooling-helpers.js'
import type { UnifiedToolCatalogEntry } from '../unified-tools/unified-tool-catalog.js'

const ALL_ENGINES: readonly ToolchainAdapterKind[] = ['claude-sdk', 'codex', 'spark']
const CLAUDE_ONLY: readonly ToolchainAdapterKind[] = ['claude-sdk']

/** MCP 扩展在 IPC 层的快照（由桌面主进程从 McpService 收集，不在此处拉起进程）。 */
export interface ToolchainMcpServerSnapshot {
  /** 服务器名（即会话内 mcp__<name>__ 命名空间）。 */
  name: string
  enabled: boolean
  connected: boolean
  /** 已连接时的实时工具清单；未连接为空数组（IPC 层不主动启动）。 */
  tools: Array<{ name: string; description?: string }>
  /** 原始 configJson；传输类型用 resolveMcpConfig 权威归一化（transport/type 兼容 + 自愈）。 */
  configJson: string
  /** 服务器作用域；scope=managed 标记托管（如 Playwright 自动注册）。 */
  scope?: string
}

type ResolvedTransport = 'stdio' | 'http' | 'sse' | 'unknown'

/** 复用仓库唯一归一化读取器（config-normalize），避免字段分裂复读。 */
function resolveTransport(configJson: string): ResolvedTransport {
  try {
    const parsed: unknown = JSON.parse(configJson)
    if (parsed == null || typeof parsed !== 'object') return 'unknown'
    const resolved = resolveMcpConfig(parsed as Record<string, unknown>)
    return resolved?.type ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export interface ToolchainInventoryInput {
  unifiedTools: UnifiedToolCatalogEntry[]
  mcpServers: ToolchainMcpServerSnapshot[]
}

// ─── 平台内置服务器注册表 ────────────────────────────────────────────────────
// 工具名常量是权威来源；动态工具面（画布/电脑操作/团队）只登记挂载条件，不臆造清单。

interface PlatformServerSpec {
  server: string
  title: string
  toolNames: readonly string[]
  adapters?: readonly ToolchainAdapterKind[]
  adapterNote?: string
  mountNote?: string
}

const MEMORY_TOOL_NAMES = [
  'mcp__spark_memory__search_memory',
  'mcp__spark_memory__recall_memory',
] as const

// 工具清单来源：packages/agent-runtime/src/tools/spark-wiki-mcp-server.mjs（12 个）
const WIKI_TOOL_NAMES = [
  'mcp__spark_wiki__wiki_list_spaces',
  'mcp__spark_wiki__wiki_search',
  'mcp__spark_wiki__wiki_read',
  'mcp__spark_wiki__wiki_list',
  'mcp__spark_wiki__wiki_backlinks',
  'mcp__spark_wiki__wiki_write',
  'mcp__spark_wiki__wiki_update',
  'mcp__spark_wiki__wiki_archive',
  'mcp__spark_wiki__wiki_restore',
  'mcp__spark_wiki__wiki_delete',
  'mcp__spark_wiki__wiki_link',
  'mcp__spark_wiki__wiki_propose_skill',
] as const

const PLATFORM_SERVERS: readonly PlatformServerSpec[] = [
  {
    server: 'spark_platform',
    title: '平台管理（spark_platform）',
    toolNames: PLATFORM_TOOL_NAMES,
  },
  {
    server: 'spark_search',
    title: '联网搜索（spark_search）',
    toolNames: SEARCH_TOOL_NAMES,
  },
  {
    server: 'spark_media',
    title: '多媒体生成（spark_media）',
    toolNames: SPARK_MEDIA_TOOL_NAMES,
    mountNote: '配置了多媒体渠道的会话挂载；按所选模型能力路由生成/转写调用。',
  },
  {
    server: 'spark_image',
    title: '图片生成（spark_image）',
    toolNames: ['mcp__spark_image__generate_image'],
    mountNote: '图片生成上下文激活时挂载（遗留路由，新会话优先 spark_media）。',
  },
  {
    server: 'spark_plugins',
    title: '插件运行时（spark_plugins）',
    toolNames: [],
    adapterNote: '统一目录（自定义工具/工具包/连接器）的投影面；具体工具见下方「统一目录」分组。',
    mountNote: '存在已启用的目录条目时按轮次拉起（Streamable HTTP）。',
  },
  {
    server: 'spark_app',
    title: '子应用（spark_app）',
    toolNames: SUB_APP_TOOL_NAMES,
  },
  {
    server: 'spark_files',
    title: '文件卡片（spark_files）',
    toolNames: PRESENT_FILES_TOOL_NAMES,
  },
  {
    server: 'spark_ui',
    title: '界面呈现（spark_ui）',
    toolNames: [
      ...QUICK_REPLIES_TOOL_NAMES,
      ...RENDER_HTML_TOOL_NAMES,
      ...RENDER_DIAGRAM_TOOL_NAMES,
    ],
  },
  {
    server: 'spark_browser',
    title: '内置浏览器（spark_browser）',
    toolNames: BROWSER_TOOL_NAMES,
  },
  {
    server: 'spark_computer',
    title: '电脑操作（spark_computer）',
    toolNames: [],
    adapterNote:
      '工具面由 Computer Use Broker 动态注入（截图/点击/键入/受控任务等），随权限与宿主能力变化。',
    mountNote: '仅开启电脑操作且通过 Broker 校验的会话挂载。',
  },
  {
    server: 'spark_debug',
    title: '交互式调试（spark_debug）',
    toolNames: DEBUG_TOOL_NAMES,
    mountNote: '仅开启调试模式的会话挂载。',
  },
  {
    server: 'spark_memory',
    title: '长期记忆（spark_memory）',
    toolNames: MEMORY_TOOL_NAMES,
    mountNote:
      '设置中「记忆」开关开启时挂载；claude-sdk 走进程内实现，codex/spark 走 stdio 桥接，工具名一致。',
  },
  {
    server: 'spark_wiki',
    title: '知识库（spark_wiki）',
    toolNames: WIKI_TOOL_NAMES,
    adapterNote: 'spark 引擎下仅 5 个只读工具进免审批白名单，写工具走审批流（工具面本身一致）。',
    mountNote: '知识库可用时挂载。',
  },
  {
    server: 'spark_session',
    title: '会话状态（spark_session）',
    toolNames: ['mcp__spark_session__set_worktree_state'],
  },
  {
    server: 'spark_voice',
    title: '语音控制（spark_voice）',
    toolNames: VOICE_CONTROL_TOOL_NAMES,
    mountNote: '仅语音路由绑定的会话挂载；绑定关系随语音切换实时迁移。',
  },
  {
    server: 'spark_tool_results',
    title: '工具结果归档（spark_tool_results）',
    toolNames: TOOL_RESULT_TOOL_NAMES,
  },
  {
    server: 'spark_verify',
    title: '验证建议（spark_verify）',
    toolNames: VALIDATION_SUGGESTION_TOOL_NAMES,
    adapters: CLAUDE_ONLY,
    adapterNote:
      '进程内（type=sdk）实现依赖轮次闭包，仅 claude-sdk 引擎挂载；codex/spark 会话不可用。',
    mountNote: '有工作区根路径的会话按轮次挂载。',
  },
  {
    server: 'spark_team',
    title: '团队协作（spark_team）',
    toolNames: ['mcp__spark_team__agent_dispatch', 'mcp__spark_team__agent_dispatch_batch'],
    adapterNote: '基础派发对固定；完整工具面由团队模式动态注册（成员互聊/账本等按团队能力扩展）。',
    mountNote: '仅团队模式（Team Mode）会话挂载。',
  },
  {
    server: 'spark_canvas',
    title: '画布（spark_canvas）',
    toolNames: [],
    adapterNote:
      '工具清单由画布能力经 env 动态注入（节点/素材/分镜/导演台等，随版本扩展），静态清单不在此登记。',
    mountNote: '仅画布绑定会话挂载。',
  },
]

// ─── 聚合实现 ────────────────────────────────────────────────────────────────

export function buildToolchainInventory(
  input: ToolchainInventoryInput,
): ToolchainInventoryResponse {
  const groups: ToolchainInventoryGroup[] = []

  // 1. SDK 内置工具（Claude Agent SDK）：claude-sdk 原名 / spark 映射名；codex 不消费此命名。
  const sdkBuiltinTools: ToolchainInventoryTool[] = WORKFLOW_RESTRICTABLE_TOOLS.map((tool) => {
    const sparkName = mapSDKToolName(tool.name)
    return {
      name: tool.name,
      ...(sparkName !== tool.name ? { sparkEngineName: sparkName } : {}),
      description: tool.label,
    }
  })
  groups.push({
    key: 'sdk-builtin',
    title: 'SDK 内置工具（Claude Agent SDK）',
    kind: 'sdk-builtin',
    adapters: ['claude-sdk', 'spark'],
    adapterNote:
      'claude-sdk 引擎使用原名（PascalCase）；spark 引擎使用映射名（snake_case，如 read_file/bash/grep）；codex 引擎使用自身内置工具集，不消费此清单命名。',
    toolCount: sdkBuiltinTools.length,
    tools: sdkBuiltinTools,
  })

  // 2. 平台内置服务器（spark_*）
  for (const spec of PLATFORM_SERVERS) {
    const adapters = spec.adapters ?? ALL_ENGINES
    if (spec.server === 'spark_plugins') {
      // spark_plugins 组并入统一目录条目数，避免重复罗列。
      const count = input.unifiedTools.length
      groups.push({
        key: `platform:${spec.server}`,
        title: spec.title,
        kind: 'platform-server',
        adapters: [...adapters],
        ...(spec.adapterNote != null ? { adapterNote: spec.adapterNote } : {}),
        ...(spec.mountNote != null ? { mountNote: spec.mountNote } : {}),
        toolCount: count,
        tools: [],
      })
      continue
    }
    const tools: ToolchainInventoryTool[] = spec.toolNames.map((name) => ({ name }))
    groups.push({
      key: `platform:${spec.server}`,
      title: spec.title,
      kind: 'platform-server',
      adapters: [...adapters],
      ...(spec.adapterNote != null ? { adapterNote: spec.adapterNote } : {}),
      ...(spec.mountNote != null ? { mountNote: spec.mountNote } : {}),
      toolCount: tools.length,
      tools,
    })
  }

  // 3. MCP 扩展（外部服务器）：按传输类型标注引擎兼容性；未连接不拉起，仅展示状态。
  for (const server of input.mcpServers) {
    const transport = resolveTransport(server.configJson)
    const adapters = resolveMcpAdapterAvailability(transport)
    const tools: ToolchainInventoryTool[] = server.tools.map((tool) => ({
      name: `mcp__${server.name}__${tool.name}`,
      ...(tool.description != null && tool.description.length > 0
        ? { description: truncateDescription(tool.description) }
        : {}),
    }))
    groups.push({
      key: `mcp:${server.name}`,
      title: `${server.name}${server.scope === 'managed' ? '（托管）' : ''}`,
      kind: 'mcp-extension',
      adapters,
      ...(transport === 'sse'
        ? { adapterNote: 'legacy SSE 传输仅 claude-sdk 引擎支持；codex/spark 会话不挂载。' }
        : transport === 'unknown'
          ? { adapterNote: '配置传输类型无法识别，引擎兼容性未知。' }
          : {}),
      ...(server.enabled ? {} : { mountNote: '已停用：任何会话都不会挂载。' }),
      serverStatus: server.enabled
        ? server.connected
          ? 'connected'
          : 'not-connected'
        : 'disabled',
      toolCount: tools.length,
      tools,
    })
  }

  // 4. 统一目录（自定义工具/工具包/连接器）：会话内经 spark_plugins 投影。
  for (const kind of ['custom-tool', 'tool-package', 'connector'] as const) {
    const entries = input.unifiedTools.filter((entry) => entry.sourceKind === kind)
    if (entries.length === 0) continue
    const tools: ToolchainInventoryTool[] = entries.map((entry) => ({
      name: `mcp__spark_plugins__${entry.qualifiedName}`,
      description: truncateDescription(entry.tool.description),
      ...(entry.autoAllow ? { autoApproved: true } : {}),
    }))
    groups.push({
      key: `unified:${kind}`,
      title: UNIFIED_KIND_TITLES[kind],
      kind: 'unified-catalog',
      adapters: [...ALL_ENGINES],
      sourceKind: kind,
      adapterNote:
        '经 spark_plugins 服务器（Streamable HTTP）投影进会话；三个引擎均可调用，工具名一致。',
      toolCount: tools.length,
      tools,
    })
  }

  return { groups, generatedAt: new Date().toISOString() }
}

const UNIFIED_KIND_TITLES: Record<'custom-tool' | 'tool-package' | 'connector', string> = {
  'custom-tool': '自定义工具（统一目录）',
  'tool-package': '工具包（统一目录）',
  connector: '连接器（统一目录）',
}

function resolveMcpAdapterAvailability(transport: ResolvedTransport): ToolchainAdapterKind[] {
  switch (transport) {
    case 'stdio':
    case 'http':
      return [...ALL_ENGINES]
    case 'sse':
      return [...CLAUDE_ONLY]
    case 'unknown':
      return []
  }
}

const MAX_DESCRIPTION_LENGTH = 160

function truncateDescription(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length <= MAX_DESCRIPTION_LENGTH) return normalized
  return `${normalized.slice(0, MAX_DESCRIPTION_LENGTH)}…`
}
