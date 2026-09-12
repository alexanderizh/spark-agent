/**
 * SparkWork 自定义生命周期 Hooks V2 协议（观察型 MVP）
 *
 * 设计基线：docs/plans/2026-09-08-SparkWork 自定义生命周期 Hooks 设计方案.md
 *
 * 核心决策：
 * - 产品 Hook 由宿主运行时确定性调度，不依赖模型在提示词中自行决定是否调用。
 * - 首期只做观察型事件（事件发生后执行动作，不能改变已发生的结果）。
 * - 事件信封、Hook 定义、绑定与运行记录均版本化，schemaVersion 首期为 1。
 * - 同名旧协议（hooks.ts 的 sound/notification 配置）继续保留，迁移归 Phase F。
 */

import { z } from 'zod'

// ─── 事件名 ──────────────────────────────────────────────────────────────────

/**
 * MVP 观察型生命周期事件（V1）。
 * 语义边界见设计方案 §4/§6：response.committed 是最终可见回答成功持久化；
 * turn.completed 是 Turn 成功终态持久化，二者不可互相替代。
 */
export type HookEventNameV1 =
  | 'turn.started'
  | 'permission.requested'
  | 'question.requested'
  | 'response.committed'
  | 'turn.completed'
  | 'turn.failed'
  | 'turn.cancelled'

export const HOOK_EVENT_NAMES_V1 = [
  'turn.started',
  'permission.requested',
  'question.requested',
  'response.committed',
  'turn.completed',
  'turn.failed',
  'turn.cancelled',
] as const satisfies readonly HookEventNameV1[]

export const HookEventNameV1Schema = z.enum(HOOK_EVENT_NAMES_V1)

// ─── 值表达式与条件（受限表达式模型，不执行用户 JS）─────────────────────────

/** 值来源：常量 / 事件白名单路径 / 模板字符串（${path} 占位）。 */
export type HookValueExpressionV1 =
  | { const: string | number | boolean | null }
  | { path: string }
  | { template: string }

export const HookValueExpressionV1Schema: z.ZodType<HookValueExpressionV1> = z.lazy(() =>
  z
    .union([
      z.object({ const: z.union([z.string(), z.number(), z.boolean(), z.null()]) }).strict(),
      z.object({ path: z.string().min(1) }).strict(),
      z.object({ template: z.string().min(1) }).strict(),
    ])
    .superRefine((value, ctx) => {
      const keys = Object.keys(value)
      if (keys.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'value expression must have exactly one key',
        })
      }
    }),
) as z.ZodType<HookValueExpressionV1>

/** 条件操作符。and/or/not 提供组合能力，其余为叶子比较。 */
export type HookConditionOperatorV1 =
  | 'eq'
  | 'notEq'
  | 'exists'
  | 'contains'
  | 'startsWith'
  | 'and'
  | 'or'
  | 'not'

export type HookConditionV1 =
  | {
      operator: 'eq' | 'notEq' | 'contains' | 'startsWith'
      left: HookValueExpressionV1
      right: HookValueExpressionV1
    }
  | { operator: 'exists'; left: HookValueExpressionV1 }
  | { operator: 'and' | 'or'; conditions: HookConditionV1[] }
  | { operator: 'not'; condition: HookConditionV1 }

export const HookConditionV1Schema: z.ZodType<HookConditionV1> = z.lazy(() =>
  z.union([
    z
      .object({
        operator: z.enum(['eq', 'notEq', 'contains', 'startsWith']),
        left: HookValueExpressionV1Schema,
        right: HookValueExpressionV1Schema,
      })
      .strict(),
    z.object({ operator: z.literal('exists'), left: HookValueExpressionV1Schema }).strict(),
    z
      .object({
        operator: z.enum(['and', 'or']),
        conditions: z.array(HookConditionV1Schema).min(1).max(16),
      })
      .strict(),
    z.object({ operator: z.literal('not'), condition: HookConditionV1Schema }).strict(),
  ]),
) as z.ZodType<HookConditionV1>

// ─── 动作 ────────────────────────────────────────────────────────────────────

/** Hook 工具动作的稳定引用。执行前由统一工具目录核验，不能只保存显示名称。 */
export interface HookToolTargetV1 {
  sourceKind: 'connector' | 'custom-tool' | 'tool-package'
  sourceId: string
  version?: string
  toolName: string
  qualifiedName: string
}

export const HookToolTargetV1Schema = z
  .object({
    sourceKind: z.enum(['connector', 'custom-tool', 'tool-package']),
    sourceId: z.string().min(1),
    version: z.string().min(1).optional(),
    toolName: z.string().min(1),
    qualifiedName: z.string().min(1),
  })
  .strict()

/**
 * 首期动作类型。内置动作（notification/sound）由宿主实现；
 * tool.invoke 走统一工具目录，保存稳定引用。
 */
export type HookActionV1 =
  | { type: 'builtin.notification'; title?: HookValueExpressionV1; body?: HookValueExpressionV1 }
  | { type: 'builtin.sound' }
  | { type: 'tool.invoke'; target: HookToolTargetV1 }

export const HookActionV1Schema: z.ZodType<HookActionV1> = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal('builtin.notification'),
        title: HookValueExpressionV1Schema.optional(),
        body: HookValueExpressionV1Schema.optional(),
      })
      .strict(),
    z.object({ type: z.literal('builtin.sound') }).strict(),
    z.object({ type: z.literal('tool.invoke'), target: HookToolTargetV1Schema }).strict(),
  ]),
) as z.ZodType<HookActionV1>

// ─── 重试与执行策略 ──────────────────────────────────────────────────────────

/** safe：仅瞬态错误自动重试；keyed：宿主注入稳定幂等键后自动重试；unsafe：失败不自动重试。 */
export type HookRetryModeV1 = 'safe' | 'keyed' | 'unsafe'

export interface HookRetryPolicyV1 {
  mode: HookRetryModeV1
  /** 最大尝试次数（含首次），默认 3。 */
  maxAttempts: number
  /** 退避基数 ms，默认 1000，按指数退避。 */
  backoffMs: number
}

export const DEFAULT_HOOK_RETRY_POLICY_V1: HookRetryPolicyV1 = {
  mode: 'unsafe',
  maxAttempts: 3,
  backoffMs: 1000,
}

export const HookRetryPolicyV1Schema = z
  .object({
    mode: z.enum(['safe', 'keyed', 'unsafe']),
    maxAttempts: z.number().int().min(1).max(10).default(DEFAULT_HOOK_RETRY_POLICY_V1.maxAttempts),
    backoffMs: z.number().int().min(0).max(600_000).default(DEFAULT_HOOK_RETRY_POLICY_V1.backoffMs),
  })
  .strict()

export type HookConcurrencyPolicyV1 = 'serial_per_session' | 'parallel'

// ─── Hook 定义 ───────────────────────────────────────────────────────────────

export const DEFAULT_HOOK_TIMEOUT_MS = 15_000

export interface HookDefinitionV1 {
  id: string
  name: string
  description?: string
  enabled: boolean
  eventName: HookEventNameV1
  condition?: HookConditionV1
  action: HookActionV1
  inputMapping: Record<string, HookValueExpressionV1>
  timeoutMs: number
  retryPolicy: HookRetryPolicyV1
  concurrencyPolicy: HookConcurrencyPolicyV1
  /** 定义每保存一次执行性字段就 +1；运行快照用它记录审计语义。 */
  revision: number
  /** 对事件、条件、映射、动作目标、超时、重试与并发策略的规范化哈希。 */
  executionHash: string
  createdAt: string
  updatedAt: string
}

/** 创建/更新定义时允许提交的字段（id/revision/executionHash/时间戳由宿主管理）。 */
export interface HookDefinitionInputV1 {
  name: string
  description?: string
  enabled?: boolean
  eventName: HookEventNameV1
  condition?: HookConditionV1
  action: HookActionV1
  inputMapping?: Record<string, HookValueExpressionV1>
  timeoutMs?: number
  retryPolicy?: Partial<HookRetryPolicyV1>
  concurrencyPolicy?: HookConcurrencyPolicyV1
}

// ─── 事件信封（HookEventEnvelopeV1）──────────────────────────────────────────

export interface HookEventEnvelopeV1<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  schemaVersion: 1
  eventId: string
  eventName: HookEventNameV1
  occurredAt: string
  source: 'host'
  session: { id: string; title?: string }
  turn: { id: string }
  agent?: { id: string; name?: string }
  workspaces: Array<{ id: string; name?: string }>
  primaryWorkspaceId?: string
  payload: TPayload
}

/** response.committed 载荷：finalText 只含最终展示正文，不含推理/提示词/工具原始结果。 */
export interface ResponseCommittedPayloadV1 {
  response: { messageId: string; finalText: string }
}

export interface PermissionRequestedPayloadV1 {
  requestId: string
  toolName: string
  action: string
  riskLevel: string
}

export interface QuestionRequestedPayloadV1 {
  questionId: string
  questions: Array<{ label?: string; title?: string; description?: string }>
}

export interface TurnLifecyclePayloadV1 {
  message?: string
}

// ─── 作用域与绑定 ────────────────────────────────────────────────────────────

export type HookScopeKindV1 = 'application' | 'workspace' | 'agent' | 'session'

export type HookBindingStateV1 = 'active' | 'needs_review' | 'disabled'

export interface HookBindingV1 {
  id: string
  hookId: string
  scopeKind: HookScopeKindV1
  /** application 作用域为 ''（空串），其余为对应对象 id。 */
  scopeId: string
  enabled: boolean
  state: HookBindingStateV1
  /** 启用时授权的 executionHash；与当前定义不一致时绑定进入 needs_review。 */
  trustedExecutionHash?: string
  authorizedEffect?: string
  authorizedAt?: string
  createdAt: string
  updatedAt: string
}

export interface HookBindingInputV1 {
  hookId: string
  scopeKind: HookScopeKindV1
  scopeId?: string
  enabled?: boolean
  /** 提供即视为（重新）授权该 executionHash。 */
  authorizeExecutionHash?: string
  authorizedEffect?: string
}

/** 会话/作用域视角的“最终生效列表”条目（含来源、覆盖与停用原因）。 */
export interface HookEffectiveBindingV1 {
  hook: HookDefinitionV1
  binding: HookBindingV1
  /** 命中的最高优先级作用域。 */
  sourceScope: HookScopeKindV1
  /** 是否被更高优先级的显式停用覆盖。 */
  disabled: boolean
  disabledReason?: 'overridden_disabled' | 'definition_disabled' | 'needs_review'
  /** 同一 Hook 在更低优先级作用域的其余命中（仅展示用）。 */
  shadowedBy: Array<{ scopeKind: HookScopeKindV1; bindingId: string }>
}

// ─── 运行记录 ────────────────────────────────────────────────────────────────

export type HookRunStatusV1 =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'blocked'
  | 'cancelled'
  | 'outcome_unknown'

export interface HookRunV1 {
  id: string
  eventId: string
  eventName: HookEventNameV1
  hookId: string
  hookRevision: number
  bindingId: string
  scopeKind: HookScopeKindV1
  sessionId: string
  turnId: string
  status: HookRunStatusV1
  attemptCount: number
  availableAt: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  errorCode?: HookErrorCodeV1
  errorMessage?: string
  /** 脱敏后的输入/输出摘要（有界预览），完整正文只在统一工具审计中。 */
  inputSummary?: Record<string, unknown>
  outputSummary?: Record<string, unknown>
  correlationId?: string
  invocationId?: string
  /** 首次解析时的定义执行快照。 */
  definitionSnapshot: HookDefinitionV1
  /** 首次解析时的绑定快照（含来源作用域与授权状态）。 */
  bindingSnapshot: HookBindingV1
  envelope: HookEventEnvelopeV1
  /** §14 测试运行：用户显式确认后的独立试运行（会产生真实外部副作用）。 */
  isTest: boolean
  createdAt: string
  updatedAt: string
}

// ─── 稳定错误码 ──────────────────────────────────────────────────────────────

export const HOOK_ERROR_CODES_V1 = [
  'binding_disabled',
  'ambiguous_binding',
  'trust_required',
  'condition_not_matched',
  'mapping_failed',
  'tool_not_found',
  'tool_disabled',
  'tool_version_changed',
  'permission_changed',
  'policy_blocked',
  'timeout',
  'transient_failure',
  'action_failed',
  'outcome_unknown',
] as const

export type HookErrorCodeV1 = (typeof HOOK_ERROR_CODES_V1)[number]

// ─── 预览（不执行真实动作）────────────────────────────────────────────────────

export interface HookPreviewRequestV1 {
  definition: HookDefinitionInputV1
  /** 样例事件信封；缺省时使用各事件的最小样例。 */
  sampleEnvelope?: HookEventEnvelopeV1
}

export interface HookPreviewResultV1 {
  valid: boolean
  errors: string[]
  conditionMatched: boolean
  mappedInput: Record<string, unknown>
  envelope: HookEventEnvelopeV1
}

// ─── 应用级总开关 ────────────────────────────────────────────────────────────

export interface HookSystemStatusV1 {
  /** false = 暂停新的自动执行（不回收已发生的外部副作用）。 */
  enabled: boolean
}

// ─── IPC 通道 ────────────────────────────────────────────────────────────────

export type HookDefinitionListRequest = { eventName?: HookEventNameV1 }
export type HookDefinitionListResponse = { definitions: HookDefinitionV1[] }

export type HookDefinitionCreateRequest = { definition: HookDefinitionInputV1 }
export type HookDefinitionCreateResponse = { definition: HookDefinitionV1 }

export type HookDefinitionUpdateRequest = { id: string; patch: Partial<HookDefinitionInputV1> }
export type HookDefinitionUpdateResponse = {
  definition: HookDefinitionV1
  /** 执行性字段变化导致授权失效的绑定数量（进入 needs_review）。 */
  invalidatedBindings: number
}

export type HookDefinitionDeleteRequest = { id: string }
export type HookDefinitionDeleteResponse = {
  deleted: boolean
  deletedBindings: number
  retainedRuns: number
}

export type HookDefinitionValidateRequest = { definition: HookDefinitionInputV1 }
export type HookDefinitionValidateResponse = {
  valid: boolean
  errors: string[]
  executionHash: string
}

export type HookBindingListRequest = {
  hookId?: string
  scopeKind?: HookScopeKindV1
  scopeId?: string
}
export type HookBindingListResponse = { bindings: HookBindingV1[] }

export type HookBindingUpsertRequest = { binding: HookBindingInputV1 }
export type HookBindingUpsertResponse = { binding: HookBindingV1 }

export type HookEffectiveListRequest = { sessionId: string }
export type HookEffectiveListResponse = { items: HookEffectiveBindingV1[] }

export type HookRunListRequest = {
  sessionId?: string
  hookId?: string
  status?: HookRunStatusV1
  eventId?: string
  eventName?: HookEventNameV1
  scopeKind?: HookScopeKindV1
  from?: string
  to?: string
  limit?: number
}
export type HookRunListResponse = { runs: HookRunV1[] }

export type HookRunGetRequest = { id: string }
export type HookRunGetResponse = { run: HookRunV1 | null }

export type HookRunRetryRequest = { id: string }
export type HookRunRetryResponse = { run: HookRunV1 | null }

export type HookRunCancelRequest = { id: string }
export type HookRunCancelResponse = { run: HookRunV1 | null }

export type HookSystemStatusGetRequest = Record<string, never>
export type HookSystemStatusGetResponse = HookSystemStatusV1

export type HookSystemEnabledSetRequest = { enabled: boolean }
export type HookSystemEnabledSetResponse = HookSystemStatusV1

export type HookPreviewRequest = HookPreviewRequestV1
export type HookPreviewResponse = HookPreviewResultV1

/**
 * 测试运行请求（设计方案 §14/§17）：展示完整动作与发送字段并经用户确认后调用；
 * 产生标记为 test 的独立运行记录，会产生真实外部副作用。
 */
export type HookTestRunRequest = HookPreviewRequestV1
export type HookTestRunResponse = { run: HookRunV1 }

/** 全部 hookV2 IPC 通道名（契约测试与渲染层封装共用）。 */
export const HOOK_V2_CHANNELS = [
  'hookV2:list-definitions',
  'hookV2:create-definition',
  'hookV2:update-definition',
  'hookV2:delete-definition',
  'hookV2:validate-definition',
  'hookV2:list-bindings',
  'hookV2:upsert-binding',
  'hookV2:list-effective',
  'hookV2:list-runs',
  'hookV2:get-run',
  'hookV2:retry-run',
  'hookV2:cancel-run',
  'hookV2:get-system-status',
  'hookV2:set-enabled',
  'hookV2:list-tool-candidates',
  'hookV2:preview',
  'hookV2:test-run',
] as const

/** 工具候选：按 Hook 风险策略给出可选工具与不可选原因（设计方案 §14）。 */
export interface HookToolCandidateV1 {
  target: HookToolTargetV1
  title: string
  risk: 'read' | 'low-write' | 'high-write' | 'destructive'
  effect: string
  idempotency: 'safe' | 'keyed' | 'unsafe'
  selectable: boolean
  unselectableReason?: string
}

export type HookToolCandidateListRequest = Record<string, never>
export type HookToolCandidateListResponse = { candidates: HookToolCandidateV1[] }

export interface HookV2IpcChannelMap {
  'hookV2:list-definitions': [HookDefinitionListRequest, HookDefinitionListResponse]
  'hookV2:create-definition': [HookDefinitionCreateRequest, HookDefinitionCreateResponse]
  'hookV2:update-definition': [HookDefinitionUpdateRequest, HookDefinitionUpdateResponse]
  'hookV2:delete-definition': [HookDefinitionDeleteRequest, HookDefinitionDeleteResponse]
  'hookV2:validate-definition': [HookDefinitionValidateRequest, HookDefinitionValidateResponse]
  'hookV2:list-bindings': [HookBindingListRequest, HookBindingListResponse]
  'hookV2:upsert-binding': [HookBindingUpsertRequest, HookBindingUpsertResponse]
  'hookV2:list-effective': [HookEffectiveListRequest, HookEffectiveListResponse]
  'hookV2:list-runs': [HookRunListRequest, HookRunListResponse]
  'hookV2:get-run': [HookRunGetRequest, HookRunGetResponse]
  'hookV2:retry-run': [HookRunRetryRequest, HookRunRetryResponse]
  'hookV2:cancel-run': [HookRunCancelRequest, HookRunCancelResponse]
  'hookV2:get-system-status': [HookSystemStatusGetRequest, HookSystemStatusGetResponse]
  'hookV2:set-enabled': [HookSystemEnabledSetRequest, HookSystemEnabledSetResponse]
  'hookV2:preview': [HookPreviewRequest, HookPreviewResponse]
  'hookV2:list-tool-candidates': [HookToolCandidateListRequest, HookToolCandidateListResponse]
  'hookV2:test-run': [HookTestRunRequest, HookTestRunResponse]
}

// ─── Zod Schema（IPC 运行时校验）────────────────────────────────────────────

const envelopeRefSchemas = {
  session: z.object({ id: z.string().min(1), title: z.string().optional() }).strict(),
  turn: z.object({ id: z.string().min(1) }).strict(),
  agent: z.object({ id: z.string().min(1), name: z.string().optional() }).strict(),
  workspace: z.object({ id: z.string().min(1), name: z.string().optional() }).strict(),
} as const

export const HookEventEnvelopeV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().min(1),
    eventName: HookEventNameV1Schema,
    occurredAt: z.string().min(1),
    source: z.literal('host'),
    session: envelopeRefSchemas.session,
    turn: envelopeRefSchemas.turn,
    agent: envelopeRefSchemas.agent.optional(),
    workspaces: z.array(envelopeRefSchemas.workspace),
    primaryWorkspaceId: z.string().min(1).optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()

const hookDefinitionInputSchemaShape = {
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
  eventName: HookEventNameV1Schema,
  condition: HookConditionV1Schema.optional(),
  action: HookActionV1Schema,
  inputMapping: z.record(z.string().min(1).max(120), HookValueExpressionV1Schema).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  retryPolicy: HookRetryPolicyV1Schema.partial().optional(),
  concurrencyPolicy: z.enum(['serial_per_session', 'parallel']).optional(),
} as const

export const HookV2IpcSchemaRegistry = {
  'hookV2:list-definitions': z.object({ eventName: HookEventNameV1Schema.optional() }).strict(),
  'hookV2:create-definition': z
    .object({ definition: z.object(hookDefinitionInputSchemaShape).strict() })
    .strict(),
  'hookV2:update-definition': z
    .object({
      id: z.string().min(1),
      patch: z.object(hookDefinitionInputSchemaShape).partial().strict(),
    })
    .strict(),
  'hookV2:delete-definition': z.object({ id: z.string().min(1) }).strict(),
  'hookV2:validate-definition': z
    .object({ definition: z.object(hookDefinitionInputSchemaShape).strict() })
    .strict(),
  'hookV2:list-bindings': z
    .object({
      hookId: z.string().min(1).optional(),
      scopeKind: z.enum(['application', 'workspace', 'agent', 'session']).optional(),
      scopeId: z.string().optional(),
    })
    .strict(),
  'hookV2:upsert-binding': z
    .object({
      binding: z
        .object({
          hookId: z.string().min(1),
          scopeKind: z.enum(['application', 'workspace', 'agent', 'session']),
          scopeId: z.string().optional(),
          enabled: z.boolean().optional(),
          authorizeExecutionHash: z.string().min(1).optional(),
          authorizedEffect: z.string().min(1).optional(),
        })
        .strict(),
    })
    .strict(),
  'hookV2:list-effective': z.object({ sessionId: z.string().min(1) }).strict(),
  'hookV2:list-runs': z
    .object({
      sessionId: z.string().min(1).optional(),
      hookId: z.string().min(1).optional(),
      status: z
        .enum([
          'queued',
          'running',
          'succeeded',
          'failed',
          'skipped',
          'blocked',
          'cancelled',
          'outcome_unknown',
        ])
        .optional(),
      eventId: z.string().min(1).optional(),
      eventName: HookEventNameV1Schema.optional(),
      scopeKind: z.enum(['application', 'workspace', 'agent', 'session']).optional(),
      from: z.string().min(1).optional(),
      to: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    })
    .strict(),
  'hookV2:get-run': z.object({ id: z.string().min(1) }).strict(),
  'hookV2:retry-run': z.object({ id: z.string().min(1) }).strict(),
  'hookV2:cancel-run': z.object({ id: z.string().min(1) }).strict(),
  'hookV2:get-system-status': z.object({}).strict(),
  'hookV2:set-enabled': z.object({ enabled: z.boolean() }).strict(),
  'hookV2:preview': z
    .object({
      definition: z.object(hookDefinitionInputSchemaShape).strict(),
      sampleEnvelope: HookEventEnvelopeV1Schema.optional(),
    })
    .strict(),
  'hookV2:list-tool-candidates': z.object({}).strict(),
  'hookV2:test-run': z
    .object({
      definition: z.object(hookDefinitionInputSchemaShape).strict(),
      sampleEnvelope: HookEventEnvelopeV1Schema.optional(),
    })
    .strict(),
} as const
