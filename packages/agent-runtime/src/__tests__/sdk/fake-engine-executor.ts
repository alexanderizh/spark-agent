import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@spark/protocol'
import type { EngineExecutor } from '../../sdk/engine-executor.js'
import type { SDKExecutorConfig } from '../../sdk/types.js'

/**
 * FakeEngineExecutor —— P1 引擎接口化的行为锁基座（W1-D1）。
 *
 * 以脚本化方式模拟引擎执行器：测试先 `queueFakeEngineScript()` 注册一份剧本，
 * session 层 `new ClaudeSDKExecutor()` / `createCodexExecutorForConfig()` 落到被
 * mock 的 barrel 后，每个 turn 的执行器实例会按序注入剧本事件，并复刻真实
 * 执行器的事件契约（makeBase 补 id/sessionId/turnId/timestamp/seq:0，seq 由
 * session 层 emitAndPersist 覆盖）。cancel 语义对齐真实执行器：cancel() 只是
 * 发信号，随后执行器自己补发终态并以 resolve 收场 —— 迟到事件是否被闸门
 * （shouldAcceptSessionExecutorEvent）丢弃正是基线测试要锁定的行为。
 *
 * 双重身份：既是贯穿基线测试（turn-pipeline-baseline.test.ts）的事件源，
 * 也是后续 W2 统一 turn 管道时的开发自测工具（echo-executor 验收标准 S11）。
 */

/** 剧本事件：只写业务字段，基础字段由执行器按真实 makeBase 契约补齐。 */
export type ScriptedEvent = Record<string, unknown> & { type: AgentEvent['type'] }

export interface FakeEngineScript {
  /** executeTurn 被调用后按序注入的事件（终态由 terminalStatus 另行补发）。 */
  events?: ScriptedEvent[]
  /**
   * 剧本事件注入完后的终态；undefined 默认 'completed'，显式 null 表示
   * 完全不补发终态（用于异常路径）。
   */
  terminalStatus?: 'completed' | 'cancelled' | 'error' | null
  /** 挂起 executeTurn 直到 cancel() 被调用；用于取消路径基线。 */
  holdUntilCancel?: boolean
  /** cancel() 释放后、终态前注入的事件（模拟取消后执行器的迟到事件）。 */
  cancelEvents?: ScriptedEvent[]
  /** cancel() 释放后的终态；undefined 默认 'cancelled'，显式 null 不补发。 */
  cancelTerminal?: 'completed' | 'cancelled' | 'error' | null
  /** executeTurn 以异常收场（在注入完 events 后抛出）。 */
  rejectWith?: Error
}

export interface FakeExecuteTurnRecord {
  sessionId: string
  turnId: string
  message: string
  config: SDKExecutorConfig
}

type EventHandler = (event: AgentEvent) => void

const state = {
  queue: [] as FakeEngineScript[],
  instances: [] as FakeEngineExecutor[],
}

/** 注册下一份剧本；多个 turn 依次出队，无剧本时使用空剧本（默认 completed 终态）。 */
export function queueFakeEngineScript(script: FakeEngineScript): void {
  state.queue.push(script)
}

/** 清空剧本队列与实例记录（beforeEach 调用）。 */
export function resetFakeEngineHarness(): void {
  state.queue.length = 0
  state.instances.length = 0
}

/** 全部执行器实例按创建顺序（即 turn 顺序）。 */
export function fakeEngineInstances(): readonly FakeEngineExecutor[] {
  return state.instances
}

/** 全部 executeTurn 调用记录（按调用顺序）。 */
export function fakeEngineCalls(): FakeExecuteTurnRecord[] {
  return state.instances.flatMap((instance) => (instance.record != null ? [instance.record] : []))
}

export class FakeEngineExecutor implements EngineExecutor {
  readonly engine = 'claude-sdk' as const

  private readonly script: FakeEngineScript
  private readonly handlers = new Set<EventHandler>()
  private releaseOnCancel: (() => void) | null = null
  /** executeTurn 已被调用且正挂在 holdUntilCancel 上。 */
  holding = false
  /** cancel() 已被调用。 */
  cancelRequested = false
  /** 执行器实际 emit 过的全部事件（含被 session 闸门丢弃的迟到事件）。 */
  readonly emitted: ScriptedEvent[] = []
  record: FakeExecuteTurnRecord | null = null

  constructor(script?: FakeEngineScript) {
    this.script = script ?? state.queue.shift() ?? {}
    state.instances.push(this)
  }

  onEvent(handler: EventHandler): void {
    this.handlers.add(handler)
  }

  offEvent(handler: EventHandler): void {
    this.handlers.delete(handler)
  }

  cancel(): void {
    this.cancelRequested = true
    this.releaseOnCancel?.()
  }

  async executeTurn(
    sessionId: string,
    turnId: string,
    message: string,
    config: SDKExecutorConfig,
  ): Promise<void> {
    this.record = { sessionId, turnId, message, config }
    const emit = (event: ScriptedEvent): void => {
      this.emitted.push(event)
      const outgoing = {
        id: randomUUID(),
        sessionId,
        turnId,
        timestamp: new Date().toISOString(),
        seq: 0,
        ...event,
      } as AgentEvent
      for (const handler of this.handlers) handler(outgoing)
    }

    for (const event of this.script.events ?? []) emit(event)
    if (this.script.rejectWith != null) throw this.script.rejectWith

    if (this.script.holdUntilCancel === true) {
      this.holding = true
      await new Promise<void>((resolve) => {
        this.releaseOnCancel = resolve
      })
      this.holding = false
      for (const event of this.script.cancelEvents ?? []) emit(event)
      const terminal = this.script.cancelTerminal ?? 'cancelled'
      if (terminal != null) emit({ type: 'agent_status', status: terminal })
      return
    }

    const terminal =
      this.script.terminalStatus === undefined ? 'completed' : this.script.terminalStatus
    if (terminal != null) emit({ type: 'agent_status', status: terminal })
  }
}
