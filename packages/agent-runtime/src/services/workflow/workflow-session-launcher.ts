import type {
  AgentItem,
  AgentRepository,
  SettingsRepository,
  TurnRequestRepository,
  WorkflowRepository,
  WorkflowRunRepository,
} from '@spark/storage'
import type { ProviderService } from '../provider.service.js'
import type { SessionService } from '../session.service.js'
import { SparkError } from '@spark/shared'
import {
  detectWorkflowConditionReferenceErrors,
  detectWorkflowGraphCycles,
  formatWorkflowConditionReferenceError,
  formatWorkflowCycleError,
  normalizeWorkflowGraph,
} from '../workflow-executor.js'
import { readSessionWorkflowFeatureFlags } from './session-workflow-feature-flags.js'

/** 启动入口标识：决定 draft 放行、Run 审计来源与会话 owner 语义。 */
export type WorkflowSessionLaunchSource = 'editor-test' | 'tool-package'

export interface WorkflowSessionLauncherDeps {
  workflowRepo: Pick<WorkflowRepository, 'get'>
  workflowRunRepo: Pick<WorkflowRunRepository, 'findWorkingByWorkflow'>
  turnRequestRepo: Pick<TurnRequestRepository, 'get'>
  agentRepo: Pick<AgentRepository, 'get' | 'list' | 'create'>
  settingsRepo: Pick<SettingsRepository, 'get'>
  providerService: Pick<ProviderService, 'listProviders'>
  sessionService: Pick<SessionService, 'createSession' | 'submitTurn' | 'deleteSession'>
  /** 覆盖“检查运行记录 → 创建会话 → 提交 turn → workflow_run 建档”的启动窗口锁。 */
  launchingWorkflowIds: Set<string>
  /** 释放锁的轮询参数（测试可缩短）。 */
  launchPollMs?: number
  launchTimeoutMs?: number
}

export interface LaunchWorkflowSessionInput {
  workflowId: string
  objective?: string
  source: WorkflowSessionLaunchSource
  title?: string
  modelId?: string
  workspaceId?: string
  /** 显式 Provider（Tool Package 请求可带）；缺省按 宿主 Agent → 默认 → 首个可用 回落。 */
  providerProfileId?: string
  /** 指定宿主 Agent（如复用既有绑定 Agent）；缺省由启动器解析。 */
  hostAgentId?: string
}

export interface LaunchWorkflowSessionResult {
  sessionId: string
  turnId: string
  hostAgentId: string
  hostAgentName: string
  /** 旧路径为兼容保留的“新建试跑 Agent”标记；Binding 路径恒为 false。 */
  createdAgent: boolean
  usedSessionBinding: boolean
  providerProfileId: string
}

const DEFAULT_POLL_MS = 100
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

/**
 * 工作流会话统一启动器（方案 §15 阶段 6）。
 *
 * 编辑器试跑与 Tool Package 两个启动入口共用：Provider 回落、启动锁、
 * 冲突检查、图结构校验、失败清理（turn 未被接受即删除空会话）与运行历史
 * 留档全部等价或强于各自旧实现。
 *
 * 路径选择：
 * - Binding 路径（runtimeEnabled && writeEnabled）：创建普通会话 + 原子
 *   override Binding，宿主复用既有绑定 Agent 或默认 Agent，**不再新建试跑
 *   Agent**；Run 以 binding 代次留档，binding_source 记录启动入口。
 * - 旧路径（开关关闭）：保持既有行为可回退——编辑器复用/新建试跑 Agent；
 *   Tool Package 仍要求存在绑定 Agent。
 */
export class WorkflowSessionLauncher {
  constructor(private readonly deps: WorkflowSessionLauncherDeps) {}

  async launch(input: LaunchWorkflowSessionInput): Promise<LaunchWorkflowSessionResult> {
    const workflow = this.deps.workflowRepo.get(input.workflowId)
    if (workflow == null) {
      throw new SparkError('NOT_FOUND', `工作流不存在或已删除：${input.workflowId}`)
    }
    if (this.deps.launchingWorkflowIds.has(workflow.id)) {
      throw launchConflict(workflow.name)
    }
    this.deps.launchingWorkflowIds.add(workflow.id)
    let retainLaunchLock = false
    try {
      if (this.deps.workflowRunRepo.findWorkingByWorkflow(workflow.id) != null) {
        throw launchConflict(workflow.name)
      }
      if (workflow.enabled === false) {
        throw new SparkError('VALIDATION_FAILED', `工作流「${workflow.name}」已停用，无法启动。`)
      }
      if (
        workflow.status !== 'active' &&
        !(input.source === 'editor-test' && workflow.status === 'draft')
      ) {
        throw new SparkError(
          'VALIDATION_FAILED',
          `工作流「${workflow.name}」不是 active 状态（当前 ${workflow.status}），无法在此入口启动。`,
        )
      }
      // 图结构校验前移：与其运行到一半以 workflow_deadlock 失败，不如启动前拦截。
      // 两个入口共用（Tool Package 旧实现没有该检查，属“更强”）。
      const graph = normalizeWorkflowGraph(
        workflow.graph as Parameters<typeof normalizeWorkflowGraph>[0],
      )
      const cycleReports = detectWorkflowGraphCycles(graph)
      if (cycleReports.length > 0) {
        throw new SparkError('VALIDATION_FAILED', formatWorkflowCycleError(cycleReports))
      }
      const referenceReports = detectWorkflowConditionReferenceErrors(graph)
      if (referenceReports.length > 0) {
        throw new SparkError(
          'VALIDATION_FAILED',
          formatWorkflowConditionReferenceError(referenceReports),
        )
      }

      const flags = readSessionWorkflowFeatureFlags(this.deps.settingsRepo)
      const useSessionBinding = flags.runtimeEnabled && flags.writeEnabled
      const objective =
        input.objective?.trim() || workflow.description?.trim() || `运行工作流「${workflow.name}」`
      const title =
        input.title?.trim() ||
        `${input.source === 'editor-test' ? '试跑' : '运行'} · ${workflow.name}`

      const agentPlan = this.resolveHostAgent(input, useSessionBinding, workflow.name)
      const providerProfileId = await this.resolveProvider(input, agentPlan.agent)

      const created = await this.deps.sessionService.createSession({
        providerProfileId,
        ...(agentPlan.agent != null ? { agentId: agentPlan.agent.id } : {}),
        ...(input.modelId != null ? { modelId: input.modelId } : {}),
        ...(input.workspaceId != null ? { workspaceId: input.workspaceId } : {}),
        title,
        ...(useSessionBinding
          ? {
              workflowBinding: { mode: 'override' as const, workflowId: workflow.id },
              workflowBindingSource: input.source,
            }
          : {}),
      })

      let submitted: { turnId: string }
      try {
        submitted = await this.deps.sessionService.submitTurn({
          sessionId: created.sessionId,
          message: objective,
        })
      } catch (error) {
        // turn 未被接受即失败：删除空会话，避免遗留无法产生任何运行记录的孤儿会话。
        await this.deps.sessionService.deleteSession(created.sessionId).catch(() => undefined)
        throw error
      }

      retainLaunchLock = true
      this.releaseLaunchLockAfterRuntimeStarts(workflow.id, submitted.turnId)

      return {
        sessionId: created.sessionId,
        turnId: submitted.turnId,
        hostAgentId: agentPlan.agent?.id ?? created.session.agentId,
        hostAgentName: agentPlan.agent?.name ?? 'Spark助手',
        createdAgent: agentPlan.created,
        usedSessionBinding: useSessionBinding,
        providerProfileId,
      }
    } finally {
      if (!retainLaunchLock) this.deps.launchingWorkflowIds.delete(workflow.id)
    }
  }

  /**
   * 宿主 Agent 解析。
   * - 显式指定优先（调用方已复用既有 Agent 的场景）；
   * - 已有 Agent 绑定该 workflowId（enabled）→ 原样复用（尊重用户自配的
   *   adapter/provider；两条路径与旧实现一致）；
   * - Binding 路径没有绑定 Agent 时回落默认 Agent（由 createSession 解析），
   *   **不新建试跑 Agent**；
   * - 旧路径仅编辑器保留“新建试跑 Agent”（可回退兼容）；Tool Package 旧路径
   *   沿用“无绑定 Agent 即失败”。
   */
  private resolveHostAgent(
    input: LaunchWorkflowSessionInput,
    useSessionBinding: boolean,
    workflowName: string,
  ): { agent: AgentItem | null; created: boolean } {
    if (input.hostAgentId != null) {
      const agent = this.deps.agentRepo.get(input.hostAgentId)
      if (agent == null) {
        throw new SparkError('NOT_FOUND', `指定的 Agent 不存在：${input.hostAgentId}`)
      }
      return { agent, created: false }
    }
    const bound = this.deps.agentRepo
      .list({ includeDisabled: true })
      .find((agent) => agent.workflowId === input.workflowId && agent.enabled)
    if (bound != null) return { agent: bound, created: false }

    if (useSessionBinding) return { agent: null, created: false }

    if (input.source === 'tool-package') {
      throw new SparkError('VALIDATION_FAILED', `工作流没有可用的执行 Agent：${input.workflowId}`)
    }
    const created = this.deps.agentRepo.create({
      name: `${workflowName} · 试跑`,
      description: '工作流编辑器试跑自动创建，可随时删除（删除后下次试跑会重建）。',
      workflowId: input.workflowId,
    })
    return { agent: created, created: true }
  }

  /** Provider 回落：显式 → 宿主 Agent 自带且仍可用 → 默认 → 首个可用。 */
  private async resolveProvider(
    input: LaunchWorkflowSessionInput,
    agent: AgentItem | null,
  ): Promise<string> {
    const profiles = await this.deps.providerService.listProviders()
    if (profiles.length === 0) {
      throw new SparkError('PROVIDER_UNAVAILABLE', '没有可用的 Provider，请先在设置中配置。')
    }
    if (input.providerProfileId != null) {
      if (!profiles.some((profile) => profile.id === input.providerProfileId)) {
        throw new SparkError(
          'PROVIDER_UNAVAILABLE',
          `指定的 Provider 不可用：${input.providerProfileId}`,
        )
      }
      return input.providerProfileId
    }
    const agentProviderId = agent?.providerProfileId
    if (agentProviderId != null && profiles.some((profile) => profile.id === agentProviderId)) {
      return agentProviderId
    }
    return (profiles.find((profile) => profile.isDefault) ?? profiles[0])!.id
  }

  /**
   * submitTurn 只保证 turn 已持久化并排队，不保证 workflow_run 已建档。
   * 持有启动锁直到真实 working 记录出现；turn 终态仍未建档（如 Provider 失败）
   * 或超时则释放。
   */
  private releaseLaunchLockAfterRuntimeStarts(workflowId: string, turnId: string): void {
    const startedAt = Date.now()
    const pollMs = this.deps.launchPollMs ?? DEFAULT_POLL_MS
    const timeoutMs = this.deps.launchTimeoutMs ?? DEFAULT_TIMEOUT_MS

    const inspect = (): void => {
      try {
        if (this.deps.workflowRunRepo.findWorkingByWorkflow(workflowId) != null) {
          this.deps.launchingWorkflowIds.delete(workflowId)
          return
        }
        const turnRequest = this.deps.turnRequestRepo.get(turnId)
        if (
          turnRequest == null ||
          turnRequest.status === 'completed' ||
          turnRequest.status === 'failed' ||
          turnRequest.status === 'cancelled'
        ) {
          this.deps.launchingWorkflowIds.delete(workflowId)
          return
        }
      } catch {
        // 数据库瞬时忙时继续观察；最终由超时兜底清理。
      }
      if (Date.now() - startedAt >= timeoutMs) {
        this.deps.launchingWorkflowIds.delete(workflowId)
        return
      }
      setTimeout(inspect, pollMs).unref()
    }

    inspect()
  }
}

function launchConflict(workflowName: string): SparkError {
  return new SparkError(
    'CONFLICT',
    `已有运行中的工作流「${workflowName}」，请打开现有会话或等待它结束后再试。`,
  )
}

/** 会话元数据中的启动入口标记（createSession 原子写入，供 Run 审计来源读取）。 */
export function readWorkflowLaunchSource(
  metadataJson: string | null | undefined,
): WorkflowSessionLaunchSource | null {
  try {
    const parsed = JSON.parse(metadataJson ?? '{}') as Record<string, unknown>
    const value = parsed.workflowLaunchSource
    return value === 'editor-test' || value === 'tool-package' ? value : null
  } catch {
    return null
  }
}
