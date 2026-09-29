/**
 * VoiceRouteBinding — 语音助手会话绑定与惰性建会话
 *
 * 语义仿远程连接的 RemoteRouteBinding：语音入口默认粘住同一个会话（多轮延续），
 * 绑定信息持久化在 app_settings category `voice-assistant` 的 `route` key。
 * 无有效绑定会话时惰性创建（title「语音会话」，权限默认取设置项 claude-auto）。
 *
 * 具体服务（SessionService/ProviderService 等）由构造依赖注入，
 * 避免与 ipc/index.ts 形成循环依赖。
 */

import { createLogger } from '@spark/shared'
import type {
  SessionPermissionMode,
  SessionReasoningEffort,
  VoiceAssistantRouteBinding,
  VoiceAssistantSettings,
} from '@spark/protocol'
import { normalizeVoiceAssistantRouteBinding } from '@spark/protocol'

const log = createLogger('voice-assistant')

/** 提供给会话创建的最小参数（与 SessionCreateRequest 对齐的子集） */
export interface CreateVoiceSessionOptions {
  workspaceId?: string
  providerProfileId?: string
  modelId?: string
  agentId?: string
  permissionMode?: SessionPermissionMode
  /** 语音会话推理档位：思考开关开启时以固定档建会话（快问快答），缺省走 agent 默认 */
  reasoningEffort?: SessionReasoningEffort
}

export interface VoiceRouteBindingDeps {
  readSettings(): VoiceAssistantSettings
  /** 读取持久化 route 绑定（已归一化） */
  readBinding(): VoiceAssistantRouteBinding
  /** 整体写回 route 绑定 */
  writeBinding(binding: VoiceAssistantRouteBinding): void
  /** 创建新会话，返回 sessionId */
  createSession(options: CreateVoiceSessionOptions): Promise<{ sessionId: string }>
  /** 绑定会话是否仍然存在（未删除/未归档） */
  isSessionAlive(sessionId: string): Promise<boolean>
  /** 会话创建后的广播钩子（推送 stream:session:created，让侧栏出现新会话） */
  onSessionCreated(sessionId: string): void
}

export class VoiceRouteBinding {
  constructor(private readonly deps: VoiceRouteBindingDeps) {}

  get current(): VoiceAssistantRouteBinding {
    return this.deps.readBinding()
  }

  /**
   * 确保语音会话可用：绑定存在且存活 → 直接复用；否则（首次/会话被删）
   * 惰性创建并改绑。创建参数优先级：绑定值 > 设置值 > 全局默认。
   */
  async ensureSession(): Promise<{ sessionId: string; created: boolean }> {
    const binding = this.deps.readBinding()
    if (binding.defaultSessionId != null) {
      if (await this.deps.isSessionAlive(binding.defaultSessionId)) {
        return { sessionId: binding.defaultSessionId, created: false }
      }
      log.info(
        `[voice-assistant] bound session ${binding.defaultSessionId} is gone, creating a new one`,
      )
    }
    const { sessionId } = await this.createNewSession()
    return { sessionId, created: true }
  }

  /**
   * 只读窥探：绑定存在且存活时返回其 sessionId，否则返回 null。
   * 供唤醒时的 UI 预跳使用——不创建、不改绑，失败静默（预跳是锦上添花）。
   */
  async peekAliveSessionId(): Promise<string | null> {
    const binding = this.deps.readBinding()
    if (binding.defaultSessionId == null) return null
    try {
      return (await this.deps.isSessionAlive(binding.defaultSessionId))
        ? binding.defaultSessionId
        : null
    } catch {
      return null
    }
  }

  /** 新建会话并改绑（语音命令「新开会话」/ 惰性创建共用） */
  async createNewSession(): Promise<{ sessionId: string }> {
    const binding = this.deps.readBinding()
    const settings = this.deps.readSettings()
    const { sessionId } = await this.deps.createSession({
      ...(binding.defaultWorkspaceId != null ? { workspaceId: binding.defaultWorkspaceId } : {}),
      ...(binding.defaultProviderProfileId != null
        ? { providerProfileId: binding.defaultProviderProfileId }
        : {}),
      ...(binding.defaultModelId != null ? { modelId: binding.defaultModelId } : {}),
      ...(binding.defaultAgentId != null ? { agentId: binding.defaultAgentId } : {}),
      permissionMode: binding.defaultPermissionMode ?? settings.sessionPermissionMode,
      // 语音会话思考：开启时以固定推理档创建（turn 级参数未接线 submitTurn 链路，
      // 会话级是已验证的生效通路），追求快问快答；关闭时缺省走 agent 档位
      ...(settings.sessionThinkingEnabled
        ? { reasoningEffort: settings.sessionThinkingEffort }
        : {}),
    })
    this.updateBinding({ defaultSessionId: sessionId })
    this.deps.onSessionCreated(sessionId)
    log.info(`[voice-assistant] voice session created and bound: ${sessionId}`)
    return { sessionId }
  }

  updateBinding(
    patch: {
      [K in keyof VoiceAssistantRouteBinding]?: VoiceAssistantRouteBinding[K] | undefined
    },
  ): void {
    // exactOptionalPropertyTypes：patch 中显式传 undefined 的键按「清除」处理
    const merged: Record<string, unknown> = { ...this.deps.readBinding() }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete merged[key]
      else merged[key] = value
    }
    this.deps.writeBinding(normalizeVoiceAssistantRouteBinding(merged))
  }

  /** 解绑当前会话（不删除会话本身） */
  clearSession(): void {
    const binding = this.deps.readBinding()
    const { defaultSessionId: _removed, ...rest } = binding
    this.deps.writeBinding(normalizeVoiceAssistantRouteBinding(rest))
  }
}
