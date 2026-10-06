import { createLogger } from '@spark/shared'
import type { SessionAttachment, SessionReferenceInput } from '@spark/protocol'
import {
  autoRouterHealthRegistry,
  classifyExecutorFailureText,
  isFailoverWorthyFailure,
} from './auto-router-health'

const log = createLogger('auto-router-health')

/**
 * 自动路由轮次重派发种子：与故障切换时刻的原 turn 面向模型输入保持一致所需的
 * 全部参数。从 startTurnExecution 的入参原样保存（浅拷贝数组防外部复用改写）。
 */
export interface AutoRouterFailoverSeed {
  sessionId: string
  message: string
  skillId?: string
  skillParams?: Record<string, unknown>
  attachments?: SessionAttachment[]
  mentionAgentId?: string
  sessionReferences?: SessionReferenceInput[]
}

/** 已登记的 auto-router 轮次上下文（健康上报与故障切换的判定依据）。 */
interface AutoRouterTurnContext {
  sessionId: string
  routerId: string
  routerName: string
  /** 本轮实际执行器（路由换绑后的渠道 + 模型）。 */
  providerId: string
  modelId: string
  seed: AutoRouterFailoverSeed
  /** 本轮是否还允许一次故障切换重派发（重派发轮自身为 false，防循环）。 */
  failoverArmed: boolean
}

/** 轮次终态失败经 supervisor 处理后的结论（挂点据此发信号/重派发）。 */
export interface AutoRouterTerminalErrorOutcome {
  /** 失败归类；environment 类与执行模型上游无关。 */
  kind: ReturnType<typeof classifyExecutorFailureText>
  /** 是否已冻结该执行器。 */
  frozen: boolean
  /** 本轮冻结毫秒（未冻结为 0）。 */
  freezeMs: number
  /**
   * 是否武装了重派发（错误可切换 + 未产出用户可见输出 + 本轮尚未切换过）。
   * true 时调用方须在轮次收尾后以 seed 重新派发一次。
   */
  failoverArmed: boolean
}

/**
 * AutoRouter 轮次监督器：登记每条由 router 派发的轮次上下文，在终态时驱动
 * 执行器健康注册表（冻结/恢复）与一次性故障切换（重派发）判定。
 *
 * 设计边界（与 session.service 的分工）：
 * - 本类只做状态管理与判定，不落事件、不发起新轮次——事件与 sendTurn 由
 *   session.service 挂点执行（emitAndPersist / settleTurnFinally 处）；
 * - 冻结状态写入进程内单例健康注册表（与选执行器避让、IPC 健康查询共用）；
 * - 每条用户消息至多重派发一次：重派发轮注册时 failoverArmed=false；
 * - 仅未产出任何用户可见/副作用内容（无 assistant 消息、无工具调用）的失败
 *   才重派发——已跑过工具的轮次静默重跑可能重复写文件/重复计费，交回用户。
 */
export class AutoRouterTurnSupervisor {
  private readonly turns = new Map<string, AutoRouterTurnContext>()
  /** 已武装待消费的重派发（sessionId 维度至多一个；失败轮收尾时消费）。 */
  private readonly armedFailovers = new Map<string, AutoRouterFailoverSeed & { turnId: string }>()

  /** 路由成功换绑执行器后登记本轮上下文（startTurnExecution 路由消费点调用）。 */
  registerTurn(params: {
    turnId: string
    sessionId: string
    routerId: string
    routerName: string
    providerId: string
    modelId: string
    /** 重派发轮传 true：本轮不允许再次故障切换。 */
    isRedispatch: boolean
    seed: AutoRouterFailoverSeed
  }): void {
    this.turns.set(params.turnId, {
      sessionId: params.sessionId,
      routerId: params.routerId,
      routerName: params.routerName,
      providerId: params.providerId,
      modelId: params.modelId,
      failoverArmed: !params.isRedispatch,
      seed: {
        ...params.seed,
        ...(params.seed.attachments != null ? { attachments: [...params.seed.attachments] } : {}),
        ...(params.seed.sessionReferences != null
          ? { sessionReferences: [...params.seed.sessionReferences] }
          : {}),
      },
    })
  }

  /** 轮次成功终态：清零执行器失败计数（半开恢复探针通过）。未登记轮次为 no-op。 */
  onTurnSuccess(turnId: string): void {
    const ctx = this.turns.get(turnId)
    if (ctx == null) return
    autoRouterHealthRegistry.reportSuccess(ctx.providerId, ctx.modelId)
  }

  /**
   * 轮次终态失败（真实落库的 agent_error）：归类 → 冻结 → 判定是否武装重派发。
   * `hasProducedSideEffects` 由挂点查询事件库给出（assistant/团队消息/工具调用）。
   */
  onTerminalError(params: {
    turnId: string
    errorText: string
    hasProducedSideEffects: boolean
  }): AutoRouterTerminalErrorOutcome | null {
    const ctx = this.turns.get(params.turnId)
    if (ctx == null) return null
    const kind = classifyExecutorFailureText(params.errorText)
    if (kind === 'environment') {
      // 环境类失败与执行模型上游无关：不冻结、不重派发（换执行器同样会失败）。
      log.info('executor terminal failure classified as environment; skipped', {
        turnId: params.turnId,
        providerId: ctx.providerId,
        modelId: ctx.modelId,
        detail: params.errorText.slice(0, 120),
      })
      return { kind, frozen: false, freezeMs: 0, failoverArmed: false }
    }
    const freezeMs = autoRouterHealthRegistry.reportFailure(
      ctx.providerId,
      ctx.modelId,
      kind,
      params.errorText,
    )
    const failoverWorthy =
      ctx.failoverArmed &&
      !params.hasProducedSideEffects &&
      isFailoverWorthyFailure(kind, params.errorText)
    if (failoverWorthy) {
      this.armedFailovers.set(ctx.sessionId, { ...ctx.seed, turnId: params.turnId })
    }
    log.warn('executor terminal failure recorded', {
      turnId: params.turnId,
      sessionId: ctx.sessionId,
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      kind,
      freezeMs,
      failoverArmed: failoverWorthy,
      hadSideEffects: params.hasProducedSideEffects,
      detail: params.errorText.slice(0, 120),
    })
    return { kind, frozen: true, freezeMs, failoverArmed: failoverWorthy }
  }

  /**
   * 轮次收尾时消费待重派发种子：仅当武装轮 == 收尾轮且会话无其他在途/排队
   * 用户消息时生效（用户已发新消息则尊重用户意图，放弃自动重跑）。
   */
  consumeFailover(sessionId: string, finalizedTurnId: string): AutoRouterFailoverSeed | null {
    const armed = this.armedFailovers.get(sessionId)
    if (armed == null || armed.turnId !== finalizedTurnId) return null
    this.armedFailovers.delete(sessionId)
    return armed
  }

  /** 放弃某会话已武装的重派发（用户取消/新消息/服务销毁时）。 */
  discardFailover(sessionId: string): void {
    this.armedFailovers.delete(sessionId)
  }

  /** 轮次终结回收（finally / 启动失败路径）：遗忘上下文，防泄漏。 */
  forgetTurn(turnId: string): void {
    this.turns.delete(turnId)
  }

  /** 测试隔离用：清空全部状态。 */
  clear(): void {
    this.turns.clear()
    this.armedFailovers.clear()
  }
}
