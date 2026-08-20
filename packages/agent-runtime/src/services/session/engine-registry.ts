import type { SessionAgentAdapter } from '@spark/protocol'
import {
  ClaudeSDKExecutor,
  CodexAppServerExecutor,
  CodexCliExecutor,
  CodexOpenAIExecutor,
  isSDKAvailable,
} from '../../sdk/index.js'
import type { SDKExecutorConfig } from '../../sdk/index.js'
import type { EngineExecutor, EngineKind } from '../../sdk/engine-executor.js'
import { CodexAppServerRuntimeSupervisor } from '../../sdk/codex-app-server/codex-runtime-supervisor.js'
import { isPersistentCodexRuntimeEnabled } from '../../sdk/codex-app-server/codex-app-server-runtime.js'
import { resolveEngineKind } from './engine-kinds.js'

/**
 * 引擎注册表（P1-W1-D5）。
 *
 * 职责：把「kind → 执行器构造 + 能力声明」收敛为 descriptor 注册，
 * 替代 session.service 里散落的执行器实例化分叉。第三引擎接入 =
 * 一个 descriptor + 一次 register，不再触碰 session.service。
 *
 * D5 范围：主分叉（claude/codex turn 路径）与成员分叉的执行器解析
 * 改经本注册表；checkAvailability 与 capabilities 本阶段只声明，
 * 由 W2 统一 turn 管道与能力探测（W2-D5）接入消费。
 */

/** 引擎能力声明：调用方按能力分支，而不是按引擎名 if/else。 */
export interface EngineCapabilities {
  /** 会话续跑（resume）：claude 在 resume gate 内支持；codex thread resume 部分支持（Phase 3 评估）。 */
  nativeResume: boolean
  /** 运行中热切换权限模式（setPermissionMode）：仅 claude。 */
  permissionHotSwitch: boolean
  /** checkpoint 回退（rewindFiles）：仅 claude。 */
  checkpointRewind: boolean
  /** 原生 subagent 工具（Task）：仅 claude。 */
  subagentTool: boolean
}

export interface EngineAvailability {
  available: boolean
  reason?: string
}

export interface EngineDescriptor {
  kind: EngineKind
  /** 按 turn 配置构造执行器；每 turn 新建实例（实例身份是事件闸门，见 EngineExecutor 契约）。 */
  createExecutor(config: SDKExecutorConfig): EngineExecutor
  capabilities: EngineCapabilities
  /** 运行前可用性检查（SDK/CLI 运行时是否就位）；W2 统一管道接入，失败走 emitSdkRequiredError 等价路径。 */
  checkAvailability(config: SDKExecutorConfig): Promise<EngineAvailability>
}

export class EngineRegistry {
  private readonly descriptors = new Map<EngineKind, EngineDescriptor>()
  private readonly disposeHandlers = new Set<() => void | Promise<void>>()
  private disposePromise: Promise<void> | null = null

  register(descriptor: EngineDescriptor): void {
    this.descriptors.set(descriptor.kind, descriptor)
  }

  /** 未注册直接抛错（fail-loud），不静默回落默认引擎。 */
  get(kind: EngineKind): EngineDescriptor {
    const descriptor = this.descriptors.get(kind)
    if (descriptor == null) {
      throw new Error(`No engine descriptor registered for kind: ${kind}`)
    }
    return descriptor
  }

  /** adapter 口径解析（resolveEngineKind 穷尽 switch）→ descriptor 构造执行器。 */
  resolveExecutor(adapter: SessionAgentAdapter, config: SDKExecutorConfig): EngineExecutor {
    return this.get(resolveEngineKind(adapter)).createExecutor(config)
  }

  registerDisposeHandler(handler: () => void | Promise<void>): void {
    this.disposeHandlers.add(handler)
  }

  async dispose(): Promise<void> {
    if (this.disposePromise != null) return this.disposePromise
    this.disposePromise = Promise.allSettled(
      [...this.disposeHandlers].map((handler) => Promise.resolve().then(handler)),
    ).then(() => undefined)
    return this.disposePromise
  }
}

/**
 * codex 载具三选一（原 session.service 模块级工厂整体迁入）：
 * 按 useLocalConfig/codexApiKind/codexCliProvider.wireApi 选
 * CodexCli / CodexOpenAI / CodexAppServer——载具差异降为 codex 引擎内部细节。
 *
 * responses 路径默认 app-server 载具（token 级流式 + 思考流 + 优雅取消，
 * 见 docs/plans/2026-08-16-codex-app-server-streaming.md）；载具内部在
 * 握手失败/图片附件等场景自动回退 CodexSdkExecutor，最坏情况等于旧行为。
 */
export function createCodexExecutorForConfig(
  config: Pick<SDKExecutorConfig, 'useLocalConfig' | 'codexApiKind' | 'codexCliProvider'>,
  options: { runtimeSupervisor?: CodexAppServerRuntimeSupervisor | undefined } = {},
): CodexCliExecutor | CodexOpenAIExecutor | CodexAppServerExecutor {
  if (config.useLocalConfig === true) return new CodexCliExecutor()
  if (config.codexApiKind === 'chat') {
    return new CodexOpenAIExecutor()
  }
  if (config.codexApiKind == null && config.codexCliProvider?.wireApi === 'chat') {
    return new CodexOpenAIExecutor()
  }
  return options.runtimeSupervisor == null
    ? new CodexAppServerExecutor()
    : new CodexAppServerExecutor({ runtimeSupervisor: options.runtimeSupervisor })
}

const claudeEngineDescriptor: EngineDescriptor = {
  kind: 'claude-sdk',
  // config 由 SDK query 路径整包消费，构造器本身无参。
  createExecutor: () => new ClaudeSDKExecutor(),
  capabilities: {
    nativeResume: true,
    permissionHotSwitch: true,
    checkpointRewind: true,
    subagentTool: true,
  },
  checkAvailability: async () =>
    (await isSDKAvailable())
      ? { available: true }
      : {
          available: false,
          reason: 'Claude Agent SDK runtime is not available',
        },
}

function createCodexEngineDescriptor(
  runtimeSupervisor?: CodexAppServerRuntimeSupervisor,
): EngineDescriptor {
  return {
    kind: 'codex',
    createExecutor: (config) => createCodexExecutorForConfig(config, { runtimeSupervisor }),
    capabilities: {
      nativeResume: runtimeSupervisor != null,
      permissionHotSwitch: false,
      checkpointRewind: false,
      subagentTool: false,
    },
    // codex 路径现状无 SDK/CLI 二进制预检（仅 workspace 路径校验留在流程内），如实声明恒可用。
    checkAvailability: async () => ({ available: true }),
  }
}

export interface DefaultEngineRegistryOptions {
  persistentCodexRuntime?: boolean | undefined
  runtimeSupervisor?: CodexAppServerRuntimeSupervisor | undefined
}

export function createDefaultEngineRegistry(
  options: DefaultEngineRegistryOptions = {},
): EngineRegistry {
  const registry = new EngineRegistry()
  const persistentCodexRuntime = options.persistentCodexRuntime ?? isPersistentCodexRuntimeEnabled()
  const runtimeSupervisor = persistentCodexRuntime
    ? (options.runtimeSupervisor ?? new CodexAppServerRuntimeSupervisor())
    : undefined
  registry.register(claudeEngineDescriptor)
  registry.register(createCodexEngineDescriptor(runtimeSupervisor))
  if (runtimeSupervisor != null) {
    registry.registerDisposeHandler(() => runtimeSupervisor.dispose())
  }
  return registry
}
