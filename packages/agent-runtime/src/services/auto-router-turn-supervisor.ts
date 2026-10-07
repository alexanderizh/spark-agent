import { createLogger } from '@spark/shared'
import type { SessionAttachment, SessionReferenceInput, TurnSource } from '@spark/protocol'
import {
  autoRouterHealthRegistry,
  classifyExecutorFailure,
  isFailoverWorthyFailure,
  type AutoRouterFailureKind,
  type AutoRouterHealthRegistry,
} from './auto-router-health'

const log = createLogger('auto-router-health')

/**
 * 自动路由轮次重派发种子：与故障切换时刻的原 turn 面向模型输入一致的核心参数，
 * 从 startTurnExecution 的入参保存（浅拷贝数组防外部复用改写）。
 *
 * 有意排除的字段（重派发语义下不应携带）：
 * - `runtimePatch`：重派发的目的就是重新路由换绑执行器，原运行时补丁作废；
 * - `clientMessageId`：重派发是服务端行为，不复用客户端消息幂等键；
 * - `teamConfig` / `agentId`：已知取舍——团队轮故障切换会退化为普通轮重跑。
 *   团队编排轮的 turnSource 多为编排入口（不在 'user' 白名单内，不武装），
 *   仅「用户聊天 + 临时指定成员」的窄场景会走该退化路径。
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
  /** 本轮是否还允许一次故障切换重派发（仅用户聊天轮允许，见 registerTurn）。 */
  failoverArmed: boolean
}

/** 轮次终态失败经 supervisor 处理后的结论（挂点据此发信号/重派发）。 */
export interface AutoRouterTerminalErrorOutcome {
  /** 失败归类；environment 类与执行模型上游无关。 */
  kind: AutoRouterFailureKind
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
 * 已武装待消费的重派发条目：seed 外加原轮 turnId 与武装时刻的冻结信息，
 * 供重派发点（过闸门后发 info 信号 / 被闸门拦截时发 warning 补偿）使用。
 */
export interface ArmedAutoRouterFailover extends AutoRouterFailoverSeed {
  turnId: string
  /** 武装时刻的冻结时长（毫秒）。 */
  freezeMs: number
  /** 武装时刻的失败归类。 */
  kind: AutoRouterFailureKind
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
  private readonly armedFailovers = new Map<string, ArmedAutoRouterFailover>()
  /**
   * 已上报成功的轮次（exactly-once 去重）：session.service 的成功路径会对同一
   * turnId 调用两次 onTurnSuccess（后处理入口 + settle 尾部守卫版），今天靠
   * reportSuccess/种子作废的幂等性撑住；此守卫保证未来向 onTurnSuccess 添加
   * 非幂等逻辑（打点、通知）时不会双计。forgetTurn 时清理。
   */
  private readonly succeededTurns = new Set<string>()
  /** 健康注册表（默认进程内单例；测试可注入独立实例，与 AutoRouterService 的 DI 对齐）。 */
  private readonly registry: AutoRouterHealthRegistry

  constructor(registry: AutoRouterHealthRegistry = autoRouterHealthRegistry) {
    this.registry = registry
  }

  /**
   * 路由成功换绑执行器后登记本轮上下文（startTurnExecution 路由消费点调用）。
   *
   * 故障切换白名单：只有 `turnSource === 'user'`（用户聊天入口显式标记）的轮次
   * 才允许武装重派发。画布/工作流/定时等编排型轮次静默重跑会注入重复执行
   * （重复计费、重复写文件），一律不武装；未标记来源默认视为非用户聊天（安全兜底：
   * 未来新增的内部调用方不设 turnSource 就自然排除）。
   *
   * 有意排除的用户型来源：`remote_user`（Telegram/飞书/QQ/微信远程消息）与
   * `voice`（语音助手）同为用户亲自发起，但**远程/语音管线有自己的投递语义**
   * （结果回传、TTS 播报、断线重试），静默重派一轮会产生双份投递/双份播报，
   * 故不纳入自动重派发——这两类轮次失败时仍会冻结执行器并发 warning 信号，
   * 用户重发一次即可。若后续远程链路支持幂等投递，可将其加入白名单。
   */
  registerTurn(params: {
    turnId: string
    sessionId: string
    routerId: string
    routerName: string
    providerId: string
    modelId: string
    /** 重派发轮传 true：本轮不允许再次故障切换。 */
    isRedispatch: boolean
    /** 轮次来源；仅 'user'（用户聊天）允许武装故障切换重派发。 */
    turnSource?: TurnSource | undefined
    seed: AutoRouterFailoverSeed
  }): void {
    this.turns.set(params.turnId, {
      sessionId: params.sessionId,
      routerId: params.routerId,
      routerName: params.routerName,
      providerId: params.providerId,
      modelId: params.modelId,
      failoverArmed: !params.isRedispatch && params.turnSource === 'user',
      seed: {
        ...params.seed,
        ...(params.seed.attachments != null ? { attachments: [...params.seed.attachments] } : {}),
        ...(params.seed.sessionReferences != null
          ? { sessionReferences: [...params.seed.sessionReferences] }
          : {}),
      },
    })
  }

  /**
   * 轮次成功终态：清零执行器失败计数（半开恢复探针通过），并作废本轮已武装的
   * 故障切换种子——中途瞬时 error 武装种子后 SDK 自愈完成轮次时，若不丢弃，
   * 收尾消费会把**已成功**的轮次静默重跑一遍。未登记轮次为 no-op。
   */
  onTurnSuccess(turnId: string): void {
    const ctx = this.turns.get(turnId)
    if (ctx == null) return
    if (this.succeededTurns.has(turnId)) return
    this.succeededTurns.add(turnId)
    this.registry.reportSuccess(ctx.providerId, ctx.modelId)
    const armed = this.armedFailovers.get(ctx.sessionId)
    if (armed != null && armed.turnId === turnId) {
      this.armedFailovers.delete(ctx.sessionId)
      log.info('armed failover discarded: turn succeeded after transient error', {
        turnId,
        sessionId: ctx.sessionId,
      })
    }
  }

  /**
   * 轮次终态失败（真实落库的 agent_error）：归类 → 冻结 → 判定是否武装重派发。
   * `hasProducedSideEffects` 是惰性 thunk：由挂点查询事件库给出（assistant/
   * 团队消息/工具调用）——非 auto-router 会话（未登记轮次）在早退时不会触发
   * 这次 DB 查询；`errorCode` 是 agent_error 事件的错误码，优先于文本参与
   * 归类（权限等待等本地闸门错误靠错误码识别，防文本误判为可重试而误冻结执行器）。
   */
  onTerminalError(params: {
    turnId: string
    errorText: string
    errorCode?: string
    hasProducedSideEffects: () => boolean
  }): AutoRouterTerminalErrorOutcome | null {
    const ctx = this.turns.get(params.turnId)
    if (ctx == null) return null
    const kind = classifyExecutorFailure({
      code: params.errorCode,
      text: params.errorText,
    })
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
    const freezeMs = this.registry.reportFailure(
      ctx.providerId,
      ctx.modelId,
      kind,
      params.errorText,
    )
    const hadSideEffects = params.hasProducedSideEffects()
    const failoverWorthy =
      ctx.failoverArmed && !hadSideEffects && isFailoverWorthyFailure(kind, params.errorText)
    if (failoverWorthy) {
      this.armedFailovers.set(ctx.sessionId, {
        ...ctx.seed,
        turnId: params.turnId,
        freezeMs,
        kind,
      })
    }
    log.warn('executor terminal failure recorded', {
      turnId: params.turnId,
      sessionId: ctx.sessionId,
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      kind,
      freezeMs,
      failoverArmed: failoverWorthy,
      hadSideEffects,
      detail: params.errorText.slice(0, 120),
    })
    return { kind, frozen: true, freezeMs, failoverArmed: failoverWorthy }
  }

  /**
   * 轮次收尾时消费待重派发种子：仅当武装轮 == 收尾轮时生效。「用户已发新消息/
   * 错误暂停激活时放弃自动重跑」的闸门在 session.service 的 dispatchAutoRouterFailover
   * 调用点（queue-error-pause 检查）。
   */
  consumeFailover(sessionId: string, finalizedTurnId: string): ArmedAutoRouterFailover | null {
    const armed = this.armedFailovers.get(sessionId)
    if (armed == null || armed.turnId !== finalizedTurnId) return null
    this.armedFailovers.delete(sessionId)
    return armed
  }

  /** 放弃某会话已武装的重派发（用户取消/新消息/服务销毁时）。 */
  discardFailover(sessionId: string): void {
    this.armedFailovers.delete(sessionId)
  }

  /**
   * 轮次终结回收（finally / 启动失败路径）：遗忘上下文，防泄漏；同时作废该轮
   * 自身武装的重派发种子——正常失败路径的种子已在收尾消费块先行取走（此处
   * no-op），被取消/无执行权收尾的轮次其种子不应滞留到同会话后续轮次。
   */
  forgetTurn(turnId: string): void {
    const ctx = this.turns.get(turnId)
    if (ctx != null) {
      const armed = this.armedFailovers.get(ctx.sessionId)
      if (armed != null && armed.turnId === turnId) {
        this.armedFailovers.delete(ctx.sessionId)
      }
    }
    this.turns.delete(turnId)
    this.succeededTurns.delete(turnId)
  }

  /** 测试隔离用：清空全部状态。 */
  clear(): void {
    this.turns.clear()
    this.armedFailovers.clear()
  }
}
