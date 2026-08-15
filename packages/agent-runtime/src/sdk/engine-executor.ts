import type { AgentEvent } from '@spark/protocol'
import type { SDKExecutorConfig } from './types.js'

/**
 * 引擎种类（P1 引擎分派的统一口径）。
 *
 * 值域与 `TurnPromptSnapshotEvent.adapterKind` 的持久化现值域对齐：
 * - `'claude-sdk'` 为历史持久化值，涵盖 `'claude'` / `'claude-sdk'` 两种 adapter；
 * - `'codex'` 涵盖 codex 三种载具（cli / sdk / openai-chat），载具是引擎内部观测口径，不上升为本层概念。
 *
 * 注意：改名属 schema 迁移，不在 P1 范围（resume 侧 `getLatestMatchingTurnPromptSnapshot`
 * 对 adapterKind 做精确匹配）。
 */
export type EngineKind = 'claude-sdk' | 'codex'

/**
 * 引擎执行器统一契约。每个 turn 新建实例、构造无参、依赖经 config 传入。
 * 契约要点（从四执行器现有鸭子契约提炼，语义显式化）：
 * 1. 终态只经事件流表达：executeTurn 的 resolve/reject 不携带业务终态；
 *    无论成功/失败/取消，必须发出至少一条 terminal AgentEvent（cancel 语义：
 *    cancel() 返回后事件流上最终必须出现 cancelled 终态）。
 * 2. 实例身份即闸门：调用方以实例引用相等校验事件所有权
 *    （shouldAcceptSessionExecutorEvent），本契约的实现不得自我包装/代理。
 * 3. turnId 语义：第 2 参为 executor 归属 id；成员执行路径与 host turnId 不同。
 */
export interface EngineExecutor {
  readonly engine: EngineKind
  onEvent(listener: (event: AgentEvent) => void): void
  offEvent(listener: (event: AgentEvent) => void): void
  cancel(): void
  executeTurn(
    sessionId: string,
    turnId: string,
    userMessage: string,
    config: SDKExecutorConfig,
  ): Promise<void>
}

/** 能力接口：权限热切换（当前仅 Claude 执行器具备）。 */
export interface PermissionModeAwareExecutor extends EngineExecutor {
  setPermissionMode(mode: SDKExecutorConfig['permissionMode']): Promise<void>
}

/** rewindFiles 的参数形状（迁自 ClaudeSDKExecutor 内联签名）。 */
export interface RewindFilesParams {
  apiKey: string
  model: string
  workspaceRootPath: string
  sdkSessionId: string
  apiEndpoint?: string
  userMessageId: string
  dryRun?: boolean
}

/** rewindFiles 的结果形状（迁自 ClaudeSDKExecutor 内联签名）。 */
export interface RewindFilesResult {
  canRewind: boolean
  error?: string
  filesChanged?: string[]
  insertions?: number
  deletions?: number
}

/** 能力接口：checkpoint 回退（当前仅 Claude 执行器具备）。 */
export interface RewindCapableExecutor extends EngineExecutor {
  rewindFiles(params: RewindFilesParams): Promise<RewindFilesResult>
}

export const isPermissionModeAware = (e: EngineExecutor): e is PermissionModeAwareExecutor =>
  typeof (e as Partial<PermissionModeAwareExecutor>).setPermissionMode === 'function'

export const isRewindCapable = (e: EngineExecutor): e is RewindCapableExecutor =>
  typeof (e as Partial<RewindCapableExecutor>).rewindFiles === 'function'

/**
 * session 层对活跃执行体的最小结构视图（迁自 session.service）。
 * activeLoops 以实例引用相等做事件所有权闸门，此处仅声明调用方实际依赖的面；
 * 任意 EngineExecutor 实现天然满足本类型。
 */
export type ActiveExecution = Pick<EngineExecutor, 'cancel'> & {
  /** Hot-swap the permission mode for the currently executing turn. */
  setPermissionMode?(mode: SDKExecutorConfig['permissionMode']): void | Promise<void>
}
