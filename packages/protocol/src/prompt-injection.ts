/**
 * @module prompt-injection
 *
 * 提示词注入源注册表（「提示词注入过滤」功能的单一事实源）。
 *
 * 背景：默认全量挂载会话每轮静态提示词 15~17k token（性能方案
 * todo/2026-10-19-简单任务启动链路性能优化方案.md §6.2 实测），本注册表枚举
 * 可按项目级/会话级配置过滤的注入源，供主进程（组装点门控）、renderer（配置
 * 面板渲染）与 agent-runtime（纯函数过滤模块）三方共用。
 *
 * 设计约束：
 * - `mcp:*` 条目的 mcpName 必须与 agent-mcp-policy.ts 的
 *   OPTIONAL_HEAVY_BUILTIN_MCP_NAME_SET 一一对应（必需档不进过滤体系）；
 * - tier:'locked' 条目仅用于 UI 锁定态展示（灰显 + 原因），不可写入
 *   disabledSources（normalizeDisabledSources 会剔除）；
 * - 本模块只放结构化元数据（id/group/tier/token 量级），中文显示名归
 *   renderer i18n，按 id 派生 key，避免协议包携带文案。
 */

/** 注入源分组（同时决定 UI 的分组展示顺序）。 */
export type PromptInjectionGroup = 'mcp' | 'context' | 'catalog' | 'memory' | 'platform'

/** filterable = 可写入 disabledSources；locked = 仅 UI 锁定展示。 */
export type PromptInjectionTier = 'filterable' | 'locked'

export interface PromptInjectionSourceInfo {
  /** 稳定 key，存入 disabledSources 的值（如 'mcp:spark_platform'）。 */
  readonly id: string
  readonly group: PromptInjectionGroup
  readonly tier: PromptInjectionTier
  /**
   * 每轮注入的 token 量级（性能方案 §6.2 实测），仅供 UI 展示与决策参考；
   * 0 = 无独立实测值（UI 不渲染量级标签）。
   */
  readonly approxTokens: number
  /** mcp:* 条目对应的内置 MCP 注册名（挂载级过滤：不挂载即声明段同摘）。 */
  readonly mcpName?: string
}

/**
 * 注册表（数组顺序即 UI 渲染顺序）。
 *
 * - mcp 组：过滤 = 不挂载对应内置 MCP，能力声明段与工具面随挂载自动收敛
 *   （先例：agent-mcp-policy.ts）。spark_platform 在 spark/codex 引擎有 D5
 *   引擎强制归位兜底，过滤仅对 claude 引擎完全生效（UI note 说明）。
 * - memory 组：记忆摘要块与行为/来源引导三段一个开关——拆开会产生
 *   「有块无规则 / 有规则无块」的不连贯中间态。
 */
export const PROMPT_INJECTION_SOURCES: readonly PromptInjectionSourceInfo[] = [
  // ── MCP 能力域（过滤 = 不挂载，声明段 + 工具面同摘） ──
  {
    id: 'mcp:spark_platform',
    group: 'mcp',
    tier: 'filterable',
    approxTokens: 2200,
    mcpName: 'spark_platform',
  },
  { id: 'mcp:spark_browser', group: 'mcp', tier: 'filterable', approxTokens: 728, mcpName: 'spark_browser' },
  {
    id: 'mcp:spark_computer',
    group: 'mcp',
    tier: 'filterable',
    approxTokens: 1601,
    mcpName: 'spark_computer',
  },
  { id: 'mcp:spark_media', group: 'mcp', tier: 'filterable', approxTokens: 1374, mcpName: 'spark_media' },
  { id: 'mcp:spark_image', group: 'mcp', tier: 'filterable', approxTokens: 481, mcpName: 'spark_image' },
  { id: 'mcp:spark_search', group: 'mcp', tier: 'filterable', approxTokens: 297, mcpName: 'spark_search' },
  { id: 'mcp:spark_app', group: 'mcp', tier: 'filterable', approxTokens: 0, mcpName: 'spark_app' },
  { id: 'mcp:spark_plugins', group: 'mcp', tier: 'filterable', approxTokens: 0, mcpName: 'spark_plugins' },
  // ── 项目上下文 / 目录 / 记忆 ──
  { id: 'inject:projectContext', group: 'context', tier: 'filterable', approxTokens: 4034 },
  { id: 'inject:skillCatalog', group: 'catalog', tier: 'filterable', approxTokens: 900 },
  { id: 'inject:memory', group: 'memory', tier: 'filterable', approxTokens: 4622 },
  // ── 平台常驻声明段 ──
  { id: 'prompt:toolGuidance', group: 'platform', tier: 'filterable', approxTokens: 94 },
  { id: 'prompt:workspaceDirs', group: 'platform', tier: 'filterable', approxTokens: 723 },
  { id: 'prompt:wikiL0', group: 'platform', tier: 'filterable', approxTokens: 156 },
  { id: 'prompt:subagentHint', group: 'platform', tier: 'filterable', approxTokens: 488 },
  // ── 锁定展示项（不可过滤，仅 UI 灰显说明） ──
  {
    id: 'locked:applicationFoundation',
    group: 'platform',
    tier: 'locked',
    approxTokens: 875,
  },
  { id: 'locked:requiredMcpFiles', group: 'mcp', tier: 'locked', approxTokens: 0, mcpName: 'spark_files' },
  {
    id: 'locked:requiredMcpToolResults',
    group: 'mcp',
    tier: 'locked',
    approxTokens: 0,
    mcpName: 'spark_tool_results',
  },
  { id: 'locked:requiredMcpMemory', group: 'mcp', tier: 'locked', approxTokens: 0, mcpName: 'spark_memory' },
  { id: 'locked:requiredMcpSession', group: 'mcp', tier: 'locked', approxTokens: 0, mcpName: 'spark_session' },
  { id: 'locked:envVars', group: 'platform', tier: 'locked', approxTokens: 300 },
]

const FILTERABLE_SOURCE_ID_SET: ReadonlySet<string> = new Set(
  PROMPT_INJECTION_SOURCES.filter((source) => source.tier === 'filterable').map((source) => source.id),
)

/** id → 条目 的只读索引。 */
export const PROMPT_INJECTION_SOURCE_MAP: ReadonlyMap<string, PromptInjectionSourceInfo> = new Map(
  PROMPT_INJECTION_SOURCES.map((source) => [source.id, source]),
)

/**
 * 归一化 disabledSources：只保留注册表中 tier:'filterable' 的合法 key，
 * 去重并保持输入顺序（存储与签名前的统一入口，畸形输入按空处理）。
 */
export function normalizeDisabledSources(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) continue
    if (!FILTERABLE_SOURCE_ID_SET.has(item)) continue
    if (seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}
