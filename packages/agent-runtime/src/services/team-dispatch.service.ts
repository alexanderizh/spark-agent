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

/** member 一次执行的结果（由 executeMember 回调返回） */
export interface TeamMemberExecutionResult {
  content: string
  inputTokens?: number
  outputTokens?: number
  artifacts?: TeamA2AReply['artifacts']
}

/** 一次 dispatch 的运行上下文 */
export interface TeamDispatchRunContext<M extends { id: string; name: string }> {
  sessionId: string
  turnId: string
  hostAgentId: string
  /** 当前会话启用的成员 Agent（完整对象，传给 executeMember） */
  members: M[]
  teamConfig: TeamModeConfig
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

const DEFAULT_DISPATCH_TIMEOUT_MS = 120_000
const MAX_DISPATCH_TIMEOUT_MS = 600_000
const DEFAULT_MAX_DISPATCHES_PER_TURN = 5

export class TeamDispatchService {
  /** turnId → 该 turn 已发起的 dispatch 次数（循环/预算检测） */
  private readonly dispatchCountByTurn = new Map<string, number>()
  /** dispatchId → AbortController（取消传播） */
  private readonly controllers = new Map<string, AbortController>()

  constructor(
    private readonly dispatches: TeamDispatchRepository,
    private readonly maxDispatchesPerTurn: number = DEFAULT_MAX_DISPATCHES_PER_TURN,
  ) {}

  async run<M extends { id: string; name: string }>(
    task: TeamA2ATask,
    ctx: TeamDispatchRunContext<M>,
  ): Promise<TeamA2AReply> {
    const dispatchId = crypto.randomUUID()
    const member = ctx.members.find((m) => m.id === task.memberAgentId)

    const fail = (
      code: NonNullable<TeamA2AReply['error']>['code'],
      message: string,
    ): TeamA2AReply => ({ taskId: task.taskId, state: 'failed', content: '', error: { code, message } })

    // ── 校验 ──────────────────────────────────────────────────────────────
    if (member == null || !ctx.teamConfig.memberAgentIds.includes(task.memberAgentId)) {
      return fail(
        'member_disabled',
        `Member "${task.memberAgentId}" is not enabled in this team session. Available members: [${ctx.teamConfig.memberAgentIds.join(', ')}].`,
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

    // ── 超时 / 取消 ─────────────────────────────────────────────────────────
    const controller = new AbortController()
    this.controllers.set(dispatchId, controller)
    const onParentAbort = () => controller.abort()
    ctx.signal?.addEventListener('abort', onParentAbort)
    const timeoutMs = Math.min(task.timeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS, MAX_DISPATCH_TIMEOUT_MS)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const startedAt = Date.now()

    try {
      const result = await ctx.executeMember({
        member,
        task,
        dispatchId,
        signal: controller.signal,
        memberDepth: ctx.currentDepth + 1,
      })
      const durationMs = Date.now() - startedAt
      const reply: TeamA2AReply = {
        taskId: task.taskId,
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
      return reply
    } finally {
      clearTimeout(timer)
      ctx.signal?.removeEventListener('abort', onParentAbort)
      this.controllers.delete(dispatchId)
    }
  }

  /** 取消所有进行中的 dispatch（session cancel 时调用） */
  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }

  /** turn 结束后清理预算计数 */
  clearTurn(turnId: string): void {
    this.dispatchCountByTurn.delete(turnId)
  }
}
