/**
 * Agent 级 MCP 挂载策略（纯函数，零运行时依赖）。
 *
 * 语义（计划文档 todo/Agent级Skill与MCP按需挂载开发计划.md，D1-D9 已锁定）：
 * - 「空 = 全量」：agent.mcpServerIds 为空数组 / 未配置 → 全量挂载（与历史行为
 *   完全一致，存量 agent 零迁移）；UI 的「全选」也一律提交 `[]`（D6）。
 * - 「部分点选 = 白名单」：仅勾选的用户 MCP server 挂载；可选档内置 MCP 按勾选
 *   与引擎归位规则门控。
 * - 白名单中混存两类 id：用户 MCP server 的 DB 行 id，与 `builtin:spark_*` 合成 id
 *   （D3，零 schema 改动）。必需档内置（spark_files 等）不进选择体系，恒挂载。
 *
 * 改动原则：本模块不持有状态、不做 IO；session.service 只在调用点消费结果，
 * 避免主文件继续膨胀。
 */

import type { EngineKind } from '../sdk/engine-executor.js'

/** 内置 MCP 合成 id 前缀（`builtin:spark_platform` → 内置名 `spark_platform`）。 */
export const BUILTIN_MCP_ID_PREFIX = 'builtin:spark_'

/**
 * D4 分级表（四维标准：会话闭环依赖 / 挂载成本 / 自身已有门控 / renderer 交互依赖）。
 *
 * - 必需不可摘：摘除即破坏平台承诺（文件卡片呈现、长工具结果回读、记忆检索、
 *   会话级轻基础设施）。
 * - 可选重型：工具定义多 / 子进程重 / token 成本大，允许按 agent 摘除。
 * - 其余内置（spark_ui / spark_voice / spark_debug / spark_canvas / spark_wiki /
 *   spark_team / spark_workflow / spark_verify）已有自身挂载条件，不进分级体系，
 *   保持原门控，避免两套开关打架。
 */
const REQUIRED_BUILTIN_MCP_NAMES: readonly string[] = [
  'spark_files',
  'spark_tool_results',
  'spark_memory',
  'spark_session',
]

const OPTIONAL_HEAVY_BUILTIN_MCP_NAMES: readonly string[] = [
  'spark_platform',
  'spark_plugins',
  'spark_app',
  'spark_media',
  'spark_image',
  'spark_browser',
  'spark_computer',
  'spark_search',
]

const REQUIRED_BUILTIN_MCP_NAME_SET: ReadonlySet<string> = new Set(REQUIRED_BUILTIN_MCP_NAMES)
const OPTIONAL_HEAVY_BUILTIN_MCP_NAME_SET: ReadonlySet<string> = new Set(
  OPTIONAL_HEAVY_BUILTIN_MCP_NAMES,
)

/** 供 UI 展示的只读分级清单（必需档锁定态展示用）。 */
export const AGENT_MCP_REQUIRED_BUILTIN_NAMES: readonly string[] = REQUIRED_BUILTIN_MCP_NAMES
/** 供 UI 展示的可选档内置清单（可勾选）。 */
export const AGENT_MCP_OPTIONAL_BUILTIN_NAMES: readonly string[] = OPTIONAL_HEAVY_BUILTIN_MCP_NAMES

/** Agent 的 MCP 选择解析结果。 */
export interface AgentMcpSelection {
  /**
   * 用户配置 MCP server 的白名单：undefined = 全量（未配置/全选），
   * Set = 仅挂载集合内的用户 server（按 DB 行 id 过滤）。
   */
  readonly userServerIds: ReadonlySet<string> | undefined
  /**
   * 可选档内置 MCP 的显式勾选集（合成 id 去前缀后的内置名）。
   * 空集 = 未显式收敛内置（保持全挂，兼容仅选择用户 server 的存量数据）；
   * 非空 = 仅勾选的可选档内置挂载。
   */
  readonly builtinNames: ReadonlySet<string>
  /** 是否处于「部分点选」模式（mcpServerIds 非空）。 */
  readonly partial: boolean
}

function normalizeIdList(ids: readonly string[] | undefined | null): string[] {
  if (!Array.isArray(ids)) return []
  return ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
}

/**
 * 解析 agent 的 MCP 选择（D3：用户 server id 与 builtin:spark_* 合成 id 混存）。
 *
 * 畸形输入（null / 非数组 / 空白串）一律按「未配置」处理 → 全量，显式兜底。
 */
export function splitAgentMcpSelection(
  ids: readonly string[] | undefined | null,
): AgentMcpSelection {
  const normalized = normalizeIdList(ids)
  if (normalized.length === 0) {
    return { userServerIds: undefined, builtinNames: new Set<string>(), partial: false }
  }
  const userServerIds = new Set<string>()
  const builtinNames = new Set<string>()
  for (const id of normalized) {
    if (id.startsWith(BUILTIN_MCP_ID_PREFIX)) {
      // 合成 id `builtin:spark_platform` → 内置名 `spark_platform`（shouldMountBuiltinMcp
      // / SPARK_BUILTIN_SERVER_NAMES 均使用带 spark_ 前缀的完整注册名）。
      const builtinName = `spark_${id.slice(BUILTIN_MCP_ID_PREFIX.length)}`
      if (builtinName.length > 'spark_'.length) builtinNames.add(builtinName)
    } else {
      userServerIds.add(id)
    }
  }
  return { userServerIds, builtinNames, partial: true }
}

/**
 * 用户配置 MCP 的白名单快捷口径：空 → undefined（全量，与裸调 buildMcpServersForSDK
 * 完全等价）；非空 → Set。
 *
 * 内置合成 id 不参与用户 server 过滤（buildMcpServersForSDK 按 DB 行 id 匹配，
 * 合成 id 天然不命中，无害）。
 */
export function resolveAgentMcpAllowList(
  ids: readonly string[] | undefined | null,
): ReadonlySet<string> | undefined {
  return splitAgentMcpSelection(ids).userServerIds
}

/**
 * 内置 MCP 门控（D4 + D5）：
 *
 * 1. 必需档恒挂载；
 * 2. 不在可选档清单内的内置（已有自身门控）恒挂载，维持原行为；
 * 3. D5 引擎强制归位：spark_platform 承载 skills_load / skills_list，spark / codex
 *    引擎的技能加载完全依赖它 → 非 claude-sdk 引擎强制挂载（claude-sdk 有原生
 *    Skill 工具兜底，才允许摘除）；
 * 4. 未处于部分点选模式（builtinNames 为空）→ 可选档保持全挂（兼容仅存用户
 *    server id 的存量数据与「全选提交 []」语义）；
 * 5. 部分点选模式下，仅勾选的可选档内置挂载。
 */
export function shouldMountBuiltinMcp(
  builtinName: string,
  engine: EngineKind,
  selection: AgentMcpSelection,
): boolean {
  if (REQUIRED_BUILTIN_MCP_NAME_SET.has(builtinName)) return true
  if (!OPTIONAL_HEAVY_BUILTIN_MCP_NAME_SET.has(builtinName)) return true
  if (builtinName === 'spark_platform' && engine !== 'claude-sdk') return true
  if (!selection.partial || selection.builtinNames.size === 0) return true
  return selection.builtinNames.has(builtinName)
}

/**
 * Agent MCP 选择的可序列化签名（SDK resume 快照保护用）：选择集变化时，
 * SDK/Codex 下一 turn 强制 `continueSession: false`，防止 resume 会话工具面漂移。
 */
export function agentMcpSelectionSignature(ids: readonly string[] | undefined | null): string {
  return normalizeIdList(ids).slice().sort().join(',')
}
