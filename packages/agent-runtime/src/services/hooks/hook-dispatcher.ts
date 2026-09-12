import type { HookEventEnvelopeV1 } from '@spark/protocol'
import {
  HookBindingRepository,
  HookDefinitionRepository,
  HookEventRepository,
  HookRunRepository,
  type SparkDatabase,
} from '@spark/storage'
import { executableBindings, resolveEffectiveBindings } from './hook-binding-resolver.js'
import { evaluateCondition } from './hook-expression.js'

/**
 * HookDispatcher（设计方案 §5/§11）：消费 hook_events outbox，解析绑定与定义快照，
 * 创建运行记录并把事件标为 resolved。
 *
 * - 同一 (event_id, hook_id) 的运行由唯一约束确定性去重；事件重解析不重跑。
 * - 条件不匹配记录为 skipped/condition_not_matched，保证「最终生效列表」可解释。
 * - 命中 ambiguous_binding 的 Hook 被拒绝，不得用创建时间或数组顺序静默选择。
 * - 解析失败不终结事件：释放租约回 pending，交给下次调度。
 */

export interface HookDispatcherOptions {
  owner: string
  leaseMs?: number
  /** 应用级总开关关闭时暂停解析（事件保留 pending）。 */
  isEnabled?: () => boolean
}

export class HookDispatcher {
  private readonly events: HookEventRepository
  private readonly definitions: HookDefinitionRepository
  private readonly bindings: HookBindingRepository
  private readonly runs: HookRunRepository
  private readonly leaseMs: number
  private readonly owner: string
  private readonly isEnabled: () => boolean

  constructor(
    private readonly db: SparkDatabase,
    options: HookDispatcherOptions,
  ) {
    this.events = new HookEventRepository(db)
    this.definitions = new HookDefinitionRepository(db)
    this.bindings = new HookBindingRepository(db)
    this.runs = new HookRunRepository(db)
    this.owner = options.owner
    this.leaseMs = options.leaseMs ?? 60_000
    this.isEnabled = options.isEnabled ?? (() => true)
  }

  /** 处理一条 pending 事件。返回是否处理了事件（false = 队列为空或被暂停）。 */
  async dispatchNext(): Promise<boolean> {
    if (!this.isEnabled()) return false
    const event = this.events.claimNextPending(this.owner, this.leaseMs)
    if (event == null) return false
    let envelope: HookEventEnvelopeV1
    try {
      envelope = JSON.parse(event.envelope_json) as HookEventEnvelopeV1
    } catch (error) {
      this.events.markFailed(event.event_id, `envelope 解析失败: ${String(error)}`)
      return true
    }

    try {
      const definitions = this.definitions.listEnabledByEvent(envelope.eventName)
      const scopes: Array<{
        scopeKind: 'application' | 'workspace' | 'agent' | 'session'
        scopeId: string
      }> = [{ scopeKind: 'application', scopeId: '' }]
      if (envelope.primaryWorkspaceId != null) {
        scopes.push({ scopeKind: 'workspace', scopeId: envelope.primaryWorkspaceId })
      }
      if (envelope.agent != null) {
        scopes.push({ scopeKind: 'agent', scopeId: envelope.agent.id })
      }
      scopes.push({ scopeKind: 'session', scopeId: envelope.session.id })
      const bindings = this.bindings.listForScopes(scopes)
      const { items, ambiguousHookIds } = resolveEffectiveBindings({
        envelope,
        definitions,
        bindings,
      })

      const runnable = executableBindings(items)
      for (const item of runnable) {
        const conditionMatched =
          item.hook.condition == null || evaluateCondition(envelope, item.hook.condition)
        this.db.raw.transaction(() => {
          this.runs.insertIfAbsent({
            eventId: envelope.eventId,
            eventName: envelope.eventName,
            hookId: item.hook.id,
            hookRevision: item.hook.revision,
            bindingId: item.binding.id,
            scopeKind: item.sourceScope,
            sessionId: envelope.session.id,
            turnId: envelope.turn.id,
            definitionSnapshot: item.hook,
            bindingSnapshot: item.binding,
            envelope,
            status: conditionMatched ? 'queued' : 'skipped',
            ...(conditionMatched ? {} : { errorCode: 'condition_not_matched' as const }),
          })
        })()
      }
      for (const hookId of ambiguousHookIds) {
        console.warn(
          `[hooks-v2] ambiguous binding for hook ${hookId} on event ${envelope.eventId}; skipped`,
        )
      }
      this.events.markResolved(event.event_id)
      return true
    } catch (error) {
      this.events.requeueExpiredLeases()
      console.warn(
        `[hooks-v2] dispatch failed for event ${envelope.eventId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return true
    }
  }

  /** 批量派发 pending 事件（上限 maxEvents，防止单次 tick 过重）。 */
  async dispatchPending(maxEvents = 32): Promise<number> {
    let processed = 0
    while (processed < maxEvents) {
      const processedAny = await this.dispatchNext()
      if (!processedAny) break
      processed += 1
    }
    return processed
  }
}
