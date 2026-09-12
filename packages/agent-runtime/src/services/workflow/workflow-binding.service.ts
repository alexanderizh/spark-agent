import {
  AgentRepository,
  GoalRepository,
  SessionRepository,
  SessionWorkflowBindingConflictError,
  SessionWorkflowBindingRepository,
  SettingsRepository,
  WorkflowRepository,
  WorkflowRunRepository,
  type SparkDatabase,
  type WorkflowRunRow,
} from '@spark/storage'
import type {
  BindingChangeBlocker,
  EffectiveWorkflowSummary,
  SessionAbandonWorkflowRunRequest,
  SessionAbandonWorkflowRunResponse,
  SessionGetWorkflowBindingResponse,
  SessionSetWorkflowBindingRequest,
  SessionSetWorkflowBindingResponse,
  WorkflowRunSummary,
} from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { normalizeWorkflowGraph } from '../workflow-executor.js'
import { hasWorkflowExecutableNodes } from '../session-workflow-helpers.js'
import { getAgentAdapterFromSession } from '../session/engine-kinds.js'
import { readSessionTeamConfig } from '../session/session-pure-utils.js'
import { resolveWorkflowExecutionModeCapability } from './workflow-execution-mode.js'
import { readSessionWorkflowFeatureFlags } from './session-workflow-feature-flags.js'
import { WorkflowPreflightService } from './workflow-preflight.service.js'

export interface WorkflowBindingServiceHost {
  getInMemoryChangeBlockers(sessionId: string): BindingChangeBlocker[]
  onBindingChanged(sessionId: string, bindingInstanceId: string): void
}

export class WorkflowBindingService {
  constructor(
    private readonly db: SparkDatabase,
    private readonly host: WorkflowBindingServiceHost,
  ) {}

  get(sessionId: string): SessionGetWorkflowBindingResponse {
    const session = new SessionRepository(this.db).findByIdOrFail(sessionId)
    const binding = new SessionWorkflowBindingRepository(this.db).get(sessionId)
    const blockers = this.collectChangeBlockers(sessionId, session.status, session.archived_at)
    return {
      binding,
      effective: this.resolveEffectiveSummary(sessionId),
      resumableRun: this.resolveResumableRun(sessionId),
      canChange: blockers.length === 0,
      changeBlockers: blockers,
      features: readSessionWorkflowFeatureFlags(new SettingsRepository(this.db)),
    }
  }

  set(request: SessionSetWorkflowBindingRequest): SessionSetWorkflowBindingResponse {
    const flags = readSessionWorkflowFeatureFlags(new SettingsRepository(this.db))
    if (!flags.writeEnabled) {
      throw new SparkError('CAPABILITY_DISABLED', '会话工作流挂载功能尚未启用。')
    }

    const preflight = new WorkflowPreflightService(this.db).inspect(request)
    if (!preflight.ok) {
      return {
        binding: new SessionWorkflowBindingRepository(this.db).get(request.sessionId),
        effective: this.resolveEffectiveSummary(request.sessionId),
        resumableRun: this.resolveResumableRun(request.sessionId),
        changed: false,
        error: null,
        preflight,
      }
    }

    let result: ReturnType<SessionWorkflowBindingRepository['set']>
    try {
      result = this.db.raw.transaction(() => {
        const session = new SessionRepository(this.db).findByIdOrFail(request.sessionId)
        const blockers = this.collectChangeBlockers(
          request.sessionId,
          session.status,
          session.archived_at,
        )
        if (blockers.length > 0) {
          const blocker = blockers[0]
          if (blocker == null) throw new Error('binding blocker collection was empty')
          throw new SparkError('CONFLICT', localizeBlocker(blocker.code), {
            blocker: blocker.code,
          })
        }
        return new SessionWorkflowBindingRepository(this.db).set({
          sessionId: request.sessionId,
          mode: request.mode,
          ...(request.mode === 'override' ? { workflowId: request.workflowId } : {}),
          expectedBindingInstanceId: request.expectedBindingInstanceId,
        })
      })()
    } catch (error) {
      if (error instanceof SessionWorkflowBindingConflictError) {
        return this.failureResponse(request.sessionId, preflight, { code: error.code })
      }
      if (
        error instanceof SparkError &&
        typeof error.context?.blocker === 'string' &&
        isBindingChangeBlockerCode(error.context.blocker)
      ) {
        return this.failureResponse(request.sessionId, preflight, {
          code: error.context.blocker,
        })
      }
      throw error
    }

    if (result.changed) {
      this.host.onBindingChanged(request.sessionId, result.binding.bindingInstanceId)
    }
    return {
      binding: result.binding,
      effective: this.resolveEffectiveSummary(request.sessionId),
      resumableRun: this.resolveResumableRun(request.sessionId),
      changed: result.changed,
      error: null,
      preflight,
    }
  }

  /**
   * 「放弃并新建运行」（方案 §7.3）：当前代次的 failed Run 标记 canceled 并
   * 轮换 Binding 代次。历史保留；下一次 workflow_run 调用因代次不匹配新建 Run。
   *
   * 与普通切换分开确认：runId 必须仍是当前代次最新的 resumable Run，任何状态
   * 漂移（并发恢复、并发放弃、换代）都返回 binding_conflict 让 UI 刷新。
   */
  abandonRun(request: SessionAbandonWorkflowRunRequest): SessionAbandonWorkflowRunResponse {
    const flags = readSessionWorkflowFeatureFlags(new SettingsRepository(this.db))
    if (!flags.writeEnabled) {
      throw new SparkError('CAPABILITY_DISABLED', '会话工作流挂载功能尚未启用。')
    }

    const bindingRepo = new SessionWorkflowBindingRepository(this.db)
    const runRepo = new WorkflowRunRepository(this.db)
    const binding = bindingRepo.get(request.sessionId)
    const resumable =
      binding == null
        ? null
        : runRepo.findLatestResumableByBinding(request.sessionId, binding.bindingInstanceId)

    // 前置校验全部走只读快照，避免事务内先抛 SparkError 带来的部分写。
    if (
      binding == null ||
      binding.bindingInstanceId !== request.expectedBindingInstanceId ||
      resumable == null ||
      resumable.id !== request.runId
    ) {
      return {
        binding,
        effective: this.resolveEffectiveSummary(request.sessionId),
        resumableRun: resumable == null ? null : toRunSummary(resumable),
        abandonedRunId: null,
        changed: false,
        error: { code: 'binding_conflict' },
      }
    }
    if (resumable.status === 'working') {
      return {
        binding,
        effective: this.resolveEffectiveSummary(request.sessionId),
        resumableRun: toRunSummary(resumable),
        abandonedRunId: null,
        changed: false,
        error: { code: 'workflow_run_working' },
      }
    }

    let newBinding: ReturnType<SessionWorkflowBindingRepository['rotateGeneration']>
    try {
      newBinding = this.db.raw.transaction(() => {
        const session = new SessionRepository(this.db).findByIdOrFail(request.sessionId)
        const blockers = this.collectChangeBlockers(
          request.sessionId,
          session.status,
          session.archived_at,
        )
        if (blockers.length > 0) {
          const blocker = blockers[0]
          if (blocker == null) throw new Error('binding blocker collection was empty')
          throw new SparkError('CONFLICT', localizeBlocker(blocker.code), {
            blocker: blocker.code,
          })
        }
        // markAbandoned 只影响 failed 行；0 行说明并发状态变化，按冲突处理。
        if (runRepo.markAbandoned(resumable.id) !== 1) {
          throw new SparkError('CONFLICT', localizeBlocker('binding_conflict'), {
            blocker: 'binding_conflict',
          })
        }
        return bindingRepo.rotateGeneration(request.sessionId, request.expectedBindingInstanceId)
      })()
    } catch (error) {
      if (error instanceof SessionWorkflowBindingConflictError) {
        return this.abandonFailureResponse(request.sessionId, { code: error.code })
      }
      if (
        error instanceof SparkError &&
        typeof error.context?.blocker === 'string' &&
        isBindingChangeBlockerCode(error.context.blocker)
      ) {
        return this.abandonFailureResponse(request.sessionId, {
          code: error.context.blocker,
        })
      }
      throw error
    }

    this.host.onBindingChanged(request.sessionId, newBinding.bindingInstanceId)
    return {
      binding: newBinding,
      effective: this.resolveEffectiveSummary(request.sessionId),
      resumableRun: null,
      abandonedRunId: resumable.id,
      changed: true,
      error: null,
    }
  }

  private abandonFailureResponse(
    sessionId: string,
    error: BindingChangeBlocker,
  ): SessionAbandonWorkflowRunResponse {
    return {
      binding: new SessionWorkflowBindingRepository(this.db).get(sessionId),
      effective: this.resolveEffectiveSummary(sessionId),
      resumableRun: this.resolveResumableRun(sessionId),
      abandonedRunId: null,
      changed: false,
      error,
    }
  }

  private failureResponse(
    sessionId: string,
    preflight: SessionSetWorkflowBindingResponse['preflight'],
    error: BindingChangeBlocker,
  ): SessionSetWorkflowBindingResponse {
    return {
      binding: new SessionWorkflowBindingRepository(this.db).get(sessionId),
      effective: this.resolveEffectiveSummary(sessionId),
      resumableRun: this.resolveResumableRun(sessionId),
      changed: false,
      error,
      preflight,
    }
  }

  private collectChangeBlockers(
    sessionId: string,
    status: string,
    archivedAt: string | null,
  ): BindingChangeBlocker[] {
    const blockers = [...this.host.getInMemoryChangeBlockers(sessionId)]
    if (status === 'running' || archivedAt != null) blockers.push({ code: 'session_busy' })
    const queued = this.db.raw
      .prepare(
        "SELECT 1 FROM turn_requests WHERE session_id = ? AND status IN ('accepted','running') LIMIT 1",
      )
      .get(sessionId)
    if (queued != null) blockers.push({ code: 'turn_queue_not_empty' })
    if (new GoalRepository(this.db).getCurrent(sessionId) != null)
      blockers.push({ code: 'goal_active' })
    const binding = new SessionWorkflowBindingRepository(this.db).get(sessionId)
    if (
      binding != null &&
      new WorkflowRunRepository(this.db).findLatestResumableByBinding(
        sessionId,
        binding.bindingInstanceId,
      )?.status === 'working'
    ) {
      blockers.push({ code: 'workflow_run_working' })
    }
    return dedupeBlockers(blockers)
  }

  private resolveEffectiveSummary(sessionId: string): EffectiveWorkflowSummary {
    const session = new SessionRepository(this.db).findByIdOrFail(sessionId)
    const agentRepo = new AgentRepository(this.db)
    const team = readSessionTeamConfig(session)
    const hostAgent =
      team?.enabled === true
        ? (agentRepo.get(team.hostAgentId) ?? agentRepo.get(session.agent_id))
        : agentRepo.get(session.agent_id)
    if (hostAgent == null) throw new SparkError('NOT_FOUND', '会话 Agent 不存在。')
    const binding = new SessionWorkflowBindingRepository(this.db).get(sessionId)
    const source =
      binding == null
        ? hostAgent.workflowId == null
          ? 'none'
          : 'legacy-agent'
        : binding.mode === 'disabled'
          ? 'session-disabled'
          : binding.mode === 'override'
            ? 'session-override'
            : 'session-inherit'
    const workflowId =
      binding?.mode === 'disabled'
        ? null
        : binding?.mode === 'override'
          ? binding.workflowId
          : (hostAgent.workflowId ?? null)
    const workflow = workflowId == null ? null : new WorkflowRepository(this.db).get(workflowId)
    const graph = workflow == null ? null : normalizeWorkflowGraph(workflow.graph)
    const enabledIds = new Set(agentRepo.list().map((agent) => agent.id))
    const managed = graph != null && hasWorkflowExecutableNodes(graph, enabledIds, hostAgent.id)
    return {
      source,
      bindingInstanceId: binding?.bindingInstanceId ?? null,
      hostAgentId: hostAgent.id,
      workflowId,
      workflowName: workflow?.name ?? null,
      workflowVersion: workflow?.version ?? null,
      workflowStatus: workflow?.status ?? null,
      workflowEnabled: workflow?.enabled ?? null,
      executionMode:
        workflowId == null
          ? 'none'
          : resolveWorkflowExecutionModeCapability({
              agentAdapter: getAgentAdapterFromSession(
                session.agent_adapter,
                session.chat_mode,
                null,
              ),
              hasWorkflowGraph: graph != null,
              managedExecutorAvailable: managed,
              isMentionTurn: false,
            }),
    }
  }

  private resolveResumableRun(sessionId: string): WorkflowRunSummary | null {
    const binding = new SessionWorkflowBindingRepository(this.db).get(sessionId)
    if (binding == null) return null
    const row = new WorkflowRunRepository(this.db).findLatestResumableByBinding(
      sessionId,
      binding.bindingInstanceId,
    )
    return row == null ? null : toRunSummary(row)
  }
}

function toRunSummary(row: WorkflowRunRow): WorkflowRunSummary {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status,
    objective: row.objective,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    graphDigest: row.workflow_graph_digest,
  }
}

function dedupeBlockers(blockers: BindingChangeBlocker[]): BindingChangeBlocker[] {
  return [...new Map(blockers.map((blocker) => [blocker.code, blocker])).values()]
}

function localizeBlocker(code: BindingChangeBlocker['code']): string {
  const messages: Record<BindingChangeBlocker['code'], string> = {
    session_busy: '会话正在运行或已归档，暂时不能修改工作流。',
    turn_queue_not_empty: '会话仍有待处理消息，暂时不能修改工作流。',
    approval_pending: '请先处理当前审批，再修改工作流。',
    question_pending: '请先回答当前问题，再修改工作流。',
    goal_active: '当前目标仍在进行中，暂时不能修改工作流。',
    workflow_run_working: '工作流正在执行，请先取消运行。',
    binding_conflict: '工作流挂载已发生变化，请刷新后重试。',
  }
  return messages[code]
}

function isBindingChangeBlockerCode(value: string): value is BindingChangeBlocker['code'] {
  return [
    'session_busy',
    'turn_queue_not_empty',
    'approval_pending',
    'question_pending',
    'goal_active',
    'workflow_run_working',
    'binding_conflict',
  ].includes(value)
}
