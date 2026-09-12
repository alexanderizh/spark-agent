import type { HookErrorCodeV1 } from '@spark/protocol'
import {
  HookBindingRepository,
  HookDefinitionRepository,
  HookEventRepository,
  HookRunRepository,
  type SparkDatabase,
} from '@spark/storage'
import {
  HookActionExecutor,
  type HookBuiltinActionHandlers,
  type HookExecutionOutcome,
  type HookToolGateway,
} from './hook-action-executor.js'
import {
  checkExecutionPolicy,
  isTransientErrorCode,
  type ToolGovernanceInfo,
} from './hook-action-policy.js'
import { deriveIdempotencyKey, evaluateInputMapping, HookMappingError } from './hook-expression.js'
import { summarizeValue } from './hook-redaction.js'

/**
 * HookWorker（设计方案 §5/§10/§12）：短租约领取 queued 运行，调用前对定义、绑定与
 * 工具治理信息做最终复核，执行动作并按重试策略回收。
 *
 * - Hook 失败不改变已发生的事件事实，也不向 Agent 追加错误消息（失败隔离）。
 * - 复核不一致 → blocked/trust_required 等；映射失败 → failed/mapping_failed，不调用动作。
 * - keyed 重试由宿主注入稳定幂等键；工具未声明幂等支持时降级为不自动重试。
 * - outcome_unknown 是终态：不自动恢复、不自动重投，仅允许用户显式重试。
 */

export interface HookWorkerOptions {
  owner: string
  builtins: HookBuiltinActionHandlers
  toolGateway: HookToolGateway
  leaseMs?: number
  pollIntervalMs?: number
  /** 应用级总开关：关闭后停止领取新的自动执行。 */
  isEnabled: () => boolean
  /** 产品策略：是否允许 high-write 工具（默认 false）。 */
  allowHighWrite?: () => boolean
  onRunFinished?: (runId: string, status: string) => void
}

const DEFAULT_LEASE_MS = 5 * 60_000
const DEFAULT_POLL_INTERVAL_MS = 2_000
/** 单个运行连续失败自动暂停阈值（连续 blocked/failed 后进入 needs_review 提示）。 */
const CONSECUTIVE_FAILURE_PAUSE_THRESHOLD = 5

export class HookWorker {
  private readonly runs: HookRunRepository
  private readonly definitions: HookDefinitionRepository
  private readonly bindings: HookBindingRepository
  private readonly events: HookEventRepository
  private readonly executor: HookActionExecutor
  private readonly owner: string
  private readonly leaseMs: number
  private readonly pollIntervalMs: number
  private readonly toolGateway: HookToolGateway
  private readonly isEnabled: () => boolean
  private readonly allowHighWrite: () => boolean
  private readonly onRunFinished: ((runId: string, status: string) => void) | undefined
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private readonly runningRuns = new Map<string, AbortController>()

  constructor(
    private readonly db: SparkDatabase,
    options: HookWorkerOptions,
  ) {
    this.runs = new HookRunRepository(db)
    this.definitions = new HookDefinitionRepository(db)
    this.bindings = new HookBindingRepository(db)
    this.events = new HookEventRepository(db)
    this.owner = options.owner
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.isEnabled = options.isEnabled
    this.allowHighWrite = options.allowHighWrite ?? (() => false)
    this.onRunFinished = options.onRunFinished
    this.toolGateway = options.toolGateway
    this.executor = new HookActionExecutor(options.builtins, options.toolGateway)
  }

  /** 应用启动时的崩溃恢复：事件租约回 pending，过期 running 进入 outcome_unknown。 */
  recoverOnStartup(): { requeuedEvents: number; unknownRuns: number } {
    return {
      requeuedEvents: this.events.requeueExpiredLeases(),
      unknownRuns: this.runs.recoverExpiredLeasesToOutcomeUnknown(),
    }
  }

  start(): void {
    if (this.timer != null) return
    this.timer = setInterval(() => {
      void this.tickLoop()
    }, this.pollIntervalMs)
    this.timer.unref?.()
    void this.tickLoop()
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
    // 尽力取消运行中动作；无法确认结果的运行进入 outcome_unknown。
    for (const controller of this.runningRuns.values()) {
      controller.abort()
    }
  }

  private async tickLoop(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      for (let i = 0; i < 16; i += 1) {
        const processed = await this.tickOnce()
        if (!processed) break
      }
    } finally {
      this.busy = false
    }
  }

  /** 领取并执行一条运行。返回是否处理了运行（false = 没有可执行任务）。 */
  async tickOnce(): Promise<boolean> {
    if (!this.isEnabled()) return false
    const run = this.runs.claimNextRunnable(this.owner, this.leaseMs)
    if (run == null) return false

    const outcome = await this.executeRun(run)
    this.onRunFinished?.(run.id, outcome.status)
    return true
  }

  private async executeRun(
    run: Awaited<ReturnType<HookRunRepository['claimNextRunnable']>>,
  ): Promise<{ status: string }> {
    if (run == null) return { status: 'noop' }
    const definition = this.definitions.get(run.hookId)
    const binding = this.bindings.get(run.bindingId)

    // ── 调用前最终复核（强制兜底）────────────────────────────────────────────
    if (definition == null || binding == null) {
      this.runs.finish(run.id, {
        status: 'blocked',
        errorCode: 'binding_disabled',
        errorMessage: '定义或绑定已不存在',
      })
      return { status: 'blocked' }
    }
    let toolGovernance: ToolGovernanceInfo | null = null
    if (definition.action.type === 'tool.invoke') {
      toolGovernance = await this.describeTool(definition.action.target)
    }
    const policy = checkExecutionPolicy({
      definition,
      binding,
      tool: toolGovernance,
      allowHighWrite: this.allowHighWrite(),
    })
    if (!policy.allowed) {
      this.runs.finish(run.id, {
        status: 'blocked',
        ...(policy.errorCode != null ? { errorCode: policy.errorCode } : {}),
        ...(policy.message != null ? { errorMessage: policy.message } : {}),
        inputSummary: summarizeValue({ reason: policy.message ?? 'policy check failed' }),
      })
      this.maybePauseBindingAfterFailures(run.hookId, run.bindingId)
      return { status: 'blocked' }
    }

    // ── 映射评估：失败不得调用动作 ─────────────────────────────────────────
    let mappedInput: Record<string, unknown>
    try {
      mappedInput = evaluateInputMapping(run.envelope, definition.inputMapping)
    } catch (error) {
      const message = error instanceof HookMappingError ? error.message : String(error)
      this.runs.finish(run.id, {
        status: 'failed',
        errorCode: 'mapping_failed',
        errorMessage: message,
        inputSummary: summarizeValue({ error: message }),
      })
      return { status: 'failed' }
    }

    // ── keyed 幂等键 ────────────────────────────────────────────────────────
    let idempotencyKey: string | undefined
    if (definition.retryPolicy.mode === 'keyed') {
      const declared = toolGovernance?.idempotency
      // 目标工具未声明可验证的幂等支持时降级为 unsafe（不自动重试）。
      idempotencyKey =
        declared === 'keyed' ? deriveIdempotencyKey(definition, run.envelope.eventId) : undefined
    }

    // ── 执行 ────────────────────────────────────────────────────────────────
    const controller = new AbortController()
    this.runningRuns.set(run.id, controller)
    let outcome: HookExecutionOutcome
    try {
      outcome = await this.executor.execute({
        runId: run.id,
        definition,
        envelope: run.envelope,
        mappedInput,
        ...(idempotencyKey != null ? { idempotencyKey } : {}),
        signal: controller.signal,
      })
    } finally {
      this.runningRuns.delete(run.id)
    }

    const errorCode = (outcome.errorCode ?? 'action_failed') as HookErrorCodeV1
    const attemptCount = run.attemptCount
    const abortedUnknown = outcome.errorCode === 'outcome_unknown'
    if (abortedUnknown) {
      // 无法确认结果：终态 outcome_unknown，不自动恢复、不自动重投。
      this.runs.finish(run.id, {
        status: 'outcome_unknown',
        errorCode: 'outcome_unknown',
        errorMessage: outcome.errorMessage ?? '动作被取消且结果无法确认',
        mappedInput,
        inputSummary: summarizeValue(mappedInput),
        ...(outcome.outputSummary != null ? { outputSummary: outcome.outputSummary } : {}),
      })
      return { status: 'outcome_unknown' }
    }
    if (outcome.status === 'succeeded') {
      this.runs.finish(run.id, {
        status: 'succeeded',
        mappedInput,
        inputSummary: summarizeValue(mappedInput),
        ...(outcome.outputSummary != null ? { outputSummary: outcome.outputSummary } : {}),
        ...(outcome.invocationId != null ? { invocationId: outcome.invocationId } : {}),
        ...(outcome.correlationId != null ? { correlationId: outcome.correlationId } : {}),
      })
      return { status: 'succeeded' }
    }

    // ── 重试判定 ────────────────────────────────────────────────────────────
    const transient = isTransientErrorCode(errorCode)
    const canAutoRetry =
      definition.retryPolicy.mode !== 'unsafe' &&
      (definition.retryPolicy.mode === 'safe' ? transient : idempotencyKey != null && transient) &&
      attemptCount < definition.retryPolicy.maxAttempts
    if (canAutoRetry) {
      const backoffMs =
        definition.retryPolicy.backoffMs * Math.pow(2, Math.max(0, attemptCount - 1))
      this.runs.requeueForAutoRetry(
        run.id,
        new Date(Date.now() + backoffMs).toISOString(),
        errorCode,
        outcome.errorMessage ?? 'transient failure',
      )
      return { status: 'retry_scheduled' }
    }

    this.runs.finish(run.id, {
      status: 'failed',
      errorCode,
      ...(outcome.errorMessage != null ? { errorMessage: outcome.errorMessage } : {}),
      mappedInput,
      inputSummary: summarizeValue(mappedInput),
      ...(outcome.outputSummary != null ? { outputSummary: outcome.outputSummary } : {}),
      ...(outcome.invocationId != null ? { invocationId: outcome.invocationId } : {}),
      ...(outcome.correlationId != null ? { correlationId: outcome.correlationId } : {}),
    })
    return { status: 'failed' }
  }

  private async describeTool(target: {
    sourceKind: 'connector' | 'custom-tool' | 'tool-package'
    sourceId: string
    version?: string
    toolName: string
    qualifiedName: string
  }): Promise<ToolGovernanceInfo | null> {
    const described = await this.toolGateway.describeTool(target)
    if (!described.found || described.governance == null) return null
    return {
      risk: described.governance.risk,
      effect: described.governance.effect,
      enabled: described.governance.enabled,
      idempotency: described.governance.idempotency,
      ...(described.governance.version != null ? { version: described.governance.version } : {}),
    }
  }

  private maybePauseBindingAfterFailures(hookId: string, bindingId: string): void {
    const recent = this.runs.list({ hookId, limit: CONSECUTIVE_FAILURE_PAUSE_THRESHOLD })
    if (recent.length < CONSECUTIVE_FAILURE_PAUSE_THRESHOLD) return
    const allBlockedOrFailed = recent.every(
      (item) => item.status === 'blocked' || item.status === 'failed',
    )
    if (allBlockedOrFailed) {
      const binding = this.bindings.get(bindingId)
      if (binding != null && binding.state === 'active') {
        this.bindings.updateState(bindingId, 'needs_review')
        console.warn(
          `[hooks-v2] hook ${hookId} binding ${bindingId} paused (needs_review) after repeated failures`,
        )
      }
    }
  }
}
