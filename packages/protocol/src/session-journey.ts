/**
 * 会话经历（Session Journey）IPC 契约 —— 检查器「会话经历」区块。
 *
 * 聚合一个会话过程中「用了什么 / 查了什么 / 产出了什么 / 输入了什么」：
 *   - 技能：Skill / skills_load 类工具调用（名称取自输入载荷，兜底工具名）；
 *   - MCP：账本按 source_kind='mcp' 的 mcp_server_id 分组（含展示名解析）；
 *   - 网页查阅：搜索/抓取类工具调用，从脱敏输入载荷提取检索词与 URL；
 *   - 过程产物：事件流 file_change + presented_files 去重合并；
 *   - 输入来源：user_message 事件的附件（图片/文件/目录）。
 *
 * 数据来源为已落库的审计账本与事件流（会话级聚合，不受聊天窗口化影响）。
 * wire 类型为 camelCase（storage 行为 snake_case，main 侧映射）。
 */
import { z } from 'zod'

/** 会话中加载过的技能。 */
export interface SessionJourneySkill {
  /** 展示名（优先输入载荷中的 id/name，兜底工具名）。 */
  name: string
  /** 记录到的工具名（如 Skill / mcp__spark_platform__skills_load）。 */
  toolName: string
  calls: number
  lastUsedAt: string | null
}

/** 会话中调用过的 MCP 服务器。 */
export interface SessionJourneyMcpServer {
  serverId: string
  /** MCP 配置里的展示名（未解析到配置时等于 serverId）。 */
  displayName: string
  /** 涉及的不同工具数。 */
  tools: number
  calls: number
  lastUsedAt: string | null
}

/** 会话中的联网检索与网页查阅条目。 */
export interface SessionJourneyWebEntry {
  kind: 'search' | 'page'
  /** search：检索词；page：URL。 */
  text: string
  /** page 的主机名（展示用；search 为 null）。 */
  host: string | null
  toolName: string
  calls: number
  lastUsedAt: string | null
}

/** 会话过程产物（文件变更 + 显式呈现文件的合并视图，按路径去重）。 */
export interface SessionJourneyArtifact {
  /** 原始路径（file_change 为工作区相对路径；presented 为绝对路径）。 */
  path: string
  /** 展示名（basename）。 */
  name: string
  /** 该路径出现过的变更类型集合。 */
  changeTypes: Array<'create' | 'modify' | 'delete' | 'rename'>
  /** 是否为 Agent 显式呈现给用户的产物。 */
  presented: boolean
  /** presented 时 Agent 提供的展示标题。 */
  title: string | null
  /** 可用于 reveal 的绝对路径（相对路径已按工作区根解析；解析不到为 null）。 */
  absolutePath: string | null
  lastChangedAt: string | null
}

/** 用户输入的附件来源。 */
export interface SessionJourneyInputSource {
  kind: 'image' | 'file' | 'directory'
  path: string
  name: string
  mimeType: string | null
  /** 同一附件在多轮出现的次数。 */
  occurrences: number
  lastUsedAt: string | null
}

export interface SessionJourneyResponse {
  skills: SessionJourneySkill[]
  mcpServers: SessionJourneyMcpServer[]
  web: SessionJourneyWebEntry[]
  artifacts: SessionJourneyArtifact[]
  inputSources: SessionJourneyInputSource[]
  /** 聚合是否触及扫描预算上限（前端展示「仅统计最近记录」提示）。 */
  truncated: boolean
}

export interface SessionJourneyIpcChannelMap {
  'session:get-journey': [{ sessionId: string }, SessionJourneyResponse]
}

export const SessionJourneyIpcSchemaRegistry = {
  'session:get-journey': z.object({ sessionId: z.string().min(1).max(128) }).strict(),
} as const
