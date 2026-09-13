import type { HookEventEnvelopeV1 } from '@spark/protocol'
import type { HookEventRepository } from '@spark/storage'

/**
 * HookEventEmitter（设计方案 §5/§11.3）：生命周期接入点只负责构造并持久化事件，
 * 不包含动作执行逻辑。事件先持久化 outbox（幂等，eventId 主键），再由 Dispatcher 消费。
 */
export class HookEventEmitter {
  constructor(
    private readonly events: HookEventRepository,
    private readonly options: { onEventPersisted?: (envelope: HookEventEnvelopeV1) => void } = {},
  ) {}

  /**
   * 持久化事件信封。返回 false 表示同一 eventId 已存在（重放/重试），不会重复派发。
   * 同步写入 SQLite；随后通过回调通知调度器（异步消费，不阻塞生命周期主流程）。
   */
  emit(envelope: HookEventEnvelopeV1): boolean {
    const created = this.events.insertIfAbsent({
      eventId: envelope.eventId,
      eventName: envelope.eventName,
      sessionId: envelope.session.id,
      turnId: envelope.turn.id,
      agentId: envelope.agent?.id ?? null,
      primaryWorkspaceId: envelope.primaryWorkspaceId ?? null,
      envelope,
    })
    if (created) {
      try {
        this.options.onEventPersisted?.(envelope)
      } catch {
        // 调度失败不影响事件持久化；pending 事件会被下一次 dispatch 扫描消费。
      }
    }
    return created
  }
}
