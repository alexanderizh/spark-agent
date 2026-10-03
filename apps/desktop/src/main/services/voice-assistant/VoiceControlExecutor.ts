/**
 * VoiceControlExecutor — 语音会话应用控制执行器（spark_voice 工具面的 desktop 实现）。
 *
 * 链路：agent 调 mcp__spark_voice__* → stdio 子进程 → PlatformBridge voice.* RPC →
 * VoiceControlAgentTools → 本执行器。与语音正则命令执行器（VoiceAssistantService 的
 * handleSwitchXxxCommand 私有方法）语义同源：同一批数据依赖（VoiceAssistantDeps 的
 * 子集）、同一种「改绑 route + emitSessionFocus」的切换语义。
 *
 * 与正则通道的差异：本执行器**不做 TTS 播报**——工具结果 message 返回给 agent，
 * 由 agent 回复自动走 TTS；也不进入挂起选择态——多轮澄清由 agent 的对话能力承担。
 *
 * 安全边界：每个方法先复核 sessionId 与语音路由绑定一致（纵深防御，防其他本地
 * 进程直击 bridge 端口）；v1 仅 list/switch/new 导航级操作，零破坏性。
 */
import { createLogger } from '@spark/shared'
import type {
  VoiceControlExecutor as IVoiceControlExecutor,
  VoiceControlResult,
  VoiceControlTarget,
} from '@spark/agent-runtime'
import { matchCandidateIndexByName } from './voiceCommands.js'
import type { VoiceRouteBinding } from './VoiceRouteBinding.js'
import type { VoiceSessionModelsResult } from './VoiceAssistantService.js'

const log = createLogger('voice-assistant')

/** 本执行器的数据依赖（VoiceAssistantDeps 的子集，由 ipc 装配处透传同一实现） */
export interface VoiceControlExecutorDeps {
  route: VoiceRouteBinding
  listRecentSessions(limit: number): Promise<Array<{ id: string; title: string }>>
  listWorkspaces(): Promise<Array<{ id: string; name: string }>>
  findLatestSessionIdInWorkspace(workspaceId: string): Promise<string | null>
  listSessionModels(sessionId: string): Promise<VoiceSessionModelsResult>
  updateSessionModel(sessionId: string, modelId: string): Promise<void>
  /** UI 聚焦广播（VOICE_ASSISTANT_SESSION_FOCUS_CHANNEL，渲染端幂等） */
  emitSessionFocus(event: {
    sessionId: string
    cause: 'command-new' | 'command-switch' | 'command-workspace'
  }): void
}

function ok(message: string, extra?: Partial<VoiceControlResult>): VoiceControlResult {
  return { ok: true, message, ...extra }
}

function fail(
  message: string,
  extra?: Partial<VoiceControlResult> & { candidates?: VoiceControlResult['candidates'] },
): VoiceControlResult {
  return { ok: false, message, ...extra }
}

/** 名称宽松匹配（双向包含忽略大小写，voiceCommands 同款语义） */
function matchByName<T extends { id: string; title?: string; name?: string }>(
  items: Array<T>,
  name: string,
): T | undefined {
  const index = matchCandidateIndexByName(
    items.map((item) => item.title ?? item.name ?? item.id),
    name,
  )
  return index != null ? items[index] : undefined
}

/**
 * 模型名称宽松匹配：先按原文本双向包含；未命中再按剥离空白与符号的宽松匹配
 * （ASR/agent 转述模型 ID 常丢连字符与点号，如 claude-sonnet-4.5 →「claude sonnet 4 5」）。
 * 与 VoiceAssistantService.matchModelCandidate 同语义。
 */
function matchModelId(models: string[], name: string): string | undefined {
  const direct = matchCandidateIndexByName(models, name)
  if (direct != null) return models[direct]
  const strip = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const needle = strip(name)
  if (needle.length === 0) return undefined
  const index = models.findIndex((model) => {
    const target = strip(model)
    return target.includes(needle) || needle.includes(target)
  })
  return index >= 0 ? models[index] : undefined
}

export class VoiceControlExecutor implements IVoiceControlExecutor {
  constructor(private readonly deps: VoiceControlExecutorDeps) {}

  /** 纵深防御：仅语音路由绑定的会话可执行（bridge 端口仅监听 127.0.0.1，仍复核绑定） */
  private isVoiceSession(sessionId: string): boolean {
    return this.deps.route.current.defaultSessionId === sessionId
  }

  async listProjects(sessionId: string): Promise<VoiceControlResult> {
    if (!this.isVoiceSession(sessionId)) return fail('当前会话不是语音绑定会话。')
    const workspaces = await this.deps.listWorkspaces()
    const currentWorkspaceId = this.deps.route.current.defaultWorkspaceId
    return ok(`共 ${workspaces.length} 个项目。`, {
      items: workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        isCurrent: workspace.id === currentWorkspaceId,
      })),
    })
  }

  async switchProject(sessionId: string, target: VoiceControlTarget): Promise<VoiceControlResult> {
    if (!this.isVoiceSession(sessionId)) return fail('当前会话不是语音绑定会话。')
    const workspaces = await this.deps.listWorkspaces()
    if (workspaces.length === 0) return fail('没有可切换的项目。')
    const matched =
      target.id != null
        ? workspaces.find((workspace) => workspace.id === target.id)
        : matchByName(workspaces, target.name ?? '')
    if (matched == null) {
      return fail(`未找到匹配的项目。`, {
        candidates: workspaces.slice(0, 5).map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
        })),
      })
    }
    // 幂等：目标即当前项目时短路
    if (this.deps.route.current.defaultWorkspaceId === matched.id) {
      return ok(`已经在项目 ${matched.name} 上了。`)
    }
    const existingSessionId = await this.deps.findLatestSessionIdInWorkspace(matched.id)
    if (existingSessionId != null) {
      this.deps.route.updateBinding({
        defaultWorkspaceId: matched.id,
        defaultSessionId: existingSessionId,
      })
      this.deps.emitSessionFocus({ sessionId: existingSessionId, cause: 'command-workspace' })
      log.info(
        `[voice-assistant] voice-control switched to workspace ${matched.id} (existing session)`,
      )
      return ok(`已切换到项目 ${matched.name}，继续其中最近的会话。`)
    }
    this.deps.route.updateBinding({ defaultWorkspaceId: matched.id, defaultSessionId: undefined })
    const { sessionId: createdSessionId } = await this.deps.route.createNewSession()
    this.deps.emitSessionFocus({ sessionId: createdSessionId, cause: 'command-workspace' })
    log.info(`[voice-assistant] voice-control switched to workspace ${matched.id} (new session)`)
    return ok(`已切换到项目 ${matched.name}，并新建了会话。`)
  }

  async listSessions(sessionId: string, limit: number): Promise<VoiceControlResult> {
    if (!this.isVoiceSession(sessionId)) return fail('当前会话不是语音绑定会话。')
    const sessions = await this.deps.listRecentSessions(limit)
    const currentSessionId = this.deps.route.current.defaultSessionId
    return ok(`最近 ${sessions.length} 个会话。`, {
      items: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        isCurrent: session.id === currentSessionId,
      })),
    })
  }

  async switchSession(sessionId: string, target: VoiceControlTarget): Promise<VoiceControlResult> {
    if (!this.isVoiceSession(sessionId)) return fail('当前会话不是语音绑定会话。')
    const sessions = await this.deps.listRecentSessions(20)
    if (sessions.length === 0) return fail('最近没有其他会话。')
    const matched =
      target.id != null
        ? sessions.find((session) => session.id === target.id)
        : matchByName(sessions, target.name ?? '')
    if (matched == null) {
      return fail('未找到匹配的会话。', {
        candidates: sessions.slice(0, 5).map((session) => ({
          id: session.id,
          title: session.title,
        })),
      })
    }
    if (matched.id === sessionId) {
      const label = matched.title.length > 20 ? `${matched.title.slice(0, 20)}…` : matched.title
      return ok(`当前就在会话「${label}」上。`)
    }
    this.deps.route.updateBinding({ defaultSessionId: matched.id })
    this.deps.emitSessionFocus({ sessionId: matched.id, cause: 'command-switch' })
    const label = matched.title.length > 20 ? `${matched.title.slice(0, 20)}…` : matched.title
    log.info(`[voice-assistant] voice-control switched to session ${matched.id}`)
    return ok(`已切换到会话：${label}。`)
  }

  async newSession(sessionId: string): Promise<VoiceControlResult> {
    if (!this.isVoiceSession(sessionId)) return fail('当前会话不是语音绑定会话。')
    const { sessionId: createdSessionId } = await this.deps.route.createNewSession()
    this.deps.emitSessionFocus({ sessionId: createdSessionId, cause: 'command-new' })
    log.info(`[voice-assistant] voice-control created session ${createdSessionId}`)
    return ok('已新建会话，我们重新开始。')
  }

  async listModels(sessionId: string): Promise<VoiceControlResult> {
    if (!this.isVoiceSession(sessionId)) return fail('当前会话不是语音绑定会话。')
    const { models, unsupportedReason } = await this.deps.listSessionModels(sessionId)
    if (unsupportedReason != null && unsupportedReason.length > 0) {
      return fail(unsupportedReason)
    }
    if (models.length === 0) return fail('当前渠道没有配置可选模型。')
    return ok(`共 ${models.length} 个可用模型。`, {
      items: models.map((modelId) => ({ id: modelId, name: modelId })),
    })
  }

  async switchModel(sessionId: string, target: VoiceControlTarget): Promise<VoiceControlResult> {
    if (!this.isVoiceSession(sessionId)) return fail('当前会话不是语音绑定会话。')
    const { models, unsupportedReason } = await this.deps.listSessionModels(sessionId)
    if (unsupportedReason != null && unsupportedReason.length > 0) {
      return fail(unsupportedReason)
    }
    if (models.length === 0) return fail('当前渠道没有配置可选模型。')
    const modelId =
      target.id != null && models.includes(target.id)
        ? target.id
        : matchModelId(models, target.name ?? target.id ?? '')
    if (modelId == null) {
      return fail('未找到匹配的模型。', {
        candidates: models.slice(0, 5).map((model) => ({ id: model, name: model })),
      })
    }
    await this.deps.updateSessionModel(sessionId, modelId)
    log.info(`[voice-assistant] voice-control switched model to ${modelId}`)
    return ok(`已切换到模型 ${modelId}，下一轮对话生效。`)
  }
}
