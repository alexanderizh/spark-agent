/**
 * @module team-dispatch.service
 *
 * Team Mode（A2A）调度服务。
 *
 * 职责（与 SDK 执行解耦）：
 *   - 校验：member 是否启用、嵌套深度、单 turn dispatch 预算。
 *   - 持久化：team_dispatches 行的创建与收尾。
 *   - 事件：emit team_dispatch_requested / team_member_status / team_dispatch_completed。
 *   - 超时 / 取消：每次 dispatch 一个 AbortController，受 turn 级 signal 与 timeout 控制。
 *
 * 实际运行 member 一次 turn 的工作交给调用方提供的 `executeMember` 回调
 * （由 SessionService 实现——它持有 provider/apiKey/config 解析与 ClaudeSDKExecutor）。
 * 这样既复用既有执行路径，又避免 TeamDispatchService ↔ SessionService 的循环依赖。
 */

import type { AgentEvent, TeamA2ATask, TeamA2AReply, TeamModeConfig } from '@spark/protocol'
import type { TeamDispatchRepository } from '@spark/storage'
import { createLogger } from '@spark/shared'

const log = createLogger('team-dispatch')

/** member 一次执行的结果（由 executeMember 回调返回） */
export interface TeamMemberExecutionResult {
  content: string
  inputTokens?: number
  outputTokens?: number
  artifacts?: TeamA2AReply['artifacts']
  /**
   * member 被超时/取消打断，但 content 中保留了已产出的部分文本。
   * TeamDispatchService 据此把 reply 标记为 failed/canceled 的同时回传
   * 部分产出，避免 Host 丢失工作后盲目重派。
   */
  partial?: boolean
}

/** 一次 dispatch 的运行上下文 */
export interface TeamDispatchRunContext<M extends { id: string; name: string }> {
  sessionId: string
  turnId: string
  hostAgentId: string
  /** 当前会话启用的成员 Agent（完整对象，传给 executeMember） */
  members: M[]
  teamConfig: TeamModeConfig
  /**
   * 允许被派发的 worker id 集合。缺省时回落 teamConfig.memberAgentIds（team 行为不变）。
   * workflow/goal 编排场景显式传入：workflow 来自节点 agentId，goal 来自其可用 worker。
   */
  allowedWorkerIds?: ReadonlySet<string>
  /** 0 = Host 主循环里发起的第一层 dispatch */
  currentDepth: number
  /** 透传给 SessionService.emitAndPersist；seq 由其覆盖 */
  emitEvent: (event: AgentEvent) => void
  /** turn 级取消信号（session cancel 触发） */
  signal?: AbortSignal
  /** 实际运行 member 一次 turn */
  executeMember: (args: {
    member: M
    task: TeamA2ATask
    dispatchId: string
    signal: AbortSignal
    /** member 自身发起的 dispatch 将处于的深度（= 本 dispatch 深度 + 1），用于嵌套判定 */
    memberDepth: number
  }) => Promise<TeamMemberExecutionResult>
}

// 默认 10 分钟：member 一次 turn 常含多轮工具调用（读写文件、跑命令），
// 旧的 2 分钟对真实编码任务远远不够，会在中途被砍断。
const DEFAULT_DISPATCH_TIMEOUT_MS = 600_000
const MAX_DISPATCH_TIMEOUT_MS = 1_800_000
// 单 turn dispatch 预算。Host 用 agent_dispatch_batch 一次提交多个并行任务时
// 计数仍按"每个 task 一次"累加（保护循环），所以上限要能覆盖典型 batch（≤10）。
const DEFAULT_MAX_DISPATCHES_PER_TURN = 10

export class TeamDispatchService {
  /** turnId → 该 turn 已发起的 dispatch 次数（循环/预算检测） */
  private readonly dispatchCountByTurn = new Map<string, number>()
  /** turnId → 同一 turn 内 member 执行队列，避免多个 Claude SDK 进程并发抢同一 cwd/session */
  private readonly executionQueueByTurn = new Map<string, Promise<unknown>>()
  /** dispatchId → AbortController（取消传播） */
  private readonly controllers = new Map<string, AbortController>()

  constructor(
    private readonly dispatches: TeamDispatchRepository,
    private readonly maxDispatchesPerTurn: number = DEFAULT_MAX_DISPATCHES_PER_TURN,
  ) {}

  async run<M extends { id: string; name: string }>(
    task: TeamA2ATask,
    ctx: TeamDispatchRunContext<M>,
    options: { parallel?: boolean } = {},
  ): Promise<TeamA2AReply> {
    const dispatchId = crypto.randomUUID()
    const member = ctx.members.find((m) => m.id === task.memberAgentId)

    const fail = (
      code: NonNullable<TeamA2AReply['error']>['code'],
      message: string,
    ): TeamA2AReply => {
      log.warn('dispatch rejected', { reason: code, memberAgentId: task.memberAgentId, turnId: ctx.turnId })
      return {
        taskId: task.taskId,
        memberAgentId: task.memberAgentId,
        state: 'failed',
        content: '',
        error: { code, message },
      }
    }

    // ── 校验 ──────────────────────────────────────────────────────────────
    const effectiveAllowedIds = ctx.allowedWorkerIds ?? new Set(ctx.teamConfig.memberAgentIds)
    if (member == null || !effectiveAllowedIds.has(task.memberAgentId)) {
      return fail(
        'member_disabled',
        `Worker "${task.memberAgentId}" is not enabled in this session. Available: [${[...effectiveAllowedIds].join(', ')}].`,
      )
    }
    if (ctx.currentDepth > 0 && (!ctx.teamConfig.allowNesting || ctx.currentDepth >= ctx.teamConfig.maxDepth)) {
      return fail('depth_exceeded', `Max chained dispatch depth (${ctx.teamConfig.maxDepth}) reached.`)
    }
    const count = (this.dispatchCountByTurn.get(ctx.turnId) ?? 0) + 1
    this.dispatchCountByTurn.set(ctx.turnId, count)
    if (count > this.maxDispatchesPerTurn) {
      return fail('internal', `Dispatch budget exceeded (${this.maxDispatchesPerTurn} per turn).`)
    }

    // ── 持久化 + emit requested ────────────────────────────────────────────
    const base = () => ({
      id: crypto.randomUUID(),
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })
    this.dispatches.create({
      id: dispatchId,
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      hostAgentId: ctx.hostAgentId,
      memberAgentId: member.id,
      taskJson: JSON.stringify(task),
      state: 'working',
    })
    ctx.emitEvent({
      ...base(),
      type: 'team_dispatch_requested',
      dispatchId,
      hostAgentId: ctx.hostAgentId,
      memberAgentId: member.id,
      task,
    })
    ctx.emitEvent({
      ...base(),
      type: 'team_member_status',
      dispatchId,
      memberAgentId: member.id,
      status: 'working',
    })
    log.info('dispatch start', {
      turnId: ctx.turnId,
      hostAgentId: ctx.hostAgentId,
      memberAgentId: task.memberAgentId,
      taskId: task.taskId,
      depth: ctx.currentDepth,
    })

    // ── 超时 / 取消 ─────────────────────────────────────────────────────────
    const controller = new AbortController()
    this.controllers.set(dispatchId, controller)
    const onParentAbort = () => controller.abort()
    ctx.signal?.addEventListener('abort', onParentAbort)
    // parallel=true 时绕过 turn 串行队列（agent_dispatch_batch 显式并行场景）。
    const runMember = async (): Promise<TeamA2AReply> => {
      // 超时优先级：task 级 > 团队配置级 > 默认；统一受 MAX 上限约束。
      const requestedTimeout =
        task.timeoutMs ?? ctx.teamConfig.dispatchTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS
      const timeoutMs = Math.min(requestedTimeout, MAX_DISPATCH_TIMEOUT_MS)
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      const startedAt = Date.now()

      try {
        if (controller.signal.aborted) {
          throw new Error('Dispatch was canceled.')
        }
        const result = await ctx.executeMember({
          member,
          task,
          dispatchId,
          signal: controller.signal,
          memberDepth: ctx.currentDepth + 1,
        })
        const durationMs = Date.now() - startedAt

        // 被超时/取消打断但保留了部分产出：标记 failed/canceled，仍回传已产出内容。
        if (result.partial === true) {
          const canceled = controller.signal.aborted
          const code: NonNullable<TeamA2AReply['error']>['code'] = timedOut ? 'timeout' : 'denied'
          const message = timedOut
            ? `Member timed out after ${timeoutMs}ms; partial output preserved below.`
            : 'Dispatch was canceled; partial output preserved below.'
          const reply: TeamA2AReply = {
            taskId: task.taskId,
            memberAgentId: member.id,
            memberName: member.name,
            state: canceled && !timedOut ? 'canceled' : 'failed',
            content: result.content,
            error: { code, message },
            usage: {
              ...(result.inputTokens != null ? { inputTokens: result.inputTokens } : {}),
              ...(result.outputTokens != null ? { outputTokens: result.outputTokens } : {}),
              durationMs,
            },
          }
          this.dispatches.update(dispatchId, {
            state: reply.state,
            replyJson: JSON.stringify(reply),
            errorMessage: message,
            ...(result.inputTokens != null ? { inputTokens: result.inputTokens } : {}),
            ...(result.outputTokens != null ? { outputTokens: result.outputTokens } : {}),
            durationMs,
            endedAt: new Date().toISOString(),
          })
          ctx.emitEvent({
            ...base(),
            type: 'team_dispatch_completed',
            dispatchId,
            hostAgentId: ctx.hostAgentId,
            memberAgentId: member.id,
            reply,
          })
          log.warn('dispatch failed', {
            memberAgentId: member.id,
            state: reply.state,
            error: reply.error?.message,
          })
          return reply
        }

        const reply: TeamA2AReply = {
          taskId: task.taskId,
          memberAgentId: member.id,
          memberName: member.name,
          state: 'completed',
          content: result.content,
          usage: {
            ...(result.inputTokens != null ? { inputTokens: result.inputTokens } : {}),
            ...(result.outputTokens != null ? { outputTokens: result.outputTokens } : {}),
            durationMs,
          },
          ...(result.artifacts != null ? { artifacts: result.artifacts } : {}),
        }
        this.dispatches.update(dispatchId, {
          state: 'completed',
          replyJson: JSON.stringify(reply),
          ...(result.inputTokens != null ? { inputTokens: result.inputTokens } : {}),
          ...(result.outputTokens != null ? { outputTokens: result.outputTokens } : {}),
          durationMs,
          endedAt: new Date().toISOString(),
        })
        ctx.emitEvent({
          ...base(),
          type: 'team_dispatch_completed',
          dispatchId,
          hostAgentId: ctx.hostAgentId,
          memberAgentId: member.id,
          reply,
        })
        log.info('dispatch done', {
          memberAgentId: member.id,
          state: reply.state,
          taskId: task.taskId,
        })
        return reply
      } catch (err) {
        const durationMs = Date.now() - startedAt
        const canceled = controller.signal.aborted
        const code: NonNullable<TeamA2AReply['error']>['code'] = timedOut
          ? 'timeout'
          : canceled
            ? 'denied'
            : 'internal'
        const message = timedOut
          ? `Member timed out after ${timeoutMs}ms.`
          : canceled
            ? 'Dispatch was canceled.'
            : err instanceof Error
              ? err.message
              : String(err)
        const reply: TeamA2AReply = {
          taskId: task.taskId,
          memberAgentId: member.id,
          memberName: member.name,
          state: canceled && !timedOut ? 'canceled' : 'failed',
          content: '',
          error: { code, message },
        }
        this.dispatches.update(dispatchId, {
          state: reply.state,
          replyJson: JSON.stringify(reply),
          errorMessage: message,
          durationMs,
          endedAt: new Date().toISOString(),
        })
        ctx.emitEvent({
          ...base(),
          type: 'team_dispatch_completed',
          dispatchId,
          hostAgentId: ctx.hostAgentId,
          memberAgentId: member.id,
          reply,
        })
        log.warn('dispatch failed', {
          memberAgentId: member.id,
          state: reply.state,
          error: reply.error?.message,
        })
        return reply
      } finally {
        clearTimeout(timer)
        // FR-B/0b 修复（审查 B-2）：dispatch 收尾（成功/失败/取消）统一 abort controller，
        // 触发传给 executeMemberTurn 的 signal 上的 abort 监听 → 回收嵌套资源（如 codex
        // HTTP 桥接 handle 的 close）。abort() 幂等，已超时/已取消路径无副作用。
        controller.abort()
        ctx.signal?.removeEventListener('abort', onParentAbort)
        this.controllers.delete(dispatchId)
      }
    }
    return options.parallel === true ? runMember() : this.enqueueTurnExecution(ctx.turnId, runMember)
  }

  /** 取消所有进行中的 dispatch（session cancel 时调用） */
  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }

  /** turn 结束后清理预算计数 */
  clearTurn(turnId: string): void {
    this.dispatchCountByTurn.delete(turnId)
    this.executionQueueByTurn.delete(turnId)
  }

  private async enqueueTurnExecution<T>(turnId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.executionQueueByTurn.get(turnId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    const marker = current.catch(() => undefined)
    this.executionQueueByTurn.set(turnId, marker)

    try {
      return await current
    } finally {
      if (this.executionQueueByTurn.get(turnId) === marker) {
        this.executionQueueByTurn.delete(turnId)
      }
    }
  }
}
