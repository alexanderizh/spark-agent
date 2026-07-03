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
import type {
  TeamDiscussionRepository,
  TeamDispatchRepository,
} from '@spark/storage'
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
  /**
   * FR-B：本次调用的发起者（坐实"caller = 发起者"语义，不一定是会话 Host）。
   * 缺省回落 hostAgentId（向后兼容现有 dispatch 路径）。agent_message 定向 @ 时
   * 发起者可以是任意被启用成员。
   */
  callerAgentId?: string
  /**
   * FR-B：关联的团队讨论线程 ID（Phase D 创建 discussion 后传入）。缺省 = 非讨论
   * 场景（workflow 编排 / 普通 dispatch），不向 team_thread_messages 写线程。
   */
  discussionId?: string
  /**
   * FR-B：当前讨论轮次序号（Phase D 推进轮次时更新传入）。写 member_reply 线程用。
   * 缺省 = 0（非讨论场景）。
   */
  roundIndex?: number
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
// FR-B：单讨论消息总量上限（广播 + 定向 @ 的 peer_message 累计），防止 peer messaging 失控。
const DEFAULT_MAX_MESSAGES_PER_DISCUSSION = 40

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
    /**
     * FR-B：团队讨论线程仓库（agent_message 广播/定向 @ 写线程用）。缺省 = 不写线程
     * （workflow 编排路径不需要讨论线程，保持现状）。
     */
    private readonly discussionRepo?: TeamDiscussionRepository,
    /** FR-B：单讨论 peer_message 总量硬上限（广播 + 定向 @ 累计） */
    private readonly maxMessagesPerDiscussion: number = DEFAULT_MAX_MESSAGES_PER_DISCUSSION,
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
        // FR-B：讨论场景把成员回复写入共享线程（member_reply），供后续被调度者 prompt 渲染。
        if (ctx.discussionId != null && this.discussionRepo != null) {
          this.discussionRepo.appendMessage({
            id: crypto.randomUUID(),
            discussionId: ctx.discussionId,
            senderAgentId: member.id,
            targetAgentId: ctx.callerAgentId ?? ctx.hostAgentId,
            roundIndex: ctx.roundIndex ?? 0,
            kind: 'member_reply',
            content: result.content,
            dispatchId,
          })
        }
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

  /**
   * FR-B：记录一条对等消息（`agent_message` 工具调用）。
   *
   * - 广播（targetAgentId 缺省）：只写线程 + emit `team_peer_message`，**不触发任何执行**
   *   （实施文档 Δ3：广播 = 异步留言，下次被调度时才看到）。
   * - 定向 @（targetAgentId 提供）：写线程 + emit 后，调 {@link run} 触发目标一次完整 turn；
   *   目标回复由 run 写入线程（member_reply）。
   *
   * 安全：sender/target 必须是 ctx 启用成员（或 Host）；消息总量受 maxMessagesPerDiscussion 硬拦截。
   * 定向 @ 另计入 dispatchCountByTurn（run 内现有计数）。
   */
  async recordPeerMessage<M extends { id: string; name: string }>(
    args: {
      content: string
      senderAgentId: string
      /** 缺省 = 广播 */
      targetAgentId?: string
      discussionId: string
      roundIndex: number
    },
    ctx: TeamDispatchRunContext<M>,
  ): Promise<
    | { ok: true; reply?: TeamA2AReply }
    | {
        ok: false
        code:
          | 'sender_disabled'
          | 'target_disabled'
          | 'self_target_not_allowed'
          | 'ping_pong_blocked'
          | 'message_budget_exceeded'
          | 'no_discussion_repo'
        message: string
      }
  > {
    if (this.discussionRepo == null) {
      return {
        ok: false,
        code: 'no_discussion_repo',
        message:
          'Peer messaging is unavailable in this context (no discussion repository — e.g. workflow orchestration).',
      }
    }
    const effectiveAllowedIds = ctx.allowedWorkerIds ?? new Set(ctx.teamConfig.memberAgentIds)
    const senderOk =
      effectiveAllowedIds.has(args.senderAgentId) || args.senderAgentId === ctx.hostAgentId
    if (!senderOk) {
      return {
        ok: false,
        code: 'sender_disabled',
        message: `Sender "${args.senderAgentId}" is not an enabled team participant.`,
      }
    }
    if (args.targetAgentId != null && !effectiveAllowedIds.has(args.targetAgentId)) {
      return {
        ok: false,
        code: 'target_disabled',
        message: `Target "${args.targetAgentId}" is not an enabled team member.`,
      }
    }
    if (args.targetAgentId != null && args.targetAgentId === args.senderAgentId) {
      return {
        ok: false,
        code: 'self_target_not_allowed',
        message: 'Directed peer messaging must target a teammate, not the sender itself.',
      }
    }

    const peerMessages = this.listPersistedPeerMessages(args.discussionId)
    if (
      args.targetAgentId != null &&
      this.isImmediatePingPong(args.senderAgentId, args.targetAgentId, args.roundIndex, peerMessages)
    ) {
      return {
        ok: false,
        code: 'ping_pong_blocked',
        message:
          'Immediate A↔B peer-message ping-pong is blocked. Wait for new work or broadcast a non-triggering note instead.',
      }
    }

    // 消息总量硬拦截（广播 + 定向 @ 的 peer_message 都计入）
    const msgCount = peerMessages.length + 1
    if (msgCount > this.maxMessagesPerDiscussion) {
      return {
        ok: false,
        code: 'message_budget_exceeded',
        message: `Discussion message budget exceeded (${this.maxMessagesPerDiscussion} per discussion).`,
      }
    }

    // 写线程（peer_message）+ emit
    this.discussionRepo.appendMessage({
      id: crypto.randomUUID(),
      discussionId: args.discussionId,
      senderAgentId: args.senderAgentId,
      ...(args.targetAgentId != null ? { targetAgentId: args.targetAgentId } : {}),
      roundIndex: args.roundIndex,
      kind: 'peer_message',
      content: args.content,
    })
    ctx.emitEvent({
      id: crypto.randomUUID(),
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
      type: 'team_peer_message',
      discussionId: args.discussionId,
      memberAgentId: args.senderAgentId,
      ...(args.targetAgentId != null ? { targetAgentId: args.targetAgentId } : {}),
      content: args.content,
    })

    // 广播：不触发任何执行，立即返回。
    if (args.targetAgentId == null) return { ok: true }

    // 定向 @：触发目标一次完整 turn（复用 run 的校验/超时/取消/dispatch 预算计数）。
    const task: TeamA2ATask = {
      taskId: crypto.randomUUID(),
      hostAgentId: ctx.hostAgentId,
      memberAgentId: args.targetAgentId,
      rootTurnId: ctx.turnId,
      instruction: args.content,
    }
    const reply = await this.run(task, { ...ctx, callerAgentId: args.senderAgentId }, {})
    return { ok: true, reply }
  }

  /** FR-B：讨论收尾时保留 API 兼容；消息预算已改为持久化线程计数，不再需要进程内清理。 */
  clearDiscussion(discussionId: string): void {
    void discussionId
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

  private listPersistedPeerMessages(discussionId: string) {
    if (this.discussionRepo == null) return []
    return this.discussionRepo
      .listMessages(discussionId, Math.max(this.maxMessagesPerDiscussion * 3, 200))
      .filter((message) => message.kind === 'peer_message')
  }

  private isImmediatePingPong(
    senderAgentId: string,
    targetAgentId: string,
    roundIndex: number,
    peerMessages: Array<{ sender_agent_id: string; target_agent_id: string | null; round_index: number }>,
  ): boolean {
    const lastDirected = [...peerMessages]
      .reverse()
      .find((message) => message.target_agent_id != null && message.round_index === roundIndex)
    if (lastDirected == null) return false
    return (
      lastDirected.sender_agent_id === targetAgentId &&
      lastDirected.target_agent_id === senderAgentId
    )
  }
}
