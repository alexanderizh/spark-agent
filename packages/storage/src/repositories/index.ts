/**
 * @module repositories
 *
 * 领域 Repository 导出入口
 *
 * 所有 Repository 都在此处统一导出，外部通过 import { XxxRepository } from '@spark/storage' 使用
 */

export { BaseRepository } from './base.repository.js'
export { SessionRepository } from './session.repository.js'
export { WorkspaceRepository } from './workspace.repository.js'
export { CanvasProjectRepository, CanvasSnapshotRepository } from './canvas.repository.js'
export type {
  CanvasProjectRow,
  CanvasSnapshotRow,
  UpsertCanvasProjectParams,
} from './canvas.repository.js'
export { EventRepository } from './event.repository.js'
export { TurnRequestRepository } from './turn-request.repository.js'
export type { TurnRequestRow, TurnRequestStatus } from './turn-request.repository.js'
export { ConnectorConnectionRepository } from './connector.repository.js'
export type {
  ConnectorConnectionRow,
  CreateConnectorConnectionParams,
  UpdateConnectorConnectionParams,
} from './connector.repository.js'
export { ProviderProfileRepository } from './provider.repository.js'
export { RulesRepository } from './rules.repository.js'
export { PermissionProfileRepository } from './permission.repository.js'
export type { PermissionDecisionRow, PermissionProfileRow, PermissionRuleRow } from './permission.repository.js'
export { ModelProfileRepository } from './model-profile.repository.js'
export type { ModelProfileRow } from './model-profile.repository.js'
export { MediaModelManifestRepository } from './media-model-manifest.repository.js'
export type {
  MediaModelManifestRow,
  MediaProviderModelRow,
  UpsertMediaModelManifestParams,
  UpsertMediaProviderModelParams,
} from './media-model-manifest.repository.js'
export { MediaGenerationTaskRepository } from './media-generation-task.repository.js'
export type {
  MediaGenerationTaskRow,
  MediaGenerationTaskStatus,
  CreateMediaGenerationTaskParams,
  UpdateMediaGenerationTaskParams,
  ListMediaGenerationTasksParams,
} from './media-generation-task.repository.js'
export { McpServerRepository } from './mcp-server.repository.js'
export type { McpServerRow } from './mcp-server.repository.js'
export { SkillRepository } from './skill.repository.js'
export type { SkillRow } from './skill.repository.js'
export { SkillRegistryRepository } from './skill-registry.repository.js'
export type { SkillRegistryRow } from './skill-registry.repository.js'
export { SettingsRepository } from './settings.repository.js'
export type { SettingsRow } from './settings.repository.js'
export { UsageLedgerRepository } from './usage-ledger.repository.js'
export type { UsageLedgerRow, RecordUsageParams, UsageSummary, ModelUsageGroup, DailyUsageGroup } from './usage-ledger.repository.js'
export { ContextPreferenceRepository } from './context-preference.repository.js'
export type { ContextPreferenceRow, UpsertContextPreferenceParams, ListContextPreferencesParams } from './context-preference.repository.js'
export { SessionSummaryRepository } from './session-summary.repository.js'
export type { SessionSummaryRow, CreateSessionSummaryParams } from './session-summary.repository.js'
export { AgentRepository } from './agent.repository.js'
export type { AgentConfig, AgentItem, AgentRow, CreateAgentParams, UpdateAgentParams } from './agent.repository.js'
export { WorkflowRepository } from './workflow.repository.js'
export type { CreateWorkflowParams, UpdateWorkflowParams, WorkflowItem, WorkflowRow, WorkflowStatus } from './workflow.repository.js'
export { WorkflowRunRepository } from './workflow-run.repository.js'
export type {
  CreateWorkflowRunParams,
  UpdateWorkflowRunSnapshotParams,
  WorkflowRunRow,
  WorkflowRunStatus,
} from './workflow-run.repository.js'
export { TeamDispatchRepository } from './team-dispatch.repository.js'
export type { TeamDispatchRow, TeamDispatchState, CreateTeamDispatchParams, UpdateTeamDispatchParams } from './team-dispatch.repository.js'
export { TeamDiscussionRepository } from './team-discussion.repository.js'
export type {
  TeamDiscussionRow,
  TeamDiscussionState,
  TeamThreadMessageRow,
  TeamThreadMessageKind,
  TeamThreadMessageDelivery,
  CreateDiscussionParams,
  AppendMessageParams,
  AdvanceRoundResult,
  ConcludeParams,
} from './team-discussion.repository.js'
export {
  DEFAULT_MAX_DISCUSSION_ROUNDS,
  HARD_MAX_DISCUSSION_ROUNDS,
  DEFAULT_THREAD_TOKEN_BUDGET,
} from './team-discussion.repository.js'
export { TeamDefinitionRepository } from './team-definition.repository.js'
export type {
  AgentTeamRow,
  AgentTeamItem,
  CreateAgentTeamParams,
  UpdateAgentTeamParams,
  ListAgentTeamsParams,
} from './team-definition.repository.js'
export { ScheduledTaskRepository } from './scheduled-task.repository.js'
export type {
  ScheduledTaskRow,
  CreateScheduledTaskParams,
  UpdateScheduledTaskParams,
  ScheduledTaskFilter,
} from './scheduled-task.repository.js'
export { TaskExecutionRepository } from './task-execution.repository.js'
export type {
  TaskExecutionRow,
  CreateTaskExecutionParams,
  ExecutionQueryOptions,
  ExecutionStats,
} from './task-execution.repository.js'
export { MemoryRepository } from './memory.repository.js'
export type { MemoryEntryRow, MemoryEntryInsert } from './memory.repository.js'
export { MemorySearchRepository, upsertFtsRow, deleteFtsRow, ftsTableExists } from './memory-search.repository.js'
export type {
  MemoryScopeFilter,
  FtsSearchOptions,
  FtsSearchHit,
  VecSearchHit,
} from './memory-search.repository.js'
export { MemoryEntityRepository, normalizeEntityName } from './memory-entity.repository.js'
export type { MemoryEntityRow } from './memory-entity.repository.js'

// 类型导出
export type { SessionRow, CreateSessionParams, ListSessionsParams } from './session.repository.js'
export type { WorkspaceRow, CreateWorkspaceParams, WorktreeMeta } from './workspace.repository.js'
export type { AgentEventRow, QueryEventsParams, InsertEventParams } from './event.repository.js'
export type { ProviderProfileRow, CreateProviderParams } from './provider.repository.js'
export type { RuleRow, CreateRuleParams, UpdateRuleParams, ListRulesParams } from './rules.repository.js'

export { GoalRepository } from './goal.repository.js'
export type { SessionGoal, GoalBudget, GoalValidation, GoalProgressEntry, GoalStatus, GoalMode } from './goal.repository.js'
