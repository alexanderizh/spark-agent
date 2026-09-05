import { randomUUID } from 'node:crypto'

import { Agent, ModelRegistry, createDefaultEnv } from '@spark/agent'
import type { AgentSession, LlmService } from '@spark/agent'
import type { AgentEvent } from '@spark/protocol'

import type { EngineExecutor, PermissionModeAwareExecutor } from '../engine-executor.js'
import type { SDKExecutorConfig } from '../types.js'
import { HostBridgeApprover } from './approver-bridge.js'
import { SparkEventMapper } from './event-mapper.js'
import { resolveSparkModelRoute, toSparkEnginePermissionMode } from './model-route.js'

/**
 * 测试注入口：替换「渠道配置 → LlmService」的默认构造（registerHttp 路径），
 * 供单测注入 FakeModel 驱动完整 turn。仅测试代码调用，生产路径恒为 null。
 */
let sparkLlmFactoryForTests: ((config: SDKExecutorConfig) => LlmService) | null = null

export function setSparkLlmFactoryForTests(
  factory: ((config: SDKExecutorConfig) => LlmService) | null,
): void {
  sparkLlmFactoryForTests = factory
}

/**
 * Spark 引擎执行器（自研 spark-engine，进程内 @spark/agent SDK）。
 *
 * 每 turn 新建实例（契约）；turn 生命周期：
 * 1. resolveSparkModelRoute 校验并归一渠道配置 → ModelRegistry.registerHttp
 *    注入模型（完全绕过 config.toml）。
 * 2. Agent.open({cwd, env}) → 首轮 newSession，续轮 openSession（事件账本重放，
 *    崩溃恢复由引擎侧 findInterruptedTurn 完成）。
 * 3. session.turn(input, {signal, onEvent, onDelta})；spark 事件/增量经
 *    SparkEventMapper 映射为 protocol AgentEvent 后上抛。
 * 4. 终态只经事件流表达：turn.completed/cancelled/failed 由映射器产出终态
 *    agent_status；cancel() 经 AbortSignal 触发引擎的 turn.cancelled 路径。
 *
 * 数据根：默认 ~/.spark（与 SparkCliBridgeService / spark CLI 共用，跨端一致）；
 * config.sparkDataRoot 可覆盖（测试隔离用）。构造参数经 config 传入（契约）。
 *
 * 审批（M3）：config.approvalCallback 存在时注入 HostBridgeApprover——引擎 default
 * 模式下 approval !== 'never' 的工具（write/edit/bash…）经 host permission service
 * 走与 claude 相同的用户审批链路；无回调时回落引擎默认 FakeApprover（全 deny）。
 * 权限热切换（M3）：实现 PermissionModeAwareExecutor，turn 进行中透传引擎
 * session.setPermissionMode；turn 间切换由 host 持久化的 permission_mode 在下一轮
 * newSession/openSession 时生效（openSession 后按 host 最新值对齐账本恢复值）。
 *
 * 待接：自定义系统提示词注入（DefaultPromptComposer 接缝在引擎侧扩展）。
 */
export class SparkEngineExecutor implements EngineExecutor, PermissionModeAwareExecutor {
  readonly engine = 'spark' as const

  readonly #listeners = new Set<(event: AgentEvent) => void>()
  #abortController: AbortController | null = null
  #currentSession: AgentSession | null = null

  onEvent(listener: (event: AgentEvent) => void): void {
    this.#listeners.add(listener)
  }

  offEvent(listener: (event: AgentEvent) => void): void {
    this.#listeners.delete(listener)
  }

  cancel(): void {
    this.#abortController?.abort()
  }

  /** 权限热切换：turn 进行中透传引擎 session（applyPermissionModeChange 经能力接口调用）。 */
  async setPermissionMode(mode: SDKExecutorConfig['permissionMode']): Promise<void> {
    this.#currentSession?.setPermissionMode(toSparkEnginePermissionMode(mode))
  }

  async executeTurn(
    sessionId: string,
    turnId: string,
    userMessage: string,
    config: SDKExecutorConfig,
  ): Promise<void> {
    const mapper = new SparkEventMapper({ sessionId, turnId, model: config.model })
    const emitFrom = (events: readonly AgentEvent[]): void => {
      for (const event of events) this.#emit(event)
    }
    const fail = (code: string, message: string): void => {
      this.#emit({
        id: randomUUID(),
        sessionId,
        turnId,
        timestamp: new Date().toISOString(),
        seq: 0,
        type: 'agent_error',
        code,
        title: 'Spark 引擎错误',
        message,
        retryable: false,
      })
      this.#emit({
        id: randomUUID(),
        sessionId,
        turnId,
        timestamp: new Date().toISOString(),
        seq: 0,
        type: 'agent_status',
        status: 'error',
      })
    }

    const route = resolveSparkModelRoute(config)
    if (!route.ok) {
      fail('spark_route_unresolvable', route.reason)
      return
    }

    const llm =
      sparkLlmFactoryForTests != null
        ? sparkLlmFactoryForTests(config)
        : (() => {
            const registry = new ModelRegistry()
            registry.registerHttp({
              id: route.modelId,
              providerId: 'sparkwork',
              protocol: route.protocol,
              model: config.model,
              ...(route.baseUrl != null ? { baseUrl: route.baseUrl } : {}),
              apiKey: route.apiKey,
            })
            return registry.createRoute([route.modelId])
          })()

    const workspaceRoot = config.workspaceRootPath
    const env = createDefaultEnv({
      cwd: workspaceRoot,
      ...(config.sparkDataRoot != null ? { dataRoot: config.sparkDataRoot } : {}),
      llm,
      ...(config.approvalCallback != null
        ? { approver: new HostBridgeApprover(sessionId, config.approvalCallback) }
        : {}),
    })
    const agent = Agent.open({ cwd: workspaceRoot, env })

    // 续跑：resume gate 持久化的 sdkSessionId 存在且可重放时走 openSession；
    // 会话账本缺失（数据根被清）时降级新会话，不阻断本轮。
    const engineMode = toSparkEnginePermissionMode(config.permissionMode)
    let session: AgentSession | undefined
    const resumeCandidate = config.continueSession === true ? config.sdkSessionId : undefined
    if (resumeCandidate != null && resumeCandidate.length > 0) {
      try {
        session = await agent.openSession(resumeCandidate)
      } catch {
        session = undefined
      }
    }
    if (session == null) {
      session = await agent.newSession({ permissionMode: engineMode })
    } else if (session.permissionMode !== engineMode) {
      // 账本恢复的是旧模式；host 本轮组装的是用户最新选择，以 host 为准。
      session.setPermissionMode(engineMode)
    }
    try {
      await config.sparkSessionIdObserver?.(session.sessionId)
    } catch {
      // 观察者异常不影响 turn 执行。
    }

    this.#currentSession = session
    this.#abortController = new AbortController()
    try {
      await session.turn(userMessage, {
        signal: this.#abortController.signal,
        onEvent: (sparkEvent) => emitFrom(mapper.mapSparkEvent(sparkEvent)),
        onDelta: (delta) => emitFrom(mapper.mapDelta(delta)),
      })
    } catch (error) {
      // 引擎异常上抛（如 fake script 耗尽、内部 invariant）：映射器可能已发过
      // turn.failed 终态，此处兜底补发（fail 内部不判重，最坏双 error 事件，
      // session 层按终态 agent_status 幂等收敛）。
      const message = error instanceof Error ? error.message : String(error)
      if (!this.#terminalEmitted) fail('spark_turn_exception', message)
    } finally {
      this.#abortController = null
      this.#currentSession = null
    }
  }

  /** mapper 已产出终态（completed/cancelled/error 的 agent_status）即视为兜底豁免。 */
  get #terminalEmitted(): boolean {
    return this.#sawTerminalStatus
  }

  #sawTerminalStatus = false

  #emit(event: AgentEvent): void {
    if (
      event.type === 'agent_status' &&
      ['completed', 'cancelled', 'error'].includes(event.status)
    ) {
      this.#sawTerminalStatus = true
    }
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
