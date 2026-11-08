/**
 * 提示词注入过滤的纯函数策略（零 IO，先例：agent-mcp-policy.ts）。
 *
 * 合并语义——「会话层显式接管」：
 * - 会话层已配置（行存在，显式空数组也算已配置）→ 生效 = 会话层 disabledSources；
 * - 会话层未配置 → 继承项目层；两层都未配置 → 空集 = 与现状完全一致。
 * 理由：用户需要「项目禁多媒体、本会话临时开回」的表达能力，skill 体系的
 * disabled 并集（单调收紧）表达不了；env 配置已有「会话覆盖项目」先例。
 *
 * 改动原则：本模块不持有状态、不做 IO；session.service 只在组装点/门控点
 * 消费结果，避免主文件继续膨胀。
 */

import {
  normalizeDisabledSources,
  PROMPT_INJECTION_SOURCE_MAP,
  type PromptInjectionSourceInfo,
} from '@spark/protocol'

const PROMPT_INJECTION_SOURCES_FILTERABLE: readonly PromptInjectionSourceInfo[] = [
  ...PROMPT_INJECTION_SOURCE_MAP.values(),
].filter((source) => source.tier === 'filterable')

/** 注册表中全部可过滤条目（tier:'filterable'）。 */
export const FILTERABLE_PROMPT_INJECTION_SOURCES: readonly PromptInjectionSourceInfo[] =
  PROMPT_INJECTION_SOURCES_FILTERABLE

/** 共享空集（未配置过滤时的零成本兜底）。 */
export const EMPTY_SOURCE_SET: ReadonlySet<string> = new Set<string>()

/**
 * 合并项目层与会话层的过滤配置（会话层显式接管语义）。
 *
 * 入参是「归一化后的 disabledSources 或 undefined」；undefined 表示该层
 * 未配置（app_settings 无行）。返回值为生效禁用集，空集 = 不过滤。
 */
export function mergePromptFilterLayers(
  project: readonly string[] | undefined,
  session: readonly string[] | undefined,
): ReadonlySet<string> {
  if (session !== undefined) return new Set(session)
  if (project !== undefined) return new Set(project)
  return EMPTY_SOURCE_SET
}

/**
 * 从生效禁用集提取「应摘除的内置 MCP 注册名」集合。
 *
 * 只映射 `mcp:*` 条目（且要求注册表里带 mcpName）；纯提示词条目
 * （inject:* / prompt:*）不影响 MCP 挂载。消费方：shouldMountBuiltinMcp
 * 第 4 参。
 */
export function extractDisabledBuiltinNames(disabled: ReadonlySet<string>): ReadonlySet<string> {
  const names = new Set<string>()
  for (const id of disabled) {
    const source = PROMPT_INJECTION_SOURCE_MAP.get(id)
    if (source?.mcpName != null) names.add(source.mcpName)
  }
  return names
}

/**
 * 过滤配置中 MCP 键的可序列化签名（SDK resume 快照保护用）。
 *
 * 只含 `mcp:*` 键（排序 join）：MCP 键变化改变工具面，SDK resume 会话的
 * 工具列表在 query 起点冻结，必须触发 `continueSession:false` 重建；纯
 * 提示词条目变化每轮重组装 systemPrompt / codex 首轮用户消息，无需重建。
 */
export function promptFilterMcpSignature(disabled: ReadonlySet<string>): string {
  const mcpKeys: string[] = []
  for (const id of disabled) {
    if (id.startsWith('mcp:')) mcpKeys.push(id)
  }
  return mcpKeys.sort().join(',')
}

/** 单一 key 的快捷判定（组装点门控用）。 */
export function isPromptSourceDisabled(disabled: ReadonlySet<string>, id: string): boolean {
  return disabled.has(id)
}

/**
 * settings 行值 → 层值（runtime-composition 存取用）。
 * 行不存在（null）/ 畸形 → undefined（未配置）。
 */
export function parsePromptFilterLayer(value: unknown): string[] | undefined {
  if (value == null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (!Array.isArray(record['disabledSources'])) return undefined
  return normalizeDisabledSources(record['disabledSources'])
}
