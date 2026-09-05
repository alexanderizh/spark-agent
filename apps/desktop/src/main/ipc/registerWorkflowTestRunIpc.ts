/**
 * @module registerWorkflowTestRunIpc
 *
 * 工作流「编辑器内试跑」IPC（workflow:test-run）。
 *
 * 设计原则：不造无会话的执行旁路。试跑 = 复用/新建绑定该工作流的 agent → 创建试跑
 * 会话 → 提交一条以 objective 为内容的用户 turn。运行时（managed executor、审批、
 * 重试、进度事件、workflow_runs 留档）与用户正常触发完全一致，会话里同步留档，
 * 历史回看面板事后可查。
 *
 * agent 解析策略：
 * - 已有 agent 绑定该 workflowId（enabled）→ 原样复用（尊重用户自配的 adapter/provider）。
 * - 没有 → 新建临时试跑 agent（默认 claude-sdk adapter，workflow_run 托管模式），
 *   下次试跑同一工作流直接复用，不重复创建。
 */

import {
  detectWorkflowGraphCycles,
  formatWorkflowCycleError,
  normalizeWorkflowGraph,
  ProviderService,
  SessionService,
} from '@spark/agent-runtime'
import type { WorkflowTestRunRequest, WorkflowTestRunResponse } from '@spark/protocol'
import { AgentRepository, WorkflowRepository } from '@spark/storage'
import { getDatabase } from '../db.js'
import { typedIpcHandle } from './typed-ipc.js'

interface WorkflowTestRunDeps {
  workflowRepo: WorkflowRepository
  agentRepo: AgentRepository
  providerService: ProviderService
  sessionService: SessionService
}

/** 解析本次试跑使用的 agent：优先复用已绑定该工作流的 agent，否则新建临时试跑 agent。 */
function resolveTestRunAgent(
  deps: WorkflowTestRunDeps,
  workflowId: string,
  workflowName: string,
): { agentId: string; agentName: string; created: boolean } {
  const bound = deps.agentRepo
    .list({ includeDisabled: true })
    .find((agent) => agent.workflowId === workflowId && agent.enabled)
  if (bound != null) {
    return { agentId: bound.id, agentName: bound.name, created: false }
  }
  const created = deps.agentRepo.create({
    name: `${workflowName} · 试跑`,
    description: '工作流编辑器试跑自动创建，可随时删除（删除后下次试跑会重建）。',
    workflowId,
  })
  return { agentId: created.id, agentName: created.name, created: true }
}

export function registerWorkflowTestRunIpc(deps?: Partial<WorkflowTestRunDeps>): void {
  const resolved: WorkflowTestRunDeps = {
    workflowRepo: deps?.workflowRepo ?? new WorkflowRepository(getDatabase()),
    agentRepo: deps?.agentRepo ?? new AgentRepository(getDatabase()),
    // ProviderService / SessionService 无独立 getter 导出，由 index.ts 接线时注入
    // （两个服务都有进程级单例语义，测试时全部注入即可）；断言仅收窄类型，运行时行为不变。
    providerService: deps?.providerService as ProviderService,
    sessionService: deps?.sessionService as SessionService,
  }

  typedIpcHandle(
    'workflow:test-run',
    async (request: WorkflowTestRunRequest): Promise<WorkflowTestRunResponse> => {
      const workflow = resolved.workflowRepo.get(request.workflowId)
      if (workflow == null) {
        throw new Error(`Workflow not found: ${request.workflowId}`)
      }

      // 试跑前环校验：与其让运行进行到一半以 workflow_deadlock 失败，不如提前拦截。
      const cycleReports = detectWorkflowGraphCycles(
        normalizeWorkflowGraph(workflow.graph as Parameters<typeof normalizeWorkflowGraph>[0]),
      )
      if (cycleReports.length > 0) {
        throw new Error(formatWorkflowCycleError(cycleReports))
      }

      const agent = resolveTestRunAgent(resolved, workflow.id, workflow.name)

      // provider：绑定 agent 自带且仍可用则尊重其选择，否则回落默认/第一个可用 profile。
      const profiles = await resolved.providerService.listProviders()
      if (profiles.length === 0) {
        throw new Error('没有可用的 Provider，请先在设置中配置后再试跑工作流。')
      }
      const agentProviderId = resolved.agentRepo.get(agent.agentId)?.providerProfileId
      const providerProfileId =
        (agentProviderId != null && profiles.some((p) => p.id === agentProviderId)
          ? agentProviderId
          : undefined) ?? (profiles.find((p) => p.isDefault) ?? profiles[0])!.id

      const objective =
        request.objective?.trim() ||
        workflow.description?.trim() ||
        `试跑工作流「${workflow.name}」`

      const created = await resolved.sessionService.createSession({
        providerProfileId,
        agentId: agent.agentId,
        title: `试跑 · ${workflow.name}`,
      })
      // workflow_run 模式的系统提示词要求模型把当前用户消息作为 objective 恰好调用一次
      // workflow_run，因此直接提交 objective 本身即可触发真实执行。
      await resolved.sessionService.submitTurn({
        sessionId: created.sessionId,
        message: objective,
      })

      return {
        sessionId: created.sessionId,
        agentId: agent.agentId,
        agentName: agent.agentName,
        createdAgent: agent.created,
      }
    },
  )
}
