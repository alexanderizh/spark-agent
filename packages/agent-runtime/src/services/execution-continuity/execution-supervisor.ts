/**
 * @module execution-supervisor
 *
 * ExecutionSupervisor — 统一接收任务、领取租约、心跳、协作式暂停、
 * 启动扫描和恢复调度（方案 §5.1/§9/§10）。
 *
 * Phase 1 范围（方案 §14-Phase 1）：
 *   - turn_runs 接入：accepted 可重放；running → orphaned → 恢复规划，不再直接失败
 *   - 心跳 + lease epoch + 启动扫描 + drain shutdown + durable outbox
 *   - L1 自动继续仅限「尚未开始执行」或「可证明未派发任何副作用」的 Run
 *   - 媒体异步任务以 query_then_resume 接入（恢复只轮询，不重新 submit）
 */

import crypto from 'node:crypto'
import {
  ExecutionCheckpointRepository,
  ExecutionEffectRepository,
  ExecutionOutboxRepository,
  ExecutionRecoveryPlanRepository,
  ExecutionRunRepository,
  ExecutionStepRepository,
  ExecutionWaitRepository,
  MediaGenerationTaskRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type {
  ExecutionEffectPhase,
  ExecutionRunKind,
  ExecutionRunRecord,
  ExecutionRunStatus,
  ExecutionRunSummary,
  ExecutionStepKind,
  ExecutionStepStatus,
  RecoveryLevel,
  RecoveryPlanV1,
  StartupScanSummary,
  ToolReplayPolicy,
} from '@spark/protocol'
import { ACTIVE_EXECUTION_RUN_STATUSES, isTerminalExecutionRunStatus } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { CheckpointWriter } from './checkpoint-writer.js'
import { EffectJournal } from './effect-journal.js'
import { RecoveryPlanner } from './recovery-planner.js'
import {
  getExecutionContinuityConfig,
  type DEFAULT_EXECUTION_CONTINUITY_CONFIG,
} from './execution-continuity-config.js'
import { inspectTurnSideEffects } from './turn-side-effect-inspector.js'
import { ADAPTER_DECLARATIONS, supportsNativeResumeFor } from './adapters/index.js'

const log = createLogger('execution-continuity.supervisor')

export interface TurnRecoveryDelegate {
  /** 会话是否存在可用的 continuity capsule（L1 恢复材料）。 */
  hasContinuityCapsule(sessionId: string): boolean
  /** 为 auto_resume 决策的 Turn Run 创建恢复 Turn（由 SessionService 排队执行）。 */
  resumeTurnRun(run: ExecutionRunRecord, plan: RecoveryPlanV1): void
  /** 恢复中心「安全继续」goal Run：重新泵迭代循环（Phase 3B）。 */
  resumeGoalLoop(sessionId: string): boolean
  /** 当前会话的引擎环境摘要（供环境校验）。 */
  environmentFor(run: ExecutionRunRecord): {
    engine: string
    providerProfileId?: string | undefined
    modelId?: string | undefined
    definitionFingerprint?: string | undefined
  }
}

interface OwnedLease {
  owner: string
  epoch: number
}

export class ExecutionSupervisor {
  private readonly runRepo: ExecutionRunRepository
  private readonly stepRepo: ExecutionStepRepository
  private readonly checkpointRepo: ExecutionCheckpointRepository
  private readonly effectRepo: ExecutionEffectRepository
  private readonly waitRepo: ExecutionWaitRepository
  private readonly outboxRepo: ExecutionOutboxRepository
  private readonly planRepo: ExecutionRecoveryPlanRepository
  private readonly checkpointWriter: CheckpointWriter
  private readonly planner: RecoveryPlanner
  private readonly effectJournal: EffectJournal

  private readonly workerOwner = `worker_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
  private readonly ownedLeases = new Map<string, OwnedLease>()
  private heartbeatTimer: NodeJS.Timeout | null = null
  private draining = false
  private lastScanSummary: StartupScanSummary | null = null
  private turnDelegate: TurnRecoveryDelegate | null = null

  constructor(private readonly db: SparkDatabase) {
    this.runRepo = new ExecutionRunRepository(db)
    this.stepRepo = new ExecutionStepRepository(db)
    this.checkpointRepo = new ExecutionCheckpointRepository(db)
    this.effectRepo = new ExecutionEffectRepository(db)
    this.waitRepo = new ExecutionWaitRepository(db)
    this.outboxRepo = new ExecutionOutboxRepository(db)
    this.planRepo = new ExecutionRecoveryPlanRepository(db)
    this.checkpointWriter = new CheckpointWriter(db)
    this.planner = new RecoveryPlanner(db)
    this.effectJournal = new EffectJournal(db)
  }

  /* ------------------------------------------------------------ */
  /* Session 接线                                                  */
  /* ------------------------------------------------------------ */

  bindTurnDelegate(delegate: TurnRecoveryDelegate): void {
    this.turnDelegate = delegate
  }

  get config(): typeof DEFAULT_EXECUTION_CONTINUITY_CONFIG {
    return getExecutionContinuityConfig()
  }

  /**
   * Turn 接受边界：创建 kind=turn 的 Run（与 turn_requests 同事务时复用外层事务）。
   * 幂等：同 turnId 已有 Run 时直接返回。parentRunId 用于把恢复 Turn 挂到
   * 原崩溃 Run 之下（闭环收口）。
   */
  ensureTurnRun(params: {
    turnId: string
    sessionId: string
    runtimeKind: string
    runtimeBinding?: Record<string, unknown> | undefined
    definitionFingerprint?: string | undefined
    inputRef?: string | undefined
    parentRunId?: string | undefined
  }): ExecutionRunRecord {
    const existing = this.runRepo.findByRootTurnId(params.turnId)
    if (existing != null) return existing
    const adapterCeiling = ADAPTER_DECLARATIONS[params.runtimeKind]?.capabilityCeiling ?? 2
    const record = this.runRepo.create({
      id: `erun_${params.turnId}`,
      sessionId: params.sessionId,
      rootTurnId: params.turnId,
      parentRunId: params.parentRunId ?? null,
      kind: 'turn',
      runtimeKind: params.runtimeKind,
      runtimeBindingJson: params.runtimeBinding ?? null,
      definitionFingerprint: params.definitionFingerprint ?? '',
      inputRef: params.inputRef ?? '',
      capabilityCeiling: adapterCeiling,
      currentGuaranteedLevel: adapterCeiling,
    })
    this.outboxRepo.enqueue({
      id: `eox_${crypto.randomUUID()}`,
      runId: record.id,
      eventType: 'run_accepted',
      payload: { turnId: params.turnId, sessionId: params.sessionId },
    })
    log.info('turn run accepted', { runId: record.id, turnId: params.turnId })
    return record
  }

  /** Turn 真正开始执行（出队 → markRunning 成功后）：Run → running + 领取租约 + accepted checkpoint。 */
  onTurnStarted(turnId: string, runtimeBinding?: Record<string, unknown>): void {
    if (!this.config.enabled) return
    try {
      const run = this.runRepo.findByRootTurnId(turnId)
      if (run == null) return
      this.runRepo.markRunning(run.id, ['accepted', 'recovering'])
      const lease = this.runRepo.acquireLease(
        run.id,
        this.workerOwner,
        this.config.leaseDurationMs,
        ['running', 'accepted', 'orphaned', 'recovering', 'paused'],
      )
      if (lease.ok) {
        this.ownedLeases.set(run.id, { owner: this.workerOwner, epoch: lease.record.leaseEpoch })
        this.ensureHeartbeat()
      }
      if (runtimeBinding != null) {
        // 轻量更新 runtime binding（后续 Checkpoint 会固化完整绑定）。
        this.db.raw
          .prepare(`UPDATE execution_runs SET runtime_binding_json = ? WHERE id = ?`)
          .run(JSON.stringify(runtimeBinding), run.id)
      }
      this.checkpointWriter.write({
        runId: run.id,
        reason: 'accepted',
        cursor: { phase: 'turn_started' },
        runtimeBinding: {
          engine: String(runtimeBinding?.engine ?? run.runtimeKind),
          ...(typeof runtimeBinding?.providerProfileId === 'string'
            ? { providerProfileId: runtimeBinding.providerProfileId }
            : {}),
          ...(typeof runtimeBinding?.modelId === 'string' ? { modelId: runtimeBinding.modelId } : {}),
          ...(typeof runtimeBinding?.nativeSessionId === 'string'
            ? { nativeSessionId: runtimeBinding.nativeSessionId }
            : {}),
          ...(typeof runtimeBinding?.nativeThreadId === 'string'
            ? { nativeThreadId: runtimeBinding.nativeThreadId }
            : {}),
        },
      })
    } catch (error) {
      // 连续性簿记失败不阻断 turn 生命周期（方案 §15 降级语义）。
      log.warn('turn start tracking failed (non-fatal)', {
        turnId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Turn 终态：Run 收口（completed/failed/cancelled）。 */
  onTurnTerminal(
    turnId: string,
    status: 'completed' | 'failed' | 'cancelled',
    reason: string | null,
  ): void {
    try {
      const run = this.runRepo.findByRootTurnId(turnId)
      if (run == null) return
      const lease = this.ownedLeases.get(run.id)
      if (lease != null) {
        this.ownedLeases.delete(run.id)
      }
      // 先用租约 fence 收口、再释放租约：租约已被新 Worker 顶掉（epoch
      // 递增）时终态写入被拒，防止旧 Worker 把新租约下正在执行的 Run 写
      // 成终态；未持有租约时按宿主权威路径收口（仅状态守卫）。
      const finalized = this.checkpointWriter.finalizeRun(run.id, status, reason, lease ?? null)
      if (lease != null) {
        this.runRepo.releaseLease(run.id, lease.owner, lease.epoch)
      }
      if (!finalized && lease != null) {
        const current = this.runRepo.get(run.id)
        if (current != null && !isTerminalExecutionRunStatus(current.status)) {
          log.warn('turn terminal fenced off by newer lease', {
            runId: run.id,
            turnId,
            status,
            leaseEpoch: lease.epoch,
            currentStatus: current.status,
          })
        }
        return
      }
      if (finalized) {
        // 收口本 Run 的有效恢复计划；若本 Turn 是恢复 Turn（挂在原崩溃 Run
        // 之下），随恢复结果一并闭环原 Run，否则原 Run 永悬 recovering，
        // 每次重启都会重复派发恢复任务。
        this.planRepo.settleActiveForRun(
          run.id,
          status === 'completed' ? 'completed' : 'superseded',
        )
        if (run.parentRunId != null) {
          this.closeRecoveryParentRun(run.parentRunId, status)
        }
      }
    } catch (error) {
      // 连续性簿记失败不阻断 turn 终态处理链路（方案 §15 降级语义）。
      log.warn('turn terminal tracking failed (non-fatal)', {
        turnId,
        status,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * 恢复 Turn 收口后闭环其原 Run：原 Run 为 kind=turn 且处于 recovering/paused
   * （恢复派发中或 drain 中断）时随恢复结果一起终态化并收口其计划。
   * goal/team 等其他父 Run（running 等状态）由各自生命周期收口，不在此处理。
   */
  private closeRecoveryParentRun(
    parentRunId: string,
    status: 'completed' | 'failed' | 'cancelled',
  ): void {
    try {
      const parent = this.runRepo.get(parentRunId)
      if (parent == null || isTerminalExecutionRunStatus(parent.status)) return
      if (parent.kind !== 'turn') return
      if (parent.status !== 'recovering' && parent.status !== 'paused') return
      const closed = this.checkpointWriter.finalizeRun(
        parentRunId,
        status,
        `recovery_turn_${status}`,
      )
      if (closed) {
        this.planRepo.settleActiveForRun(
          parentRunId,
          status === 'completed' ? 'completed' : 'superseded',
        )
        log.info('recovery parent run closed by recovery turn', {
          parentRunId,
          status,
        })
      }
    } catch (error) {
      log.warn('close recovery parent run failed', {
        parentRunId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** 副作用边界 fencing 检查（EffectJournal 调用方使用）。 */
  assertLease(runId: string): boolean {
    const lease = this.ownedLeases.get(runId)
    if (lease == null) return false
    return this.runRepo.isLeaseValid(runId, lease.owner, lease.epoch)
  }

  /* ------------------------------------------------------------ */
  /* Workflow 生命周期（Phase 3A 剩余：方案 §11.2）                 */
  /* ------------------------------------------------------------ */

  /** workflow_run 建档边界：创建 kind=workflow 的 Run（幂等）。 */
  ensureWorkflowRun(params: {
    workflowRunId: string
    sessionId: string
    turnId: string
    workflowId: string
    graphDigest: string
    nameSnapshot?: string | undefined
    versionSnapshot?: string | undefined
  }): ExecutionRunRecord | null {
    if (!this.config.enabled) return null
    try {
      const runId = `erun_wf_${params.workflowRunId}`
      const existing = this.runRepo.get(runId)
      if (existing != null) {
        // 续跑同一 workflow run：复用 Run，仅刷新绑定 turn。
        if (!isTerminalExecutionRunStatus(existing.status) && existing.status !== 'running') {
          this.runRepo.markRunning(runId, ['accepted', 'paused', 'orphaned', 'recovering', 'waiting'])
        }
        return existing
      }
      const adapterCeiling = ADAPTER_DECLARATIONS.workflow?.capabilityCeiling ?? 2
      const record = this.runRepo.create({
        id: runId,
        sessionId: params.sessionId,
        rootTurnId: params.turnId,
        kind: 'workflow',
        runtimeKind: 'workflow',
        runtimeBindingJson: {
          workflowRunId: params.workflowRunId,
          workflowId: params.workflowId,
          ...(params.nameSnapshot != null ? { name: params.nameSnapshot } : {}),
          ...(params.versionSnapshot != null ? { version: params.versionSnapshot } : {}),
        },
        definitionFingerprint: params.graphDigest,
        inputRef: params.workflowId,
        capabilityCeiling: adapterCeiling,
        currentGuaranteedLevel: adapterCeiling,
      })
      this.outboxRepo.enqueue({
        id: `eox_${crypto.randomUUID()}`,
        runId,
        eventType: 'run_accepted',
        payload: { kind: 'workflow', workflowRunId: params.workflowRunId },
      })
      log.info('workflow run registered', { runId, workflowRunId: params.workflowRunId })
      return record
    } catch (error) {
      log.warn('workflow run registration failed', {
        workflowRunId: params.workflowRunId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * 图版本漂移记录（恢复时当前定义 digest ≠ Run 冻结 digest）。
   * 语义：不阻断（续跑冻结图是既有正确行为），但把漂移事实写进 runtime binding
   * 与 outbox，恢复中心可见（方案 §11.2「必须经过显式迁移/确认」的可见性部分）。
   */
  noteWorkflowGraphDrift(workflowRunId: string, frozenDigest: string, currentDigest: string | null): void {
    if (!this.config.enabled) return
    try {
      const runId = `erun_wf_${workflowRunId}`
      const run = this.runRepo.get(runId)
      if (run == null) return
      const drift = currentDigest != null && currentDigest !== frozenDigest
      if (!drift) return
      const binding =
        run.runtimeBindingJson != null && typeof run.runtimeBindingJson === 'object'
          ? { ...(run.runtimeBindingJson as Record<string, unknown>) }
          : {}
      binding.graphDrift = {
        frozenDigest,
        currentDigest,
        detectedAt: new Date().toISOString(),
        policy: 'resume_frozen_graph',
      }
      this.db.raw
        .prepare(`UPDATE execution_runs SET runtime_binding_json = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(binding), new Date().toISOString(), runId)
      this.outboxRepo.enqueue({
        id: `eox_${crypto.randomUUID()}`,
        runId,
        eventType: 'workflow_graph_drift',
        payload: { frozenDigest, currentDigest },
      })
      log.info('workflow graph drift detected', { runId, workflowRunId })
    } catch (error) {
      log.warn('workflow graph drift recording failed (non-fatal)', {
        workflowRunId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** 节点完成边界：step committed + checkpoint（节点粒度独立提交，方案 §6.2）。 */
  onWorkflowNodeCommitted(workflowRunId: string, nodeId: string): void {
    if (!this.config.enabled) return
    let runId: string
    try {
      runId = `erun_wf_${workflowRunId}`
      if (this.runRepo.get(runId) == null) return
    } catch (error) {
      log.warn('workflow node commit check failed (non-fatal)', {
        workflowRunId,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
    try {
      const step = this.stepRepo.ensure({
        id: `est_wf_${workflowRunId}_${nodeId}`,
        runId,
        stableKey: `workflow_node:${nodeId}`,
        kind: 'workflow_node',
      })
      this.stepRepo.commit(step.id, `workflow_node:${nodeId}`)
      this.checkpointWriter.write({
        runId,
        reason: 'step_committed',
        cursor: { phase: 'workflow_node_committed', graphNodeId: nodeId },
        runtimeBinding: { engine: 'workflow' },
      })
    } catch (error) {
      log.warn('workflow node commit failed', {
        workflowRunId,
        nodeId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** workflow 终态：Run 收口（completed/failed/cancelled）。 */
  onWorkflowTerminal(
    workflowRunId: string,
    status: 'completed' | 'failed' | 'cancelled',
    reason: string | null,
  ): void {
    if (!this.config.enabled) return
    try {
      const runId = `erun_wf_${workflowRunId}`
      const run = this.runRepo.get(runId)
      if (run == null || isTerminalExecutionRunStatus(run.status)) return
      this.checkpointWriter.finalizeRun(runId, status, reason)
    } catch (error) {
      log.warn('workflow terminal tracking failed (non-fatal)', {
        workflowRunId,
        status,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /* ------------------------------------------------------------ */
  /* Goal 生命周期（Phase 3B：方案 §11.1）                          */
  /* ------------------------------------------------------------ */

  private goalRunId(goalId: string): string {
    return `erun_goal_${goalId}`
  }

  /**
   * 该 Run 是否存在需要人工处理的子 Run（如中断且待恢复的 goal 迭代 turn）。
   * 只看 needs_attention/orphaned：正常 drain 后子 Run 是 paused（由各自恢复
   * 路径自动处理），不应阻断 goal 根 Run 的迭代重启。查询失败时保守返回 true。
   */
  hasNonTerminalChildRuns(runId: string): boolean {
    try {
      const rows = this.db.raw
        .prepare(
          `SELECT COUNT(*) AS n FROM execution_runs WHERE parent_run_id = ? AND status IN ('needs_attention','orphaned')`,
        )
        .get(runId) as { n: number } | undefined
      return (rows?.n ?? 0) > 0
    } catch (error) {
      log.warn('child run check failed, assume interrupted (non-fatal)', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      })
      return true
    }
  }

  /** goal Run 转入 needs_attention（启动恢复发现中断迭代时）。 */
  markGoalRunNeedsAttention(goalId: string, reason: string): void {
    try {
      const runId = this.goalRunId(goalId)
      const run = this.runRepo.get(runId)
      if (run == null || isTerminalExecutionRunStatus(run.status)) return
      this.runRepo.markNeedsAttention(runId, reason)
      this.outboxRepo.enqueue({
        id: `eox_${crypto.randomUUID()}`,
        runId,
        eventType: 'run_needs_attention',
        payload: { reasons: [reason] },
      })
    } catch (error) {
      log.warn('goal needs-attention marking failed (non-fatal)', {
        goalId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Goal 根 Run 建档（kind=goal；幂等，active goal 重启后复用）。 */
  ensureGoalRun(params: {
    goalId: string
    sessionId: string
    objective: string
    mode: string
  }): ExecutionRunRecord | null {
    if (!this.config.enabled) return null
    try {
      const runId = this.goalRunId(params.goalId)
      const existing = this.runRepo.get(runId)
      if (existing != null) {
        if (isTerminalExecutionRunStatus(existing.status)) return existing
        this.runRepo.markRunning(runId, ['accepted', 'paused', 'orphaned', 'recovering', 'waiting'])
        return this.runRepo.get(runId) ?? existing
      }
      const adapterCeiling = ADAPTER_DECLARATIONS.goal?.capabilityCeiling ?? 1
      const record = this.runRepo.create({
        id: runId,
        sessionId: params.sessionId,
        kind: 'goal',
        runtimeKind: 'goal',
        runtimeBindingJson: { goalId: params.goalId, mode: params.mode },
        inputRef: params.objective.slice(0, 200),
        capabilityCeiling: adapterCeiling,
        currentGuaranteedLevel: adapterCeiling,
      })
      this.outboxRepo.enqueue({
        id: `eox_${crypto.randomUUID()}`,
        runId,
        eventType: 'run_accepted',
        payload: { kind: 'goal', goalId: params.goalId },
      })
      log.info('goal run registered', { runId, goalId: params.goalId })
      return record
    } catch (error) {
      log.warn('goal run registration failed', {
        goalId: params.goalId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /** Goal 迭代边界：稳定 step（stableKey=goal_iteration:N），waiting → running。 */
  onGoalIterationStarted(goalId: string, iteration: number, turnId: string): void {
    if (!this.config.enabled) return
    const runId = this.goalRunId(goalId)
    if (this.runRepo.get(runId) == null) return
    try {
      const step = this.stepRepo.ensure({
        id: `est_goal_${goalId}_${iteration}`,
        runId,
        stableKey: `goal_iteration:${iteration}`,
        kind: 'goal_iteration',
      })
      this.stepRepo.markRunning(step.id)
      // 迭代 turn 的 kind=turn Run 挂到 goal 根 Run 之下（parentRunId 供恢复导航）。
      const turnRun = this.runRepo.findByRootTurnId(turnId)
      if (turnRun != null && turnRun.parentRunId == null) {
        this.db.raw
          .prepare(`UPDATE execution_runs SET parent_run_id = ?, updated_at = ? WHERE id = ?`)
          .run(runId, new Date().toISOString(), turnRun.id)
      }
    } catch (error) {
      log.warn('goal iteration step failed', {
        goalId,
        iteration,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * 迭代结果提交（progress append 同边界）：step committed + checkpoint。
   * 预算/失败计数以 progress_log（持久事实）为准 —— 崩溃重试不重复计数（§11.1）。
   */
  onGoalIterationCommitted(goalId: string, iteration: number, phase: string): void {
    if (!this.config.enabled) return
    const runId = this.goalRunId(goalId)
    if (this.runRepo.get(runId) == null) return
    try {
      const step = this.stepRepo.findByStableKey(runId, `goal_iteration:${iteration}`)
      if (step == null) return
      this.stepRepo.commit(step.id, `goal_progress:${iteration}:${phase}`)
      this.checkpointWriter.write({
        runId,
        reason: 'step_committed',
        cursor: { phase: 'goal_iteration_committed', goalIteration: iteration },
        runtimeBinding: { engine: 'goal' },
      })
    } catch (error) {
      log.warn('goal iteration commit failed', {
        goalId,
        iteration,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Goal 终态（completed/failed/cleared/paused）映射到 Run 收口或暂停。 */
  onGoalTerminal(
    goalId: string,
    outcome: 'completed' | 'failed' | 'cleared' | 'paused' | 'stopped_by_budget',
  ): void {
    if (!this.config.enabled) return
    try {
      const runId = this.goalRunId(goalId)
      const run = this.runRepo.get(runId)
      if (run == null) return
      if (outcome === 'completed' || outcome === 'failed') {
        if (!isTerminalExecutionRunStatus(run.status)) {
          this.checkpointWriter.finalizeRun(runId, outcome, `goal_${outcome}`)
        }
        return
      }
      if (outcome === 'cleared') {
        if (!isTerminalExecutionRunStatus(run.status)) {
          this.checkpointWriter.finalizeRun(runId, 'cancelled', 'goal_cleared')
        }
        return
      }
      // paused / stopped_by_budget：Run 暂停（用户可通过恢复中心/继续对话重启迭代）。
      if (run.status === 'running' || run.status === 'accepted') {
        this.runRepo.markPaused(runId, `goal_${outcome}`)
      }
    } catch (error) {
      log.warn('goal terminal tracking failed (non-fatal)', {
        goalId,
        outcome,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * 子 Agent / Team 派发边界（Phase 3B §11.3 的 Host 侧实现）：
   * 派发 = 父 Run 上的稳定 step（kind=subagent）进入 durable waiting；完成/失败
   * 收口。重启后 step 状态随 Run 可见（成员执行本身依附父 turn 的内存 Promise，
   * 恢复语义由父 Run 的恢复规划决定 —— 不伪造成员级内容恢复）。
   */
  onSubagentDispatchOpened(params: {
    turnId: string
    dispatchId: string
    memberAgentId: string
    parallel: boolean
  }): void {
    if (!this.config.enabled) return
    try {
      const runId = this.resolveRunIdByTurn(params.turnId)
      if (runId == null) return
      const step = this.stepRepo.ensure({
        id: `est_disp_${params.dispatchId}`,
        runId,
        stableKey: `dispatch:${params.dispatchId}`,
        kind: 'subagent',
      })
      this.stepRepo.markRunning(step.id)
      this.stepRepo.markWaiting(step.id)
    } catch (error) {
      log.warn('subagent dispatch step failed', {
        dispatchId: params.dispatchId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  onSubagentDispatchSettled(
    dispatchId: string,
    outcome: 'completed' | 'failed' | 'cancelled',
  ): void {
    if (!this.config.enabled) return
    const stepId = `est_disp_${dispatchId}`
    try {
      if (outcome === 'completed') {
        // waiting → running → committed（状态机要求 waiting 不能直接提交）。
        this.stepRepo.resumeFromWaiting(stepId)
        this.stepRepo.commit(stepId, `dispatch:${dispatchId}`)
      } else {
        this.stepRepo.markCancelled(stepId)
      }
    } catch (error) {
      log.warn('subagent dispatch settle failed', {
        dispatchId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /* ------------------------------------------------------------ */
  /* 工具副作用信封（Phase 2：统一事件入口接入 EffectJournal）        */
  /* ------------------------------------------------------------ */

  private readonly runIdByTurn = new Map<string, string>()

  private resolveRunIdByTurn(turnId: string): string | null {
    const cached = this.runIdByTurn.get(turnId)
    if (cached != null && this.runRepo.get(cached) != null) return cached
    const run = this.runRepo.findByRootTurnId(turnId)
    if (run == null) return null
    this.runIdByTurn.set(turnId, run.id)
    return run.id
  }

  /**
   * 统一工具事件入口的副作用信封记录（方案 §6.4/§8.3）：
   *   tool_call（副作用类工具）→ prepared → dispatching（write-ahead sent-intent）
   *   tool_result success      → confirmed + step committed + step_committed checkpoint
   *   tool_result error/denied → failed
   *
   * 只为 sideEffect ≠ none 的工具建立信封；只读工具的安全性可从事件流直接推导。
   * 引擎在派发时持久化 tool_call 事件，本钩子在事件持久化后被调用 —— 与
   * 「先登记后越过边界」的 write-ahead 顺序一致。
   */
  recordToolEffectFromEvent(turnId: string, event: { type: string } & Record<string, unknown>): void {
    if (!this.config.enabled) return
    if (event.type !== 'tool_call' && event.type !== 'tool_result') return
    let runId: string | null
    try {
      runId = this.resolveRunIdByTurn(turnId)
    } catch (error) {
      log.warn('tool effect tracking failed (non-fatal)', {
        turnId,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
    if (runId == null) return
    try {
      if (event.type === 'tool_call') {
        const toolName = String(event.toolName ?? '')
        const toolCallId = String(event.toolCallId ?? '')
        if (toolName === '' || toolCallId === '') return
        const source = event.source === 'mcp' ? 'mcp' : 'builtin'
        const policy = this.effectJournal.policyFor(toolName, source)
        if (policy.sideEffect === 'none') return
        const prepared = this.effectJournal.prepare({
          runId,
          stepKey: `tool:${toolCallId}`,
          stepKind: 'tool',
          toolName,
          toolSource: source,
          toolCallId,
          toolInput: (event.toolInput as Record<string, unknown> | undefined) ?? {},
        })
        this.effectJournal.markDispatching(runId, prepared.effect.id)
        return
      }
      // tool_result：收口信封（success → confirmed；error/denied → failed）。
      const toolCallId = String(event.toolCallId ?? '')
      if (toolCallId === '') return
      const effect = this.effectRepo.findByToolCallId(runId, toolCallId)
      if (effect == null) return
      const status = event.status
      if (status === 'success') {
        this.checkpointWriter.write({
          runId,
          reason: 'step_committed',
          cursor: { phase: 'tool_committed', nextStepKey: `tool:${toolCallId}` },
          runtimeBinding: { engine: this.runRepo.get(runId)?.runtimeKind ?? 'unknown' },
          commitStep: { stepId: effect.stepId, resultRef: `tool_result:${toolCallId}` },
        })
        this.effectJournal.confirm(runId, effect.id, `tool_result:${toolCallId}`)
      } else {
        this.effectRepo.markFailed(effect.id)
        this.stepRepo.markFailed(effect.stepId)
      }
    } catch (error) {
      // 信封失败不阻断工具事件流本身（事件已是持久事实）。
      log.warn('tool effect envelope recording failed', {
        runId,
        turnId,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  getEffectJournal(): EffectJournal {
    return this.effectJournal
  }

  getCheckpointWriter(): CheckpointWriter {
    return this.checkpointWriter
  }

  /**
   * Spark Engine 账本恢复证据 → Effect 三态精确调和（Phase 2 深化，方案 §8/§14）：
   *   - dispatching/unknown + 账本已有 tool.result → confirmed（崩溃后结果已收口）
   *   - dispatching/unknown + 孤儿 intent          → unknown（已派发、结果未知，维持）
   *   - dispatching + 仅 tool.call 无 intent        → markFailed（从未派发，安全跳过）
   *
   * 作用域是**会话级**：spark 账本（sparkSessionId）覆盖整个会话，崩溃 Run 与
   * 恢复 Turn 是不同 turnId —— 按 turn 定位会漏掉真正的目标 Run。这里对会话的
   * 全部活动 Run 调和；callId 全局唯一，不在证据集合里的 Effect 不受影响。
   * 由 spark-engine-executor openSession 后的回调触发；证据集合为空（账本被清）
   * 时不动作，保持既有保守调和，不误标。
   */
  reconcileEffectsFromEngineLedger(
    sessionId: string,
    evidence: {
      resultCallIds: ReadonlySet<string>
      orphanIntentCallIds: ReadonlySet<string>
      undeliveredCallIds: ReadonlySet<string>
    },
  ): void {
    if (!this.config.enabled) return
    if (
      evidence.resultCallIds.size === 0 &&
      evidence.orphanIntentCallIds.size === 0 &&
      evidence.undeliveredCallIds.size === 0
    ) {
      return
    }
    let activeRunIds: Array<{ id: string }>
    try {
      activeRunIds = this.db.raw
        .prepare(
          `SELECT id FROM execution_runs WHERE session_id = ? AND status IN
             ('accepted','running','pausing','paused','waiting','orphaned','recovering','needs_attention')`,
        )
        .all(sessionId) as Array<{ id: string }>
    } catch (error) {
      log.warn('engine ledger reconciliation failed (non-fatal)', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
    for (const { id: runId } of activeRunIds) {
      const effects = this.effectRepo.listByRun(runId)
      let confirmed = 0
      let orphaned = 0
      let skipped = 0
      try {
        for (const effect of effects) {
          if (effect.phase !== 'dispatching' && effect.phase !== 'unknown') continue
          if (evidence.resultCallIds.has(effect.toolCallId)) {
            if (effect.phase === 'unknown') {
              this.effectRepo.reconcileUnknown(effect.id, 'confirmed')
            } else {
              this.effectRepo.markConfirmed(effect.id, `engine_ledger:${effect.toolCallId}`)
            }
            this.stepRepo.commit(effect.stepId, `engine_ledger:${effect.toolCallId}`)
            confirmed += 1
          } else if (evidence.orphanIntentCallIds.has(effect.toolCallId)) {
            // 真未知：已越过派发边界、结果缺失 —— 保持 unknown，交给恢复中心确认。
            orphaned += 1
          } else if (
            evidence.undeliveredCallIds.has(effect.toolCallId) &&
            effect.phase === 'dispatching'
          ) {
            this.effectRepo.markFailed(effect.id)
            this.stepRepo.markFailed(effect.stepId)
            skipped += 1
          }
        }
      } catch (error) {
        log.warn('engine ledger reconciliation failed for run (non-fatal)', {
          runId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }
      if (confirmed > 0 || orphaned > 0 || skipped > 0) {
        this.outboxRepo.enqueue({
          id: `eox_${crypto.randomUUID()}`,
          runId,
          eventType: 'effect_reconciled',
          payload: {
            source: 'engine_ledger',
            confirmed,
            unknown: orphaned,
            skippedUndelivered: skipped,
          },
        })
        log.info('effects reconciled from engine ledger', {
          runId,
          sessionId,
          confirmed,
          unknown: orphaned,
          skipped,
        })
      }
    }
  }

  /* ------------------------------------------------------------ */
  /* 启动扫描（方案 §9.1）                                          */
  /* ------------------------------------------------------------ */

  /**
   * 应用启动后的恢复扫描。返回汇总（启动提示区分自动恢复/需确认/无法恢复）。
   *
   * 扫描顺序：
   *   1. turn_requests accepted → 重放（既有行为，走 SessionService 队列）
   *   2. active execution_runs：过期租约 running/pausing/recovering → orphaned
   *   3. 逐 Run 生成恢复计划（副作用证明 → 决策）
   *   4. auto_resume 且配置允许 → 委托 resumeTurnRun
   *   5. needs_attention → 保持状态供恢复中心处理
   *   6. 媒体任务投影：pending/running + providerTaskId → query_then_resume
   */
  startupScan(_input?: { replayAcceptedTurn?: (turnId: string, sessionId: string) => void }): StartupScanSummary {
    const summary: StartupScanSummary = {
      scannedAt: new Date().toISOString(),
      totalActiveRuns: 0,
      autoResumed: 0,
      needsAttention: 0,
      cannotRecover: 0,
      mediaTasksPolling: 0,
      runIds: [],
    }
    if (!this.config.enabled) {
      this.lastScanSummary = summary
      return summary
    }
    // 说明：accepted turn_requests 的重放由 SessionService.recoverAcceptedTurnRequests
    // 负责（含队列错误暂停闸门）；本扫描只处理 execution_runs 侧的恢复。

    // 1. 过期租约的 running/pausing/recovering → orphaned（方案 §10.2）。
    const nowIso = new Date().toISOString()
    const active = this.runRepo.listActive()
    summary.totalActiveRuns = active.length
    for (const run of active) {
      if (
        (run.status === 'running' || run.status === 'pausing' || run.status === 'recovering') &&
        run.leaseExpiresAt != null &&
        run.leaseExpiresAt <= nowIso
      ) {
        this.runRepo.markOrphaned(run.id, 'lease_expired')
      }
    }

    // 2. 逐 Run 恢复规划。
    for (const run of this.runRepo.listActive()) {
      if (
        run.kind !== 'turn' &&
        run.kind !== 'media' &&
        run.kind !== 'workflow' &&
        run.kind !== 'goal' &&
        run.kind !== 'subapp'
      ) {
        continue
      }
      summary.runIds.push(run.id)
      try {
        if (run.kind === 'workflow') {
          // workflow 的恢复语义是「下一轮 turn 惰性续跑冻结图」（EffectiveWorkflowResolver
          // 已实现）：不自动、不阻断；orphaned → paused 并标注续跑方式，恢复中心可见。
          if (run.status === 'orphaned' || run.status === 'running') {
            this.runRepo.markPaused(run.id, 'workflow_deferred_resume')
          }
          continue
        }
        if (run.kind === 'goal') {
          // goal 恢复由 SessionService.recoverActiveGoals 负责（迭代泵/needs_attention），
          // 这里只把孤儿状态收敛为 paused，避免与迭代恢复竞争。
          if (run.status === 'orphaned' || run.status === 'running') {
            this.runRepo.markPaused(run.id, 'goal_startup_recovery')
          }
          continue
        }
        if (run.kind === 'subapp') {
          // 投影 Run：needs_attention 已在投影时标注；其他活跃态保持（JobManager 跟随）。
          continue
        }
        if (run.status === 'accepted') {
          // accepted Run 尚未开始执行：原消息由 recoverAcceptedTurnRequests
          // 重放入队，这里再派恢复 Turn 会造成同一任务双执行。
          continue
        }
        if (
          (run.status === 'running' || run.status === 'pausing') &&
          run.leaseExpiresAt != null &&
          run.leaseExpiresAt > nowIso
        ) {
          // 租约仍有效（刚崩溃不久或另一进程在执行）：本轮不自动恢复，
          // 交恢复中心；租约过期后 safe_continue 可续。
          this.runRepo.markNeedsAttention(run.id, 'lease_still_valid_at_startup')
          continue
        }
        this.planAndDispatch(run)
      } catch (error) {
        log.warn('recovery planning failed', {
          runId: run.id,
          error: error instanceof Error ? error.message : String(error),
        })
        this.runRepo.markNeedsAttention(run.id, 'recovery_planning_failed')
      }
    }

    // 3. 媒体任务投影（§21.6：query_then_resume 样板）。
    summary.mediaTasksPolling = this.projectMediaTasks()

    // 4. SubApp Job 投影（Phase 3C）。
    this.projectSubAppJobs()

    // 统计
    const after = this.runRepo.listActive()
    for (const run of after) {
      const plan = this.planner.latestPlanForRun(run.id)
      if (plan == null) continue
      if (plan.decision === 'auto_resume' && run.status !== 'needs_attention') summary.autoResumed += 1
      else if (plan.decision === 'needs_confirmation' || run.status === 'needs_attention') {
        summary.needsAttention += 1
      } else if (plan.decision === 'cannot_resume') summary.cannotRecover += 1
    }

    log.info('startup scan complete', {
      totalActiveRuns: summary.totalActiveRuns,
      autoResumed: summary.autoResumed,
      needsAttention: summary.needsAttention,
      cannotRecover: summary.cannotRecover,
      mediaTasksPolling: summary.mediaTasksPolling,
    })
    this.lastScanSummary = summary
    // Phase 4 janitor：启动时顺带清理超期终态 Run 与已发布 outbox（方案 §6.7）。
    try {
      this.runJanitor(30)
    } catch (error) {
      log.warn('janitor failed at startup', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return summary
  }

  /**
   * 应用重启时对 interrupted running turn 的 Run 路由（由
   * SessionService.recoverAcceptedTurnRequests 调用）：Run → orphaned，
   * 后续由 startupScan 做恢复规划。无 Run 时返回 null（存量请求走旧语义）。
   */
  getRunByRootTurnIdForRecovery(turnId: string): ExecutionRunRecord | null {
    const run = this.runRepo.findByRootTurnId(turnId)
    if (run == null) return null
    if (
      run.status === 'running' ||
      run.status === 'pausing' ||
      run.status === 'recovering' ||
      run.status === 'waiting'
    ) {
      this.runRepo.markOrphaned(run.id, 'application_restart')
      return this.runRepo.get(run.id) ?? run
    }
    return run
  }

  /** 对单个 Run 生成恢复计划并执行 auto_resume 委托。 */
  private planAndDispatch(run: ExecutionRunRecord): void {
    // 恢复 Turn 已在途（executing 计划尚未收口）：等待其闭环，禁止重复派发，
    // 否则每次重启都会重复执行同一恢复任务。
    if (this.planRepo.hasExecutingPlan(run.id)) {
      log.debug('recovery plan already executing, skip dispatch', { runId: run.id })
      return
    }
    const delegateEnv = this.turnDelegate?.environmentFor(run)
    const supportsNative = supportsNativeResumeFor(run.runtimeKind, run.runtimeBindingJson)
    const sideEffectProof =
      run.kind === 'turn' && run.sessionId != null
        ? inspectTurnSideEffects({
            db: this.db,
            sessionId: run.sessionId,
            turnId: run.rootTurnId ?? '',
          })
        : undefined
    const result = this.planner.plan({
      run,
      current: {
        runtimeKind: run.runtimeKind,
        engine: delegateEnv?.engine ?? run.runtimeKind,
        providerProfileId: delegateEnv?.providerProfileId,
        modelId: delegateEnv?.modelId,
        definitionFingerprint: delegateEnv?.definitionFingerprint,
      },
      sideEffectProof,
      supportsNativeResume: supportsNative,
      hasContinuityCapsule:
        run.sessionId != null && (this.turnDelegate?.hasContinuityCapsule(run.sessionId) ?? false),
      requestedRecoveryMode: run.requestedRecoveryMode,
      autoRecoveryEnabled: this.config.autoRecoveryKinds.includes(run.kind),
    })
    switch (result.decision) {
      case 'auto_resume': {
        // 无恢复执行方（如 turn kind 未绑定 delegate）时不能停在 recovering——
        // 交给恢复中心人工处理，避免 Run 永久悬置。media 恢复（query_then_resume
        // 轮询）尚无执行方，同样落 needs_attention。
        const canExecuteResume = run.kind === 'turn' && this.turnDelegate != null
        if (!canExecuteResume) {
          this.runRepo.markNeedsAttention(run.id, 'no_resume_executor')
          this.outboxRepo.enqueue({
            id: `eox_${crypto.randomUUID()}`,
            runId: run.id,
            eventType: 'run_needs_attention',
            payload: { reasons: ['no_resume_executor'] },
          })
          break
        }
        if (run.status === 'orphaned' || run.status === 'paused') {
          this.runRepo.markRecovering(run.id)
        }
        if (run.kind === 'turn' && this.turnDelegate != null) {
          this.turnDelegate.resumeTurnRun(run, result.plan)
          this.planRepo.updateStatus(result.plan.planId, 'executing')
        }
        this.outboxRepo.enqueue({
          id: `eox_${crypto.randomUUID()}`,
          runId: run.id,
          eventType: 'run_recovered',
          payload: { decision: 'auto_resume', method: result.plan.recoveryMethod },
        })
        break
      }
      case 'needs_confirmation':
        this.runRepo.markNeedsAttention(run.id, result.plan.degradationReasons.join(';') || null)
        this.outboxRepo.enqueue({
          id: `eox_${crypto.randomUUID()}`,
          runId: run.id,
          eventType: 'run_needs_attention',
          payload: { reasons: result.plan.degradationReasons },
        })
        break
      case 'cannot_resume':
        this.runRepo.markNeedsAttention(run.id, 'cannot_resume')
        break
    }
  }

  /**
   * 媒体任务投影：pending/running 且已有 providerTaskId 的媒体任务登记为
   * media Run + query_then_resume Effect（恢复只轮询，绝不重新 submit）。
   */
  private projectMediaTasks(): number {
    const mediaRepo = new MediaGenerationTaskRepository(this.db)
    const pending = mediaRepo.list({ status: 'running' })
    const inFlight = mediaRepo.list({ status: 'pending' })
    let projected = 0
    for (const task of [...pending, ...inFlight]) {
      if (task.provider_task_id == null || task.provider_task_id === '') continue
      const runId = `erun_media_${task.id}`
      const existing = this.runRepo.get(runId)
      if (existing != null && existing.status !== 'accepted' && existing.status !== 'orphaned') {
        continue
      }
      if (existing == null) {
        this.runRepo.create({
          id: runId,
          sessionId: null,
          kind: 'media',
          runtimeKind: 'media-task',
          inputRef: task.id,
          runtimeBindingJson: {
            providerTaskId: task.provider_task_id,
            providerKind: task.provider_kind,
            operation: task.operation,
          },
          capabilityCeiling: 3,
          currentGuaranteedLevel: 3,
        })
      }
      const run = this.runRepo.get(runId)
      if (run == null) continue
      const effectExisting = this.effectRepo.listByPhase(runId, 'confirmed')
      if (effectExisting.length > 0) continue
      // 登记外部收据 Effect：已提交过 submit，恢复动作只剩轮询。
      const journal = this.effectJournal
      const prepared = journal.prepare({
        runId,
        stepKey: `media_submit:${task.id}`,
        stepKind: 'tool',
        toolName: task.operation,
        toolSource: 'builtin',
        toolCallId: `media_${task.id}`,
        toolInput: { taskId: task.id, providerTaskId: task.provider_task_id },
      })
      journal.markDispatching(runId, prepared.effect.id)
      journal.confirm(runId, prepared.effect.id, task.id, task.provider_task_id)
      this.outboxRepo.enqueue({
        id: `eox_${crypto.randomUUID()}`,
        runId,
        eventType: 'effect_reconciled',
        payload: { tool: task.operation, receipt: task.provider_task_id, policy: 'query_then_resume' },
      })
      projected += 1
    }
    return projected
  }

  /**
   * SubApp Job 投影（Phase 3C，方案 §14/§15）：
   *   - interrupted → Run needs_attention：诚实呈现「checkpoint 存而不用、不伪造
   *     恢复」，恢复中心提供「放弃（job → cancelled）/ 保留现场」；
   *   - queued → Run accepted（SubAppBackend.restore 会重新派发，Run 跟随收口）；
   *   - 残留 running（旧数据）→ needs_attention。
   * scheduled task 不投影：其 nextRunAt 语义重启后自然继续，不属于中断的长程任务。
   */
  private projectSubAppJobs(): number {
    let rows: Array<{
      id: string
      app_id: string
      type: string
      status: string
      checkpoint_json: string | null
    }> = []
    try {
      rows = this.db.raw
        .prepare(
          `SELECT id, app_id, type, status, checkpoint_json FROM sub_app_jobs
           WHERE status IN ('queued', 'running', 'interrupted')
           ORDER BY created_at ASC LIMIT 200`,
        )
        .all() as typeof rows
    } catch (error) {
      // 表不存在（未启用 SubApp 平台）时静默跳过。
      log.debug('sub_app_jobs projection skipped', {
        error: error instanceof Error ? error.message : String(error),
      })
      return 0
    }
    let projected = 0
    for (const job of rows) {
      const runId = `erun_subapp_${job.id}`
      const existing = this.runRepo.get(runId)
      if (existing != null && isTerminalExecutionRunStatus(existing.status)) continue
      const hasCheckpoint =
        job.checkpoint_json != null &&
        job.checkpoint_json !== 'null' &&
        job.checkpoint_json.length > 4
      if (existing == null) {
        this.runRepo.create({
          id: runId,
          sessionId: null,
          kind: 'subapp',
          runtimeKind: 'subapp-job',
          inputRef: job.id,
          runtimeBindingJson: {
            jobId: job.id,
            appId: job.app_id,
            type: job.type,
            hasCheckpoint,
          },
          capabilityCeiling: 1,
          currentGuaranteedLevel: 1,
        })
        projected += 1
      }
      if (job.status === 'queued') continue // JobManager restore 重跑，Run 跟随
      const reason =
        job.status === 'interrupted'
          ? 'subapp_job_interrupted'
          : 'subapp_job_stale_running'
      this.runRepo.markNeedsAttention(runId, reason)
      this.outboxRepo.enqueue({
        id: `eox_${crypto.randomUUID()}`,
        runId,
        eventType: 'run_needs_attention',
        payload: { reasons: [reason], hasCheckpoint },
      })
    }
    return projected
  }

  /** 恢复中心放弃 SubApp Job Run 时写回 job 状态（cancelled + 保留现场说明）。 */
  private cancelProjectedSubAppJob(runId: string): boolean {
    const run = this.runRepo.get(runId)
    if (run == null || run.kind !== 'subapp') return false
    const binding =
      run.runtimeBindingJson != null && typeof run.runtimeBindingJson === 'object'
        ? (run.runtimeBindingJson as { jobId?: unknown; appId?: unknown })
        : {}
    const jobId = typeof binding.jobId === 'string' ? binding.jobId : null
    const appId = typeof binding.appId === 'string' ? binding.appId : null
    if (jobId == null || appId == null) return false
    try {
      const result = this.db.raw
        .prepare(
          `UPDATE sub_app_jobs SET status='cancelled', finished_at=?, updated_at=?,
             error_json=COALESCE(error_json, ?) WHERE id=? AND app_id=? AND status IN ('queued','running','interrupted')`,
        )
        .run(
          new Date().toISOString(),
          new Date().toISOString(),
          JSON.stringify({ code: 'USER_ABANDONED', message: '用户在恢复中心放弃该任务，现场已保留。' }),
          jobId,
          appId,
        )
      return result.changes > 0
    } catch (error) {
      log.warn('subapp job cancel writeback failed', {
        runId,
        jobId,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  /* ------------------------------------------------------------ */
  /* Drain（正常退出；方案 §10.1）                                  */
  /* ------------------------------------------------------------ */

  /**
   * 停止领取新 Run；对活跃 Run 写 shutdown Checkpoint 并转 paused /
   * needs_attention；释放租约。在 SessionService.dispose() 的取消执行器之前调用。
   */
  drainSync(reason = 'app_shutdown'): { paused: number; needsAttention: number } {
    this.draining = true
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    let paused = 0
    let needsAttention = 0
    if (!this.config.enabled) return { paused, needsAttention }
    const active = this.runRepo.listActive()
    for (const run of active) {
      if (run.status === 'accepted') continue // 未开始：保持 accepted，下次启动重放
      // SubApp 投影 Run 的状态由 sub_app_jobs 驱动（JobManager 侧 interrupt/cancel），
      // drain 不代管。
      if (run.kind === 'subapp') continue
      const unknownEffects = this.effectRepo.reconcileInflightToUnknown(run.id)
      this.checkpointWriter.write({
        runId: run.id,
        reason: 'shutdown',
        cursor: { phase: 'drained' },
        runtimeBinding: {
          engine: run.runtimeKind,
        },
      })
      const lease = this.ownedLeases.get(run.id)
      if (lease != null) {
        this.runRepo.releaseLease(run.id, lease.owner, lease.epoch)
        this.ownedLeases.delete(run.id)
      }
      if (unknownEffects > 0) {
        this.runRepo.markNeedsAttention(run.id, `${reason}:effects_unknown`)
        needsAttention += 1
      } else {
        this.runRepo.markPaused(run.id, reason)
        paused += 1
      }
    }
    log.info('drain complete', { paused, needsAttention })
    return { paused, needsAttention }
  }

  isDraining(): boolean {
    return this.draining
  }

  /* ------------------------------------------------------------ */
  /* 持久 HITL 等待（Phase 3A：方案 §6.5/§11.4）                    */
  /* ------------------------------------------------------------ */

  /**
   * HITL 请求先落库再推 UI（幂等：同 (run, step, type) 不重复弹卡）。
   * 返回 waitId；无关联 Run 时返回 null（保持旧行为，不阻塞提问本身）。
   */
  recordWaitOpened(
    turnId: string,
    type: 'question' | 'permission' | 'plan',
    request: unknown,
    stepKey?: string,
  ): string | null {
    if (!this.config.enabled) return null
    try {
      const runId = this.resolveRunIdByTurn(turnId)
      if (runId == null) return null
      // stepKey 去重键：同类型等待以稳定 step 关联（无 step 时用 type 兜底行）。
      const wait = this.waitRepo.ensureOpen({
        id: `ewt_${crypto.randomUUID()}`,
        runId,
        stepId: null,
        type,
        requestJson: request,
      })
      // 稳定步骤登记（审计可见；open 唯一部分索引保证幂等）。
      if (stepKey != null) {
        this.stepRepo.ensure({
          id: `est_${crypto.randomUUID()}`,
          runId,
          stableKey: stepKey,
          kind: 'wait',
        })
      }
      this.outboxRepo.enqueue({
        id: `eox_${crypto.randomUUID()}`,
        runId,
        eventType: 'wait_opened',
        payload: { waitId: wait.id, type },
      })
      return wait.id
    } catch (error) {
      log.warn('wait recording failed', {
        turnId,
        type,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /** 用户回答先落库（CAS；重复提交只返回原结果），再由原控制流/恢复路径唤醒。 */
  recordWaitAnswered(waitId: string, outcome: 'answered' | 'denied', answer: unknown): void {
    if (waitId == null) return
    try {
      const result = this.waitRepo.answer(waitId, outcome, answer)
      if (result.changed && result.record != null) {
        this.outboxRepo.enqueue({
          id: `eox_${crypto.randomUUID()}`,
          runId: result.record.runId,
          eventType: 'wait_answered',
          payload: { waitId, outcome },
        })
      }
    } catch (error) {
      log.warn('wait answer recording failed', {
        waitId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /* ------------------------------------------------------------ */
  /* 心跳                                                          */
  /* ------------------------------------------------------------ */

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer != null) return
    const interval = Math.max(5_000, this.config.heartbeatIntervalMs)
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat()
    }, interval)
    this.heartbeatTimer.unref?.()
  }

  private heartbeat(): void {
    for (const [runId, lease] of this.ownedLeases.entries()) {
      const ok = this.runRepo.renewLease(runId, lease.owner, lease.epoch, this.config.leaseDurationMs)
      if (!ok) {
        // 租约丢失（过期被接管/数据库异常）：停止续租，后续提交会被 fencing 拒绝。
        this.ownedLeases.delete(runId)
        log.warn('lease lost during heartbeat', { runId, epoch: lease.epoch })
      }
    }
    if (this.ownedLeases.size === 0 && this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /* ------------------------------------------------------------ */
  /* 恢复中心动作（方案 §13）                                       */
  /* ------------------------------------------------------------ */

  resolveRun(
    runId: string,
    action: 'safe_continue' | 'confirm_unknown_effects' | 'restart_from_checkpoint' | 'abandon_keep_state' | 'cancel_run',
  ): { ok: boolean; message: string; status: ExecutionRunStatus | null } {
    const run = this.runRepo.get(runId)
    if (run == null) return { ok: false, message: 'Run 不存在', status: null }
    switch (action) {
      case 'safe_continue': {
        if (run.status !== 'needs_attention' && run.status !== 'paused' && run.status !== 'orphaned') {
          return { ok: false, message: `当前状态 ${run.status} 不支持安全继续`, status: run.status }
        }
        // goal Run：委托 SessionService 重新泵迭代（迭代水位 = 持久 progressLog）。
        if (run.kind === 'goal') {
          if (run.sessionId == null || this.turnDelegate == null) {
            return { ok: false, message: 'goal 恢复需要会话上下文', status: run.status }
          }
          const resumed = this.turnDelegate.resumeGoalLoop(run.sessionId)
          if (resumed) {
            const recovering = this.runRepo.markRecovering(runId)
            return {
              ok: true,
              message: '已恢复目标迭代循环',
              status: recovering ? 'recovering' : run.status,
            }
          }
          return { ok: false, message: '目标当前不可恢复（可能已暂停或无活动目标）', status: run.status }
        }
        if (run.kind === 'workflow') {
          return {
            ok: true,
            message: '工作流将在您下次于所属会话发送消息时自动继续（使用冻结的图版本）',
            status: run.status,
          }
        }
        if (!this.runRepo.markRecovering(runId)) {
          return { ok: false, message: '状态切换失败（Run 状态已变化），请刷新后重试', status: run.status }
        }
        if (run.kind === 'turn' && this.turnDelegate != null) {
          const plan = this.planner.latestPlanForRun(runId)
          if (plan != null) {
            this.turnDelegate.resumeTurnRun(run, plan)
            this.planRepo.updateStatus(plan.planId, 'executing')
            return { ok: true, message: '已创建恢复 Turn', status: 'recovering' }
          }
        }
        return { ok: true, message: '已进入恢复状态', status: 'recovering' }
      }
      case 'confirm_unknown_effects': {
        const unknown = this.effectRepo.listByPhase(runId, 'unknown')
        for (const effect of unknown) {
          this.effectRepo.reconcileUnknown(effect.id, 'confirmed')
        }
        this.outboxRepo.enqueue({
          id: `eox_${crypto.randomUUID()}`,
          runId,
          eventType: 'effect_reconciled',
          payload: { count: unknown.length, outcome: 'user_confirmed' },
        })
        return {
          ok: true,
          message: `已确认 ${unknown.length} 个未知副作用为已发生`,
          status: run.status,
        }
      }
      case 'restart_from_checkpoint': {
        const latest = this.checkpointRepo.getLatest(runId)
        if (latest == null) return { ok: false, message: '无可用的恢复点', status: run.status }
        // running 等活跃执行中的 Run 禁止重启：否则会派生第二个执行器并
        // 抢走活租约，造成同一 Run 双执行器交叉写入。
        if (run.status !== 'needs_attention' && run.status !== 'paused' && run.status !== 'orphaned') {
          return { ok: false, message: `当前状态 ${run.status} 不支持从恢复点重启`, status: run.status }
        }
        if (!this.runRepo.markRecovering(runId)) {
          return { ok: false, message: '状态切换失败（Run 状态已变化），请刷新后重试', status: run.status }
        }
        if (run.kind === 'turn' && this.turnDelegate != null) {
          const plan = this.planner.latestPlanForRun(runId)
          if (plan != null) {
            this.turnDelegate.resumeTurnRun(run, plan)
            this.planRepo.updateStatus(plan.planId, 'executing')
            return { ok: true, message: `已从恢复点 #${latest.sequence} 重启任务`, status: 'recovering' }
          }
        }
        return { ok: true, message: `已从恢复点 #${latest.sequence} 重启`, status: 'recovering' }
      }
      case 'abandon_keep_state':
      case 'cancel_run': {
        // SubApp 投影 Run：放弃时同步写回 sub_app_jobs（cancelled + 现场保留）。
        if (run.kind === 'subapp') {
          const jobCancelled = this.cancelProjectedSubAppJob(runId)
          const cancelled = this.checkpointWriter.finalizeRun(
            runId,
            'cancelled',
            action === 'abandon_keep_state' ? 'user_abandoned_keep_state' : 'user_cancelled',
          )
          if (cancelled) this.planRepo.settleActiveForRun(runId, 'superseded')
          return {
            ok: cancelled || jobCancelled,
            message: jobCancelled
              ? '任务已取消（子应用任务状态已同步），现场已保留'
              : cancelled
                ? '任务已取消，现场已保留'
                : '取消失败（可能已是终态）',
            status: cancelled ? 'cancelled' : run.status,
          }
        }
        const cancelled = this.checkpointWriter.finalizeRun(
          runId,
          'cancelled',
          action === 'abandon_keep_state' ? 'user_abandoned_keep_state' : 'user_cancelled',
        )
        if (cancelled) this.planRepo.settleActiveForRun(runId, 'superseded')
        return {
          ok: cancelled,
          message: cancelled ? '任务已取消，现场已保留' : '取消失败（可能已是终态）',
          status: cancelled ? 'cancelled' : run.status,
        }
      }
    }
  }

  /* ------------------------------------------------------------ */
  /* 查询（恢复中心 IPC）                                           */
  /* ------------------------------------------------------------ */

  listRunSummaries(params: {
    activeOnly?: boolean
    kind?: ExecutionRunKind
    sessionId?: string
    limit?: number
  }): ExecutionRunSummary[] {
    // activeOnly=false 时包含终态 Run（恢复中心历史视图；终态保留期由 janitor 决定）。
    const runs = params.activeOnly
      ? this.runRepo.listNonTerminalRecent(params.limit ?? 100)
      : this.runRepo.listByStatuses(
          [...ACTIVE_EXECUTION_RUN_STATUSES, 'completed', 'failed', 'cancelled'],
          params.limit ?? 100,
        )
    return runs
      .filter((run) => (params.kind != null ? run.kind === params.kind : true))
      .filter((run) => (params.sessionId != null ? run.sessionId === params.sessionId : true))
      .map((run) => this.toSummary(run))
  }

  getRunDetail(runId: string) {
    const run = this.runRepo.get(runId)
    if (run == null) return null
    const steps = this.stepRepo.listByRun(runId)
    const effects = this.effectRepo.listByRun(runId)
    const waits = this.waitRepo.listByRun(runId)
    const checkpoints = this.checkpointRepo.listByRun(runId)
    const planRow = this.planRepo.getLatestForRun(runId)
    const plan = this.planRepo.parsePlan(planRow)
    return {
      run: this.toSummary(run),
      steps: steps.map((step) => ({
        id: step.id,
        stableKey: step.stableKey,
        kind: step.kind,
        status: step.status,
        attempt: step.attempt,
        startedAt: step.startedAt,
        committedAt: step.committedAt,
      })),
      effects: effects.map((effect) => ({
        id: effect.id,
        stepId: effect.stepId,
        toolName: effect.toolName,
        replayPolicy: effect.replayPolicy,
        phase: effect.phase,
        externalReceiptRef: effect.externalReceiptRef,
        updatedAt: effect.updatedAt,
      })),
      waits: waits.map((wait) => ({
        id: wait.id,
        type: wait.type,
        status: wait.status,
        createdAt: wait.createdAt,
        answeredAt: wait.answeredAt,
      })),
      checkpoints: checkpoints.map((cp) => ({
        id: cp.id,
        sequence: cp.sequence,
        reason: cp.reason,
        createdAt: cp.created_at,
      })),
      latestPlan:
        plan != null
          ? {
              id: planRow!.id,
              decision: plan.decision,
              achievedLevel: plan.achievedLevel,
              degradationReasons: plan.degradationReasons,
              recoveryMethod: plan.recoveryMethod,
              createdAt: plan.createdAt,
            }
          : null,
    }
  }

  private toSummary(run: ExecutionRunRecord): ExecutionRunSummary {
    const stepCounts = this.stepRepo.countByStatus(run.id)
    const effectCounts = this.effectRepo.countByPhase(run.id)
    const latest = this.checkpointRepo.getLatest(run.id)
    return {
      id: run.id,
      sessionId: run.sessionId,
      rootTurnId: run.rootTurnId,
      kind: run.kind,
      status: run.status,
      runtimeKind: run.runtimeKind,
      requestedRecoveryMode: run.requestedRecoveryMode,
      capabilityCeiling: run.capabilityCeiling,
      currentGuaranteedLevel: run.currentGuaranteedLevel,
      latestCheckpointId: run.latestCheckpointId,
      latestCheckpointAt: latest?.created_at ?? null,
      attempt: run.attempt,
      interruptionReason: run.interruptionReason,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      stepCounts: {
        committed: stepCounts.committed,
        running: stepCounts.running,
        uncertain: stepCounts.uncertain,
        waiting: stepCounts.waiting,
        planned: stepCounts.planned,
      },
      effectCounts: {
        confirmed: effectCounts.confirmed,
        dispatching: effectCounts.dispatching,
        unknown: effectCounts.unknown,
        prepared: effectCounts.prepared,
      },
      openWaits: this.waitRepo.listOpen(run.id).length,
    }
  }

  getStartupSummary(): StartupScanSummary | null {
    return this.lastScanSummary
  }

  /** 脱敏诊断导出（方案 §6.7：不包含凭据/环境变量/Authorization）。 */
  exportDiagnostics(runId: string): string {
    const detail = this.getRunDetail(runId)
    if (detail == null) return JSON.stringify({ error: 'run_not_found' })
    // 仅保留摘要级字段；requestJson/answerJson 等载荷已在 detail 中排除。
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        supervisor: this.workerOwner,
        run: detail.run,
        steps: detail.steps.map((s: { status: ExecutionStepStatus; kind: ExecutionStepKind }) => ({
          kind: s.kind,
          status: s.status,
        })),
        effects: detail.effects.map((e: { phase: ExecutionEffectPhase; replayPolicy: ToolReplayPolicy }) => ({
          phase: e.phase,
          replayPolicy: e.replayPolicy,
        })),
        waits: detail.waits,
        checkpoints: detail.checkpoints,
        latestPlan: detail.latestPlan,
      },
      null,
      2,
    )
  }

  /** outbox 泵：发布待发事件并回调（供 UI 刷新通知）。 */
  pumpOutbox(onEvent?: (runId: string, eventType: string, payload: unknown) => void): number {
    const pending = this.outboxRepo.takePending(50)
    if (pending.length === 0) return 0
    for (const event of pending) {
      try {
        onEvent?.(event.run_id, event.event_type, JSON.parse(event.payload_json))
      } catch {
        // 单事件发布失败不阻塞整批标记。
      }
    }
    this.outboxRepo.markPublished(pending.map((event) => event.id))
    return pending.length
  }

  /** 清理基线（方案 §6.7/Phase 4）：终态 Run 与已发布 outbox 的 janitor。 */
  runJanitor(retentionDays = 30): { runsDeleted: number; outboxDeleted: number } {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    const runsDeleted = this.runRepo.deleteTerminalBefore(cutoff)
    const outboxDeleted = this.outboxRepo.deletePublishedBefore(cutoff)
    if (runsDeleted > 0 || outboxDeleted > 0) {
      log.info('janitor cleaned', { runsDeleted, outboxDeleted })
    }
    return { runsDeleted, outboxDeleted }
  }

  dispose(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.ownedLeases.clear()
  }

  /** Adapter 能力声明透出（测试/诊断用）。 */
  adapterDeclarations(): Record<string, { capabilityCeiling: RecoveryLevel; supportsNativeResume: boolean }> {
    return Object.fromEntries(
      Object.entries(ADAPTER_DECLARATIONS).map(([kind, decl]) => [
        kind,
        { capabilityCeiling: decl.capabilityCeiling, supportsNativeResume: decl.supportsNativeResume },
      ]),
    )
  }
}
