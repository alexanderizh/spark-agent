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
export { EventRepository } from './event.repository.js'
export { ProviderProfileRepository } from './provider.repository.js'
export { RulesRepository } from './rules.repository.js'
export { PermissionProfileRepository } from './permission.repository.js'
export type { PermissionDecisionRow, PermissionProfileRow, PermissionRuleRow } from './permission.repository.js'
export { ModelProfileRepository } from './model-profile.repository.js'
export type { ModelProfileRow } from './model-profile.repository.js'
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

// 类型导出
export type { SessionRow, CreateSessionParams, ListSessionsParams } from './session.repository.js'
export type { WorkspaceRow, CreateWorkspaceParams } from './workspace.repository.js'
export type { AgentEventRow, QueryEventsParams, InsertEventParams } from './event.repository.js'
export type { ProviderProfileRow, CreateProviderParams } from './provider.repository.js'
export type { RuleRow, CreateRuleParams, UpdateRuleParams, ListRulesParams } from './rules.repository.js'
