/**
 * VoiceAssistantService — 语音助手常驻编排服务（主进程单例）
 *
 * 状态机：Idle →(快捷键 M1/KWS M2)→ Listening →(VAD final)→ Thinking
 *        →(首句 delta)→ Speaking →(队列播完)→ Idle
 *
 * 职责：
 * - 全局快捷键注册与再武装（设置变更时热更新）
 * - 对话采集生命周期（指令渲染端起停麦克风 + 内部 ASR 会话）
 * - 转写文本：语音命令匹配 → submitTurn(turnSource:'voice')
 * - 轮次事件旁路消费（ipc/index.ts onEvent 链路调入 handleTurnEvent）
 * - 逐句 TTS 流水线驱动与打断
 *
 * 渲染进程只做「麦克风搬运工 + 扬声器执行器」；所有编排在主进程。
 * 约束：采集链路由 AudioWorklet 音频回调驱动，本服务不得在采集路径引入
 * timer 驱动逻辑（Chromium 后台节流只影响 timer，不影响音频回调）。
 */

import { mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger, hasMeaningfulVoiceText } from '@spark/shared'
import type {
  AgentEvent,
  SessionReasoningEffort,
  VoiceAssistantCaptureCommand,
  VoiceAssistantPlayCommand,
  VoiceAssistantRendererEvent,
  VoiceAssistantSessionAgentInfo,
  VoiceAssistantSessionFocusEvent,
  VoiceAssistantSettings,
  VoiceAssistantState,
  VoiceAssistantStateEvent,
  VoiceAssistantStatus,
} from '@spark/protocol'
import {
  VOICE_ASSISTANT_DIALOGUE_SESSION_PREFIX,
  VOICE_ASSISTANT_ENDPOINT_PROFILES,
  VOICE_ASSISTANT_INTERNAL_OWNER_ID,
  VOICE_ASSISTANT_KWS_SESSION_ID,
  normalizeVoiceAssistantSettings,
} from '@spark/protocol'
import type { MediaProviderProfile, MediaRouterService } from '@spark/agent-runtime'
import {
  feedVoiceAudio,
  startVoiceSession,
  stopVoiceSession,
  type VoiceSessionHandle,
} from '../VoiceRecognitionService.js'
import { VoiceTtsPipeline } from './VoiceTtsPipeline.js'
import { WakeWordDetector, isWakeWordModelAvailable } from './WakeWordDetector.js'
import { resolveVoiceRefinePaths, resolveVoiceVadPaths } from '../VoiceIntegrityService.js'
import {
  buildApprovalSpeech,
  buildCandidateSelectionSpeech,
  buildSessionSelectionSpeech,
  matchCandidateIndexByName,
  parseApprovalDecision,
  parseVoiceCommand,
} from './voiceCommands.js'
import { buildVoiceUserMessage } from './voiceUserMessage.js'
import type { VoiceRouteBinding } from './VoiceRouteBinding.js'
import { synthesizeSpeechText } from './ttsSynthesis.js'
import { VoiceBargeInGate } from './VoiceBargeInGate.js'
import { describeEchoMatch, isLikelyTtsEcho } from './VoiceEchoGuard.js'
import { VoiceInputQueue } from './VoiceInputQueue.js'

const log = createLogger('voice-assistant')

/**
 * listening 空转兜底超时：检测不到人声活动（门控 speech-activity）时保持收音的
 * 最长等待。期间用户可随时手动取消（HUD 停止按钮 / 再按快捷键）；检测到人声
 * 活动即重置计时，说话后的收口由说完确认窗口负责。
 */
const EMPTY_SPEECH_TIMEOUT_MS = 20_000
/**
 * listening 硬上限：持续说话（防抖窗口不断被撤销）或持续噪音（空转计时不断被
 * speech-activity 重置）时的强制收口兜底，防会话无限滞留。
 */
const LISTENING_HARD_LIMIT_MS = 120_000
/** M3 连续对话：播报到续听的间隔（等 TTS 尾音消散，防录进自己的播报） */
const CONTINUOUS_LISTEN_DELAY_MS = 800
/** 插话输入队列容量（语音插话是短时行为，深队列无意义；超限挤最旧） */
const BARGE_IN_QUEUE_CAPACITY = 3
/** 回声守卫近期命中后的门控严格档保持时长（防间歇性回声反复穿透） */
const ECHO_GUARD_STRICT_WINDOW_MS = 60_000
/** 外部入口安装在途时的等待轮询间隔 */
const KWS_INSTALL_WAIT_INTERVAL_MS = 5_000
/** 等待轮询上限（120 × 5s = 10 分钟，覆盖全量语音包慢速下载） */
const KWS_INSTALL_WAIT_MAX_ATTEMPTS = 120

export interface VoiceAssistantSubmitResult {
  turnId: string
  started: boolean
}

/**
 * 会话可选模型查询结果：models 为候选清单（modelIds 为空时 fallback [defaultModel]）；
 * unsupportedReason 非空表示渠道不支持切换（内置 CLI / auto-router），models 恒为空。
 */
export interface VoiceSessionModelsResult {
  models: string[]
  unsupportedReason?: string
}

export interface VoiceAssistantDeps {
  /** 设置原始值读取（app_settings，脏数据由 normalize 收敛） */
  readSettings(): unknown
  writeSettings(value: VoiceAssistantSettings): void
  /** 全局快捷键注册器（globalShortcut 适配） */
  shortcutRegistrar: {
    register(accelerator: string, callback: () => void): boolean
    unregister(accelerator: string): void
  }
  /** TTS 渠道解析（带 API key 的 provider 列表） */
  resolveMediaProviders(): Promise<MediaProviderProfile[]>
  /** 媒体路由（TTS 合成） */
  mediaRouter: MediaRouterService
  /** 提交语音轮次（返回 turnId） */
  submitVoiceTurn(params: {
    sessionId: string
    message: string
    userMessageDisplayContent: string
  }): Promise<VoiceAssistantSubmitResult>
  /** 打断会话当前活跃 turn */
  cancelSessionTurn(sessionId: string): Promise<unknown>
  /** completed 先于 isFinal 时的历史回捞（照抄远程链路 300ms 兜底模式） */
  recoverFinalFromHistory(sessionId: string, turnId: string): Promise<string | null>
  /** 会话绑定（惰性建会话/改绑） */
  route: VoiceRouteBinding
  /** 三条 stream 通道的推送（主窗口 webContents） */
  sendCaptureCommand(command: VoiceAssistantCaptureCommand): void
  sendPlayCommand(command: VoiceAssistantPlayCommand): void
  broadcastState(event: VoiceAssistantStateEvent): void
  broadcastStatus(status: VoiceAssistantStatus): void
  /** 会话聚焦推送：语音活动发生时 UI 跳转到语音绑定会话 */
  emitSessionFocus(event: VoiceAssistantSessionFocusEvent): void
  /** 应用关闭清理登记 */
  registerCleanup(cleanup: () => void): void
  /** TTS 产物根目录（userData/voice-assistant/tts，safe-file 白名单内） */
  ttsDir: string
  /** 语音助手运行时目录（userData/voice-assistant，存放 KWS runtime keywords） */
  runtimeDir: string
  /** 按需安装语音包（含可选 KWS 组件；开启常驻聆听时模型缺失自动补装）。
   *  status.downloading=true 表示另一入口已有安装在途（互斥快速返回），调用方应等待而非报错。 */
  installVoicePack(): Promise<{
    success: boolean
    message: string
    status?: { downloading?: boolean }
  }>
  /** M2 语音命令：最近会话列表（标题用于播报与名称匹配） */
  listRecentSessions(limit: number): Promise<Array<{ id: string; title: string }>>
  /** M2 语音命令：工作区列表 */
  listWorkspaces(): Promise<Array<{ id: string; name: string }>>
  /** M2 语音命令：某工作区下最近的会话（无则新建） */
  findLatestSessionIdInWorkspace(workspaceId: string): Promise<string | null>
  /**
   * M4 语音命令：会话当前渠道的可选模型（与远程 /models 同源 buildRemoteProviderModelRows；
   * modelIds 为空 fallback [defaultModel]，对齐渲染端 getProviderModelOptions）。
   * unsupportedReason 非空 = 渠道不支持切换（内置 CLI / auto-router，对齐 UI 禁改语义）。
   */
  listSessionModels(sessionId: string): Promise<VoiceSessionModelsResult>
  /** M4 语音命令：切换会话模型（转发 SessionService.updateSession） */
  updateSessionModel(sessionId: string, modelId: string): Promise<void>
  /** M3 语音审批：回应挂起的权限审批（转发 PermissionService.resolveApproval） */
  resolveApproval(requestId: string, decision: 'allow' | 'deny'): boolean
  /** 同步语音绑定会话推理档位（固定档 → 写入该档位；null → 恢复 agent 档位） */
  setSessionReasoningEffort(sessionId: string, effort: SessionReasoningEffort | null): Promise<void>
  /** 解析 Agent 适配器信息（agentId 为空时取默认 Agent），供设置页按适配器出选项 */
  resolveAgentInfo(agentId: string | null): VoiceAssistantSessionAgentInfo | null
}

export class VoiceAssistantService {
  private settings: VoiceAssistantSettings
  private state: VoiceAssistantState = 'idle'
  /** 当前对话采集会话（voice-assistant:dialogue:*，渲染端 chunk 携带） */
  private captureSessionId: string | null = null
  /** 当前活跃 ASR 会话（VoiceRecognitionService 生成） */
  private asrSessionId: string | null = null
  /** 停止中的 ASR 会话（stopVoiceSession flush 期间仍会吐 final/session-stopped） */
  private closingAsrSessionId: string | null = null
  private captureCounter = 0
  private listeningTimer: ReturnType<typeof setTimeout> | null = null
  /** listening 硬上限定时器（与空转计时独立，不受人声活动重置影响） */
  private listeningHardTimer: ReturnType<typeof setTimeout> | null = null
  private partialText = ''
  private collectedFinals: string[] = []
  /** 已命中 VAD final / 超时，正在等 ASR 收尾 */
  private handoffPending = false
  /** 说完确认窗口定时器：VAD final 后再静默 utteranceConfirmMs 才真正收口提交 */
  private handoffConfirmTimer: ReturnType<typeof setTimeout> | null = null
  private activeTurn: { turnId: string; sessionId: string } | null = null
  /** 生成是否已完成（agent_status completed 已到；与播报收尾独立——执行器释放信号） */
  private generationCompleted = false
  /** 非轮次播报（命令确认/错误提示）进行中 */
  private announcing = false
  private armedAccelerator: string | null = null
  private disposed = false
  private readonly pipeline: VoiceTtsPipeline
  private readonly route: VoiceRouteBinding
  // ── M2 常驻聆听（KWS） ──
  private kwsDetector: WakeWordDetector | null = null
  /** 渲染端 KWS 常驻采集是否在线（在线时对话复用该采集流，不重起 getUserMedia） */
  private kwsCaptureActive = false
  /** KWS 采集断流自愈重试定时器 */
  private kwsRestartTimer: ReturnType<typeof setTimeout> | null = null
  /** KWS 采集重试次数（成功后清零） */
  private kwsRestartAttempts = 0
  /** 模型缺失自动安装是否进行中（防重入） */
  private kwsInstallInFlight = false
  /** vad 人声检测模型后台补装进行中（防重入） */
  private vadInstallInFlight = false
  private refineInstallInFlight = false
  /** 外部入口安装在途的等待轮询定时器（等其完成后再启动 standby） */
  private kwsInstallWaitTimer: ReturnType<typeof setTimeout> | null = null
  /** 安装等待轮询次数（就绪/取消时清零，超上限提示手动处理） */
  private kwsInstallWaitAttempts = 0
  /** M2-4：挂起的会话选择态（念出列表后等待用户说序号/名称） */
  private awaitingSessionCandidates: Array<{ id: string; title: string }> | null = null
  /** M4：挂起的模型选择态（念出候选后等待用户说序号/名称，与 session/project 互斥） */
  private awaitingModelCandidates: string[] | null = null
  /** M4：挂起的项目选择态（念出工作区候选后等待用户说序号/名称） */
  private awaitingProjectCandidates: Array<{ id: string; name: string }> | null = null
  /** M3 连续对话续听定时器 */
  private continuousListenTimer: ReturnType<typeof setTimeout> | null = null
  /** M3 语音审批：挂起的审批请求（念问题 → 听同意/拒绝 → resolveApproval） */
  private pendingApproval: { requestId: string; sessionId: string; retries: number } | null = null
  /** M3 云转写：聆听期间缓存的原始 PCM（cloud 引擎整段上传转写） */
  private cloudPcmChunks: Int16Array[] = []
  private cloudTotalSamples = 0
  /** 轮次令牌：interrupt/dispose 时自增，提交链 await 恢复点校验防「打断复活」 */
  private turnEpoch = 0
  /** 对话进行中请求开启常驻聆听 → 延迟到对话收尾再起（避免抢走对话麦克风） */
  private standbyPending = false
  // ── 全双工（D1 对话窗口 / D2 回声治理 / D3 输入队列） ──
  /** 对话窗口是否在线（窗口内采集+ASR 常开，thinking/speaking 期间也在听） */
  private duplexWindowActive = false
  /** 队列派发在途（dequeue 到 submitTranscript 落定之间，防二次触发重复提交） */
  private queueDispatchInFlight = false
  /** 渲染端 AEC 实际生效值（capture-started 探测；false 时门控/守卫升严格档） */
  private aecEffective: boolean | null = null
  /** 回声守卫最近命中时刻（严格档保持窗口） */
  private echoGuardHitAt: number | null = null
  /**
   * graceful 接管桥接中（派发 → 新代首句开播的间隙）：HUD「本句播完后衔接」
   * 只应覆盖这个间隙。queue-dispatch 是同态广播，reason 会一直挂在渲染端，
   * 新代首句 play 指令发出时同态补一次广播把 reason 冲掉，否则衔接态贯穿
   * 整个新回答播报、还压住播报期新插话的队列框展示。
   */
  private gracefulTakeoverBridge = false
  private readonly bargeInGate = new VoiceBargeInGate()
  private readonly inputQueue: VoiceInputQueue

  /** 全双工是否可用（设置开关 + 仅本地识别引擎；cloud 引擎整段上传与常开窗口不匹配） */
  private get duplexEnabled(): boolean {
    return this.settings.fullDuplex && this.settings.recognitionEngine === 'local'
  }

  /** 当前是否处于「插话可听」态（thinking/speaking 且对话窗口在线） */
  private isDuplexBargeInState(): boolean {
    return (
      this.duplexEnabled &&
      this.duplexWindowActive &&
      (this.state === 'thinking' || this.state === 'speaking')
    )
  }

  constructor(private readonly deps: VoiceAssistantDeps) {
    const rawSettings = deps.readSettings()
    this.settings = normalizeVoiceAssistantSettings(rawSettings)
    // v1→v2 噪音管线迁移回写：normalize 已把 v1 默认组合（browserDenoise+standard
    // 门控，实测严重伤识别率）回退为新默认并置标记，立即持久化防止每次启动重复
    // 迁移；此后用户显式开启降噪/门控不会再被重置
    const rawSettingsRecord =
      rawSettings != null && typeof rawSettings === 'object'
        ? (rawSettings as Record<string, unknown>)
        : null
    const noisePipelineMigratedNow =
      this.settings.noisePipelineMigrated &&
      !(rawSettingsRecord != null && 'noisePipelineMigrated' in rawSettingsRecord)
    // 识别精修迁移回写：v1 死字段默认 false 被存量持久化的，normalize 已统一翻回
    // 默认开（SenseVoice 精修对识别率提升显著），同样立即落盘防重复迁移
    const refineTranscriptMigratedNow =
      this.settings.refineTranscriptMigrated &&
      !(rawSettingsRecord != null && 'refineTranscriptMigrated' in rawSettingsRecord)
    if (noisePipelineMigratedNow || refineTranscriptMigratedNow) {
      deps.writeSettings(this.settings)
      if (noisePipelineMigratedNow) {
        log.info(
          '[voice-assistant] noise pipeline migrated to v2 defaults (denoise/focus off, refine on)',
        )
      }
      if (refineTranscriptMigratedNow) {
        log.info('[voice-assistant] transcript refine migrated to default on')
      }
    }
    this.route = deps.route
    this.pipeline = new VoiceTtsPipeline({
      synthesize: (sentence) => this.synthesizeSentence(sentence),
      // 包装 sendPlay：graceful 接管桥接的收口点——新代首句开播即冲掉渲染端
      // 挂着的 queue-dispatch reason（同态广播，无迁移日志）。beginTurn 的
      // graceful 分支会丢弃旧代在途合成，派发后首个 play 必属新代，判据精确。
      sendPlay: (command) => {
        deps.sendPlayCommand(command)
        if (command.kind === 'play' && this.gracefulTakeoverBridge) {
          this.gracefulTakeoverBridge = false
          log.info('[voice-assistant] graceful takeover live (new generation speaking)')
          this.deps.broadcastState({
            state: this.state,
            previous: this.state,
            reason: 'takeover-live',
          })
        }
      },
      onAllPlayed: () => this.handleAllPlayed(),
      shouldPlayCues: () => this.settings.soundCues,
      onTurnSynthesisFailed: (message) => this.notifyTurnSynthesisFailed(message),
      shouldFastCutFirstSentence: () => this.settings.firstSentenceFastCut,
      shouldPrefetch: () => this.settings.ttsPrefetch,
    })
    this.inputQueue = new VoiceInputQueue(
      BARGE_IN_QUEUE_CAPACITY,
      () => VOICE_ASSISTANT_ENDPOINT_PROFILES[this.settings.utteranceEndpointProfile].confirmMs,
      {
        onEnqueued: (entry, evicted) => {
          log.info(
            `[voice-assistant] queued input enqueued (${entry.id}, ${entry.text.length} chars, ${entry.capturedState}${evicted != null ? `, evictedOldest=${evicted.id}` : ''})`,
          )
          if (evicted != null) this.playCue('fail')
          this.deps.broadcastStatus(this.getStatus())
        },
        onDraftChanged: () => {
          this.deps.broadcastStatus(this.getStatus())
        },
        onDraftConfirmed: (text) => {
          this.routeConfirmedBargeIn(text)
        },
        onRemoved: (entry, cause) => {
          log.info(`[voice-assistant] queued input ${cause} (${entry.id})`)
          this.deps.broadcastStatus(this.getStatus())
        },
      },
    )
    deps.registerCleanup(() => this.dispose())
  }

  // ─── 生命周期 ─────────────────────────────────────────────────────────────

  /** 应用就绪后调用：武装快捷键 + 清扫残留 TTS 文件 + 按设置启动常驻聆听 */
  async initialize(): Promise<void> {
    this.rearmShortcut()
    await this.sweepTtsDir()
    if (this.settings.enabled && this.settings.alwaysListening) {
      void this.startStandby()
    }
    // 精修模型预装：refineTranscript 默认开启，模型缺失时启动即后台补装，
    // 避免首次对话因模型未装静默退化为纯流式（识别率劣化）
    if (this.settings.refineTranscript) void this.ensureRefineModelInstalled()
    // 存量绑定会话的推理档位对齐（轻量思考开关只对新会话即时生效的补齐）
    void this.syncSessionReasoningEffort()
    log.info(
      `[voice-assistant] service initialized (enabled=${this.settings.enabled}, shortcut=${this.settings.wakeShortcut}, alwaysListening=${this.settings.alwaysListening})`,
    )
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.turnEpoch += 1
    this.disarmShortcut()
    this.stopStandby()
    if (this.kwsRestartTimer != null) {
      clearTimeout(this.kwsRestartTimer)
      this.kwsRestartTimer = null
    }
    if (this.continuousListenTimer != null) {
      clearTimeout(this.continuousListenTimer)
      this.continuousListenTimer = null
    }
    this.duplexWindowActive = false
    this.inputQueue.dispose()
    this.bargeInGate.setPlaybackActive(false, false)
    this.teardownListening()
    this.pipeline.cancel()
    try {
      stopVoiceSession(undefined, VOICE_ASSISTANT_INTERNAL_OWNER_ID)
    } catch {
      // 关闭路径忽略
    }
  }

  private async sweepTtsDir(): Promise<void> {
    try {
      if (!existsSync(this.deps.ttsDir)) return
      await rm(this.deps.ttsDir, { recursive: true, force: true })
    } catch (error) {
      log.warn(`[voice-assistant] tts dir sweep failed: ${String(error)}`)
    }
  }

  // ─── 设置 ─────────────────────────────────────────────────────────────────

  getSettings(): VoiceAssistantSettings {
    return this.settings
  }

  /**
   * 语音会话当前解析到的 Agent 适配器信息（设置页按适配器展示权限/推理选项）：
   * 绑定的 Agent 优先，未绑定走默认 Agent；与 createNewSession 的建会话解析一致。
   */
  describeSessionAgent(): VoiceAssistantSessionAgentInfo | null {
    try {
      return this.deps.resolveAgentInfo(this.route.current.defaultAgentId ?? null)
    } catch {
      return null
    }
  }

  updateSettings(next: VoiceAssistantSettings): VoiceAssistantSettings {
    const normalized = normalizeVoiceAssistantSettings(next)
    const shortcutChanged =
      normalized.enabled !== this.settings.enabled ||
      normalized.wakeShortcut !== this.settings.wakeShortcut
    const standbyConfigChanged =
      normalized.alwaysListening !== this.settings.alwaysListening ||
      normalized.wakeWord !== this.settings.wakeWord ||
      normalized.wakeThreshold !== this.settings.wakeThreshold ||
      normalized.wakeBoost !== this.settings.wakeBoost
    const sessionThinkingChanged =
      normalized.sessionThinkingEnabled !== this.settings.sessionThinkingEnabled ||
      normalized.sessionThinkingEffort !== this.settings.sessionThinkingEffort
    this.settings = normalized
    this.deps.writeSettings(normalized)
    if (shortcutChanged) this.rearmShortcut()
    if (standbyConfigChanged) this.applyAlwaysListeningSetting()
    if (sessionThinkingChanged) void this.syncSessionReasoningEffort()
    // 全双工关闭（或引擎切 cloud 致不可用）：窗口收口 + 存量排队输入清空
    // （UI 侧随 duplexActive=false 一并隐藏队列框/迷你麦，不「说了谎」）
    if (!this.duplexEnabled && this.duplexWindowActive) {
      this.duplexWindowActive = false
      const removed = this.inputQueue.clear()
      if (removed.length > 0) {
        log.info(`[voice-assistant] queue cleared on duplex off (${removed.length})`)
      }
    }
    // 人声聚焦开启但 silero 模型未装：后台静默补装（不阻塞，失败只记日志，
    // 期间门控自动降级为纯能量层）
    if (normalized.voiceFocus !== 'off') void this.ensureVadModelInstalled()
    // 转写精修开启但 SenseVoice 模型未装：同样静默补装（缺失时停止退化为纯流式）
    if (normalized.refineTranscript) void this.ensureRefineModelInstalled()
    log.info(
      `[voice-assistant] settings updated (shortcut rearm=${shortcutChanged}, standby reconfig=${standbyConfigChanged})`,
    )
    return normalized
  }

  /**
   * 语音会话思考设置的档位对齐：把语音绑定会话的推理档位刷成与设置一致
   * （开关开 → 固定档 sessionThinkingEffort；关 → 恢复 agent 档位）。
   * 新建会话在 createNewSession 时自带档位，这里覆盖存量绑定会话与切换两种
   * 场景；会话不存在时静默跳过。
   */
  private async syncSessionReasoningEffort(): Promise<void> {
    if (this.disposed) return
    const sessionId = await this.route.peekAliveSessionId()
    if (sessionId == null) return
    const effort: SessionReasoningEffort | null = this.settings.sessionThinkingEnabled
      ? this.settings.sessionThinkingEffort
      : null
    try {
      await this.deps.setSessionReasoningEffort(sessionId, effort)
      log.info(
        `[voice-assistant] session reasoning effort synced (effort=${effort ?? 'agent-default'}, session=${sessionId})`,
      )
    } catch (error) {
      log.warn(
        `[voice-assistant] session reasoning effort sync failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /** vad 人声检测模型后台补装（installVoicePack 全量互斥语义，在途时快速返回） */
  private async ensureVadModelInstalled(): Promise<void> {
    if (this.disposed || this.vadInstallInFlight) return
    if (resolveVoiceVadPaths() != null) return
    this.vadInstallInFlight = true
    try {
      const result = await this.deps.installVoicePack()
      if (result.success) {
        log.info('[voice-assistant] vad model installed for voice focus')
      } else if (!result.status?.downloading) {
        log.warn(`[voice-assistant] vad model install failed: ${result.message}`)
      }
    } catch (error) {
      log.warn(`[voice-assistant] vad model install error: ${String(error)}`)
    } finally {
      this.vadInstallInFlight = false
    }
  }

  /** SenseVoice 精修模型后台补装（refineTranscript 开启时的识别质量依赖） */
  private async ensureRefineModelInstalled(): Promise<void> {
    if (this.disposed || this.refineInstallInFlight) return
    if (resolveVoiceRefinePaths() != null) return
    this.refineInstallInFlight = true
    try {
      const result = await this.deps.installVoicePack()
      if (result.success) {
        log.info('[voice-assistant] refine model installed for transcript refine')
      } else if (!result.status?.downloading) {
        log.warn(`[voice-assistant] refine model install failed: ${result.message}`)
      }
    } catch (error) {
      log.warn(`[voice-assistant] refine model install error: ${String(error)}`)
    } finally {
      this.refineInstallInFlight = false
    }
  }

  /** 常驻聆听设置应用：开启→启动 standby；关闭→停止并释放麦克风 */
  private applyAlwaysListeningSetting(): void {
    if (this.disposed || !this.settings.enabled) {
      this.stopStandby()
      return
    }
    if (this.settings.alwaysListening) {
      void this.startStandby()
    } else {
      this.stopStandby()
    }
  }

  private rearmShortcut(): void {
    this.disarmShortcut()
    if (!this.settings.enabled) return
    const accelerator = this.settings.wakeShortcut.trim()
    if (accelerator.length === 0) return
    try {
      const ok = this.deps.shortcutRegistrar.register(accelerator, () => {
        this.wake()
      })
      if (ok) {
        this.armedAccelerator = accelerator
        log.info(`[voice-assistant] wake shortcut armed: ${accelerator}`)
      } else {
        log.warn(`[voice-assistant] failed to arm wake shortcut: ${accelerator}`)
      }
    } catch (error) {
      log.warn(`[voice-assistant] wake shortcut register error: ${String(error)}`)
    }
  }

  private disarmShortcut(): void {
    if (this.armedAccelerator == null) return
    try {
      this.deps.shortcutRegistrar.unregister(this.armedAccelerator)
    } catch {
      // 注销失败不阻断
    }
    this.armedAccelerator = null
  }

  // ─── 状态查询 ─────────────────────────────────────────────────────────────

  getStatus(): VoiceAssistantStatus {
    return {
      state: this.state,
      captureSessionId: this.captureSessionId,
      partialText: this.partialText,
      speakingProgress:
        this.state === 'speaking'
          ? {
              played: this.pipeline.getPlayedCount(),
              pending: this.pipeline.getPendingCount(),
            }
          : null,
      lastError: null,
      boundSessionId: this.route.current.defaultSessionId ?? null,
      duplexActive: this.isDuplexBargeInState(),
      queuedInputs: this.inputQueue.snapshot().map((entry) => ({
        id: entry.id,
        text: entry.text,
        capturedState: entry.capturedState,
        createdAt: entry.createdAt,
      })),
      queueDraft: this.inputQueue.draft,
    }
  }

  // ─── 会话聚焦（UI 跟随语音会话跳转） ─────────────────────────────────────

  /**
   * 通知 UI 跳转到语音绑定会话（渲染端 setActiveSession + revealSession，
   * 对齐命令面板切会话行为）。渲染端处理幂等，重复推送无害。
   */
  private focusSession(sessionId: string, cause: VoiceAssistantSessionFocusEvent['cause']): void {
    if (this.disposed || sessionId.length === 0) return
    try {
      this.deps.emitSessionFocus({ sessionId, cause })
    } catch (error) {
      log.warn(`[voice-assistant] emit session focus failed: ${String(error)}`)
    }
  }

  /**
   * 唤醒预跳：绑定会话存在且存活时让 UI 提前就位（说话时转写直接出现在眼前）。
   * 只读窥探不创建不改绑；首次使用（无绑定）不跳，等轮次提交时再跳。
   */
  private prefocusOnWake(): void {
    void this.route
      .peekAliveSessionId()
      .then((sessionId) => {
        if (sessionId != null && !this.disposed) this.focusSession(sessionId, 'wake')
      })
      .catch(() => undefined)
  }

  // ─── 唤醒入口（快捷键 / HUD 手动触发） ────────────────────────────────────

  wake(): { ok: boolean; message: string } {
    if (this.disposed) return { ok: false, message: '服务已停止' }
    if (!this.settings.enabled) return { ok: false, message: '语音助手未启用' }
    switch (this.state) {
      case 'idle':
      case 'standby':
        this.prefocusOnWake()
        void this.startListening('wake')
        return { ok: true, message: '正在聆听' }
      case 'listening':
        // 再按一次 = 取消本轮聆听（用户显式结束对话循环）
        this.teardownListening()
        this.transition('idle', 'cancelled')
        this.logDialogueExit('manual-cancel')
        return { ok: true, message: '已取消聆听' }
      case 'thinking':
      case 'speaking':
        this.interrupt()
        return { ok: true, message: '已打断' }
      default:
        return { ok: false, message: '当前状态不可用' }
    }
  }

  /** 手动打断（HUD 按钮 / IPC）：任何活跃态立即回到 idle（用户显式结束对话循环） */
  interrupt(): void {
    this.turnEpoch += 1
    if (this.continuousListenTimer != null) {
      clearTimeout(this.continuousListenTimer)
      this.continuousListenTimer = null
    }
    // E9：打断保留插话队列（打断的是「播报/生成」，不是「我说过的话」——
    // 下次进对话（唤醒/续听）时由 maybeDispatchQueue 补发）；只撤草稿确认窗口
    const retained = this.inputQueue.size
    if (retained > 0) {
      log.info(`[voice-assistant] interrupted (queue retained ${retained})`)
    }
    this.inputQueue.cancelDraft()
    if (this.state === 'listening') {
      this.teardownListening()
      this.transition('idle', 'cancelled')
      this.logDialogueExit('interrupted')
      return
    }
    if (this.activeTurn != null) {
      const { sessionId } = this.activeTurn
      this.activeTurn = null
      void this.deps
        .cancelSessionTurn(sessionId)
        .catch((error) => log.warn(`[voice-assistant] cancelTurn failed: ${String(error)}`))
    }
    this.announcing = false
    this.pendingApproval = null // 打断语音审批：卡片保留给应用内手动处理
    // 挂起选择态不清：打断播报（抢话）后说序号/名称仍要能选——
    // 「切换模型 → 嫌列表啰嗦按快捷键打断 → 直接说第2个」是合法主流程
    this.pipeline.cancel() // 同步停播（淡出）+ 清队列 + 删未播文件
    this.transition('idle', 'cancelled')
    this.logDialogueExit('interrupted')
  }

  // ─── M2 常驻聆听（standby / KWS） ─────────────────────────────────────────

  /**
   * 启动常驻唤醒词聆听：加载 KWS 模型（缺失时自动补装一次）→ 请求渲染端常驻采集。
   * 对话期间复用同一采集流（kwsCaptureActive），命中唤醒词后不再重起 getUserMedia。
   * waitingInstall=true 为安装等待轮询的再入口：只检查就绪，不再次主动发起安装。
   */
  private async startStandby(waitingInstall = false): Promise<void> {
    if (this.disposed) return
    // 对话进行中不抢麦克风：标记待起，收尾 idle 后由 transition 自动接管
    if (this.state === 'listening' || this.state === 'thinking' || this.state === 'speaking') {
      this.standbyPending = true
      return
    }
    // 本服务已有安装或安装等待进行中：直接返回，避免重入期间误报「模型未安装」
    if (this.kwsInstallInFlight || this.kwsInstallWaitTimer != null) return
    if (!isWakeWordModelAvailable()) {
      let externallyInFlight = false
      if (!waitingInstall) {
        this.kwsInstallInFlight = true
        try {
          log.info('[voice-assistant] kws model missing, installing voice pack on demand')
          const result = await this.deps.installVoicePack()
          if (!result.success) {
            if (result.status?.downloading === true) {
              // 另一入口（设置→完整性页 / 语音输入触发的全量安装）正在安装：
              // 等待其完成后自动启动 standby，而不是把「正在安装中」当失败误报。
              externallyInFlight = true
              log.info('[voice-assistant] voice pack install already in flight, waiting')
            } else {
              log.warn(`[voice-assistant] kws model install failed: ${result.message}`)
            }
          }
        } catch (error) {
          log.warn(`[voice-assistant] kws model install error: ${String(error)}`)
        } finally {
          this.kwsInstallInFlight = false
        }
      }
      if (!isWakeWordModelAvailable()) {
        if (externallyInFlight || waitingInstall) {
          this.scheduleKwsInstallWait()
          return
        }
        this.transition(
          'idle',
          'error',
          '唤醒词模型未安装：请先在设置 → 完整性中安装语音包（含唤醒词组件）',
        )
        return
      }
    }
    this.clearKwsInstallWait()
    if (this.kwsDetector == null) {
      this.kwsDetector = new WakeWordDetector({
        onHit: (keyword) => this.onWakeWordHit(keyword),
        onError: (message) => {
          log.warn(`[voice-assistant] kws detector error: ${message}`)
          // 推理异常不致命：停 standby 回 idle，快捷键唤醒仍可用
          this.stopStandby()
          this.transition('idle', 'error', `唤醒词检测异常：${shortError(message)}`)
        },
        runtimeDir: this.deps.runtimeDir,
      })
    }
    if (!this.kwsDetector.isActive()) {
      try {
        await this.kwsDetector.start({
          wakeWord: this.settings.wakeWord,
          threshold: this.settings.wakeThreshold,
          boost: this.settings.wakeBoost,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn(`[voice-assistant] kws start failed: ${message}`)
        this.kwsDetector = null
        this.transition('idle', 'error', `常驻聆听启动失败：${shortError(message)}`)
        return
      }
    }
    // 请求渲染端常驻采集（已在线则跳过）
    if (!this.kwsCaptureActive) {
      this.deps.sendCaptureCommand({
        action: 'start',
        sessionId: VOICE_ASSISTANT_KWS_SESSION_ID,
        mode: 'kws',
      })
    }
    if (this.state === 'idle' || this.state === 'standby') {
      this.transition('standby', 'standby-on')
    }
  }

  /** 外部安装在途的等待轮询：5s 一次，上限 10 分钟，超时提示手动处理 */
  private scheduleKwsInstallWait(): void {
    if (this.disposed || this.kwsInstallWaitTimer != null) return
    if (this.kwsInstallWaitAttempts >= KWS_INSTALL_WAIT_MAX_ATTEMPTS) {
      this.kwsInstallWaitAttempts = 0
      log.warn('[voice-assistant] voice pack install wait timed out')
      this.transition(
        'idle',
        'error',
        '语音包安装等待超时：请在设置 → 完整性中检查语音包状态后重试',
      )
      return
    }
    this.kwsInstallWaitAttempts += 1
    this.kwsInstallWaitTimer = setTimeout(() => {
      this.kwsInstallWaitTimer = null
      void this.startStandby(true)
    }, KWS_INSTALL_WAIT_INTERVAL_MS)
  }

  /** 模型就绪/关闭常驻聆听时清掉等待轮询与计数 */
  private clearKwsInstallWait(): void {
    if (this.kwsInstallWaitTimer != null) {
      clearTimeout(this.kwsInstallWaitTimer)
      this.kwsInstallWaitTimer = null
    }
    this.kwsInstallWaitAttempts = 0
  }

  /** 停止常驻聆听：释放 KWS 推理与渲染端常驻采集（对话进行中则仅停推理） */
  private stopStandby(): void {
    this.standbyPending = false
    this.clearKwsInstallWait()
    this.kwsDetector?.stop()
    if (this.kwsRestartTimer != null) {
      clearTimeout(this.kwsRestartTimer)
      this.kwsRestartTimer = null
    }
    this.kwsRestartAttempts = 0
    if (this.kwsCaptureActive) {
      this.kwsCaptureActive = false
      // 对话进行中（listening）时保留采集流供 ASR，结束后由收尾逻辑停采集；
      // 其余状态立即停止渲染端采集释放麦克风。
      if (this.state !== 'listening') {
        this.deps.sendCaptureCommand({
          action: 'stop',
          sessionId: VOICE_ASSISTANT_KWS_SESSION_ID,
          mode: 'kws',
        })
      }
    }
    if (this.state === 'standby') {
      this.transition('idle', 'standby-off')
    }
  }

  /** 唤醒词命中：进入对话聆听（复用常驻采集流） */
  private onWakeWordHit(_keyword: string): void {
    if (this.disposed) return
    if (this.state === 'standby' || (this.state === 'idle' && this.kwsCaptureActive)) {
      // 播放/思考期间 KWS 已被路由层挂起（handleAudioChunk 丢弃），此处不会触发
      this.playCue('wake')
      void this.startListening('wake')
    }
  }

  /** KWS 常驻采集断流自愈：短退避重试（渲染端设备切换/系统休眠唤醒等场景） */
  private scheduleKwsCaptureRestart(): void {
    if (!this.settings.alwaysListening || this.disposed) return
    if (this.kwsRestartTimer != null) return
    if (this.kwsRestartAttempts >= 10) {
      log.warn('[voice-assistant] kws capture restart attempts exhausted, standby disabled')
      this.transition('idle', 'error', '常驻采集多次重试失败，已暂停常驻聆听')
      this.stopStandby()
      return
    }
    const delay = Math.min(2_000 * 2 ** this.kwsRestartAttempts, 30_000)
    this.kwsRestartAttempts += 1
    log.info(
      `[voice-assistant] kws capture down, restarting in ${delay}ms (attempt ${this.kwsRestartAttempts})`,
    )
    this.kwsRestartTimer = setTimeout(() => {
      this.kwsRestartTimer = null
      this.kwsCaptureActive = false
      // 走完整 startStandby：检测器可能也已停止（onError 路径），只重发采集会变「假待命」
      void this.startStandby()
    }, delay)
  }

  // ─── Listening 阶段 ───────────────────────────────────────────────────────

  private async startListening(reason: VoiceAssistantStateEvent['reason']): Promise<void> {
    if (this.state === 'listening' || this.state === 'thinking' || this.state === 'speaking') {
      return
    }
    const endpoint = VOICE_ASSISTANT_ENDPOINT_PROFILES[this.settings.utteranceEndpointProfile]
    // 全双工对话窗口内（播报收尾续听等场景）：采集与 ASR 已在线，复用免重建
    // （重建的代价 = 一次 ASR 会话泄漏 + 渲染端 getUserMedia 重起时延）
    if (this.duplexEnabled && this.duplexWindowActive && this.asrSessionId != null) {
      this.partialText = ''
      this.collectedFinals = []
      this.handoffPending = false
      this.armEmptySpeechTimeout()
      this.armListeningHardLimit()
      this.transition('listening', reason)
      log.info(
        `[voice-assistant] duplex listening resumed (reason=${reason}, asr=${this.asrSessionId})`,
      )
      // 打断保留的队列输入先派发（E9：打断≠丢用户的话，下次进对话时补发）
      this.maybeDispatchQueue('listen-resume')
      return
    }
    this.captureCounter += 1
    const captureSessionId = `${VOICE_ASSISTANT_DIALOGUE_SESSION_PREFIX}${Date.now()}-${this.captureCounter}`
    // 安装/等待在途时给准确的引导文案，而非「请先安装语音包」误导正在下载的用户
    const installPending =
      this.kwsInstallInFlight || this.kwsInstallWaitTimer != null
        ? '语音包正在安装中，请稍候再试'
        : null
    // 1. 先起主进程 ASR（失败则无需惊动渲染端采集）
    let handle: VoiceSessionHandle
    try {
      handle = startVoiceSession(
        {
          sampleRate: 16000,
          language: 'auto',
          enableVad: true,
          vadSilenceMs: endpoint.vadSilenceMs,
          // 人声聚焦门控（off 时省略，走识别服务旧行为）
          ...(this.settings.voiceFocus !== 'off' ? { noiseGate: this.settings.voiceFocus } : {}),
        },
        VOICE_ASSISTANT_INTERNAL_OWNER_ID,
      )
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const message = installPending ?? rawMessage
      log.warn(`[voice-assistant] asr start failed: ${rawMessage}`)
      this.playCue('fail')
      this.transition('idle', 'error', message)
      return
    }
    if (!handle.success || handle.sessionId == null) {
      this.playCue('fail')
      this.transition('idle', 'error', installPending ?? handle.error ?? '语音识别启动失败')
      return
    }
    // 采集/识别管线组合落日志：排查识别率问题时据此确认实际生效的处理链
    log.info(
      `[voice-assistant] asr pipeline: denoise=${this.settings.browserDenoise}, focus=${this.settings.voiceFocus}, refine=${this.settings.refineTranscript}, engine=${this.settings.recognitionEngine}, vadSilence=${endpoint.vadSilenceMs}ms, duplex=${this.duplexEnabled}, endpoint=${this.settings.utteranceEndpointProfile}`,
    )
    this.captureSessionId = captureSessionId
    this.asrSessionId = handle.sessionId
    this.closingAsrSessionId = null
    this.partialText = ''
    this.collectedFinals = []
    this.handoffPending = false
    this.cloudPcmChunks = []
    this.cloudTotalSamples = 0
    // 全双工：打开对话窗口（thinking/speaking 期间采集+ASR 常开）
    if (this.duplexEnabled) this.duplexWindowActive = true
    this.transition('listening', reason)
    this.playCue('wake')
    // 对话循环进入日志（与 dialogue loop ended 成对）：排查「一轮后退出」时
    // 据此确认每轮续听是否真的拉起
    log.info(
      `[voice-assistant] dialogue listening started (reason=${reason}, capture=${captureSessionId}, duplex=${this.duplexWindowActive})`,
    )
    // 2. 请求渲染端起采集（常驻 KWS 采集在线时复用同一流，不重起 getUserMedia）；
    //    对话采集按设置下发浏览器级降噪（远场对话优先保噪音免疫）；全双工
    //    显式要求 AEC（回声治理层 1，实际生效值经 capture-started 探测回传）
    if (!this.kwsCaptureActive) {
      this.deps.sendCaptureCommand({
        action: 'start',
        sessionId: captureSessionId,
        mode: 'dialogue',
        ...(this.settings.browserDenoise || this.duplexEnabled
          ? {
              audioProcessing: {
                noiseSuppression: this.settings.browserDenoise,
                voiceIsolation: this.settings.browserDenoise,
                ...(this.duplexEnabled ? { echoCancellation: true } : {}),
              },
            }
          : {}),
      })
    }
    // 3. 空转兜底超时（检测到人声活动会重置；说话后的收口由确认窗口负责）
    this.armEmptySpeechTimeout()
    // 4. 硬上限兜底（持续说话/持续噪音时的强制收口，不受活动重置影响）
    this.armListeningHardLimit()
  }

  /** listening 硬上限兜底的统一布防（新建/全双工复用两条路径共用） */
  private armListeningHardLimit(): void {
    if (this.listeningHardTimer != null) clearTimeout(this.listeningHardTimer)
    this.listeningHardTimer = setTimeout(() => {
      this.listeningHardTimer = null
      log.info('[voice-assistant] listening hard limit reached, closing capture')
      this.onListeningTimeout()
    }, LISTENING_HARD_LIMIT_MS)
  }

  /** 空转超时布防：speech-activity 命中时重调以重新计时 */
  private armEmptySpeechTimeout(): void {
    if (this.listeningTimer != null) clearTimeout(this.listeningTimer)
    this.listeningTimer = setTimeout(() => {
      this.onListeningTimeout()
    }, EMPTY_SPEECH_TIMEOUT_MS)
  }

  /** 对话循环退出统一日志（与 dialogue listening started 成对）：reason 说明退出归属 */
  private logDialogueExit(reason: string): void {
    log.info(`[voice-assistant] dialogue loop ended (reason=${reason})`)
  }

  private onListeningTimeout(): void {
    if (this.state !== 'listening') return
    log.info('[voice-assistant] empty speech timeout, closing capture')
    // 注意不置 handoffPending：该标记表示「已收到转写」，超时路径无转写，
    // 收口时应报告 timeout 而非 empty
    this.stopCaptureAndAsr()
    // stopVoiceSession(flush) 补尾部 padding 后经 session-stopped 事件统一收口
  }

  /** 停止渲染端采集 + 结束 ASR 会话（flush 模式刷出残余 final）；常驻采集在线时保留麦克风 */
  private stopCaptureAndAsr(): void {
    if (this.listeningTimer != null) {
      clearTimeout(this.listeningTimer)
      this.listeningTimer = null
    }
    if (this.listeningHardTimer != null) {
      clearTimeout(this.listeningHardTimer)
      this.listeningHardTimer = null
    }
    this.cancelHandoffConfirm()
    if (this.captureSessionId != null && !this.kwsCaptureActive) {
      this.deps.sendCaptureCommand({
        action: 'stop',
        sessionId: this.captureSessionId,
        mode: 'dialogue',
      })
    }
    if (this.asrSessionId != null) {
      const asrSessionId = this.asrSessionId
      this.asrSessionId = null
      this.closingAsrSessionId = asrSessionId
      try {
        // refine：停止后 SenseVoice 离线重识别整段音频（与会话语音输入同链路），
        // refined 事件整体替换流式结果后经 session-stopped 统一收口——识别率
        // 显著高于纯流式；模型缺失/时长不符时内部自动退化为 flush
        const mode =
          this.settings.refineTranscript && this.settings.recognitionEngine === 'local'
            ? 'refine'
            : 'flush'
        stopVoiceSession(asrSessionId, VOICE_ASSISTANT_INTERNAL_OWNER_ID, mode)
      } catch (error) {
        log.warn(`[voice-assistant] asr stop error: ${String(error)}`)
        this.closingAsrSessionId = null
        this.finishAfterListeningClosed()
      }
    } else {
      this.finishAfterListeningClosed()
    }
  }

  private teardownListening(): void {
    if (this.listeningTimer != null) {
      clearTimeout(this.listeningTimer)
      this.listeningTimer = null
    }
    if (this.listeningHardTimer != null) {
      clearTimeout(this.listeningHardTimer)
      this.listeningHardTimer = null
    }
    if (this.handoffConfirmTimer != null) {
      clearTimeout(this.handoffConfirmTimer)
      this.handoffConfirmTimer = null
    }
    if (this.captureSessionId != null) {
      // 常驻采集在线时保留麦克风流（stopStandby/收尾逻辑负责停采集）
      if (!this.kwsCaptureActive) {
        this.deps.sendCaptureCommand({
          action: 'stop',
          sessionId: this.captureSessionId,
          mode: 'dialogue',
        })
      }
      this.captureSessionId = null
    }
    // 主动释放前先摘掉会话归属：stopVoiceSession 会**同步**回调 session-stopped
    // （内部识别事件经 recognitionBridge 直接进 handleRecognitionEvent）。归属还挂在
    // asrSessionId 上时，这个自发的停止会被 session-stopped 分支误判为「外部终止」，
    // 把用户主动取消变成 idle(error)——现象就是点「取消聆听」却弹「语音识别会话已中断」。
    // 先置空归属，此后到达的收尾事件（tail final / session-stopped / error）按取消丢弃。
    const stoppingSessions = new Set<string | null>([this.asrSessionId, this.closingAsrSessionId])
    this.asrSessionId = null
    this.closingAsrSessionId = null
    for (const sessionId of stoppingSessions) {
      if (sessionId == null) continue
      try {
        stopVoiceSession(sessionId, VOICE_ASSISTANT_INTERNAL_OWNER_ID, 'flush')
      } catch {
        // 已在停止路径，忽略
      }
    }
    this.partialText = ''
    this.collectedFinals = []
    this.handoffPending = false
    this.duplexWindowActive = false
    this.inputQueue.cancelDraft()
  }

  // ─── 音频 chunk 与识别事件（由 registerVoiceAssistantIpc 路由进来） ────────

  /** 该 captureSessionId 是否属于本服务当前对话采集 */
  ownsCaptureSession(sessionId: string): boolean {
    return this.captureSessionId != null && sessionId === this.captureSessionId
  }

  /** 渲染端 chunk 到达（已通过 voice-assistant 前缀校验） */
  handleAudioChunk(sessionId: string, samples: Int16Array): void {
    // 常驻 KWS 采集流：按状态机路由（idle/standby→唤醒词检测；listening→对话 ASR；
    // thinking/speaking 且全双工→插话门控后喂 ASR（KWS 检测保持挂起防 TTS 自触发）；
    // 半双工 thinking/speaking→丢弃）
    if (sessionId === VOICE_ASSISTANT_KWS_SESSION_ID) {
      if (this.state === 'standby' || this.state === 'idle') {
        this.kwsDetector?.feed(samples)
      } else if (this.state === 'listening' && this.asrSessionId != null) {
        this.bufferCloudPcm(samples)
        feedVoiceAudio(this.asrSessionId, samples, VOICE_ASSISTANT_INTERNAL_OWNER_ID)
      } else if (this.isDuplexBargeInState() && this.asrSessionId != null) {
        const gated = this.bargeInGate.process(samples)
        feedVoiceAudio(this.asrSessionId, gated, VOICE_ASSISTANT_INTERNAL_OWNER_ID)
      }
      return
    }
    if (this.asrSessionId == null || sessionId !== this.captureSessionId) return
    if (this.isDuplexBargeInState()) {
      // 播报/思考期插话：能量门控（层 2）后再喂 ASR，被压制 chunk 置零保时间推进
      const gated = this.bargeInGate.process(samples)
      feedVoiceAudio(this.asrSessionId, gated, VOICE_ASSISTANT_INTERNAL_OWNER_ID)
      return
    }
    if (this.state !== 'listening') return
    this.bufferCloudPcm(samples)
    feedVoiceAudio(this.asrSessionId, samples, VOICE_ASSISTANT_INTERNAL_OWNER_ID)
  }

  /** cloud 引擎：聆听期间缓存整段 PCM 供说完后整体上传转写 */
  private bufferCloudPcm(samples: Int16Array): void {
    if (this.settings.recognitionEngine !== 'cloud') return
    // 上限 60s：超长只保留尾段（云转写本就面向短指令）
    const maxSamples = 16000 * 60
    this.cloudPcmChunks.push(samples)
    this.cloudTotalSamples += samples.length
    while (this.cloudTotalSamples > maxSamples && this.cloudPcmChunks.length > 1) {
      const dropped = this.cloudPcmChunks.shift()
      this.cloudTotalSamples -= dropped?.length ?? 0
    }
  }

  /**
   * VoiceRecognitionService 内部会话事件（经 registerVoiceIpc 分发器桥接）。
   * 同时覆盖活跃会话（listening）与停止中会话（flush 收尾）两种归属。
   */
  handleRecognitionEvent(event: {
    type: string
    sessionId: string
    text?: string
    message?: string
    /** speech-activity 事件携带：门控是否检出人声（空转计时重置依据） */
    speechActive?: boolean
  }): void {
    const isClosingSession =
      this.closingAsrSessionId != null && event.sessionId === this.closingAsrSessionId
    const isActiveSession = this.asrSessionId != null && event.sessionId === this.asrSessionId
    if (!isClosingSession && !isActiveSession) return
    switch (event.type) {
      case 'speech-activity': {
        // 门控检出人声活动：重置空转兜底计时，给用户完整的说话空间
        if (isActiveSession && this.state === 'listening' && event.speechActive === true) {
          this.armEmptySpeechTimeout()
        }
        return
      }
      case 'partial': {
        if (!isActiveSession) return
        if (this.state === 'listening') {
          // 确认窗口内用户继续开口：撤销本次收口，继续聆听拼接
          this.cancelHandoffConfirm()
          this.partialText = event.text ?? ''
          this.deps.broadcastState({
            state: 'listening',
            previous: 'listening',
            reason: 'wake',
            detail: this.partialText,
          })
          return
        }
        if (this.isDuplexBargeInState()) {
          // 插话确认窗口内继续开口：撤销计时继续拼接（与 handoff 确认窗口同构）
          this.inputQueue.extendDraft(this.state === 'speaking' ? 'speaking' : 'thinking')
        }
        return
      }
      case 'final': {
        const text = (event.text ?? '').trim()
        if (text.length === 0) return
        // partial 是「当前句实时全文」、final 是同句定稿：final 落定后必须清掉
        // partialText，否则确认窗口的 HUD 广播把两者拼接，同一句话显示两遍
        this.partialText = ''
        if (isActiveSession && this.state === 'listening') {
          this.collectedFinals.push(text)
          log.info(
            `[voice-assistant] vad final captured (${text.length} chars), entering utterance confirm window`,
          )
          this.scheduleHandoffConfirm()
        } else if (isActiveSession && this.isDuplexBargeInState()) {
          // 播报/思考期插话：回声守卫（层 3）→ 命令旁路 / 审批解析 / 确认窗口
          this.handleBargeInFinal(text)
        } else if (isClosingSession) {
          // flush 尾句（VAD final 之后残留的短句）并入本轮转写
          this.collectedFinals.push(text)
        }
        return
      }
      case 'refined': {
        // SenseVoice 精修全文（整轮重识别）：整体替换流式拼接，漏字/错字在这里修复
        const text = (event.text ?? '').trim()
        if (text.length === 0) return
        const streamingChars = [...this.collectedFinals, this.partialText]
          .filter(Boolean)
          .join(' ').length
        this.collectedFinals = [text]
        this.partialText = ''
        log.info(
          `[voice-assistant] transcript refined: ${text.length} chars replaces ${streamingChars} streaming chars`,
        )
        return
      }
      case 'session-stopped': {
        if (isClosingSession) {
          this.closingAsrSessionId = null
          this.finishAfterListeningClosed()
          return
        }
        if (isActiveSession) {
          // 活跃会话被外部终止（如语音包安装触发 resetVoiceEngineCache）
          log.warn('[voice-assistant] active asr session stopped unexpectedly')
          this.asrSessionId = null
          this.teardownListening()
          this.playCue('fail')
          this.transition('idle', 'error', '语音识别会话已中断')
        }
        return
      }
      case 'error': {
        const message = event.message ?? '语音识别错误'
        log.warn(`[voice-assistant] recognition error: ${message}`)
        this.asrSessionId = null
        this.closingAsrSessionId = null
        this.teardownListening()
        this.playCue('error')
        this.transition('idle', 'error', message)
        return
      }
      default:
        return
    }
  }

  /**
   * 说完确认窗口（防抖）：VAD 句尾静音 ≠ 整轮说完——换气、思考措辞的停顿同样
   * 会触发 VAD final。final 后保持采集与 ASR 继续运行，再持续静默
   * utteranceConfirmMs 才真正收口提交；窗口内用户继续说话（partial/新 final）
   * 即撤销收口继续拼接，给用户完整的说话空间。
   */
  private scheduleHandoffConfirm(): void {
    if (this.handoffConfirmTimer != null) clearTimeout(this.handoffConfirmTimer)
    this.handoffConfirmTimer = setTimeout(() => {
      this.handoffConfirmTimer = null
      if (this.state !== 'listening' || this.asrSessionId == null) return
      // 纯标点/无正文的转写（环境噪音硬解的典型产出）不是用户输入：
      // 不收口、清空已收集文本，继续聆听（采集与 ASR 未停，零切换成本）
      if (!hasMeaningfulVoiceText([...this.collectedFinals, this.partialText].join(''))) {
        log.info(
          `[voice-assistant] transcript has no meaningful text (${this.collectedFinals.length} finals), keep listening`,
        )
        this.collectedFinals = []
        this.partialText = ''
        this.armEmptySpeechTimeout()
        this.deps.broadcastState({
          state: 'listening',
          previous: 'listening',
          reason: 'wake',
          detail: '',
        })
        return
      }
      log.info('[voice-assistant] utterance confirmed silent, handing off to thinking')
      this.handoffPending = true
      this.transition('thinking', 'wake')
      if (this.duplexEnabled && this.duplexWindowActive) {
        // 全双工：采集/ASR 保持在线（thinking/speaking 继续听插话），直接用流式
        // 结果提交——窗口内不做整段 refine（一次会话跨多轮，整段重识别会卷入
        // 前几轮音频；识别率敏感用户可关 fullDuplex 回 refine 路径）
        log.info('[voice-assistant] duplex window disables per-turn refine')
        this.handoffPending = false
        this.submitCollectedTranscript(true)
        return
      }
      this.stopCaptureAndAsr()
    }, VOICE_ASSISTANT_ENDPOINT_PROFILES[this.settings.utteranceEndpointProfile].confirmMs)
    // 窗口期告知用户：可以继续说，静默后自动发送
    this.deps.broadcastState({
      state: 'listening',
      previous: 'listening',
      reason: 'confirm',
      detail: [...this.collectedFinals, this.partialText].filter(Boolean).join(' '),
    })
  }

  /** 确认窗口内检测到继续说话：撤销本次收口，继续聆听 */
  private cancelHandoffConfirm(): void {
    if (this.handoffConfirmTimer == null) return
    clearTimeout(this.handoffConfirmTimer)
    this.handoffConfirmTimer = null
    log.info('[voice-assistant] speech resumed within confirm window, keep listening')
  }

  // ─── 全双工插话路径（三分：命令旁路 / graceful 边播边处理 / 排队） ────────

  /**
   * 播报/思考期捕获一句 final（ASR 层已过 BargeInGate 能量门控）：
   * 层 3 文本回声守卫 → 审批解析（挂起期冻结队列）→ 确认窗口草稿。
   */
  private handleBargeInFinal(text: string): void {
    // 层 3：与在播/待播/最近播完 TTS 文本模糊匹配（AEC/门控漏网的回声兜底）
    const ttsTexts = this.pipeline.getRecentTtsTexts()
    if (isLikelyTtsEcho(text, ttsTexts)) {
      const match = describeEchoMatch(text, ttsTexts)
      this.echoGuardHitAt = Date.now()
      log.info(
        `[voice-assistant] echo guard dropped final (len=${text.length}, bestRatio=${match.bestRatio}, matchedTtsLen=${match.matchedTtsLen})`,
      )
      return
    }
    // 审批挂起期（问题正在念/等待答复）：插话只走审批解析，队列冻结（C12）
    if (this.pendingApproval != null) {
      if (parseApprovalDecision(text) != null) {
        void this.settleApprovalFromTranscript(text)
        return
      }
      log.info('[voice-assistant] barge-in frozen during pending approval')
      return
    }
    this.inputQueue.feedDraftFinal(text, this.state === 'speaking' ? 'speaking' : 'thinking')
  }

  /**
   * 插话确认窗口收口（一条输入就绪）的三分路径判定（R2）：
   * 命令 → 旁路立即执行；执行器闲 + 播报未完 → graceful 边播边处理；
   * 其余（执行器忙）→ 排队等释放。
   * 守卫用「对话窗口在线」而非瞬时相位——draft 在 thinking/speaking 期捕获，
   * 收口时可能已迁移到 listening（续听拉起）或 idle（播报收尾间隙），已确认的
   * 话不应因相位迁移被丢弃。
   */
  private routeConfirmedBargeIn(text: string): void {
    if (!this.duplexEnabled || !this.duplexWindowActive) {
      log.info('[voice-assistant] barge-in draft confirmed after window closed, dropped')
      return
    }
    const command = parseVoiceCommand(text, {
      enableSessionCommands: true,
      awaitingSessionSelection: this.awaitingSessionCandidates != null,
      awaitingModelSelection: this.awaitingModelCandidates != null,
      awaitingProjectSelection: this.awaitingProjectCandidates != null,
    })
    if (command != null) {
      log.info(`[voice-assistant] barge-in voice command hit: ${JSON.stringify(command)}`)
      void this.executeVoiceCommand(command)
      return
    }
    if (
      // announcing（候选列表/确认提示）不是轮次播报：非选择内容在此期间只入队，
      // 等播报完由 listen-resume 派发（C3「非选择内容 → 入队」）。若放行 graceful
      // 会当场砍断候选播报起聊天轮，allPlayed 走 announcing 分支把 activeTurn
      // 悬挂一轮、挂起选择态也无人清理
      !this.announcing &&
      (this.activeTurn == null || this.generationCompleted) &&
      this.pipeline.isPlaybackActive()
    ) {
      // 执行器已释放（生成完，activeTurn 可能仍挂着等播报收尾）、播报未完：
      // 边播边处理（当前句播完即止，新首句句边界接上）
      log.info('[voice-assistant] dispatch path = graceful (barge-in while playback trailing)')
      void this.submitTranscript(text)
      return
    }
    this.inputQueue.enqueue(text, this.state === 'speaking' ? 'speaking' : 'thinking')
  }

  /**
   * 队列自动派发（R4：执行器释放瞬间，不等播报完）。
   * 两个到达路径合流：turn completed 先到（播报未完 → graceful）与
   * handleAllPlayed 先到（播报已完 → 正常提交，替换 800ms 续听延迟）。
   * 派发防抖由「activeTurn 占用」+ dispatchInFlight 防重入共同保证。
   */
  private maybeDispatchQueue(trigger: 'turn-completed' | 'all-played' | 'listen-resume'): void {
    if (this.disposed || !this.duplexEnabled) return
    if (this.pendingApproval != null || this.announcing) return
    // 派发在途（submitTranscript 的 ensureSession/submitVoiceTurn await 间隙，
    // activeTurn 尚未就位）：allPlayed 等二次触发在此窗口会重复 dequeue 双提交
    if (this.queueDispatchInFlight) return
    // 执行器忙（生成中）不派发；生成完（agent_status completed 已到）即释放，
    // 播报是否结束只决定接管模式（graceful / immediate）
    if (this.activeTurn != null && !this.generationCompleted) return
    const entry = this.inputQueue.dequeueHead()
    if (entry == null) return
    const graceful = this.pipeline.isPlaybackActive()
    log.info(
      `[voice-assistant] queue auto-advance (trigger=${trigger}, id=${entry.id}, remaining=${this.inputQueue.size}, graceful=${graceful})`,
    )
    // 同态 detail 广播（HUD 感知队列派发；状态类别不变不打迁移日志）
    this.deps.broadcastState({
      state: this.state,
      previous: this.state,
      reason: 'queue-dispatch',
      detail: entry.text,
    })
    // 状态机对齐：all-played/listen-resume 触发时状态是 idle/listening（或被常驻
    // 顶替的 standby），而 submitTranscript 不做 thinking 迁移、maybeTransitionSpeaking
    // 又只从 thinking 迁入 speaking——不迁移的话派发轮的整个生成+播报期卡在原态
    // （HUD 错态、回声门控不武装、listening 态下 TTS 回声无门控直喂 ASR）。
    // turn-completed 触发时已在 speaking（graceful 接管），保持不动。
    if (this.state === 'idle' || this.state === 'listening' || this.state === 'standby') {
      this.transition('thinking', 'queue-dispatch', entry.text)
    }
    this.queueDispatchInFlight = true
    void this.submitTranscript(entry.text).finally(() => {
      this.queueDispatchInFlight = false
    })
  }

  /** ASR 会话结束（flush 完成）后的统一收口 */
  private finishAfterListeningClosed(): void {
    const wasHandoff = this.handoffPending
    this.captureSessionId = null
    this.handoffPending = false
    this.duplexWindowActive = false
    this.inputQueue.cancelDraft()
    if (this.state !== 'listening' && this.state !== 'thinking') return
    this.submitCollectedTranscript(wasHandoff)
  }

  /** collectedFinals 组装转写并按优先级提交（审批 → cloud → 普通聊天） */
  private submitCollectedTranscript(wasHandoff: boolean): void {
    const transcript = this.collectedFinals.join(' ').trim()
    this.collectedFinals = []
    this.partialText = ''
    // 审批聆听优先于普通提交（挂起审批等待「同意/拒绝」）；纯标点当未听到处理
    if (this.pendingApproval != null) {
      if (hasMeaningfulVoiceText(transcript)) {
        void this.settleApprovalFromTranscript(transcript)
        return
      }
      this.playCue('fail')
      // 审批聆听超时/空转：追问一次（保持挂起）
      const pending = this.pendingApproval
      if (pending.retries < 1) {
        pending.retries += 1
        this.announceSpeech('没有听到答复。请明确说「同意」或「拒绝」。')
        return
      }
      this.pendingApproval = null
      this.announceSpeech('未收到语音答复，请在应用中点击审批卡处理。')
      return
    }
    if (hasMeaningfulVoiceText(transcript)) {
      if (this.settings.recognitionEngine === 'cloud') {
        // 云转写：整段上传（本地流式结果仅作 VAD 断句与兜底）
        void this.submitCloudTranscript(transcript)
        return
      }
      void this.submitTranscript(transcript)
      return
    }
    // 有字符但无正文（纯标点，多为 refine 后兜底路径命中）：继续聆听而非报错退出
    if (transcript.length > 0) {
      log.info('[voice-assistant] closed transcript has no meaningful text, resuming listening')
      this.transition('idle', 'empty')
      void this.startListening('wake')
      return
    }
    this.playCue('fail')
    this.transition('idle', wasHandoff ? 'empty' : 'timeout')
  }

  /**
   * M3 云转写提交：把缓存的整段 PCM 写 WAV → transcribe（whisper 类渠道）→
   * 用云端文本提交；失败回落本地流式转写。云转写延迟高（1–3s），追求准确率时选用。
   */
  private async submitCloudTranscript(localFallback: string): Promise<void> {
    const epoch = this.turnEpoch
    const totalSamples = this.cloudTotalSamples
    const chunks = this.cloudPcmChunks
    this.cloudPcmChunks = []
    this.cloudTotalSamples = 0
    let transcript = localFallback
    if (totalSamples >= 16000 * 0.3) {
      try {
        const wavPath = await this.writePcmWav(chunks, totalSamples)
        try {
          const providers = await this.deps.resolveMediaProviders()
          if (providers.length === 0) throw new Error('未配置支持语音转写的多媒体渠道')
          const { output } = await this.deps.mediaRouter.invoke(
            {
              operation: 'audio_transcribe',
              capability: 'audio.transcription',
              inputFiles: [{ type: 'audio', path: wavPath, role: 'input' }],
              outputDir: this.deps.ttsDir,
            },
            { providers },
          )
          const text = output.assets.find((asset) => asset.contentText != null)?.contentText ?? ''
          const cleaned = text.trim()
          if (cleaned.length > 0) transcript = cleaned
        } finally {
          unlink(wavPath).catch(() => undefined)
        }
      } catch (error) {
        log.warn(
          `[voice-assistant] cloud transcription failed, falling back to local: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
    // 云转写 await 期间被打断则放弃（submitTranscript 内部再做二次校验）
    if (epoch !== this.turnEpoch || this.disposed) return
    await this.submitTranscript(transcript)
  }

  /** PCM16 mono 16k → WAV 文件（44 字节 RIFF 头 + 数据） */
  private async writePcmWav(chunks: Int16Array[], totalSamples: number): Promise<string> {
    await mkdir(this.deps.runtimeDir, { recursive: true })
    const dataBytes = totalSamples * 2
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + dataBytes, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20) // PCM
    header.writeUInt16LE(1, 22) // mono
    header.writeUInt32LE(16000, 24)
    header.writeUInt32LE(32000, 28) // byte rate
    header.writeUInt16LE(2, 32) // block align
    header.writeUInt16LE(16, 34) // bits per sample
    header.write('data', 36)
    header.writeUInt32LE(dataBytes, 40)
    const pcm = Buffer.alloc(dataBytes)
    let offset = 0
    for (const chunk of chunks) {
      if (offset + chunk.length * 2 > pcm.length) break
      Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length * 2).copy(pcm, offset)
      offset += chunk.length * 2
    }
    const filePath = join(this.deps.runtimeDir, `cloud-asr-${Date.now()}.wav`)
    await writeFile(filePath, Buffer.concat([header, pcm]))
    return filePath
  }

  // ─── 渲染端反馈 ───────────────────────────────────────────────────────────

  handleRendererEvent(event: VoiceAssistantRendererEvent): void {
    switch (event.type) {
      case 'capture-started': {
        // AEC 实际生效值探测（回声治理层 1）：false 时播报期门控与文本守卫
        // 自动升严格档（AEC 是优化不是依赖——蓝牙 HFP/部分驱动会失效）
        if (event.echoCancellationEffective != null) {
          this.aecEffective = event.echoCancellationEffective
          if (!event.echoCancellationEffective) {
            log.warn(
              `[voice-assistant] capture aec effective=false (${event.sessionId}), echo guard escalating to strict`,
            )
          } else {
            log.info(`[voice-assistant] capture aec effective=true (${event.sessionId})`)
          }
        }
        if (event.sessionId === VOICE_ASSISTANT_KWS_SESSION_ID) {
          this.kwsCaptureActive = true
          this.kwsRestartAttempts = 0
          log.info('[voice-assistant] renderer kws capture online')
          if (this.state === 'idle' && this.settings.alwaysListening) {
            this.transition('standby', 'standby-on')
          }
          return
        }
        log.info(`[voice-assistant] renderer capture started (${event.sessionId})`)
        return
      }
      case 'capture-stopped': {
        if (event.sessionId === VOICE_ASSISTANT_KWS_SESSION_ID) {
          log.info('[voice-assistant] renderer kws capture stopped')
          this.kwsCaptureActive = false
          if (this.state === 'standby') {
            this.transition('idle', 'standby-off')
            this.scheduleKwsCaptureRestart()
          } else if (this.state === 'idle') {
            this.scheduleKwsCaptureRestart()
          }
          return
        }
        // 渲染端采集意外停止（设备断开等）：按听写结束收口
        if (this.state === 'listening' && event.sessionId === this.captureSessionId) {
          log.info('[voice-assistant] renderer capture stopped unexpectedly, closing listening')
          this.handoffPending = this.collectedFinals.length > 0
          this.stopCaptureAndAsr()
        }
        return
      }
      case 'capture-failed': {
        if (event.sessionId === VOICE_ASSISTANT_KWS_SESSION_ID || this.kwsCaptureActive) {
          this.kwsCaptureActive = false
          log.warn(`[voice-assistant] renderer kws capture failed: ${event.message}`)
          if (this.state === 'standby') this.transition('idle', 'standby-off')
          if (this.state === 'idle') this.scheduleKwsCaptureRestart()
          return
        }
        if (this.state !== 'listening') return
        log.warn(`[voice-assistant] renderer capture failed: ${event.message}`)
        this.teardownListening()
        this.playCue('fail')
        this.transition('idle', 'error', event.message)
        return
      }
      case 'playback-ended':
        this.pipeline.onPlaybackEnded(event.sentenceId)
        return
      case 'playback-error':
        this.pipeline.onPlaybackFailed(event.sentenceId)
        return
      default:
        return
    }
  }

  // ─── 转写提交（Thinking 阶段） ────────────────────────────────────────────

  private async submitTranscript(transcript: string): Promise<void> {
    const epoch = this.turnEpoch
    // 语音命令优先：命中则不走会话（M2 起会话/工作区命令开放；M4 起模型/项目/带名会话）
    const command = parseVoiceCommand(transcript, {
      enableSessionCommands: true,
      awaitingSessionSelection: this.awaitingSessionCandidates != null,
      awaitingModelSelection: this.awaitingModelCandidates != null,
      awaitingProjectSelection: this.awaitingProjectCandidates != null,
    })
    if (command != null) {
      log.info(`[voice-assistant] voice command hit: ${JSON.stringify(command)}`)
      await this.executeVoiceCommand(command)
      return
    }
    this.clearPendingSelections()
    let session: { sessionId: string }
    try {
      session = await this.route.ensureSession()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`[voice-assistant] ensure voice session failed: ${message}`)
      if (epoch === this.turnEpoch && !this.disposed) {
        this.announceSpeech(`语音会话创建失败。${shortError(message)}`)
      }
      return
    }
    // await 恢复点：打断/dispose 后不再提交（防「打断复活」）
    if (epoch !== this.turnEpoch || this.disposed) return
    // UI 跳转到语音会话：转写与回复都发生在该会话，提前让用户看到
    this.focusSession(session.sessionId, 'turn')
    try {
      const result = await this.deps.submitVoiceTurn({
        sessionId: session.sessionId,
        message: buildVoiceUserMessage(transcript, this.settings.voiceSystemPrompt),
        userMessageDisplayContent: transcript,
      })
      this.activeTurn = { turnId: result.turnId, sessionId: session.sessionId }
      if (epoch !== this.turnEpoch || this.disposed) {
        // 提交完成瞬间被打断：立即撤销该轮次，保持打断语义
        this.activeTurn = null
        void this.deps.cancelSessionTurn(session.sessionId).catch(() => undefined)
        return
      }
      // 接管模式：新轮起跑时旧播报仍在响 → graceful 句边界让位（边播边处理）；
      // 播报已停 → immediate（含 fadeOut 淡出的现状语义）
      const takeover = this.pipeline.isPlaybackActive() ? 'graceful' : 'immediate'
      this.gracefulTakeoverBridge = takeover === 'graceful'
      this.pipeline.beginTurn(takeover)
      this.generationCompleted = false
      // 首响 ack：提交成功瞬间（不等 LLM 首字），消除「说完后无声空窗」
      this.playAckCue()
      log.info(
        `[voice-assistant] voice turn submitted (${result.turnId}, session ${session.sessionId}, started=${result.started}, takeover=${takeover})`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`[voice-assistant] submitTurn failed: ${message}`)
      if (epoch === this.turnEpoch && !this.disposed) {
        this.announceSpeech(`抱歉，语音请求发送失败。${shortError(message)}`)
      }
    }
  }

  /** 语音命令执行（listening 期与插话旁路共用同一优先级链） */
  private async executeVoiceCommand(
    command: NonNullable<ReturnType<typeof parseVoiceCommand>>,
  ): Promise<void> {
    switch (command.kind) {
      case 'stop-listening': {
        this.clearPendingSelections()
        // E8：清空插话队列（逐条记 discarded）+ 窗口收口
        const removed = this.inputQueue.clear()
        if (removed.length > 0) {
          log.info(`[voice-assistant] queue cleared on exit (${removed.length})`)
        }
        this.duplexWindowActive = false
        this.teardownListening()
        this.transition('idle', 'cancelled')
        return
      }
      case 'cancel-selection': {
        // 挂起选择态逃生门：清候选回到聊天（与 stop-listening「关语音」语义解耦）。
        // 不动状态机——播报收尾后既有连续对话链路自动续听
        this.clearPendingSelections()
        this.announceSpeech('好，不切了，我们继续聊。')
        log.info('[voice-assistant] pending selection cancelled by voice')
        return
      }
      case 'new-session':
        this.clearPendingSelections()
        await this.handleNewSessionCommand()
        return
      case 'switch-session':
        await this.handleSwitchSessionCommand(command.name)
        return
      case 'select-session':
        await this.handleSelectSessionCommand(command.index, command.name)
        return
      case 'switch-model':
        await this.handleSwitchModelCommand(command.name)
        return
      case 'select-model':
        await this.handleSelectModelCommand(command.index, command.name)
        return
      case 'switch-workspace':
        await this.handleSwitchWorkspaceCommand(command.name)
        return
      case 'select-project':
        await this.handleSelectProjectCommand(command.index, command.name)
        return
      default:
        return
    }
  }

  /** 首响 ack 提示音（firstResponseFeedback 独立设置，与 soundCues 语义分离） */
  private playAckCue(): void {
    if (this.disposed) return
    if (this.settings.firstResponseFeedback !== 'cue') return
    this.deps.sendPlayCommand({ kind: 'cue', cue: 'ack' })
  }

  /** 放弃排队输入（E6：仅移除当前展示条 = 最新入队条，可重说） */
  discardQueued(id: string): { ok: boolean; message: string } {
    if (this.disposed) return { ok: false, message: '服务已停止' }
    const entry = this.inputQueue.removeById(id)
    if (entry == null) return { ok: false, message: '该输入已不在队列中' }
    return { ok: true, message: '已放弃' }
  }

  /**
   * 立即发送（抢占，E5）：epoch+1 → 中止旧轮（cancelTurn）→ TTS 立即淡出 →
   * 提交指定排队输入（缺省 = 最新条，与 HUD 展示一致「动作所指一致」）。
   * 队列剩余条目与确认窗口草稿保留（抢占只处理「这一条」）。
   */
  async dispatchQueued(id?: string): Promise<{ ok: boolean; message: string }> {
    if (this.disposed) return { ok: false, message: '服务已停止' }
    if (!this.duplexEnabled) return { ok: false, message: '全双工聆听未开启' }
    const entry = id != null ? this.inputQueue.findById(id) : this.inputQueue.latest()
    if (entry == null) return { ok: false, message: '没有排队中的输入' }
    log.info(`[voice-assistant] preempt dispatch (queuedId=${entry.id}, ttsFade=true)`)
    this.turnEpoch += 1
    this.inputQueue.removeById(entry.id, 'dispatched')
    if (this.activeTurn != null) {
      const { sessionId } = this.activeTurn
      this.activeTurn = null
      try {
        await this.deps.cancelSessionTurn(sessionId)
      } catch (error) {
        log.warn(`[voice-assistant] preempt cancelTurn failed: ${String(error)}`)
      }
    }
    // TTS 立即淡出（120ms ramp，不等句尾——抢占语义与低时延都要求）
    this.pipeline.cancel()
    this.announcing = false
    this.pendingApproval = null
    // 抢占的是聊天输入：挂起选择态一并作废（C3 同族——非选择内容放弃候选，
    // 否则抢占后残留的候选列表会让后续插话被误解析成选择）
    this.clearPendingSelections()
    this.transition('thinking', 'preempt', entry.text)
    await this.submitTranscript(entry.text)
    return { ok: true, message: '已发送' }
  }

  private async handleNewSessionCommand(): Promise<void> {
    try {
      const { sessionId } = await this.route.createNewSession()
      this.focusSession(sessionId, 'command-new')
      this.announceSpeech('已为你新建会话。')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.announceSpeech(`新建会话失败。${shortError(message)}`)
    }
  }

  /**
   * 「切换会话」：带名直选（在最近会话池按名称匹配，未命中回落念列表）；
   * 无名称时念最近 5 个会话，挂起选择态等下一句序号/名称。
   */
  private async handleSwitchSessionCommand(name: string | null): Promise<void> {
    try {
      // 带名直选用更大的池子（念列表仍只念前 5 个，序号语义与播报对齐）
      const sessions = await this.deps.listRecentSessions(20)
      if (sessions.length === 0) {
        this.announceSpeech('最近没有其他会话，已保留当前会话。')
        return
      }
      if (name != null && name.length > 0) {
        const matchedIndex = matchCandidateIndexByName(
          sessions.map((s) => s.title),
          name,
        )
        const matched = matchedIndex != null ? sessions[matchedIndex] : undefined
        if (matched != null) {
          log.info(
            `[voice-assistant] voice session named match: ${name} -> ${matched.id} (${matched.title})`,
          )
          this.clearPendingSelections()
          this.route.updateBinding({ defaultSessionId: matched.id })
          this.focusSession(matched.id, 'command-switch')
          const label = matched.title.length > 20 ? `${matched.title.slice(0, 20)}…` : matched.title
          this.announceSpeech(`已切换到会话：${label}。`)
          return
        }
        log.info(
          `[voice-assistant] voice session named match missed: ${name}, falling back to list`,
        )
      }
      const head = sessions.slice(0, 5)
      this.clearPendingSelections()
      this.awaitingSessionCandidates = head
      this.announceSpeech(buildSessionSelectionSpeech(head.map((s) => s.title)))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.announceSpeech(`读取会话列表失败。${shortError(message)}`)
    }
  }

  /** 选择态回应：按序号或名称匹配候选会话并改绑 */
  private async handleSelectSessionCommand(
    index: number | null,
    name: string | null,
  ): Promise<void> {
    const candidates = this.awaitingSessionCandidates
    if (candidates == null || candidates.length === 0) {
      this.announceSpeech('当前没有待选择的会话列表。')
      return
    }
    let matched: { id: string; title: string } | undefined
    if (index != null) {
      matched = candidates[index - 1]
    } else if (name != null) {
      const needle = name.trim().toLowerCase()
      matched = candidates.find(
        (candidate) =>
          candidate.title.toLowerCase().includes(needle) ||
          needle.includes(candidate.title.toLowerCase()),
      )
    }
    this.awaitingSessionCandidates = null
    if (matched == null) {
      this.announceSpeech('没有匹配的会话，如需再选请说「切换会话」。')
      return
    }
    this.route.updateBinding({ defaultSessionId: matched.id })
    this.focusSession(matched.id, 'command-switch')
    const label = matched.title.length > 20 ? `${matched.title.slice(0, 20)}…` : matched.title
    this.announceSpeech(`已切换到会话：${label}。`)
    log.info(`[voice-assistant] voice route switched to session ${matched.id}`)
  }

  /**
   * 「切换模型」（M4）：带名直选当前渠道模型；无名称/未命中时念候选列表，
   * 挂起选择态等下一句序号/名称。模型候选取自语音绑定会话的渠道。
   */
  private async handleSwitchModelCommand(name: string | null): Promise<void> {
    try {
      const sessionId = await this.route.peekAliveSessionId()
      if (sessionId == null) {
        this.announceSpeech('当前没有语音会话，先说一句话或新开会话后再切换模型。')
        return
      }
      const { models, unsupportedReason } = await this.deps.listSessionModels(sessionId)
      if (unsupportedReason != null && unsupportedReason.length > 0) {
        this.announceSpeech(unsupportedReason)
        return
      }
      if (models.length === 0) {
        this.announceSpeech('当前渠道没有配置可选模型。')
        return
      }
      if (name != null && name.length > 0) {
        const matchedIndex = this.matchModelCandidate(models, name)
        const modelId = matchedIndex != null ? models[matchedIndex] : undefined
        if (modelId != null) {
          log.info(`[voice-assistant] voice model named match: ${name} -> ${modelId}`)
          await this.applySessionModel(sessionId, modelId)
          return
        }
        log.info(`[voice-assistant] voice model named match missed: ${name}, falling back to list`)
      }
      this.clearPendingSelections()
      this.awaitingModelCandidates = models
      this.announceSpeech(buildCandidateSelectionSpeech('模型', models))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.announceSpeech(`读取模型列表失败。${shortError(message)}`)
    }
  }

  /** 模型选择态回应：按序号或名称匹配候选并切换会话模型 */
  private async handleSelectModelCommand(index: number | null, name: string | null): Promise<void> {
    const candidates = this.awaitingModelCandidates
    if (candidates == null || candidates.length === 0) {
      this.announceSpeech('当前没有待选择的模型列表。')
      return
    }
    let modelId: string | undefined
    if (index != null) {
      modelId = candidates[index - 1]
    } else if (name != null) {
      const matchedIndex = this.matchModelCandidate(candidates, name)
      modelId = matchedIndex != null ? candidates[matchedIndex] : undefined
    }
    this.awaitingModelCandidates = null
    if (modelId == null) {
      this.announceSpeech('没有匹配的模型，如需再选请说「切换模型」。')
      return
    }
    const sessionId = await this.route.peekAliveSessionId()
    if (sessionId == null) {
      this.announceSpeech('语音绑定会话已失效，请先说一句话再切换模型。')
      return
    }
    await this.applySessionModel(sessionId, modelId)
  }

  /**
   * 模型名称匹配：先按原文本双向包含；未命中再按剥离空白与符号的宽松匹配
   * （ASR 念模型 ID 常丢连字符与点号，如 claude-sonnet-4.5 →「claude sonnet 4 5」）。
   */
  private matchModelCandidate(models: string[], name: string): number | null {
    const direct = matchCandidateIndexByName(models, name)
    if (direct != null) return direct
    const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')
    const needle = normalize(name)
    if (needle.length === 0) return null
    const index = models.findIndex((model) => {
      const target = normalize(model)
      return target.includes(needle) || needle.includes(target)
    })
    return index >= 0 ? index : null
  }

  /** 执行会话模型切换并播报结果（执行通道：SessionService.updateSession） */
  private async applySessionModel(sessionId: string, modelId: string): Promise<void> {
    try {
      await this.deps.updateSessionModel(sessionId, modelId)
      this.focusSession(sessionId, 'command-switch')
      this.announceSpeech(`已切换模型：${modelId}。`)
      log.info(`[voice-assistant] voice model switched to ${modelId} (session ${sessionId})`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.announceSpeech(`切换模型失败。${shortError(message)}`)
    }
  }

  /**
   * 「切换到 XX 工作区/项目」：带名直选（未找到时念已登记项）；
   * 无名称时（M4「切换项目」）念项目候选挂起选择态；仅一个工作区时保持直切。
   */
  private async handleSwitchWorkspaceCommand(name: string | null): Promise<void> {
    try {
      const workspaces = await this.deps.listWorkspaces()
      if (workspaces.length === 0) {
        this.announceSpeech('当前没有已登记的工作区。')
        return
      }
      let matched: { id: string; name: string } | undefined
      if (name != null && name.length > 0) {
        const matchedIndex = matchCandidateIndexByName(
          workspaces.map((w) => w.name),
          name,
        )
        matched = matchedIndex != null ? workspaces[matchedIndex] : undefined
      } else if (workspaces.length === 1) {
        matched = workspaces[0]
      }
      if (matched == null) {
        if (name == null || name.length === 0) {
          // M4 无名称：念项目候选，挂起选择态等序号/名称
          this.clearPendingSelections()
          this.awaitingProjectCandidates = workspaces
          this.announceSpeech(
            buildCandidateSelectionSpeech(
              '项目',
              workspaces.map((w) => w.name),
            ),
          )
          return
        }
        this.announceSpeech(
          `没有找到该工作区。已登记的有：${workspaces
            .slice(0, 3)
            .map((w) => w.name)
            .join('、')}。`,
        )
        return
      }
      await this.performSwitchToWorkspace(matched)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.announceSpeech(`切换工作区失败。${shortError(message)}`)
    }
  }

  /** 项目选择态回应：按序号或名称匹配候选工作区并执行切换 */
  private async handleSelectProjectCommand(
    index: number | null,
    name: string | null,
  ): Promise<void> {
    const candidates = this.awaitingProjectCandidates
    if (candidates == null || candidates.length === 0) {
      this.announceSpeech('当前没有待选择的项目列表。')
      return
    }
    let matched: { id: string; name: string } | undefined
    if (index != null) {
      matched = candidates[index - 1]
    } else if (name != null) {
      const matchedIndex = matchCandidateIndexByName(
        candidates.map((c) => c.name),
        name,
      )
      matched = matchedIndex != null ? candidates[matchedIndex] : undefined
    }
    this.awaitingProjectCandidates = null
    if (matched == null) {
      this.announceSpeech('没有匹配的项目，如需再选请说「切换项目」。')
      return
    }
    await this.performSwitchToWorkspace(matched)
  }

  /** 切换到目标工作区：有最近会话则改绑续聊，否则在其中新建会话 */
  private async performSwitchToWorkspace(matched: { id: string; name: string }): Promise<void> {
    const existingSessionId = await this.deps.findLatestSessionIdInWorkspace(matched.id)
    if (existingSessionId != null) {
      this.route.updateBinding({
        defaultWorkspaceId: matched.id,
        defaultSessionId: existingSessionId,
      })
      this.focusSession(existingSessionId, 'command-workspace')
      this.announceSpeech(`已切换到工作区 ${matched.name}，继续最近的会话。`)
    } else {
      this.route.updateBinding({ defaultWorkspaceId: matched.id, defaultSessionId: undefined })
      const { sessionId } = await this.route.createNewSession()
      this.focusSession(sessionId, 'command-workspace')
      this.announceSpeech(`已切换到工作区 ${matched.name}，并新建了会话。`)
    }
    log.info(`[voice-assistant] voice route switched to workspace ${matched.id}`)
  }

  /** 清空三类挂起选择态（命令落空/新命令/打断取消时统一收口，防旧候选劫持下一句） */
  private clearPendingSelections(): void {
    this.awaitingSessionCandidates = null
    this.awaitingModelCandidates = null
    this.awaitingProjectCandidates = null
  }

  // ─── M3 语音审批桥（挂起-收听-消费环） ─────────────────────────────────────

  /**
   * 权限审批请求入口（ipc/index.ts onApproval 链路旁路调入）。
   * 仅在语音轮次进行中（activeTurn 匹配）且无挂起审批时接手：
   * TTS 念问题 → 聆听「同意/拒绝」→ resolveApproval 消费；其余情况交还本地审批卡。
   */
  handleApprovalRequest(request: {
    requestId: string
    sessionId: string
    toolName: string
    action: string
    riskLevel: string
  }): boolean {
    if (this.disposed || this.pendingApproval != null) return false
    if (this.activeTurn == null || this.activeTurn.sessionId !== request.sessionId) return false
    this.pendingApproval = {
      requestId: request.requestId,
      sessionId: request.sessionId,
      retries: 0,
    }
    log.info(
      `[voice-assistant] voice approval bridge engaged (${request.toolName}, risk=${request.riskLevel})`,
    )
    this.announceSpeech(buildApprovalSpeech(request.toolName, request.action, request.riskLevel))
    return true
  }

  /** 审批卡过期/被外部处理：清除语音挂起态（轮次交还 SDK 按未批准处理） */
  handleApprovalExpired(): void {
    if (this.pendingApproval == null) return
    log.info('[voice-assistant] voice approval expired externally')
    this.pendingApproval = null
  }

  /** 审批聆听收口：解析同意/拒绝 → resolveApproval；模糊则追问一次 */
  private async settleApprovalFromTranscript(transcript: string): Promise<void> {
    const pending = this.pendingApproval
    if (pending == null) return
    const decision = parseApprovalDecision(transcript)
    if (decision != null) {
      this.pendingApproval = null
      let ok = false
      try {
        ok = this.deps.resolveApproval(pending.requestId, decision)
      } catch (error) {
        log.warn(`[voice-assistant] resolveApproval failed: ${String(error)}`)
      }
      log.info(
        `[voice-assistant] voice approval ${decision} (requestId=${pending.requestId}, ok=${ok})`,
      )
      this.announceSpeech(
        !ok
          ? '该审批已失效，请在应用中查看结果。'
          : decision === 'allow'
            ? '已同意，继续执行。'
            : '已拒绝该操作。',
      )
      // agent 恢复执行后 delta 流会驱动 speaking；此处保持 idle 等事件
      return
    }
    if (pending.retries < 1) {
      pending.retries += 1
      this.announceSpeech('没听清。请明确说「同意」或「拒绝」。')
      return
    }
    this.pendingApproval = null
    this.announceSpeech('未识别到明确答复，请在应用中点击审批卡处理。')
  }

  // ─── 轮次事件（ipc/index.ts onEvent 链路调入） ─────────────────────────────

  handleTurnEvent(event: AgentEvent): void {
    if (this.activeTurn == null || event.turnId !== this.activeTurn.turnId) return
    if (event.type === 'assistant_message') {
      if (event.isFinal) {
        // 权威全文：flush 尾句；若 delta 全丢则以全文兜底
        this.pipeline.finalize(event.content ?? '')
        this.maybeTransitionSpeaking()
        return
      }
      if (event.mode === 'delta' && event.content.length > 0) {
        this.pipeline.pushDelta(event.content)
        this.maybeTransitionSpeaking()
      }
      return
    }
    if (event.type === 'agent_status') {
      if (event.status === 'completed') {
        // 轮次终结时挂起的语音审批必已失效（超时/已处理），清掉防劫持后续对话
        if (this.pendingApproval != null) {
          log.info('[voice-assistant] voice approval dropped on turn completion')
          this.pendingApproval = null
        }
        // 终态可能先于 isFinal：300ms 后历史回捞兜底（照抄远程链路模式）
        const { turnId, sessionId } = this.activeTurn
        setTimeout(() => {
          if (this.activeTurn?.turnId !== turnId) return
          void (async () => {
            try {
              const recovered = await this.deps.recoverFinalFromHistory(sessionId, turnId)
              if (recovered != null) this.pipeline.finalize(recovered)
            } catch (error) {
              log.warn(`[voice-assistant] final recovery failed: ${String(error)}`)
            } finally {
              this.pipeline.turnDone()
              // 执行器已释放（生成完）：队列非空立即派发——播报未完走 graceful
              // 句边界让位（R4：不等播报完，兑现并行性）。activeTurn 保留到
              // allPlayed（播报收尾语义不变），执行器释放用独立标志表达
              if (this.activeTurn?.turnId === turnId) {
                this.generationCompleted = true
                this.maybeDispatchQueue('turn-completed')
              }
            }
          })()
        }, 300)
        return
      }
      if (event.status === 'cancelled') {
        this.activeTurn = null
        this.pendingApproval = null
        this.pipeline.cancel()
        this.transition('idle', 'cancelled')
        return
      }
      if (event.status === 'error') {
        this.activeTurn = null
        this.pendingApproval = null
        this.pipeline.cancel()
        this.announceSpeech(`任务出错了。${shortError(event.message ?? '请查看会话详情')}`)
        return
      }
      return
    }
    if (event.type === 'agent_error') {
      this.activeTurn = null
      this.pendingApproval = null
      this.pipeline.cancel()
      this.announceSpeech(`任务出错了。${shortError(event.message ?? '请查看会话详情')}`)
    }
  }

  private maybeTransitionSpeaking(): void {
    if (this.state === 'thinking') this.transition('speaking', 'wake')
  }

  private handleAllPlayed(): void {
    // announcing（审批问题/命令确认）优先于轮次收尾判定：
    // 审批播报时轮次仍活跃（agent 挂起等批准），不能误判为轮次完成
    if (this.announcing) {
      this.announcing = false
      this.transition('idle', 'completed')
      // 挂起审批：问题念完 → 进入聆听收「同意/拒绝」
      // idle 可能已被常驻在线自动顶成 standby，两态都要放行（与连续对话回调对齐）
      if (
        this.pendingApproval != null &&
        !this.disposed &&
        (this.state === 'idle' || this.state === 'standby')
      ) {
        void this.startListening('manual')
        return
      }
      // 命令确认/错误提示等非轮次播报同样续听：对话循环只由用户显式结束
      this.scheduleNextRoundListening()
      return
    }
    if (this.activeTurn != null) {
      this.activeTurn = null
      this.transition('idle', 'completed')
      // 队列非空：0ms 派发队首（播放已停、执行器已释放，无续听间隙——
      // 排队输入在捕获时已过回声守卫）；空 → 现行为续听
      if (this.inputQueue.size > 0) {
        this.maybeDispatchQueue('all-played')
        return
      }
      this.scheduleNextRoundListening()
    }
  }

  /**
   * 整轮 TTS 合成全失败的用户提示：复用 reason='error' 的状态事件通道
   * （VoiceAssistantButton 对该事件弹右上角 toast 并附「去设置」动作，无需新增通道）。
   * 只做同态 detail 广播（收尾后应为 idle/standby），不迁移状态机；若收尾后已
   * 重新进入 listening（如审批续听已开始），放弃弹窗只记日志，避免打断收听。
   */
  private notifyTurnSynthesisFailed(message: string): void {
    if (this.disposed) return
    if (this.state !== 'idle' && this.state !== 'standby') {
      log.warn(`[voice-assistant] tts failure notice skipped (state=${this.state}): ${message}`)
      return
    }
    this.transition(this.state, 'error', message)
  }

  /**
   * 播报完短暂停顿（等 TTS 尾音消散 + AEC 收敛）→ 自动回聆听。
   * 常驻语音对话是默认行为：空闲 = 继续等待下一轮，只有用户显式结束
   * （再按唤醒键取消/打断、「停止聆听」语音命令、轮次取消、关闭应用）才退出循环。
   * 原 continuousMode 开关不再参与控制（语义与常驻语音冲突，字段仅存量兼容）；
   * 修复点：常驻唤醒在线时收尾会被 transition 自动顶成 standby，旧实现先按
   * `state !== 'idle'` 拦截导致 standby 分支永远走不到——续听在常驻场景整轮失效。
   */
  private scheduleNextRoundListening(): void {
    if (this.disposed) return
    if (this.continuousListenTimer != null) clearTimeout(this.continuousListenTimer)
    this.continuousListenTimer = setTimeout(() => {
      this.continuousListenTimer = null
      if (this.disposed || !this.settings.enabled) return
      // idle 与 standby（常驻在线自动顶替的待命态）都可续听；其余状态说明已有
      // 新的聆听/思考/播报在途，不应再拉起
      if (this.state !== 'idle' && this.state !== 'standby') return
      void this.startListening('completed')
    }, CONTINUOUS_LISTEN_DELAY_MS)
  }

  // ─── TTS 合成与播报 ───────────────────────────────────────────────────────

  /**
   * 非轮次播报（命令确认/错误提示）：复用流水线，播完回 idle。
   * announce 期间不持有 activeTurn（announcing 标记驱动收尾）。
   */
  private announceSpeech(text: string): void {
    this.announcing = true
    this.pipeline.beginTurn()
    this.pipeline.finalize(text)
    if (this.state !== 'speaking') this.transition('speaking', 'command')
  }

  private async synthesizeSentence(sentence: string): Promise<{ filePath: string }> {
    // 渠道/模型/音色决策与媒体路由在共享内核（消息语音播报 IPC 同源复用）
    return synthesizeSpeechText(
      {
        settings: this.settings,
        resolveMediaProviders: () => this.deps.resolveMediaProviders(),
        mediaRouter: this.deps.mediaRouter,
        outputDir: this.deps.ttsDir,
      },
      sentence,
    )
  }

  private playCue(cue: 'wake' | 'fail' | 'error'): void {
    if (!this.settings.soundCues) return
    this.deps.sendPlayCommand({ kind: 'cue', cue })
  }

  // ─── 状态机 ───────────────────────────────────────────────────────────────

  private transition(
    next: VoiceAssistantState,
    reason: VoiceAssistantStateEvent['reason'],
    detail?: string,
  ): void {
    const previous = this.state
    if (previous === next) {
      // 同态重复迁移只更新 detail（listening 的 partial 刷新）
      if (detail != null) {
        this.deps.broadcastState({ state: next, previous, reason, detail })
      }
      return
    }
    this.state = next
    log.info(`[voice-assistant] state ${previous} -> ${next} (${reason})`)
    this.deps.broadcastState({
      state: next,
      previous,
      reason,
      ...(detail != null ? { detail } : {}),
    })
    this.deps.broadcastStatus(this.getStatus())
    // 回声门控（层 2）随播报相位武装/解除：speaking = 有本进程 TTS 在响
    if (next === 'speaking') {
      const echoGuardRecentHit =
        this.echoGuardHitAt != null &&
        Date.now() - this.echoGuardHitAt < ECHO_GUARD_STRICT_WINDOW_MS
      const strict = this.aecEffective === false || echoGuardRecentHit
      this.bargeInGate.setPlaybackActive(true, strict)
    } else if (previous === 'speaking') {
      this.bargeInGate.setPlaybackActive(false, false)
      // graceful 桥接随播报相位结束一并收口（新代零句/合成全失败的兜底路径）
      this.gracefulTakeoverBridge = false
    }
    // 对话结束回 idle 后：常驻采集在线直接回 standby；否则有挂起的常驻请求则补启动
    if (next === 'idle' && this.settings.alwaysListening && !this.disposed) {
      if (this.kwsCaptureActive && this.kwsDetector != null && this.kwsDetector.isActive()) {
        this.state = 'standby'
        log.info('[voice-assistant] state idle -> standby (resident listening online)')
        this.deps.broadcastState({ state: 'standby', previous: 'idle', reason: 'standby-on' })
        this.deps.broadcastStatus(this.getStatus())
      } else if (this.standbyPending) {
        this.standbyPending = false
        void this.startStandby()
      }
    }
  }
}

/** 错误信息压缩为可朗读的短句 */
function shortError(message: string): string {
  const cleaned = message.replace(/\s+/g, ' ').trim()
  return cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned
}
