/**
 * registerVoiceAssistantIpc — 语音助手 IPC 注册与装配（主进程）
 *
 * 组合根：构造 VoiceAssistantService 单例 + VoiceRouteBinding，
 * 注册 invoke 通道、渲染端反馈通道、音频 chunk 旁路路由，
 * 并导出 handleVoiceAssistantTurnEvent 供 ipc/index.ts 的 onEvent 链路调用。
 *
 * 具体服务依赖（SessionService / ProviderService / MediaRouter…）全部由
 * 调用方（ipc/index.ts）注入，本模块不直接 import ipc/index.ts，避免循环依赖。
 */

import { ipcMain, globalShortcut, type WebContents } from 'electron'
import type {
  AgentEvent,
  SessionReasoningEffort,
  VoiceAssistantSessionAgentInfo,
} from '@spark/protocol'
import {
  VOICE_ASSISTANT_KWS_SESSION_ID,
  VOICE_ASSISTANT_RENDERER_EVENT_CHANNEL,
  VOICE_ASSISTANT_ROUTE_KEY,
  VOICE_ASSISTANT_SESSION_FOCUS_CHANNEL,
  VOICE_ASSISTANT_SETTINGS_CATEGORY,
  VOICE_ASSISTANT_SETTINGS_KEY,
  isVoiceAssistantRendererEvent,
  normalizeVoiceAssistantRouteBinding,
  normalizeVoiceAssistantSettings,
} from '@spark/protocol'
import { VOICE_AUDIO_CHUNK_CHANNEL } from '@spark/protocol/voice'
import type { MediaProviderProfile, MediaRouterService } from '@spark/agent-runtime'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'
import { VoiceAssistantService } from '../services/voice-assistant/VoiceAssistantService.js'
import { VoiceRouteBinding } from '../services/voice-assistant/VoiceRouteBinding.js'
import type { CreateVoiceSessionOptions } from '../services/voice-assistant/VoiceRouteBinding.js'
import { setVoiceAssistantRecognitionHandler } from '../services/voice-assistant/recognitionBridge.js'
import { isWakeWordModelAvailable } from '../services/voice-assistant/WakeWordDetector.js'
import {
  removeTtsArtifactWithin,
  synthesizeSpeechText,
} from '../services/voice-assistant/ttsSynthesis.js'
import { createLogger } from '@spark/shared'

const log = createLogger('voice-assistant-ipc')

export interface RegisterVoiceAssistantIpcDeps {
  /** 设置存储（app_settings） */
  settingsStore: {
    get(category: string, key: string): unknown | null
    set(category: string, key: string, value: unknown): void
  }
  /** 绑定会话是否仍存在 */
  isSessionAlive(sessionId: string): Promise<boolean>
  /** 创建语音会话（含权限校验与 stream:session:created 广播） */
  createSession(options: CreateVoiceSessionOptions): Promise<{ sessionId: string }>
  /**
   * 同步语音绑定会话的推理档位（思考开关切换/启动对齐时调用）：
   * effort 非空 → 写入该档位；null → 恢复会话所属 agent 的档位
   */
  setSessionReasoningEffort(sessionId: string, effort: SessionReasoningEffort | null): Promise<void>
  /** 解析 Agent 适配器信息（agentId 为空取默认 Agent），供设置页按适配器出选项 */
  resolveAgentInfo(agentId: string | null): VoiceAssistantSessionAgentInfo | null
  /** 提交语音轮次 */
  submitTurn(params: {
    sessionId: string
    message: string
    userMessageDisplayContent: string
  }): Promise<{ turnId: string; started: boolean }>
  /** 打断会话当前活跃 turn */
  cancelTurn(sessionId: string): Promise<unknown>
  /** completed 先于 isFinal 时的历史回捞 */
  recoverFinal(sessionId: string, turnId: string): Promise<string | null>
  /** TTS 渠道解析（带 API key） */
  resolveMediaProviders(): Promise<MediaProviderProfile[]>
  mediaRouter: MediaRouterService
  /** 主窗口 webContents（采集/播放指令接收方；null 时指令丢弃并告警） */
  getMainWindowWebContents(): WebContents | null
  /** TTS 产物目录 */
  ttsDir: string
  /** 语音助手运行时目录（KWS runtime keywords 等） */
  runtimeDir: string
  /** 按需安装语音包（含可选 KWS 组件；status.downloading=true 表示另一入口安装在途） */
  installVoicePack(): Promise<{
    success: boolean
    message: string
    status?: { downloading?: boolean }
  }>
  /** M2 语音命令：最近会话列表 */
  listRecentSessions(limit: number): Promise<Array<{ id: string; title: string }>>
  /** M2 语音命令：工作区列表 */
  listWorkspaces(): Promise<Array<{ id: string; name: string }>>
  /** M2 语音命令：某工作区最近会话 */
  findLatestSessionIdInWorkspace(workspaceId: string): Promise<string | null>
  /** M4 语音命令：会话当前渠道的可选模型（与远程 /models 同源 buildRemoteProviderModelRows） */
  listSessionModels(sessionId: string): Promise<string[]>
  /** M4 语音命令：切换会话模型（转发 SessionService.updateSession） */
  updateSessionModel(sessionId: string, modelId: string): Promise<void>
  /** M3 语音审批：回应挂起的权限审批（转发 PermissionService.resolveApproval） */
  resolveApproval(requestId: string, decision: 'allow' | 'deny'): boolean
  /** 应用关闭清理登记 */
  registerCleanup(cleanup: () => void): void
  /** 状态变化通知（托盘刷新等；在状态广播后调用） */
  onStatusChanged?: () => void
}

let voiceAssistantService: VoiceAssistantService | null = null

export function getVoiceAssistantService(): VoiceAssistantService | null {
  return voiceAssistantService
}

/** 常驻聆听是否具备条件（服务已装配 + KWS 模型已安装），供托盘/设置展示 */
export function isVoiceAssistantStandbyCapable(): boolean {
  if (voiceAssistantService == null) return false
  return isWakeWordModelAvailable()
}

/** ipc/index.ts 的 onEvent 链路调用：旁路消费语音发起的轮次事件 */
export function handleVoiceAssistantTurnEvent(event: AgentEvent): void {
  voiceAssistantService?.handleTurnEvent(event)
}

export function registerVoiceAssistantIpc(deps: RegisterVoiceAssistantIpcDeps): void {
  if (voiceAssistantService != null) return // 热重载防重复装配

  const readRawSettings = (): unknown =>
    deps.settingsStore.get(VOICE_ASSISTANT_SETTINGS_CATEGORY, VOICE_ASSISTANT_SETTINGS_KEY)

  const route = new VoiceRouteBinding({
    readSettings: () => normalizeVoiceAssistantSettings(readRawSettings()),
    readBinding: () =>
      normalizeVoiceAssistantRouteBinding(
        deps.settingsStore.get(VOICE_ASSISTANT_SETTINGS_CATEGORY, VOICE_ASSISTANT_ROUTE_KEY),
      ),
    writeBinding: (binding) =>
      deps.settingsStore.set(VOICE_ASSISTANT_SETTINGS_CATEGORY, VOICE_ASSISTANT_ROUTE_KEY, binding),
    createSession: deps.createSession,
    isSessionAlive: deps.isSessionAlive,
    onSessionCreated: () => {
      /* stream:session:created 由 createSession 实现内广播 */
    },
  })

  const sendToMainWindow = (channel: string, payload: unknown): void => {
    const webContents = deps.getMainWindowWebContents()
    if (webContents == null || webContents.isDestroyed()) {
      return
    }
    webContents.send(channel, payload)
  }

  voiceAssistantService = new VoiceAssistantService({
    readSettings: readRawSettings,
    writeSettings: (value) =>
      deps.settingsStore.set(
        VOICE_ASSISTANT_SETTINGS_CATEGORY,
        VOICE_ASSISTANT_SETTINGS_KEY,
        value,
      ),
    shortcutRegistrar: {
      register: (accelerator, callback) => {
        try {
          return globalShortcut.register(accelerator, callback)
        } catch {
          return false
        }
      },
      unregister: (accelerator) => {
        try {
          globalShortcut.unregister(accelerator)
        } catch {
          // 注销失败不阻断
        }
      },
    },
    resolveMediaProviders: deps.resolveMediaProviders,
    mediaRouter: deps.mediaRouter,
    submitVoiceTurn: deps.submitTurn,
    cancelSessionTurn: deps.cancelTurn,
    recoverFinalFromHistory: deps.recoverFinal,
    setSessionReasoningEffort: deps.setSessionReasoningEffort,
    resolveAgentInfo: deps.resolveAgentInfo,
    route,
    sendCaptureCommand: (command) => sendToMainWindow('stream:voice-assistant:capture', command),
    sendPlayCommand: (command) => sendToMainWindow('stream:voice-assistant:play', command),
    broadcastState: (event) => pushStreamEvent('stream:voice-assistant:state', event),
    emitSessionFocus: (event) => pushStreamEvent(VOICE_ASSISTANT_SESSION_FOCUS_CHANNEL, event),
    broadcastStatus: (status) => {
      pushStreamEvent('stream:voice-assistant:status', status)
      try {
        deps.onStatusChanged?.()
      } catch {
        // 托盘刷新失败不影响状态机
      }
    },
    registerCleanup: deps.registerCleanup,
    ttsDir: deps.ttsDir,
    runtimeDir: deps.runtimeDir,
    installVoicePack: deps.installVoicePack,
    listRecentSessions: deps.listRecentSessions,
    listWorkspaces: deps.listWorkspaces,
    findLatestSessionIdInWorkspace: deps.findLatestSessionIdInWorkspace,
    listSessionModels: deps.listSessionModels,
    updateSessionModel: deps.updateSessionModel,
    resolveApproval: deps.resolveApproval,
  })

  // 识别事件桥接：VoiceRecognitionService 内部会话（ownerId=-1）事件 → 编排服务
  setVoiceAssistantRecognitionHandler((event) => {
    voiceAssistantService?.handleRecognitionEvent(event)
  })

  // ── invoke 通道 ───────────────────────────────────────────────────────────
  const service = () => {
    if (voiceAssistantService == null) throw new Error('语音助手服务未初始化')
    return voiceAssistantService
  }

  typedIpcHandle('voice-assistant:get-settings', async () => {
    // sessionAgent：语音会话当前适配器（绑定 Agent 优先），设置页据此展示
    // 对应的权限模式与推理档位选项（claude/codex/spark 三系互斥）
    return { settings: service().getSettings(), sessionAgent: service().describeSessionAgent() }
  })

  typedIpcHandle('voice-assistant:update-settings', async (request) => {
    return { settings: service().updateSettings(request.settings) }
  })

  typedIpcHandle('voice-assistant:get-status', async () => {
    return { status: service().getStatus() }
  })

  typedIpcHandle('voice-assistant:trigger', async () => {
    return service().wake()
  })

  typedIpcHandle('voice-assistant:interrupt', async () => {
    service().interrupt()
    return { ok: true, message: '已打断' }
  })

  typedIpcHandle('voice-assistant:reset-route', async () => {
    route.clearSession()
    return { ok: true, message: '已解绑语音会话，下次唤醒将新建会话' }
  })

  // 消息语音播报：无状态复用语音助手 TTS 设置（现读现归一，设置热更新即时生效）。
  // 渲染端逐句调用、边合边播；文件落在 ttsDir（safe-file 白名单内），
  // 播完由渲染端 cleanup 删除，应用启动另有 sweepTtsDir 清扫兜底。
  typedIpcHandle('voice-assistant:tts-synthesize', async (request) => {
    const text = request.text.trim()
    if (text.length === 0) throw new Error('播报文本为空')
    const settings = normalizeVoiceAssistantSettings(readRawSettings())
    const result = await synthesizeSpeechText(
      {
        settings,
        resolveMediaProviders: () => deps.resolveMediaProviders(),
        mediaRouter: deps.mediaRouter,
        outputDir: deps.ttsDir,
      },
      text,
    )
    return { filePath: result.filePath }
  })

  typedIpcHandle('voice-assistant:tts-cleanup', async (request) => {
    const ok = await removeTtsArtifactWithin(deps.ttsDir, request.filePath)
    if (!ok) log.warn(`[voice-assistant] message tts cleanup skipped: ${request.filePath}`)
    return { ok }
  })

  // ── 渲染端反馈（fire-and-forget） ────────────────────────────────────────
  ipcMain.removeAllListeners(VOICE_ASSISTANT_RENDERER_EVENT_CHANNEL)
  ipcMain.on(VOICE_ASSISTANT_RENDERER_EVENT_CHANNEL, (event, payload: unknown) => {
    // 纵深防御：仅主窗口渲染端可发采集/播放反馈（与 voice 通道按 sender 校验对齐）
    const mainWindow = deps.getMainWindowWebContents()
    if (mainWindow == null || event.sender !== mainWindow) return
    if (!isVoiceAssistantRendererEvent(payload)) return
    voiceAssistantService?.handleRendererEvent(payload)
  })

  // ── 音频 chunk 旁路路由（与 registerVoiceIpc 的监听共存） ─────────────────
  // voice-assistant:* 前缀的 chunk 走编排服务；普通 voice-* 会话由既有监听处理。
  ipcMain.on(VOICE_AUDIO_CHUNK_CHANNEL, (event, payload: unknown) => {
    if (
      event.senderFrame == null ||
      payload == null ||
      typeof payload !== 'object' ||
      typeof (payload as { sessionId?: unknown }).sessionId !== 'string'
    ) {
      return
    }
    const sessionId = (payload as { sessionId: string }).sessionId
    // 路由门必须同时放行对话采集会话与 KWS 常驻采集会话：
    // KWS 会话 id 为固定值，不在 captureSessionId 内（standby 态 captureSessionId 为 null）
    if (
      voiceAssistantService == null ||
      (!voiceAssistantService.ownsCaptureSession(sessionId) &&
        sessionId !== VOICE_ASSISTANT_KWS_SESSION_ID)
    ) {
      return
    }
    const samples = (payload as { samples?: unknown }).samples
    if (!(samples instanceof Int16Array)) return
    voiceAssistantService.handleAudioChunk(sessionId, samples)
  })

  // 应用就绪后初始化（武装快捷键 + 清扫 TTS 目录）
  void voiceAssistantService.initialize().catch((error) => {
    // initialize 失败只影响快捷键武装，不影响 IPC 可用性
  })
}
