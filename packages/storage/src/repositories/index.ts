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

// 类型导出
export type { SessionRow, CreateSessionParams, ListSessionsParams } from './session.repository.js'
export type { WorkspaceRow, CreateWorkspaceParams } from './workspace.repository.js'
export type { AgentEventRow, QueryEventsParams, InsertEventParams } from './event.repository.js'
export type { ProviderProfileRow, CreateProviderParams } from './provider.repository.js'
export type { RuleRow, CreateRuleParams, UpdateRuleParams, ListRulesParams } from './rules.repository.js'
