import { randomUUID } from 'node:crypto'

import type { AgentEvent } from '@spark/protocol'

import type { EngineExecutor } from '../engine-executor.js'
import type { SDKExecutorConfig } from '../types.js'

/**
 * Spark 引擎执行器（自研 spark-engine，进程内 @spark/agent SDK）。
 *
 * M1 阶段为契约合规的占位实现：executeTurn 发出 agent_error + error 终态
 * 状态事件后正常 resolve（终态只经事件流表达，见 EngineExecutor 契约），
 * 保证类型层登记完 'spark' 后任何提前触达该引擎的路径都失败可见、不悬挂。
 * M2 落地真实实现（Agent.open → session.turn → 事件映射）时整体替换本类。
 */
export class SparkEngineExecutor implements EngineExecutor {
  readonly engine = 'spark' as const

  readonly #listeners = new Set<(event: AgentEvent) => void>()

  onEvent(listener: (event: AgentEvent) => void): void {
    this.#listeners.add(listener)
  }

  offEvent(listener: (event: AgentEvent) => void): void {
    this.#listeners.delete(listener)
  }

  cancel(): void {
    // 占位实现：无进行中的 turn，取消无事可做。
  }

  async executeTurn(
    sessionId: string,
    turnId: string,
    _userMessage: string,
    _config: SDKExecutorConfig,
  ): Promise<void> {
    const base = {
      id: randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    }
    this.#emit({
      ...base,
      type: 'agent_error',
      code: 'spark_executor_not_implemented',
      title: 'Spark 执行器尚未实现',
      message:
        'Spark 引擎执行器处于 M1 占位阶段，真实实现随 M2 落地（见 todo/2026-09-05-spark-engine-adapter-plan.md）。',
      retryable: false,
    })
    this.#emit({ ...base, type: 'agent_status', status: 'error' })
  }

  #emit(event: AgentEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event)
      } catch {
        // 监听器异常不阻断事件流（与其余执行器口径一致）。
      }
    }
  }
}

/** 进程内探测 @spark/agent SDK 是否可加载（engine-registry checkAvailability 用）。 */
export async function isSparkEngineAvailable(): Promise<boolean> {
  try {
    await import('@spark/agent')
    return true
  } catch {
    return false
  }
}
