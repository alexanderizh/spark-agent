/**
 * @module execution-continuity
 *
 * 执行连续性（Execution Continuity）协议 — 长程任务断点继续的统一数据模型与 IPC 契约。
 *
 * 设计原则（对应方案 §5/§6/§8）：
 *   - Run / Step / Checkpoint / Effect / Wait / Outbox 六类持久对象构成执行子系统
 *   - 恢复等级 L0–L3 动态声明，禁止用单一开关掩盖能力差异
 *   - 副作用安全优先于自动恢复率：不能确认的步骤交给用户，绝不静默重跑
 *   - 所有跨进程契约（IPC、存储、运行时）共用本模块类型
 */

/* ------------------------------------------------------------------ */
/* 基础枚举与恢复等级                                                    */
/* ------------------------------------------------------------------ */

export type ExecutionRunKind =
  | 'turn'
  | 'goal'
  | 'workflow'
  | 'subagent'
  | 'scheduled'
  | 'subapp'
  | 'media'

export type ExecutionRunStatus =
  | 'accepted'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'waiting'
  | 'orphaned'
  | 'recovering'
  | 'needs_attention'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Run 级别的运行是否仍在执行中（未到终态、可能仍被恢复）。 */
export const ACTIVE_EXECUTION_RUN_STATUSES: readonly ExecutionRunStatus[] = [
  'accepted',
  'running',
  'pausing',
  'paused',
  'waiting',
  'orphaned',
  'recovering',
  'needs_attention',
] as const

/** Run 终态集合；终态不可回退。 */
export const TERMINAL_EXECUTION_RUN_STATUSES: readonly ExecutionRunStatus[] = [
  'completed',
  'failed',
  'cancelled',
] as const

export function isTerminalExecutionRunStatus(status: ExecutionRunStatus): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  )
}

export type RequestedRecoveryMode = 'auto' | 'confirm' | 'manual' | 'none'

/**
 * 恢复等级（方案 §4.3）：
 *   L0 = 无恢复（只能看到中断事实）
 *   L1 = fresh recovery（continuity capsule / 摘要续跑，精确上下文不可保证）
 *   L2 = 精确上下文恢复（native resume 可验证）
 *   L3 = L2 + 副作用不被静默重复（工具级 exactly-once / 可查询调和）
 */
export type RecoveryLevel = 0 | 1 | 2 | 3

export type RuntimeAdapterKind =
  | 'claude'
  | 'codex'
  | 'spark-engine'
  | 'workflow'
  | 'goal'
  | 'media-task'
  | 'subapp-job'
  | 'scheduled'

/* ------------------------------------------------------------------ */
/* execution_runs                                                      */
/* ------------------------------------------------------------------ */

export interface ExecutionRunRecord {
  id: string
  sessionId: string | null
  rootTurnId: string | null
  parentRunId: string | null
  parentStepId: string | null
  kind: ExecutionRunKind
  status: ExecutionRunStatus
  requestedRecoveryMode: RequestedRecoveryMode
  /** 当前 Runtime 不考虑具体工具时的最高恢复等级。 */
  capabilityCeiling: RecoveryLevel
  /** 截至当前步骤仍然成立的最低保证；只能单调下降。 */
  currentGuaranteedLevel: RecoveryLevel
  /** 输入载荷的内容寻址引用（表内存 digest，正文进 artifact/事件流）。 */
  inputRef: string
  runtimeKind: RuntimeAdapterKind | string
  runtimeBindingJson: unknown
  definitionFingerprint: string
  latestCheckpointId: string | null
  latestRecoveryPlanId: string | null
  leaseOwner: string | null
  leaseEpoch: number
  leaseExpiresAt: string | null
  heartbeatAt: string | null
  attempt: number
  interruptionReason: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

/** 创建 Run 的输入（仓储层补齐默认值与时间戳）。 */
export interface ExecutionRunCreateParams {
  id: string
  sessionId?: string | null
  rootTurnId?: string | null
  parentRunId?: string | null
  parentStepId?: string | null
  kind: ExecutionRunKind
  requestedRecoveryMode?: RequestedRecoveryMode
  capabilityCeiling?: RecoveryLevel
  currentGuaranteedLevel?: RecoveryLevel
  inputRef?: string
  runtimeKind: RuntimeAdapterKind | string
  runtimeBindingJson?: unknown
  definitionFingerprint?: string
  attempt?: number
}

/* ------------------------------------------------------------------ */
/* execution_steps                                                     */
/* ------------------------------------------------------------------ */

export type ExecutionStepKind =
  | 'model'
  | 'tool'
  | 'subagent'
  | 'workflow_node'
  | 'approval'
  | 'artifact'
  | 'goal_iteration'
  | 'wait'

export type ExecutionStepStatus =
  | 'planned'
  | 'running'
  | 'committed'
  | 'waiting'
  | 'failed'
  | 'cancelled'
  | 'uncertain'

export interface ExecutionStepRecord {
  id: string
  runId: string
  stableKey: string
  parentStepId: string | null
  kind: ExecutionStepKind
  status: ExecutionStepStatus
  attempt: number
  inputHash: string | null
  resultRef: string | null
  replayPolicy: ToolReplayPolicy | null
  startedAt: string | null
  committedAt: string | null
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ */
/* execution_checkpoints                                               */
/* ------------------------------------------------------------------ */

export type CheckpointReason =
  | 'accepted'
  | 'step_committed'
  | 'waiting'
  | 'shutdown'
  | 'error'
  | 'manual'

/** 版本化 Checkpoint 信封（方案 §6.3）。 */
export interface ExecutionCheckpointV1 {
  schemaVersion: 1
  checkpointId: string
  runId: string
  sequence: number
  reason: CheckpointReason
  cursor: {
    phase: string
    nextStepKey?: string | undefined
    graphNodeId?: string | undefined
    goalIteration?: number | undefined
  }
  /** 逻辑状态（capsule / 摘要 / 游标补充材料）的内容寻址引用。 */
  logicalStateRef: string
  /** 本 Checkpoint 覆盖到的会话事件 seq 水位。 */
  messageWaterline: number
  runtimeBinding: {
    engine: string
    providerProfileId?: string | undefined
    modelId?: string | undefined
    nativeSessionId?: string | undefined
    nativeThreadId?: string | undefined
  }
  openWaitIds: string[]
  workspaceSnapshotSetId?: string | undefined
  definitionFingerprint: string
  checksum: string
  createdAt: string
}

export interface ExecutionCheckpointRow {
  id: string
  run_id: string
  sequence: number
  reason: CheckpointReason
  envelope_json: string
  checksum: string
  created_at: string
}

/* ------------------------------------------------------------------ */
/* execution_effects                                                   */
/* ------------------------------------------------------------------ */

export type ToolReplayPolicy = 'safe' | 'query_then_resume' | 'confirm' | 'never'

export type ToolSideEffectClass =
  | 'none'
  | 'workspace'
  | 'external_reversible'
  | 'external_irreversible'

export type ExecutionEffectPhase =
  | 'prepared'
  | 'dispatching'
  | 'confirmed'
  | 'failed'
  | 'unknown'
  | 'compensated'

export interface ExecutionEffectRecord {
  id: string
  runId: string
  stepId: string
  toolName: string
  toolVersion: string
  toolCallId: string
  requestHash: string
  idempotencyKey: string | null
  replayPolicy: ToolReplayPolicy
  phase: ExecutionEffectPhase
  externalReceiptRef: string | null
  resultRef: string | null
  createdAt: string
  updatedAt: string
}

/** 工具恢复能力声明（方案 §8.1），未声明的第三方工具采用保守默认。 */
export interface ToolRecoveryPolicy {
  sideEffect: ToolSideEffectClass
  replayPolicy: ToolReplayPolicy
  supportsIdempotencyKey: boolean
  supportsStatusQuery: boolean
  supportsCompensation: boolean
  definitionVersion: string
}

export const CONSERVATIVE_TOOL_RECOVERY_POLICY: ToolRecoveryPolicy = {
  sideEffect: 'external_irreversible',
  replayPolicy: 'confirm',
  supportsIdempotencyKey: false,
  supportsStatusQuery: false,
  supportsCompensation: false,
  definitionVersion: 'unknown',
} as const

/* ------------------------------------------------------------------ */
/* execution_waits                                                     */
/* ------------------------------------------------------------------ */

export type ExecutionWaitType = 'question' | 'permission' | 'plan' | 'external_callback'

export type ExecutionWaitStatus = 'open' | 'answered' | 'denied' | 'expired' | 'cancelled'

export interface ExecutionWaitRecord {
  id: string
  runId: string
  stepId: string | null
  type: ExecutionWaitType
  status: ExecutionWaitStatus
  /** schema 化请求（已脱敏）。 */
  requestJson: unknown
  answerJson: unknown
  deadlineAt: string | null
  answeredAt: string | null
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ */
/* execution_outbox                                                    */
/* ------------------------------------------------------------------ */

export type ExecutionOutboxEventType =
  | 'run_accepted'
  | 'run_status_changed'
  | 'checkpoint_committed'
  | 'wait_opened'
  | 'wait_answered'
  | 'run_recovered'
  | 'run_needs_attention'
  | 'effect_reconciled'
  | 'workflow_graph_drift'

export interface ExecutionOutboxEventRow {
  id: string
  run_id: string
  event_type: ExecutionOutboxEventType
  payload_json: string
  published_at: string | null
  created_at: string
}

/* ------------------------------------------------------------------ */
/* 恢复计划                                                            */
/* ------------------------------------------------------------------ */

export type RecoveryDecision =
  | 'auto_resume'
  | 'needs_confirmation'
  | 'cannot_resume'

export type RecoveryPlanStatus =
  | 'proposed'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'superseded'

export interface RecoveryStepDecision {
  stepKey: string
  action:
    | 'skip_already_committed'
    | 'replay_safe'
    | 'query_external_then_resume'
    | 'require_user_confirmation'
    | 'mark_unknown'
    | 'cancel_not_dispatched'
  reason: string
}

export interface RecoveryPlanV1 {
  schemaVersion: 1
  planId: string
  runId: string
  checkpointId: string | null
  environmentFingerprint: string
  decision: RecoveryDecision
  /** 实际可用的恢复等级与降级原因。 */
  achievedLevel: RecoveryLevel
  degradationReasons: string[]
  stepDecisions: RecoveryStepDecision[]
  /** auto_resume 使用的恢复方式。 */
  recoveryMethod: 'native_resume' | 'continuity_capsule' | 'fresh_context' | 'poll_external' | 'none'
  plannerVersion: string
  createdAt: string
}

export interface ExecutionRecoveryPlanRow {
  id: string
  run_id: string
  checkpoint_id: string | null
  environment_fingerprint: string
  decision: RecoveryDecision
  plan_json: string
  status: RecoveryPlanStatus
  created_at: string
  updated_at: string
}

/* ------------------------------------------------------------------ */
/* Supervisor / Adapter 契约                                           */
/* ------------------------------------------------------------------ */

/** Runtime Adapter 能力声明（方案 §5.1）。 */
export interface RuntimeAdapterDeclaration {
  kind: RuntimeAdapterKind | string
  capabilityCeiling: RecoveryLevel
  /** 是否支持原生会话续接（L2 基础）。 */
  supportsNativeResume: boolean
}

/** 启动扫描结果摘要（供恢复中心与启动提示）。 */
export interface StartupScanSummary {
  scannedAt: string
  totalActiveRuns: number
  autoResumed: number
  needsAttention: number
  cannotRecover: number
  mediaTasksPolling: number
  runIds: string[]
}

/* ------------------------------------------------------------------ */
/* IPC 契约（恢复中心）                                                 */
/* ------------------------------------------------------------------ */

export interface ExecutionRunSummary {
  id: string
  sessionId: string | null
  rootTurnId: string | null
  kind: ExecutionRunKind
  status: ExecutionRunStatus
  runtimeKind: string
  requestedRecoveryMode: RequestedRecoveryMode
  capabilityCeiling: RecoveryLevel
  currentGuaranteedLevel: RecoveryLevel
  latestCheckpointId: string | null
  latestCheckpointAt: string | null
  attempt: number
  interruptionReason: string | null
  createdAt: string
  updatedAt: string
  /** 汇总计数（详情列表共用）。 */
  stepCounts: {
    committed: number
    running: number
    uncertain: number
    waiting: number
    planned: number
  }
  effectCounts: {
    confirmed: number
    dispatching: number
    unknown: number
    prepared: number
  }
  openWaits: number
}

export interface ExecutionListRunsRequest {
  /** 只返回非终态 Run；默认 false（恢复中心关注活跃与最近中断）。 */
  activeOnly?: boolean
  kind?: ExecutionRunKind
  sessionId?: string
  limit?: number
}

export interface ExecutionListRunsResponse {
  runs: ExecutionRunSummary[]
}

export interface ExecutionGetRunDetailRequest {
  runId: string
}

export interface ExecutionRunDetail {
  run: ExecutionRunSummary
  steps: Array<{
    id: string
    stableKey: string
    kind: ExecutionStepKind
    status: ExecutionStepStatus
    attempt: number
    startedAt: string | null
    committedAt: string | null
  }>
  effects: Array<{
    id: string
    stepId: string
    toolName: string
    replayPolicy: ToolReplayPolicy
    phase: ExecutionEffectPhase
    externalReceiptRef: string | null
    updatedAt: string
  }>
  waits: Array<{
    id: string
    type: ExecutionWaitType
    status: ExecutionWaitStatus
    createdAt: string
    answeredAt: string | null
  }>
  checkpoints: Array<{
    id: string
    sequence: number
    reason: CheckpointReason
    createdAt: string
  }>
  latestPlan: {
    id: string
    decision: RecoveryDecision
    achievedLevel: RecoveryLevel
    degradationReasons: string[]
    recoveryMethod: string
    createdAt: string
  } | null
}

export interface ExecutionGetRunDetailResponse {
  detail: ExecutionRunDetail | null
}

export type ExecutionResolveAction =
  | 'safe_continue'
  | 'confirm_unknown_effects'
  | 'restart_from_checkpoint'
  | 'abandon_keep_state'
  | 'cancel_run'

export interface ExecutionResolveRunRequest {
  runId: string
  action: ExecutionResolveAction
}

export interface ExecutionResolveRunResponse {
  ok: boolean
  message: string
  /** 处理后的 Run 状态。 */
  status: ExecutionRunStatus | null
}

export interface ExecutionGetStartupSummaryRequest {
  since?: string
}

export interface ExecutionGetStartupSummaryResponse {
  summary: StartupScanSummary | null
}

export interface ExecutionExportDiagnosticsRequest {
  runId: string
}

export interface ExecutionExportDiagnosticsResponse {
  /** 脱敏后的诊断 JSON 文本（调用方负责写盘）。 */
  diagnostics: string
}

export interface ExecutionContinuityConfig {
  /** 功能开关：false 时整体退回旧终止语义（方案 §15）。 */
  enabled: boolean
  /** 租约时长（ms）。 */
  leaseDurationMs: number
  /** 心跳间隔（ms）。 */
  heartbeatIntervalMs: number
  /** drain 有界等待（ms）。 */
  drainTimeoutMs: number
  /** 自动恢复的 Run kind 白名单（灰度）。 */
  autoRecoveryKinds: ExecutionRunKind[]
}

export interface ExecutionGetConfigRequest {
  _?: never
}

export interface ExecutionGetConfigResponse {
  config: ExecutionContinuityConfig
}

export interface ExecutionSetConfigRequest {
  config: Partial<ExecutionContinuityConfig>
}

export interface ExecutionSetConfigResponse {
  config: ExecutionContinuityConfig
}

/* ------------------------------------------------------------------ */
/* IPC 通道表                                                          */
/* ------------------------------------------------------------------ */

export interface ExecutionContinuityIpcChannelMap {
  'execution:list-runs': [ExecutionListRunsRequest, ExecutionListRunsResponse]
  'execution:get-run-detail': [ExecutionGetRunDetailRequest, ExecutionGetRunDetailResponse]
  'execution:resolve-run': [ExecutionResolveRunRequest, ExecutionResolveRunResponse]
  'execution:get-startup-summary': [
    ExecutionGetStartupSummaryRequest,
    ExecutionGetStartupSummaryResponse,
  ]
  'execution:export-diagnostics': [
    ExecutionExportDiagnosticsRequest,
    ExecutionExportDiagnosticsResponse,
  ]
  'execution:get-config': [ExecutionGetConfigRequest, ExecutionGetConfigResponse]
  'execution:set-config': [ExecutionSetConfigRequest, ExecutionSetConfigResponse]
}
