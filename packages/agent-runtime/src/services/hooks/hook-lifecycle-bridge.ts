import { randomUUID } from 'node:crypto'
import type { HookEventEnvelopeV1, HookEventNameV1 } from '@spark/protocol'
import {
  AgentRepository,
  HookEventRepository,
  SessionRepository,
  type SparkDatabase,
  WorkspaceRepository,
} from '@spark/storage'
import { deriveEventId } from './hook-expression.js'
import { HookEventEmitter } from './hook-event-emitter.js'

/**
 * HookLifecycleBridge（设计方案 §13）：把 SessionService / PermissionService 的
 * 生命周期事实转成版本化事件信封并持久化到 outbox。
 *
 * - eventId 由事件名 + 稳定源 ID 确定性生成（turnId / messageId / requestId / questionId），
 *   重复发射经 hook_events 主键天然去重。
 * - 载荷只含白名单字段：finalText 只在 response.committed 出现且仅为最终可见正文。
 * - 系统维护任务可能没有可解析 Agent：此时省略 agent，只匹配 application/workspace/session。
 */

export interface HookLifecycleBridgeOptions {
  /** 事件持久化后的回调（主进程用它触发 Dispatcher）。 */
  onEventPersisted?: (envelope: HookEventEnvelopeV1) => void
}

interface SessionContext {
  sessionId: string
  sessionTitle?: string
  agentId?: string
  agentName?: string
  workspaceIds: string[]
  primaryWorkspaceId?: string
}

export class HookLifecycleBridge {
  private readonly emitter: HookEventEmitter
  private readonly sessionRepository: SessionRepository
  private readonly agentRepository: AgentRepository
  private readonly workspaceRepository: WorkspaceRepository

  constructor(
    private readonly db: SparkDatabase,
    options: HookLifecycleBridgeOptions = {},
  ) {
    this.emitter = new HookEventEmitter(new HookEventRepository(db), {
      ...(options.onEventPersisted != null ? { onEventPersisted: options.onEventPersisted } : {}),
    })
    this.sessionRepository = new SessionRepository(db)
    this.agentRepository = new AgentRepository(db)
    this.workspaceRepository = new WorkspaceRepository(db)
  }

  getEventEmitter(): HookEventEmitter {
    return this.emitter
  }

  private buildSessionContext(sessionId: string): SessionContext | null {
    const session = this.sessionRepository.get(sessionId)
    if (session == null) return null
    const workspaceIds = this.sessionRepository.getWorkspaceIds(sessionId)
    const agentId = (session as { agent_id?: string | null }).agent_id ?? undefined
    const agent = agentId != null ? this.agentRepository.get(agentId) : null
    const primaryWorkspaceId = workspaceIds[0]
    return {
      sessionId,
      ...(session.title != null ? { sessionTitle: session.title } : {}),
      ...(agent != null ? { agentId: agent.id, agentName: agent.name } : {}),
      workspaceIds,
      ...(primaryWorkspaceId != null ? { primaryWorkspaceId } : {}),
    }
  }

  private buildEnvelope(
    context: SessionContext,
    eventName: HookEventNameV1,
    turnId: string,
    payload: Record<string, unknown>,
    eventId: string,
  ): HookEventEnvelopeV1 {
    const workspaces = context.workspaceIds.map((id) => {
      const workspace = this.workspaceRepository.get(id)
      return workspace != null ? { id, name: workspace.name } : { id }
    })
    return {
      schemaVersion: 1,
      eventId,
      eventName,
      occurredAt: new Date().toISOString(),
      source: 'host',
      session: {
        id: context.sessionId,
        ...(context.sessionTitle != null ? { title: context.sessionTitle } : {}),
      },
      turn: { id: turnId },
      ...(context.agentId != null
        ? {
            agent: {
              id: context.agentId,
              ...(context.agentName != null ? { name: context.agentName } : {}),
            },
          }
        : {}),
      workspaces,
      ...(context.primaryWorkspaceId != null
        ? { primaryWorkspaceId: context.primaryWorkspaceId }
        : {}),
      payload,
    }
  }

  /** Turn 已建立并准备进入执行管线。稳定源：turnId。 */
  turnStarted(sessionId: string, turnId: string): void {
    this.emitForSession(sessionId, 'turn.started', turnId, {}, turnId)
  }

  /** 最终可见回答成功持久化。稳定源：messageId。 */
  responseCommitted(sessionId: string, turnId: string, messageId: string, finalText: string): void {
    this.emitForSession(
      sessionId,
      'response.committed',
      turnId,
      { response: { messageId, finalText } },
      messageId,
    )
  }

  /** Turn 成功/失败/取消终态首次持久化。稳定源：turnId + terminal status。 */
  turnTerminal(
    sessionId: string,
    turnId: string,
    status: 'completed' | 'failed' | 'cancelled',
    message?: string,
  ): void {
    const eventName: HookEventNameV1 = `turn.${status}`
    this.emitForSession(sessionId, eventName, turnId, message != null ? { message } : {}, turnId)
  }

  /** 真实权限请求进入等待。稳定源：permission requestId。 */
  permissionRequested(info: {
    sessionId: string
    turnId: string
    requestId: string
    toolName: string
    action: string
    riskLevel: string
  }): void {
    this.emitForSession(
      info.sessionId,
      'permission.requested',
      info.turnId,
      {
        requestId: info.requestId,
        toolName: info.toolName,
        action: info.action,
        riskLevel: info.riskLevel,
      },
      info.requestId,
    )
  }

  /** Agent 提问进入等待用户输入。稳定源：questionId（缺省时一次性生成）。 */
  questionRequested(
    sessionId: string,
    turnId: string,
    options: {
      questionId?: string
      questions?: Array<{ label?: string; title?: string; description?: string }>
    } = {},
  ): void {
    const questionId = options.questionId ?? randomUUID()
    this.emitForSession(
      sessionId,
      'question.requested',
      turnId,
      {
        questionId,
        questions: (options.questions ?? []).map((question) => ({
          ...(question.label != null ? { label: question.label } : {}),
          ...(question.title != null ? { title: question.title } : {}),
          ...(question.description != null ? { description: question.description } : {}),
        })),
      },
      questionId,
    )
  }

  private emitForSession(
    sessionId: string,
    eventName: HookEventNameV1,
    turnId: string,
    payload: Record<string, unknown>,
    sourceId: string,
  ): void {
    try {
      const context = this.buildSessionContext(sessionId)
      if (context == null) return
      const envelope = this.buildEnvelope(
        context,
        eventName,
        turnId,
        payload,
        deriveEventId(eventName, sourceId),
      )
      this.emitter.emit(envelope)
    } catch {
      // Hook 基础设施不可用时 Agent 主流程继续（设计方案 §12.4）；
      // 事件缺失由补偿扫描（后续阶段）兜底，这里不向调用方抛错。
    }
  }
}
