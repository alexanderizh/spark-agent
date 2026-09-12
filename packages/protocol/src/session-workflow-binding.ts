import { z } from 'zod'

export const SessionWorkflowBindingModeSchema = z.enum(['inherit', 'override', 'disabled'])
export type SessionWorkflowBindingMode = z.infer<typeof SessionWorkflowBindingModeSchema>

const BindingIdSchema = z.string().trim().min(1).max(200)

export const SessionWorkflowBindingCreateSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }).strict(),
  z.object({ mode: z.literal('disabled') }).strict(),
  z.object({ mode: z.literal('override'), workflowId: BindingIdSchema }).strict(),
])
export type SessionWorkflowBindingCreate = z.infer<typeof SessionWorkflowBindingCreateSchema>

export interface SessionWorkflowBinding {
  sessionId: string
  bindingInstanceId: string
  mode: SessionWorkflowBindingMode
  workflowId: string | null
  createdAt: string
  updatedAt: string
}

export type WorkflowExecutionSource =
  | 'legacy-agent'
  | 'session-inherit'
  | 'session-override'
  | 'session-disabled'
  | 'none'

export interface EffectiveWorkflowSummary {
  source: WorkflowExecutionSource
  bindingInstanceId: string | null
  hostAgentId: string
  workflowId: string | null
  workflowName: string | null
  workflowVersion: string | null
  workflowStatus: 'draft' | 'active' | 'archived' | null
  workflowEnabled: boolean | null
  executionMode: 'workflow_run' | 'codex_guided' | 'guided' | 'none'
}

export interface WorkflowRunSummary {
  id: string
  workflowId: string
  status: 'working' | 'completed' | 'failed' | 'canceled'
  objective: string
  startedAt: string
  updatedAt: string
  endedAt: string | null
  graphDigest?: string | null
}

export type BindingChangeBlockerCode =
  | 'session_busy'
  | 'turn_queue_not_empty'
  | 'approval_pending'
  | 'question_pending'
  | 'goal_active'
  | 'workflow_run_working'
  | 'binding_conflict'

export interface BindingChangeBlocker {
  code: BindingChangeBlockerCode
  nodeId?: string
  dependencyId?: string
  params?: Record<string, string | number | boolean>
}

export type WorkflowPreflightIssueCode =
  | 'workflow_not_found'
  | 'workflow_disabled'
  | 'workflow_not_active'
  | 'workflow_run_snapshot_invalid'
  | 'graph_cycle'
  | 'invalid_condition_reference'
  | 'invalid_loop_body'
  | 'unsupported_node_kind'
  | 'missing_agent'
  | 'disabled_agent'
  | 'missing_required_skill'
  | 'missing_required_tool'
  | 'missing_required_mcp'

export type WorkflowPreflightWarningCode =
  | 'provider_uses_host_fallback'
  | 'optional_mcp_unavailable'
  | 'workflow_archived_for_existing_binding'
  | 'definition_newer_than_resumable_run'
  | 'bundle_dependency_unresolved'

export interface WorkflowPreflightIssue {
  code: WorkflowPreflightIssueCode | WorkflowPreflightWarningCode
  nodeId?: string
  dependencyId?: string
  params?: Record<string, string | number | boolean>
}

export interface SessionGetWorkflowBindingRequest {
  sessionId: string
}

export interface SessionGetWorkflowBindingResponse {
  binding: SessionWorkflowBinding | null
  effective: EffectiveWorkflowSummary
  resumableRun: WorkflowRunSummary | null
  canChange: boolean
  changeBlockers: BindingChangeBlocker[]
  features: {
    writeEnabled: boolean
    runtimeRequested: boolean
    runtimeEnabled: boolean
  }
}

export type SessionSetWorkflowBindingRequest =
  | {
      sessionId: string
      mode: 'inherit' | 'disabled'
      expectedBindingInstanceId: string | null
    }
  | {
      sessionId: string
      mode: 'override'
      workflowId: string
      expectedBindingInstanceId: string | null
    }

export interface SessionSetWorkflowBindingResponse {
  binding: SessionWorkflowBinding | null
  effective: EffectiveWorkflowSummary
  resumableRun: WorkflowRunSummary | null
  changed: boolean
  error: BindingChangeBlocker | null
  preflight: {
    ok: boolean
    issues: WorkflowPreflightIssue[]
    warnings: WorkflowPreflightIssue[]
  }
}

/**
 * 「放弃并新建运行」：放弃当前 Binding 代次中最后一个 failed Run。
 *
 * 语义（方案 §7.3）：旧 Run 标记 canceled（历史保留），Binding 轮换新代次，
 * 下一次 workflow_run 调用将新建 Run。expectedBindingInstanceId 是乐观锁；
 * runId 是 UI 确认弹窗看到的失败 Run，状态漂移时返回 binding_conflict。
 */
export interface SessionAbandonWorkflowRunRequest {
  sessionId: string
  expectedBindingInstanceId: string
  runId: string
}

export interface SessionAbandonWorkflowRunResponse {
  binding: SessionWorkflowBinding | null
  effective: EffectiveWorkflowSummary
  resumableRun: WorkflowRunSummary | null
  /** 被放弃的 Run；未发生放弃（错误或无 Run 可放弃）时为 null。 */
  abandonedRunId: string | null
  changed: boolean
  error: BindingChangeBlocker | null
}

const expectedBindingInstanceId = BindingIdSchema.nullable()

export const SessionWorkflowBindingIpcSchemaRegistry = {
  'session:get-workflow-binding': z.object({ sessionId: BindingIdSchema }).strict(),
  'session:set-workflow-binding': z.discriminatedUnion('mode', [
    z
      .object({
        sessionId: BindingIdSchema,
        mode: z.literal('inherit'),
        expectedBindingInstanceId,
      })
      .strict(),
    z
      .object({
        sessionId: BindingIdSchema,
        mode: z.literal('disabled'),
        expectedBindingInstanceId,
      })
      .strict(),
    z
      .object({
        sessionId: BindingIdSchema,
        mode: z.literal('override'),
        workflowId: BindingIdSchema,
        expectedBindingInstanceId,
      })
      .strict(),
  ]),
  'session:abandon-workflow-run': z
    .object({
      sessionId: BindingIdSchema,
      expectedBindingInstanceId: BindingIdSchema,
      runId: BindingIdSchema,
    })
    .strict(),
} as const

export interface SessionWorkflowBindingIpcChannelMap {
  'session:get-workflow-binding': [
    SessionGetWorkflowBindingRequest,
    SessionGetWorkflowBindingResponse,
  ]
  'session:set-workflow-binding': [
    SessionSetWorkflowBindingRequest,
    SessionSetWorkflowBindingResponse,
  ]
  'session:abandon-workflow-run': [
    SessionAbandonWorkflowRunRequest,
    SessionAbandonWorkflowRunResponse,
  ]
}
