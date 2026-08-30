/**
 * @module team-tool-names
 *
 * 团队 A2A 升级（Phase A · FR-10）：团队/编排工具名的单一来源。
 *
 * 目的：
 *  - `spark_team` 后续计划重命名为 `spark_orchestrate`（unified-orchestration-kernel M6）。
 *    工具名集中在这一处定义，改名时只改一个文件，避免散落在 session.service.ts /
 *    prompt 文案 / 测试断言各处的硬编码字符串漂移。
 *  - Phase B/C/D 引用这些常量来注册新工具（agent_message / team_round_advance /
 *    team_conclude）与生成全限定名（`mcp__${SERVER}__${tool}`）。
 *
 * 本期（Phase A）只新建常量模块并 export，**不**重构 session.service.ts 现有硬编码
 * 字符串——session.service.ts 正在被另一个 agent 改，避免冲突。常量本身要能被后续
 * Phase B/C/D 引用。
 */

/**
 * spark_team MCP server 的名字。
 *
 * 历史包袱：早期只服务团队模式；现在 goal/workflow/team 三套机制共用同一个 server
 * 实例（见 session.service.ts:3403）。名字保留 spark_team 以兼容现有代码、测试、文档、
 * 用户自定义 prompt；待 unified-orchestration-kernel M6 统一改名为 spark_orchestrate。
 */
export const SPARK_TEAM_MCP_SERVER_NAME = 'spark_team' as const

/**
 * 团队/编排工具的短名（不含 `mcp__${server}__` 前缀）。
 *
 * - agent_dispatch / agent_dispatch_batch：现有 Host → Member 派发工具（已落地）。
 * - agent_message：Phase B 新增的对等消息工具（广播/定向 @）。
 * - team_round_advance / team_conclude：Phase D 新增的轮次控制工具。
 * - team_thread_read：只读查询共享讨论线程（分页/按轮次/按发送者/单条全文）。
 *   注入快照是截断预览，成员需要更多历史正文时用它按需翻聊天记录。
 * - workflow_run：workflow 工具（与团队共用同一 MCP server 实例）。
 */
export const TEAM_TOOL_NAMES = [
  'agent_dispatch',
  'agent_dispatch_batch',
  'agent_message',
  'team_round_advance',
  'team_conclude',
  'team_thread_read',
  'workflow_run',
] as const

export type TeamToolName = (typeof TEAM_TOOL_NAMES)[number]

/** agent_message 的投递语义：call = 同步触发目标执行；note = 定向异步留言。 */
export const AGENT_MESSAGE_DELIVERY_MODES = ['call', 'note'] as const

export type AgentMessageDeliveryMode = (typeof AGENT_MESSAGE_DELIVERY_MODES)[number]

/** 新增工具的短名集合（Phase A 引入但尚未在 session.service.ts 注册的）。 */
export const NEW_TEAM_TOOL_NAMES = [
  'agent_message',
  'team_round_advance',
  'team_conclude',
] as const

/** 现有已落地的工具短名集合（用于区分新旧，方便测试与渐进迁移）。 */
export const EXISTING_TEAM_TOOL_NAMES = [
  'agent_dispatch',
  'agent_dispatch_batch',
  'workflow_run',
] as const

/**
 * 拼接 SDK 用的全限定工具名：`mcp__spark_team__<tool>`。
 *
 * 与 session.service.ts:2498-2503 / 3806-3807 现有写法一致（`mcp__${server}__${name}`）。
 * 后续 server 改名时，只改 {@link SPARK_TEAM_MCP_SERVER_NAME} 即可全仓联动。
 */
export function qualifyTeamToolName(tool: TeamToolName): string {
  return `mcp__${SPARK_TEAM_MCP_SERVER_NAME}__${tool}`
}

/**
 * 批量拼接 SDK 用的全限定工具名。
 *
 * @example
 *   qualifyTeamTools('agent_dispatch', 'agent_message')
 *   // → ['mcp__spark_team__agent_dispatch', 'mcp__spark_team__agent_message']
 */
export function qualifyTeamTools(...tools: TeamToolName[]): string[] {
  return tools.map((t) => qualifyTeamToolName(t))
}
