/**
 * @module registerWorkflowTestRunIpc
 *
 * 工作流「编辑器内试跑」IPC（workflow:test-run）。
 *
 * 设计原则：不造无会话的执行旁路。试跑 = 经 WorkflowSessionLauncher 创建
 * 会话（Binding 路径：普通会话 + 原子 override Binding，不再新建试跑 Agent；
 * 开关关闭时保持旧路径：复用/新建绑定该工作流的 agent）→ 提交一条以
 * objective 为内容的用户 turn。运行时（managed executor、审批、重试、进度
 * 事件、workflow_runs 留档）与用户正常触发完全一致，会话里同步留档，
 * 历史回看面板事后可查。
 */

import { ProviderService, SessionService, WorkflowSessionLauncher } from '@spark/agent-runtime'
import type { WorkflowTestRunRequest, WorkflowTestRunResponse } from '@spark/protocol'
import {
  AgentRepository,
  SettingsRepository,
  TurnRequestRepository,
  WorkflowRepository,
  WorkflowRunRepository,
} from '@spark/storage'
import { getDatabase } from '../db.js'
import { typedIpcHandle } from './typed-ipc.js'

interface WorkflowTestRunDeps {
  workflowRepo: WorkflowRepository
  workflowRunRepo: WorkflowRunRepository
  turnRequestRepo: TurnRequestRepository
  agentRepo: AgentRepository
  settingsRepo: SettingsRepository
  providerService: ProviderService
  sessionService: SessionService
  launchingWorkflowIds: Set<string>
}

/**
 * 覆盖“检查运行记录 → 创建会话 → 提交 turn → workflow_run 建档”之间尚无持久化记录的窗口。
 * JS 主进程内 Set.add 是同步的，同一 workflowId 的并发 IPC 只有第一个能进入启动区间。
 */
const launchingWorkflowIds = new Set<string>()

export function registerWorkflowTestRunIpc(deps?: Partial<WorkflowTestRunDeps>): void {
  const launcher = new WorkflowSessionLauncher({
    workflowRepo: deps?.workflowRepo ?? new WorkflowRepository(getDatabase()),
    workflowRunRepo: deps?.workflowRunRepo ?? new WorkflowRunRepository(getDatabase()),
    turnRequestRepo: deps?.turnRequestRepo ?? new TurnRequestRepository(getDatabase()),
    agentRepo: deps?.agentRepo ?? new AgentRepository(getDatabase()),
    settingsRepo: deps?.settingsRepo ?? new SettingsRepository(getDatabase()),
    // ProviderService / SessionService 无独立 getter 导出，由 index.ts 接线时注入
    // （两个服务都有进程级单例语义，测试时全部注入即可）；断言仅收窄类型，运行时行为不变。
    providerService: deps?.providerService as ProviderService,
    sessionService: deps?.sessionService as unknown as SessionService,
    launchingWorkflowIds: deps?.launchingWorkflowIds ?? launchingWorkflowIds,
  })

  typedIpcHandle(
    'workflow:test-run',
    async (request: WorkflowTestRunRequest): Promise<WorkflowTestRunResponse> => {
      const result = await launcher.launch({
        workflowId: request.workflowId,
        ...(request.objective != null ? { objective: request.objective } : {}),
        source: 'editor-test',
      })
      return {
        sessionId: result.sessionId,
        agentId: result.hostAgentId,
        agentName: result.hostAgentName,
        createdAgent: result.createdAgent,
      }
    },
  )
}
