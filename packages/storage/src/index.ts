/**
 * @spark/storage — Spark Agent 存储层
 *
 * 职责：
 *   - SQLite 数据库连接管理（better-sqlite3 + WAL）
 *   - Migration 管理（版本号递增策略）
 *   - Repository 模式的基类
 *   - 各领域 Repository 的导出入口
 *
 * 约束（ADR-002）：
 *   - 本包是唯一合法的数据库访问入口
 *   - 所有 SQL 通过 prepared statement 执行
 *   - 数据库文件路径由调用方（Electron 主进程）提供
 *   - API Key 不存储在 SQLite 中，只存储 keychain_ref
 */

// 数据库核心
export { SparkDatabase, createDatabase } from './database.js'
export type { SqliteDatabase } from './database.js'

// Repository（向后兼容）
export { BaseRepository } from './repository.js'

// 领域 Repository
export {
  SessionRepository,
  WorkspaceRepository,
  EventRepository,
  ProviderProfileRepository,
  RulesRepository,
  PermissionProfileRepository,
  ModelProfileRepository,
  McpServerRepository,
  SkillRepository,
  SkillRegistryRepository,
  SettingsRepository,
  UsageLedgerRepository,
  ContextPreferenceRepository,
  SessionSummaryRepository,
  AgentRepository,
  WorkflowRepository,
  TeamDispatchRepository,
  TeamDefinitionRepository,
  ScheduledTaskRepository,
  TaskExecutionRepository,
  MemoryRepository,
} from './repositories/index.js'

export type {
  SessionRow,
  CreateSessionParams,
  ListSessionsParams,
  WorkspaceRow,
  CreateWorkspaceParams,
  AgentEventRow,
  QueryEventsParams,
  InsertEventParams,
  ProviderProfileRow,
  CreateProviderParams,
  RuleRow,
  CreateRuleParams,
  UpdateRuleParams,
  ListRulesParams,
  PermissionDecisionRow,
  PermissionProfileRow,
  PermissionRuleRow,
  ModelProfileRow,
  McpServerRow,
  SkillRow,
  SkillRegistryRow,
  SettingsRow,
  UsageLedgerRow,
  RecordUsageParams,
  UsageSummary,
  ModelUsageGroup,
  DailyUsageGroup,
  ContextPreferenceRow,
  UpsertContextPreferenceParams,
  ListContextPreferencesParams,
  SessionSummaryRow,
  CreateSessionSummaryParams,
  AgentConfig,
  AgentItem,
  AgentRow,
  CreateAgentParams,
  UpdateAgentParams,
  CreateWorkflowParams,
  UpdateWorkflowParams,
  WorkflowItem,
  WorkflowRow,
  WorkflowStatus,
  TeamDispatchRow,
  TeamDispatchState,
  CreateTeamDispatchParams,
  UpdateTeamDispatchParams,
  AgentTeamRow,
  AgentTeamItem,
  CreateAgentTeamParams,
  UpdateAgentTeamParams,
  ListAgentTeamsParams,
  ScheduledTaskRow,
  CreateScheduledTaskParams,
  UpdateScheduledTaskParams,
  ScheduledTaskFilter,
  TaskExecutionRow,
  CreateTaskExecutionParams,
  ExecutionQueryOptions,
  ExecutionStats,
  MemoryEntryRow,
} from './repositories/index.js'
