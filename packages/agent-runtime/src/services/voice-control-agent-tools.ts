/**
 * 语音会话应用控制桥（spark_voice）—— agent 工具调用回到主进程的执行面。
 *
 * 链路：stdio voice-control-mcp-server.mjs 子进程 → PlatformBridgeService HTTP RPC
 * （voice.*）→ 本类 → desktop 侧注入的 VoiceControlExecutor（与语音正则命令执行器
 * 收敛到同一批实现）。executor 经 SessionService setter 由 desktop 装配注入，
 * 未装配（语音服务不可用）时所有工具返回友好错误而非崩溃。
 *
 * 安全边界：sessionId 一律来自 env 注入（SPARK_VOICE_SID），**不信任模型传参**；
 * executor 侧对 sessionId 与语音路由绑定做二次复核（纵深防御）。
 */

/** 统一执行结果：items 用于 list_*，candidates 用于 switch_* 未命中时提示 agent 澄清 */
export interface VoiceControlResult {
  ok: boolean
  message: string
  items?: Array<{ id: string; name?: string; title?: string; isCurrent?: boolean }>
  candidates?: Array<{ id: string; name?: string; title?: string }>
}

/** switch_* 的目标定位：name 宽松匹配 / id 精确标识，二选一 */
export interface VoiceControlTarget {
  name?: string
  id?: string
}

/** desktop 侧执行器契约（apps/desktop VoiceControlExecutor 实现） */
export interface VoiceControlExecutor {
  listProjects(sessionId: string): Promise<VoiceControlResult>
  switchProject(sessionId: string, target: VoiceControlTarget): Promise<VoiceControlResult>
  listSessions(sessionId: string, limit: number): Promise<VoiceControlResult>
  switchSession(sessionId: string, target: VoiceControlTarget): Promise<VoiceControlResult>
  newSession(sessionId: string): Promise<VoiceControlResult>
  listModels(sessionId: string): Promise<VoiceControlResult>
  switchModel(sessionId: string, target: VoiceControlTarget): Promise<VoiceControlResult>
}

function requireExecutor(executor: VoiceControlExecutor | null): VoiceControlExecutor {
  if (executor == null) {
    throw new Error('语音助手未装配，应用控制工具暂不可用。请在应用内启用语音助手后重试。')
  }
  return executor
}

function requireSessionId(sessionId: string): string {
  const trimmed = sessionId.trim()
  if (trimmed.length === 0) throw new Error('Missing parameter: sessionId')
  return trimmed
}

function normalizeTarget(target: VoiceControlTarget): VoiceControlTarget {
  const name = typeof target.name === 'string' ? target.name.trim() : ''
  const id = typeof target.id === 'string' ? target.id.trim() : ''
  if (name.length === 0 && id.length === 0) {
    throw new Error('必须提供 name（宽松名称匹配）或 id（精确标识）其中之一')
  }
  return { ...(name.length > 0 ? { name } : {}), ...(id.length > 0 ? { id } : {}) }
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 20
  return Math.min(Math.floor(limit), 50)
}

/** voice.* 桥执行面（PlatformBridgeDeps.voiceControlTools 的实现） */
export class VoiceControlAgentTools {
  constructor(private readonly getExecutor: () => VoiceControlExecutor | null) {}

  async listProjects(params: { sessionId: string }): Promise<VoiceControlResult> {
    return requireExecutor(this.getExecutor()).listProjects(requireSessionId(params.sessionId))
  }

  async switchProject(params: {
    sessionId: string
    name?: string
    id?: string
  }): Promise<VoiceControlResult> {
    return requireExecutor(this.getExecutor()).switchProject(
      requireSessionId(params.sessionId),
      normalizeTarget(params),
    )
  }

  async listSessions(params: { sessionId: string; limit?: number }): Promise<VoiceControlResult> {
    return requireExecutor(this.getExecutor()).listSessions(
      requireSessionId(params.sessionId),
      normalizeLimit(params.limit ?? 20),
    )
  }

  async switchSession(params: {
    sessionId: string
    name?: string
    id?: string
  }): Promise<VoiceControlResult> {
    return requireExecutor(this.getExecutor()).switchSession(
      requireSessionId(params.sessionId),
      normalizeTarget(params),
    )
  }

  async newSession(params: { sessionId: string }): Promise<VoiceControlResult> {
    return requireExecutor(this.getExecutor()).newSession(requireSessionId(params.sessionId))
  }

  async listModels(params: { sessionId: string }): Promise<VoiceControlResult> {
    return requireExecutor(this.getExecutor()).listModels(requireSessionId(params.sessionId))
  }

  async switchModel(params: {
    sessionId: string
    name?: string
    id?: string
  }): Promise<VoiceControlResult> {
    return requireExecutor(this.getExecutor()).switchModel(
      requireSessionId(params.sessionId),
      normalizeTarget(params),
    )
  }
}
