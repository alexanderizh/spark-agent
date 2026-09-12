import type {
  HookBindingV1,
  HookDefinitionInputV1,
  HookDefinitionV1,
  HookEffectiveBindingV1,
  HookEventEnvelopeV1,
  HookEventNameV1,
  HookPreviewResultV1,
  HookRunV1,
  HookScopeKindV1,
} from '@spark/protocol'
import { HookEventEnvelopeV1Schema } from '@spark/protocol'
import {
  AgentRepository,
  HookBindingRepository,
  HookDefinitionRepository,
  HookEventRepository,
  HookRunRepository,
  SessionRepository,
  SettingsRepository,
  type SparkDatabase,
  WorkspaceRepository,
} from '@spark/storage'
import { resolveEffectiveBindings } from './hook-binding-resolver.js'
import {
  computeExecutionHash,
  evaluateCondition,
  evaluateInputMapping,
  validateDefinitionInput,
} from './hook-expression.js'

/**
 * Hook 管理面服务（设计方案 §14/§15）：定义 CRUD/校验、绑定授权、最终生效列表、
 * 运行记录查询与重试、应用级总开关和映射预览。IPC 层保持薄接线，逻辑集中在这里。
 */

const SETTINGS_CATEGORY = 'hooks-v2'
const ENABLED_KEY = 'enabled'

function normalizeRetryPolicy(
  partial?: Partial<HookDefinitionInputV1['retryPolicy']> | undefined,
): HookDefinitionV1['retryPolicy'] {
  return {
    mode: partial?.mode ?? 'unsafe',
    maxAttempts: partial?.maxAttempts ?? 3,
    backoffMs: partial?.backoffMs ?? 1000,
  }
}

export interface HookManagementDeps {
  db: SparkDatabase
}

export class HookManagementService {
  private readonly definitions: HookDefinitionRepository
  private readonly bindings: HookBindingRepository
  private readonly runs: HookRunRepository
  private readonly events: HookEventRepository
  private readonly settings: SettingsRepository
  private readonly sessions: SessionRepository
  private readonly agents: AgentRepository
  private readonly workspaces: WorkspaceRepository

  constructor(deps: HookManagementDeps) {
    this.definitions = new HookDefinitionRepository(deps.db)
    this.bindings = new HookBindingRepository(deps.db)
    this.runs = new HookRunRepository(deps.db)
    this.events = new HookEventRepository(deps.db)
    this.settings = new SettingsRepository(deps.db)
    this.sessions = new SessionRepository(deps.db)
    this.agents = new AgentRepository(deps.db)
    this.workspaces = new WorkspaceRepository(deps.db)
  }

  // ── 定义 ──────────────────────────────────────────────────────────────────

  createDefinition(input: HookDefinitionInputV1): HookDefinitionV1 {
    const errors = validateDefinitionInput(input)
    if (errors.length > 0) throw new Error(`Hook 定义校验失败: ${errors.join('; ')}`)
    const executionHash = computeExecutionHash({
      eventName: input.eventName,
      ...(input.condition != null ? { condition: input.condition } : {}),
      action: input.action,
      inputMapping: input.inputMapping ?? {},
      timeoutMs: input.timeoutMs ?? 15_000,
      retryPolicy: {
        mode: input.retryPolicy?.mode ?? 'unsafe',
        maxAttempts: input.retryPolicy?.maxAttempts ?? 3,
        backoffMs: input.retryPolicy?.backoffMs ?? 1000,
      },
      concurrencyPolicy: input.concurrencyPolicy ?? 'serial_per_session',
    })
    return this.definitions.create({
      name: input.name,
      ...(input.description != null ? { description: input.description } : {}),
      enabled: input.enabled ?? true,
      eventName: input.eventName,
      ...(input.condition != null ? { condition: input.condition } : {}),
      action: input.action,
      inputMapping: input.inputMapping ?? {},
      timeoutMs: input.timeoutMs ?? 15_000,
      retryPolicy: {
        mode: input.retryPolicy?.mode ?? 'unsafe',
        maxAttempts: input.retryPolicy?.maxAttempts ?? 3,
        backoffMs: input.retryPolicy?.backoffMs ?? 1000,
      },
      concurrencyPolicy: input.concurrencyPolicy ?? 'serial_per_session',
      revision: 1,
      executionHash,
    })
  }

  updateDefinition(
    id: string,
    patch: Partial<HookDefinitionInputV1>,
  ): { definition: HookDefinitionV1; invalidatedBindings: number } {
    const current = this.definitions.get(id)
    if (current == null) throw new Error(`Hook 定义不存在: ${id}`)
    const merged: HookDefinitionInputV1 = {
      name: patch.name ?? current.name,
      ...(patch.description !== undefined
        ? { description: patch.description }
        : current.description != null
          ? { description: current.description }
          : {}),
      enabled: patch.enabled ?? current.enabled,
      eventName: patch.eventName ?? current.eventName,
      ...(patch.condition !== undefined
        ? { condition: patch.condition }
        : current.condition != null
          ? { condition: current.condition }
          : {}),
      action: patch.action ?? current.action,
      inputMapping: patch.inputMapping ?? current.inputMapping,
      timeoutMs: patch.timeoutMs ?? current.timeoutMs,
      retryPolicy:
        patch.retryPolicy != null ? normalizeRetryPolicy(patch.retryPolicy) : current.retryPolicy,
      concurrencyPolicy: patch.concurrencyPolicy ?? current.concurrencyPolicy,
    }
    const errors = validateDefinitionInput(merged)
    if (errors.length > 0) throw new Error(`Hook 定义校验失败: ${errors.join('; ')}`)

    // 哈希必须基于归一化后的执行字段（retryPolicy 补全缺省值），
    // 保证「同语义定义同哈希」不因提交方式（全量/部分字段）而漂移。
    const executionHash = computeExecutionHash({
      eventName: merged.eventName,
      ...(merged.condition != null ? { condition: merged.condition } : {}),
      action: merged.action,
      inputMapping: merged.inputMapping ?? {},
      ...(merged.timeoutMs != null ? { timeoutMs: merged.timeoutMs } : {}),
      retryPolicy: normalizeRetryPolicy(merged.retryPolicy),
      concurrencyPolicy: merged.concurrencyPolicy ?? 'serial_per_session',
    })
    const executableChanged = executionHash !== current.executionHash
    const updated = this.definitions.update(id, {
      name: merged.name,
      ...(merged.description !== undefined ? { description: merged.description } : {}),
      enabled: merged.enabled ?? true,
      eventName: merged.eventName,
      ...(merged.condition !== undefined ? { condition: merged.condition } : {}),
      action: merged.action,
      ...(merged.inputMapping != null ? { inputMapping: merged.inputMapping } : {}),
      ...(merged.timeoutMs != null ? { timeoutMs: merged.timeoutMs } : {}),
      retryPolicy: normalizeRetryPolicy(merged.retryPolicy),
      ...(merged.concurrencyPolicy != null ? { concurrencyPolicy: merged.concurrencyPolicy } : {}),
      ...(executableChanged ? { revision: current.revision + 1, executionHash } : {}),
    })
    if (updated == null) throw new Error(`Hook 定义不存在: ${id}`)
    const invalidatedBindings = executableChanged
      ? this.bindings.invalidateStaleAuthorizations(id, executionHash)
      : 0
    return { definition: updated, invalidatedBindings }
  }

  deleteDefinition(id: string): {
    deleted: boolean
    deletedBindings: number
    retainedRuns: number
  } {
    const deletedBindings = this.definitions.countBindings(id)
    const retainedRuns = this.definitions.countRuns(id)
    const deleted = this.definitions.delete(id)
    return { deleted, deletedBindings, retainedRuns }
  }

  validateDefinition(input: HookDefinitionInputV1): {
    valid: boolean
    errors: string[]
    executionHash: string
  } {
    const errors = validateDefinitionInput(input)
    return {
      valid: errors.length === 0,
      errors,
      executionHash: computeExecutionHash({
        eventName: input.eventName,
        ...(input.condition != null ? { condition: input.condition } : {}),
        action: input.action,
        inputMapping: input.inputMapping ?? {},
        timeoutMs: input.timeoutMs ?? 15_000,
        retryPolicy: {
          mode: input.retryPolicy?.mode ?? 'unsafe',
          maxAttempts: input.retryPolicy?.maxAttempts ?? 3,
          backoffMs: input.retryPolicy?.backoffMs ?? 1000,
        },
        concurrencyPolicy: input.concurrencyPolicy ?? 'serial_per_session',
      }),
    }
  }

  listDefinitions(eventName?: HookEventNameV1): HookDefinitionV1[] {
    return this.definitions.list(eventName)
  }

  // ── 绑定 ──────────────────────────────────────────────────────────────────

  upsertBinding(input: {
    hookId: string
    scopeKind: HookScopeKindV1
    scopeId?: string
    enabled?: boolean
    authorizeExecutionHash?: string
    authorizedEffect?: string
  }): HookBindingV1 {
    const definition = this.definitions.get(input.hookId)
    if (definition == null) throw new Error(`Hook 定义不存在: ${input.hookId}`)
    const scopeId = input.scopeKind === 'application' ? '' : (input.scopeId ?? '')
    if (input.scopeKind !== 'application' && scopeId.trim() === '') {
      throw new Error(`${input.scopeKind} 作用域必须提供 scopeId`)
    }
    const enabled = input.enabled ?? true
    // 授权哈希必须匹配当前定义执行哈希；不匹配（或未提供授权）进入 needs_review。
    const authorized =
      input.authorizeExecutionHash != null &&
      input.authorizeExecutionHash === definition.executionHash
    const state = enabled ? (authorized ? 'active' : 'needs_review') : 'disabled'
    return this.bindings.upsert({
      hookId: input.hookId,
      scopeKind: input.scopeKind,
      scopeId,
      enabled,
      state,
      trustedExecutionHash: authorized ? definition.executionHash : null,
      authorizedEffect: authorized ? (input.authorizedEffect ?? definition.action.type) : null,
      authorizedAt: authorized ? new Date().toISOString() : null,
    })
  }

  listBindings(
    filters: { hookId?: string; scopeKind?: HookScopeKindV1; scopeId?: string } = {},
  ): HookBindingV1[] {
    return this.bindings.list(filters)
  }

  /** 会话视角的最终生效列表（设计方案 §15.3）。 */
  listEffective(sessionId: string): HookEffectiveBindingV1[] {
    const session = this.sessionLookup(sessionId)
    if (session == null) return []
    const definitions = this.definitions.list()
    const scopes: Array<{ scopeKind: HookScopeKindV1; scopeId: string }> = [
      { scopeKind: 'application', scopeId: '' },
      { scopeKind: 'session', scopeId: sessionId },
    ]
    if (session.primaryWorkspaceId != null) {
      scopes.push({ scopeKind: 'workspace', scopeId: session.primaryWorkspaceId })
    }
    if (session.agentId != null) {
      scopes.push({ scopeKind: 'agent', scopeId: session.agentId })
    }
    const bindings = this.bindings.listForScopes(scopes)
    const { items } = resolveEffectiveBindings({
      envelope: {
        schemaVersion: 1,
        eventId: 'preview',
        eventName: 'turn.started',
        occurredAt: new Date().toISOString(),
        source: 'host',
        session: {
          id: sessionId,
          ...(session.sessionTitle != null ? { title: session.sessionTitle } : {}),
        },
        turn: { id: 'preview' },
        ...(session.agentId != null
          ? {
              agent: {
                id: session.agentId,
                ...(session.agentName != null ? { name: session.agentName } : {}),
              },
            }
          : {}),
        workspaces: session.workspaceIds.map((id) => ({ id })),
        ...(session.primaryWorkspaceId != null
          ? { primaryWorkspaceId: session.primaryWorkspaceId }
          : {}),
        payload: {},
      },
      definitions,
      bindings,
    })
    return items
  }

  // ── 运行记录 ──────────────────────────────────────────────────────────────

  listRuns(
    filters: {
      sessionId?: string
      hookId?: string
      status?: HookRunV1['status']
      limit?: number
    } = {},
  ): HookRunV1[] {
    return this.runs.list(filters)
  }

  getRun(id: string): HookRunV1 | null {
    return this.runs.get(id)
  }

  /** 用户显式重试：终态运行重新入队（不改写事件事实）。 */
  retryRun(id: string): HookRunV1 | null {
    return this.runs.requeueForManualRetry(id)
  }

  cancelPendingRun(id: string): HookRunV1 | null {
    return this.runs.cancelPending(id)
  }

  // ── 总开关 ────────────────────────────────────────────────────────────────

  getSystemEnabled(): boolean {
    const value = this.settings.get(SETTINGS_CATEGORY, ENABLED_KEY)
    if (value == null) return true
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') return value !== 'false'
    return true
  }

  setSystemEnabled(enabled: boolean): boolean {
    this.settings.set(SETTINGS_CATEGORY, ENABLED_KEY, enabled)
    return enabled
  }

  // ── 预览（不执行真实动作）──────────────────────────────────────────────────

  preview(
    definition: HookDefinitionInputV1,
    sampleEnvelope?: HookEventEnvelopeV1,
  ): HookPreviewResultV1 {
    const { valid, errors } = this.validateDefinition(definition)
    const envelope = sampleEnvelope ?? this.buildSampleEnvelope(definition.eventName)
    const parsed = HookEventEnvelopeV1Schema.safeParse(envelope)
    if (!parsed.success) {
      return {
        valid: false,
        errors: [
          ...errors,
          `样例事件不合法: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        ],
        conditionMatched: false,
        mappedInput: {},
        envelope,
      }
    }
    // zod 推断的可选字段带 | undefined，与手工信封类型在 exactOptionalPropertyTypes 下
    // 存在表示差异；schema 校验通过后按协议类型收窄。
    const validated = parsed.data as HookEventEnvelopeV1
    let conditionMatched = false
    let mappedInput: Record<string, unknown> = {}
    try {
      conditionMatched =
        definition.condition == null || evaluateCondition(validated, definition.condition)
      if (conditionMatched) {
        mappedInput = evaluateInputMapping(validated, definition.inputMapping ?? {})
      }
    } catch (error) {
      return {
        valid: false,
        errors: [...errors, error instanceof Error ? error.message : String(error)],
        conditionMatched,
        mappedInput,
        envelope: validated,
      }
    }
    return { valid, errors, conditionMatched, mappedInput, envelope: validated }
  }

  private buildSampleEnvelope(eventName: HookEventNameV1): HookEventEnvelopeV1 {
    const payload: Record<string, unknown> =
      eventName === 'response.committed'
        ? { response: { messageId: 'sample-message', finalText: '（样例最终回答正文）' } }
        : eventName === 'permission.requested'
          ? {
              requestId: 'sample-request',
              toolName: 'sample_tool',
              action: 'write',
              riskLevel: 'low',
            }
          : eventName === 'question.requested'
            ? { questionId: 'sample-question', questions: [{ title: '（样例问题）' }] }
            : eventName === 'turn.started'
              ? {}
              : { message: '（样例消息）' }
    return {
      schemaVersion: 1,
      eventId: 'sample-event',
      eventName,
      occurredAt: new Date().toISOString(),
      source: 'host',
      session: { id: 'sample-session', title: '样例会话' },
      turn: { id: 'sample-turn' },
      agent: { id: 'sample-agent', name: '样例 Agent' },
      workspaces: [{ id: 'sample-workspace', name: '样例项目' }],
      primaryWorkspaceId: 'sample-workspace',
      payload,
    }
  }

  private sessionLookup(sessionId: string): {
    sessionTitle?: string
    agentId?: string
    agentName?: string
    workspaceIds: string[]
    primaryWorkspaceId?: string
  } | null {
    const session = this.sessions.get(sessionId)
    if (session == null) return null
    const workspaceIds = this.sessions.getWorkspaceIds(sessionId)
    const agent = session.agent_id != null ? this.agents.get(session.agent_id) : null
    const primaryWorkspaceId = workspaceIds[0]
    return {
      ...(session.title != null ? { sessionTitle: session.title } : {}),
      ...(agent != null ? { agentId: agent.id, agentName: agent.name } : {}),
      workspaceIds,
      ...(primaryWorkspaceId != null ? { primaryWorkspaceId } : {}),
    }
  }

  /** outbox 深度（运维观测用）。 */
  pendingEventCount(): number {
    return this.events.countByStatus('pending')
  }
}
