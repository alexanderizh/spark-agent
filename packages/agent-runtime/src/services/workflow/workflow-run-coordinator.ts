/**
 * @module workflow-run-coordinator
 *
 * `workflow_run` 托管工具的执行协调器（方案 §15 阶段 7，行为保持式抽取）。
 *
 * 从 SessionService 原位迁出：Run 建档/按 Binding 代次续跑、workflow_progress
 * 事件、原子节点自执行分发与结果文案全部保持逐行为等价；SessionService 只
 * 负责上下文装配与 MCP 接线（经 hooks 注入持久化事件通道与三个节点级执行器）。
 * 本文件不得改动节点算法与事件顺序；执行模式扩展禁止与本抽取同一提交。
 */
import crypto from 'node:crypto'
import { z } from 'zod'
import {
  EventRepository,
  WorkflowRunRepository,
  type AgentItem,
  type SparkDatabase,
  type WorkflowRunBindingSource,
} from '@spark/storage'
import { createLogger } from '@spark/shared'
import type { AgentEvent, TeamA2AReply, WorkflowNodeKind } from '@spark/protocol'
import type { TeamToolDefinition } from '../team-mcp-http-bridge.js'
import {
  buildWorkflowAtomicInstruction,
  buildWorkflowProgressNodeMetas,
  buildWorkflowProgressNodes,
  getDefaultWorkflowAtomicContent,
  getWorkflowToolInvocationSpec,
  hasWorkflowExecutableNodes,
  runWorkflowVerifyNode,
  validateWorkflowInputStructuredContent,
  validateWorkflowRouteDecisionContent,
  workflowAtomicMemberId,
  type WorkflowToolInvocationSpec,
} from '../session-workflow-helpers.js'
import {
  executeWorkflowAgentPlan,
  type NormalizedWorkflowGraph,
  type WorkflowDispatchAttachment,
  type WorkflowRunSnapshot,
  type WorkflowAtomicNodeExecutionReply,
} from '../workflow-executor.js'

// 日志通道沿用迁移前标签，保证日志检索与告警不因抽取而漂移。
const log = createLogger('session.service')

/** 原子节点执行请求（与执行器 executeAtomicNode 回调入参同构）。 */
type AtomicNodeRequest = Parameters<
  NonNullable<Parameters<typeof executeWorkflowAgentPlan>[0]['executeAtomicNode']>
>[0]

/** workflow_run 协调器实际消费的会话执行上下文（SessionService 装配后传入）。 */
export interface WorkflowRunToolContext {
  sessionId: string
  turnId: string
  hostAgent: AgentItem
  members: AgentItem[]
  workspaceRootPath: string
  eventRepo: EventRepository
  workflowGraph?: NormalizedWorkflowGraph
  workflowWorkerIds?: ReadonlySet<string>
  workflowId?: string
  workflowBindingInstanceId?: string
  workflowGraphDigest?: string
  workflowNameSnapshot?: string
  workflowVersionSnapshot?: string
  workflowBindingSource?: WorkflowRunBindingSource
  workflowAttachments?: WorkflowDispatchAttachment[]
}

/**
 * SessionService 侧注入的宿主能力（上下文装配与 MCP 接线留在原处）：
 * 事件持久化通道与 approval/tool-invocation/artifact 三类节点级执行器。
 */
export interface WorkflowRunCoordinatorHooks {
  emitAndPersist(
    sessionId: string,
    turnId: string,
    event: AgentEvent,
    eventRepo: EventRepository,
  ): void
  executeApprovalNode(request: {
    title: string
    objective: string
    config: Record<string, unknown>
  }): Promise<WorkflowAtomicNodeExecutionReply>
  executeToolInvocationNode(
    request: {
      nodeId: string
      title: string
      objective: string
      inputs: Record<string, unknown>
      config: Record<string, unknown>
    },
    spec: WorkflowToolInvocationSpec,
    runSingleDispatch: (args: Record<string, unknown>, parallel?: boolean) => Promise<TeamA2AReply>,
    invocationContext: { sessionId: string; turnId?: string; workflowId?: string },
  ): Promise<WorkflowAtomicNodeExecutionReply>
  finalizeArtifactContent(
    request: { nodeId: string; kind: WorkflowNodeKind; config: Record<string, unknown> },
    content: string,
  ): Promise<WorkflowAtomicNodeExecutionReply>
}

export interface WorkflowRunCoordinatorInput {
  db: SparkDatabase
  ctx: WorkflowRunToolContext
  runSingleDispatch: (args: Record<string, unknown>, parallel?: boolean) => Promise<TeamA2AReply>
  hooks: WorkflowRunCoordinatorHooks
}

export class WorkflowRunCoordinator {
  constructor(private readonly input: WorkflowRunCoordinatorInput) {}

  buildToolDefinition(): TeamToolDefinition | null {
    const { db, ctx, runSingleDispatch, hooks } = this.input
    if (
      ctx.workflowGraph == null ||
      !hasWorkflowExecutableNodes(ctx.workflowGraph, ctx.workflowWorkerIds, ctx.hostAgent.id)
    ) {
      return null
    }
    return {
      name: 'workflow_run',
      description:
        'Execute the managed workflow graph for the current objective: nodes run in dependency order, independent agent/subagent nodes in the same wave run in parallel, conditional edges route branches, and node prompts/tool arguments support {{outputKey}} interpolation of upstream results.',
      schema: { objective: z.string().max(8000) },
      handler: async (args: Record<string, unknown>) => {
        const objective = String(args.objective ?? '')
        const runRepo = new WorkflowRunRepository(db)
        const graphNodeIds = new Set(ctx.workflowGraph!.nodes.map((n) => n.id))
        // 每个节点实际会用到的派发目标 + 生效模型（节点自己的 config.modelId 优先，
        // 否则回落到该 agentId 在花名册里的默认值）——供下面的 workflow_progress 事件。
        // 空绑定或失效绑定不回落宿主，须与执行器的 missing_agent_id 语义保持一致。
        const progressNodeMetas = buildWorkflowProgressNodeMetas(
          ctx.workflowGraph!.nodes,
          ctx.members,
        )
        const emitWorkflowProgress = (snap: WorkflowRunSnapshot): void => {
          const nodes = buildWorkflowProgressNodes({
            metas: progressNodeMetas,
            executions: snap.executions,
            atomicExecutions: snap.atomicExecutions,
            runningNodeIds: new Set(snap.runningNodeIds),
            completedNodeIds: new Set(snap.completedNodeIds),
            skippedNodeIds: new Set(snap.skippedNodeIds),
            ...(snap.failedNode?.nodeId != null ? { failedNodeId: snap.failedNode.nodeId } : {}),
            ...(snap.failedNode?.error != null ? { failedNodeError: snap.failedNode.error } : {}),
            terminal: snap.status !== 'working',
          })
          hooks.emitAndPersist(
            ctx.sessionId,
            ctx.turnId,
            {
              id: crypto.randomUUID(),
              type: 'workflow_progress',
              sessionId: ctx.sessionId,
              turnId: ctx.turnId,
              timestamp: new Date().toISOString(),
              seq: 0,
              workflowId: ctx.workflowId ?? '',
              ...(runId != null ? { runId } : {}),
              runStatus: snap.status,
              nodes,
            },
            ctx.eventRepo,
          )
        }

        // 自动续跑：Binding-aware sessions only reuse the current generation. Legacy
        // sessions retain the historical (session, workflow) lookup.
        let runId: string | null = null
        let initialState: Record<string, unknown> | undefined
        let initialCompletedNodeIds: string[] | undefined
        let initialSkippedNodeIds: string[] | undefined
        if (ctx.workflowId != null) {
          const resumable =
            ctx.workflowBindingInstanceId != null
              ? runRepo.findLatestResumableByBinding(
                  ctx.sessionId,
                  ctx.workflowBindingInstanceId,
                  ctx.workflowId,
                )
              : runRepo.findLatestResumable(ctx.sessionId, ctx.workflowId)
          if (resumable != null) {
            runId = resumable.id
            try {
              initialState = JSON.parse(resumable.state_json) as Record<string, unknown>
            } catch {
              initialState = undefined
            }
            try {
              const ids = JSON.parse(resumable.completed_node_ids_json) as string[]
              initialCompletedNodeIds = Array.isArray(ids)
                ? ids.filter((id) => graphNodeIds.has(id))
                : undefined
            } catch {
              initialCompletedNodeIds = undefined
            }
            try {
              const ids = JSON.parse(resumable.skipped_node_ids_json) as string[]
              initialSkippedNodeIds = Array.isArray(ids)
                ? ids.filter((id) => graphNodeIds.has(id))
                : undefined
            } catch {
              initialSkippedNodeIds = undefined
            }
            log.info('workflow run: resume', {
              sessionId: ctx.sessionId,
              workflowId: ctx.workflowId,
              runId,
              skipped: initialCompletedNodeIds?.length ?? 0,
            })
          } else {
            runId = runRepo.create({
              sessionId: ctx.sessionId,
              turnId: ctx.turnId,
              workflowId: ctx.workflowId,
              objective,
              graph: ctx.workflowGraph as unknown as Record<string, unknown>,
              ...(ctx.workflowBindingInstanceId != null
                ? { workflowBindingInstanceId: ctx.workflowBindingInstanceId }
                : {}),
              ...(ctx.workflowGraphDigest != null
                ? { workflowGraphDigest: ctx.workflowGraphDigest }
                : {}),
              ...(ctx.workflowNameSnapshot != null
                ? { workflowNameSnapshot: ctx.workflowNameSnapshot }
                : {}),
              ...(ctx.workflowVersionSnapshot != null
                ? { workflowVersionSnapshot: ctx.workflowVersionSnapshot }
                : {}),
              ...(ctx.workflowBindingSource != null
                ? { bindingSource: ctx.workflowBindingSource }
                : {}),
            }).id
            log.info('workflow run: start', {
              sessionId: ctx.sessionId,
              workflowId: ctx.workflowId,
              runId,
            })
          }
        }

        const result = await executeWorkflowAgentPlan({
          graph: ctx.workflowGraph!,
          objective,
          ...(ctx.workflowAttachments != null && ctx.workflowAttachments.length > 0
            ? { attachments: ctx.workflowAttachments }
            : {}),
          availableWorkerIds: new Set(ctx.members.map((member) => member.id)),
          ...(initialState != null ? { initialState } : {}),
          ...(initialCompletedNodeIds != null ? { initialCompletedNodeIds } : {}),
          ...(initialSkippedNodeIds != null ? { initialSkippedNodeIds } : {}),
          onSnapshot: (snap) => {
            if (runId != null) {
              runRepo.updateSnapshot(runId, {
                status: snap.status,
                state: snap.state,
                executions: snap.executions,
                atomicExecutions: snap.atomicExecutions,
                completedNodeIds: snap.completedNodeIds,
                skippedNodeIds: snap.skippedNodeIds,
                ...(snap.failedNode != null ? { failedNode: snap.failedNode } : {}),
                ...(snap.status !== 'working' ? { endedAt: new Date().toISOString() } : {}),
              })
            }
            emitWorkflowProgress(snap)
          },
          executeAtomicNode: async (request) => {
            // 原子节点按 kind 显式自执行：
            // - verify：跑校验命令（runWorkflowVerifyNode）。
            // - approval：经 onQuestion 暂停等待用户审批，拒绝则节点失败、停止工作流。
            // - input：LLM 把 prompt/objective/constraint/value 拆解为结构化 JSON；派发失败或
            //   LLM 输出非法 JSON 时回落透传 getDefaultWorkflowAtomicContent 并追加提示。
            // - route：经纯 LLM 临时 worker 只输出 routeOptions 中的一个 value，用于条件边分流。
            // - skill/tool/mcp/plan/review/artifact：config.execution!=='static' 时经临时受限
            //   worker 真实派发单轮执行（skill 只挂 skillIds、tool 收窄 toolIds；MCP 使用
            //   全局已启用集合；input/plan/review 使用只读工具集）；artifact 另外支持 exportPath 写盘。
            //   配 execution:'static' 或该 kind 不在真实执行集内时，回落静态回显。
            // - tool/mcp 节点配了 toolSource/toolName 时走确定性调用：mcp 源经 McpService
            //   原生直调（不经 LLM，tool 与 mcp 节点语义等价，mcp 节点仅多一个专属配置入口）；
            //   platform 源直调平台自定义工具/工具包工具（不经 LLM，仅 tool 节点可选该源）；
            //   builtin 源经锁定单工具 + 预渲染参数的强约束派发（仅 tool 节点可选该源）。
            //   与其它 LLM 原子节点一致，execution:'static' 时回落静态回显不走直调。
            const executionMode =
              typeof request.config.execution === 'string' ? request.config.execution.trim() : ''
            const toolInvocation =
              executionMode === 'static' || (request.kind !== 'tool' && request.kind !== 'mcp')
                ? null
                : getWorkflowToolInvocationSpec(request.config, request.kind)
            if (toolInvocation != null) {
              return hooks.executeToolInvocationNode(request, toolInvocation, runSingleDispatch, {
                sessionId: ctx.sessionId,
                ...(ctx.turnId != null ? { turnId: ctx.turnId } : {}),
                ...(ctx.workflowId != null ? { workflowId: ctx.workflowId } : {}),
              })
            }
            switch (request.kind) {
              case 'verify':
                return runWorkflowVerifyNode(request, ctx.workspaceRootPath)
              case 'approval':
                return hooks.executeApprovalNode(request)
              case 'input':
              case 'route':
              case 'skill':
              case 'tool':
              case 'mcp':
              case 'plan':
              case 'review':
              case 'artifact': {
                // config.execution:'static' 或该节点未登记临时 worker 时回落静态回显。
                const execution =
                  typeof request.config.execution === 'string'
                    ? request.config.execution.trim()
                    : ''
                const workerId = workflowAtomicMemberId(request.nodeId)
                const isRegistered = ctx.members.some((m) => m.id === workerId)
                if (execution === 'static' || !isRegistered) {
                  return hooks.finalizeArtifactContent(
                    request,
                    getDefaultWorkflowAtomicContent(request),
                  )
                }
                const reply = await runSingleDispatch({
                  targetAgentId: workerId,
                  instruction: buildWorkflowAtomicInstruction(request),
                  inputs: request.inputs,
                })
                if (reply.state !== 'completed') {
                  return {
                    state: reply.state,
                    content: reply.content,
                    error: {
                      ...(reply.error?.code != null ? { code: reply.error.code } : {}),
                      message:
                        reply.error?.message ??
                        `Workflow ${request.kind} node ${request.nodeId} did not complete successfully.`,
                    },
                  }
                }
                // input 节点：校验 reply.content 为合法结构化 JSON；非法 JSON 回落透传 + 提示。
                if (request.kind === 'input') {
                  const fallback = getDefaultWorkflowAtomicContent(request)
                  const validated = validateWorkflowInputStructuredContent(reply.content, fallback)
                  if (!validated.ok) {
                    log.warn('workflow input: invalid JSON from LLM, fallback to passthrough', {
                      sessionId: ctx.sessionId,
                      node: request.nodeId,
                    })
                  }
                  return { content: validated.content }
                }
                if (request.kind === 'route') {
                  const validated = validateWorkflowRouteDecisionContent(
                    reply.content,
                    request.config,
                  )
                  if (!validated.ok) {
                    log.warn('workflow route: invalid decision from LLM', {
                      sessionId: ctx.sessionId,
                      node: request.nodeId,
                      decision: validated.decision,
                    })
                    return {
                      state: 'failed',
                      content: reply.content,
                      error: {
                        code: 'workflow_route_invalid_output',
                        message: validated.message,
                      },
                    }
                  }
                  return { content: validated.content }
                }
                // artifact 节点在成功后按 exportPath 写盘（其余 kind 该方法直接透传内容）。
                return hooks.finalizeArtifactContent(request, reply.content)
              }
              default:
                return { content: getDefaultWorkflowAtomicContent(request) }
            }
          },
          dispatch: async (request, options) => {
            const reply = await runSingleDispatch(
              {
                targetAgentId: request.agentId,
                instruction: request.instruction,
                inputs: request.inputs,
                ...(request.attachments != null && request.attachments.length > 0
                  ? { attachments: request.attachments }
                  : {}),
              },
              options?.parallel === true,
            )
            if (reply.state !== 'completed') {
              const message =
                reply.error?.message ??
                `Workflow worker ${request.agentId} did not complete successfully.`
              return {
                state: reply.state,
                content: reply.content,
                error: {
                  ...(reply.error?.code != null ? { code: reply.error.code } : {}),
                  message,
                },
              }
            }
            return { state: 'completed', content: reply.content }
          },
        })
        const workflowRunLog = result.status === 'completed' ? log.info : log.warn
        workflowRunLog('workflow run: ' + result.status, {
          sessionId: ctx.sessionId,
          runId,
          executions: result.executions.length,
          failedNode: result.failedNode?.nodeId,
        })
        const text =
          result.status === 'completed'
            ? `Workflow completed ${result.executions.length} agent node attempt(s). Final state: ${JSON.stringify(result.state)}`
            : `Workflow ${result.status} at node ${result.failedNode?.nodeId ?? 'unknown'} after ${result.failedNode?.attempt ?? 0} attempt(s). Error: ${result.failedNode?.error.message ?? 'Unknown error'}. Final state: ${JSON.stringify(result.state)}`
        return {
          content: [
            {
              type: 'text' as const,
              text,
            },
          ],
          structuredContent: result as unknown as { [x: string]: unknown },
        }
      },
    }
  }
}
