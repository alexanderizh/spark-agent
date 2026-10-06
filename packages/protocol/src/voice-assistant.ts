/**
 * 语音助手（唤醒 + 语音对话）协议类型
 *
 * 语音助手 = 本机上的一个「外部入口」：全局快捷键（M1）或本地唤醒词 KWS（M2）
 * 唤起 → 渲染端采集 16kHz PCM（复用 voice:feed-audio 通道，sessionId 前缀路由）
 * → 主进程 VoiceAssistantService 状态机编排（ASR → submitTurn → 逐句 TTS → 播放）。
 *
 * 通道分层：
 *   invoke：设置读写 / 状态查询 / 手动触发（低频）
 *   stream 主→渲染：状态迁移、采集指令、TTS 播放指令
 *   fire-and-forget 渲染→主：播放反馈与采集反馈（VOICE_ASSISTANT_RENDERER_EVENT_CHANNEL）
 */

import type {
  SessionAgentAdapter,
  SessionPermissionMode,
  SessionReasoningEffort,
} from './ipc/index.js'

/** 语音会话推理档位全集（normalize 白名单用） */
export const VOICE_ASSISTANT_THINKING_EFFORTS: readonly SessionReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

/** 语音会话所属 Agent 的适配器信息（设置页按适配器展示权限/推理选项） */
export interface VoiceAssistantSessionAgentInfo {
  adapter: SessionAgentAdapter
  /** Agent 显示名；未解析到具体 Agent（走运行时默认）时为 null */
  agentName: string | null
}

// ─── 设置 ───────────────────────────────────────────────────────────────────

export const VOICE_ASSISTANT_SETTINGS_CATEGORY = 'voice-assistant'
export const VOICE_ASSISTANT_SETTINGS_KEY = 'settings'
/** voice route 绑定（会话粘性），结构仿 RemoteRouteBinding，独立存储 */
export const VOICE_ASSISTANT_ROUTE_KEY = 'route'

/** 唤醒词预设（keywords.txt 由 WakeWordDetector 按预设生成，M2 生效） */
export const VOICE_ASSISTANT_WAKE_WORDS = [
  'hey-spark',
  'nihao-xinghuo',
  'xinghuo-xinghuo',
  'xiaoxing-xiaoxing',
] as const
export type VoiceAssistantWakeWord = (typeof VOICE_ASSISTANT_WAKE_WORDS)[number]

export interface VoiceAssistantSettings {
  /** 快捷键唤醒总开关（M1 功能开关） */
  enabled: boolean
  /** 全局快捷键（Electron accelerator），默认 Alt+Space */
  wakeShortcut: string
  /** M2 常驻唤醒词聆听（默认关闭；开启即持续采集麦克风做本地 KWS） */
  alwaysListening: boolean
  /** M3 连续对话模式（默认关）：播报完短暂停顿后自动回聆听，免唤醒词续聊 */
  continuousMode: boolean
  /** 唤醒词预设 */
  wakeWord: VoiceAssistantWakeWord
  /** KWS keywordsThreshold（越低越易触发，默认 0.1 适配「嘿 Spark」双语模型） */
  wakeThreshold: number
  /** KWS 命中词 boost（keywordsScore，默认 3.0） */
  wakeBoost: number
  /** 识别引擎：本地 Paraformer（默认）；云 whisper 为 M3 预留 */
  recognitionEngine: 'local' | 'cloud'
  /**
   * 停止后离线精修（SenseVoice 重识别整段音频，延迟 1–3s 换准确率）。
   * 与会话语音输入同链路，默认开——实测纯流式 Paraformer 漏字明显，精修后
   * 整体替换流式结果，识别率显著提升。云引擎下不生效（云转写本就是整段识别）。
   */
  refineTranscript: boolean
  /**
   * 云端识别渠道（null = 自动取第一个支持 audio.transcription 的已配置渠道）。
   * 仅 recognitionEngine='cloud' 时生效：云转写把整段 PCM 上传到该渠道转写。
   */
  sttProviderProfileId: string | null
  /** 云端识别模型（null = 渠道默认模型）；与 sttProviderProfileId 配套生效。 */
  sttModelId: string | null
  /** TTS 渠道（null = 自动取第一个支持 audio.speech 的已配置渠道） */
  ttsProviderProfileId: string | null
  /** TTS 模型（null = 渠道默认模型） */
  ttsModelId: string | null
  /** TTS 音色（空串 = 渠道默认） */
  ttsVoice: string
  /** TTS 语速（0.5–2.0，1.0 原速） */
  ttsSpeed: number
  /** TTS 音量（0–10，1.0 默认；MiniMax voice_setting.vol 语义，其他渠道自动忽略） */
  ttsVol: number
  /** TTS 音调（-12–12，0 默认；MiniMax voice_setting.pitch 语义，其他渠道自动忽略） */
  ttsPitch: number
  /** TTS 情绪（空串 = 不指定；MiniMax：happy/sad/angry/fearful/disgusted/surprised/calm 等） */
  ttsEmotion: string
  /** 语音会话默认权限模式（默认 claude-auto，与远程连接一致） */
  sessionPermissionMode: SessionPermissionMode
  /** 注入语音系统提示（要求 Agent 口语化简短回复），默认开 */
  voiceSystemPrompt: boolean
  /** 提示音（唤醒/失效/错误），默认开 */
  soundCues: boolean
  /**
   * 说完确认窗口（毫秒，默认 1200）：VAD 句尾静音后再静默该时长才提交本轮，
   * 期间检测到继续说话则撤销收口继续拼接收听（防换气/思考停顿被误截断）。
   */
  utteranceConfirmMs: number
  /**
   * 浏览器级降噪（默认关）：采集时开启 Chromium 降噪与人声隔离（voiceIsolation），
   * 过滤稳态噪音。代价是削字头轻辅音（RNNoise 类处理的固有行为），实测明显
   * 伤 ASR 识别率——与旧语音输入保持一致默认关闭，仅在嘈杂环境手动开启。
   */
  browserDenoise: boolean
  /**
   * 人声聚焦（默认 off）：主进程双层门控，尽量只保留用户本人的近场人声——
   * 能量层按自适应底噪门限把远场低能量音频静音（近场优先），silero 层校验
   * final 的人声覆盖率丢弃噪音硬解的句子。门控会轻微影响字头/字尾的完整性
   * （已用起音迟滞与加长尾音保持把影响压到最低），识别率优先场景保持 off。
   */
  voiceFocus: 'off' | 'standard' | 'strict'
  /**
   * 噪音管线一次性迁移标记：v1 默认 browserDenoise=true + voiceFocus=standard
   * 实测严重伤害识别率（降噪削字头 + 门控切字尾 + 覆盖率误杀整句），v2 起默认
   * 关闭。存量设置若仍是 v1 默认组合（用户从未显式调整）则自动迁移回新默认；
   * 用户已是其他组合说明显式选择过，仅置标记不再迁移。
   */
  noisePipelineMigrated: boolean
  /**
   * 识别精修一次性迁移标记：refineTranscript 在 v1 是无 UI 的死字段（默认 false
   * 且会被整体保存持久化），用户不可能显式关闭过；v2 默认翻转 true 后，存量
   * false 一律视为旧默认产物自动迁移回开。迁移后用户显式关闭（false + 标记
   * 已置）则尊重选择不再重置。
   */
  refineTranscriptMigrated: boolean
  /**
   * 语音会话思考开关（默认开）：开启时语音会话以固定推理档运行（见
   * sessionThinkingEffort），大幅降低响应延迟——思考会显著拉长首字时间，
   * 语音对话追求快问快答。仅影响语音会话，普通对话不受影响（仍走
   * agent/会话的推理配置）；关闭后跟随会话所属 Agent 的默认档位。
   */
  sessionThinkingEnabled: boolean
  /**
   * 语音会话推理档位（默认 minimal ≈ 不思考，最快出字）。开关开启时生效，
   * 各适配器映射到自身最近档位（codex/spark 同样支持六档语义）。
   */
  sessionThinkingEffort: SessionReasoningEffort
  /**
   * 全双工聆听（默认开）：对话进行中（思考/播报）麦克风与 ASR 保持在线，
   * 可随时插话——新输入默认排队到当前轮完成后自动提交，不自动打断播报；
   * 想马上处理可点 HUD 上的「立即发送」。仅本地识别引擎生效（cloud 引擎
   * 强制回落半双工）。关闭后回到「播报结束后才继续聆听」的现状行为。
   */
  fullDuplex: boolean
  /**
   * 首响即时反馈（默认 cue 提示音）：一句话确认提交的瞬间给出反馈，消除
   * 等待模型首句期间的无声空窗。cue = 本地振荡器短双音（零成本零延迟）；
   * voice = 合成一句短应答（P2 预留，normalize 收敛为合法值）；off = 只保留
   * 界面反馈。
   */
  firstResponseFeedback: 'cue' | 'voice' | 'off'
  /**
   * 说话端点三档（默认 standard）：决定「说完 → 提交」的尾部等待
   * （VAD 尾静音 + 确认窗口）。relaxed=从容（2000+1800ms）、
   * standard=标准（1500+1200ms，约 2.7s 停顿容忍，覆盖中文换气/措辞/思考停顿）、
   * snappy=迅捷（1100+900ms，误截断率升、靠确认窗口撤销兜底）。
   * 未显式设置时按旧 utteranceConfirmMs 单向迁移。
   */
  utteranceEndpointProfile: 'relaxed' | 'standard' | 'snappy'
  /** N+1 句预取（默认开）：合成并发 2，消除句间合成间隙；渠道限流时可关 */
  ttsPrefetch: boolean
  /** 首句快切（默认开）：首句凑齐 ≥10 字或首 delta 后 400ms 强切，压首字延迟 */
  firstSentenceFastCut: boolean
  /**
   * 本地兜底播报（默认开）：云端 TTS 渠道不可用（未配置渠道，或调用失败——
   * 网络错误/鉴权失败/限流等）时，自动改用操作系统自带语音合成（macOS say /
   * Windows SAPI / Linux espeak-ng）合成 wav 复用既有播放链路，保证播报不中断。
   * 系统语音为机械音质仅作兜底；兜底产物不入磁盘缓存，渠道恢复后自动回到
   * 云端合成。存量设置缺字段按默认开启解析。
   */
  ttsLocalFallback: boolean
}

export const DEFAULT_VOICE_ASSISTANT_SETTINGS: VoiceAssistantSettings = {
  enabled: true,
  wakeShortcut: 'Alt+Space',
  alwaysListening: false,
  continuousMode: false,
  wakeWord: 'hey-spark',
  wakeThreshold: 0.1,
  wakeBoost: 3.0,
  recognitionEngine: 'local',
  sttProviderProfileId: null,
  sttModelId: null,
  ttsProviderProfileId: null,
  ttsModelId: null,
  ttsVoice: '',
  ttsSpeed: 1.0,
  ttsVol: 1.0,
  ttsPitch: 0,
  ttsEmotion: '',
  sessionPermissionMode: 'claude-auto',
  voiceSystemPrompt: true,
  soundCues: true,
  utteranceConfirmMs: 1200,
  browserDenoise: false,
  voiceFocus: 'off',
  noisePipelineMigrated: false,
  refineTranscriptMigrated: false,
  refineTranscript: true,
  sessionThinkingEnabled: true,
  sessionThinkingEffort: 'minimal',
  fullDuplex: true,
  firstResponseFeedback: 'cue',
  utteranceEndpointProfile: 'standard',
  ttsPrefetch: true,
  firstSentenceFastCut: true,
  ttsLocalFallback: true,
}

/**
 * 说话端点三档参数表（VAD 句尾静音 + 说完确认窗口，毫秒）。
 * 主进程 startListening 与插话队列确认窗口共用，保证两处节奏一致。
 */
export const VOICE_ASSISTANT_ENDPOINT_PROFILES: Record<
  VoiceAssistantSettings['utteranceEndpointProfile'],
  { vadSilenceMs: number; confirmMs: number; label: string }
> = {
  relaxed: { vadSilenceMs: 2000, confirmMs: 1800, label: '从容' },
  standard: { vadSilenceMs: 1500, confirmMs: 1200, label: '标准' },
  snappy: { vadSilenceMs: 1100, confirmMs: 900, label: '迅捷' },
}

function readBool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback
}

function readNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function readString(raw: unknown, fallback: string, maxLength: number): string {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  return trimmed.length === 0 ? fallback : trimmed.slice(0, maxLength)
}

/**
 * 端点档位解析（单向迁移，不留双写）：显式 profile 优先；未设置时按旧
 * utteranceConfirmMs 迁移——旧默认 1200（非用户显式选择）迁移为新默认
 * standard，更大的自定义值（长停顿说话风格）迁移 relaxed，更小值迁移
 * snappy 语义最接近的 standard。迁移后以 profile 为唯一事实源，旧字段
 * 仅为兼容保留的迁移输入，服务与设置 UI 均不再消费它。
 */
function resolveEndpointProfile(
  source: Record<string, unknown>,
): VoiceAssistantSettings['utteranceEndpointProfile'] {
  const explicit = source.utteranceEndpointProfile
  if (explicit === 'relaxed' || explicit === 'standard' || explicit === 'snappy') {
    return explicit
  }
  if (typeof source.utteranceConfirmMs === 'number' && Number.isFinite(source.utteranceConfirmMs)) {
    return source.utteranceConfirmMs > 1200 ? 'relaxed' : 'standard'
  }
  return DEFAULT_VOICE_ASSISTANT_SETTINGS.utteranceEndpointProfile
}

/**
 * 宽容解析持久化设置：任意脏数据（旧版本、手工编辑、缺字段）都收敛为合法值，
 * 缺失字段回落默认值。设置页保存时同样经过本函数归一。
 */
export function normalizeVoiceAssistantSettings(raw: unknown): VoiceAssistantSettings {
  const source = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const wakeWord = VOICE_ASSISTANT_WAKE_WORDS.includes(source.wakeWord as VoiceAssistantWakeWord)
    ? (source.wakeWord as VoiceAssistantWakeWord)
    : DEFAULT_VOICE_ASSISTANT_SETTINGS.wakeWord
  const permissionMode =
    typeof source.sessionPermissionMode === 'string' &&
    source.sessionPermissionMode.length > 0 &&
    source.sessionPermissionMode.length <= 40
      ? (source.sessionPermissionMode as SessionPermissionMode)
      : DEFAULT_VOICE_ASSISTANT_SETTINGS.sessionPermissionMode
  const ttsProviderProfileId =
    typeof source.ttsProviderProfileId === 'string' &&
    source.ttsProviderProfileId.trim().length > 0 &&
    source.ttsProviderProfileId.length <= 200
      ? source.ttsProviderProfileId
      : null
  const ttsModelId =
    typeof source.ttsModelId === 'string' &&
    source.ttsModelId.trim().length > 0 &&
    source.ttsModelId.length <= 300
      ? source.ttsModelId
      : null
  // 云端识别渠道/模型：与 TTS 同款宽容解析；旧版本设置缺字段回落 null（自动选路），
  // 保证升级后云端识别行为与之前完全一致。
  const sttProviderProfileId =
    typeof source.sttProviderProfileId === 'string' &&
    source.sttProviderProfileId.trim().length > 0 &&
    source.sttProviderProfileId.length <= 200
      ? source.sttProviderProfileId
      : null
  const sttModelId =
    typeof source.sttModelId === 'string' &&
    source.sttModelId.trim().length > 0 &&
    source.sttModelId.length <= 300
      ? source.sttModelId
      : null
  const settings: VoiceAssistantSettings = {
    enabled: readBool(source.enabled, DEFAULT_VOICE_ASSISTANT_SETTINGS.enabled),
    wakeShortcut: readString(
      source.wakeShortcut,
      DEFAULT_VOICE_ASSISTANT_SETTINGS.wakeShortcut,
      120,
    ),
    alwaysListening: readBool(
      source.alwaysListening,
      DEFAULT_VOICE_ASSISTANT_SETTINGS.alwaysListening,
    ),
    continuousMode: readBool(
      source.continuousMode,
      DEFAULT_VOICE_ASSISTANT_SETTINGS.continuousMode,
    ),
    wakeWord,
    wakeThreshold: readNumber(
      source.wakeThreshold,
      DEFAULT_VOICE_ASSISTANT_SETTINGS.wakeThreshold,
      0.01,
      0.9,
    ),
    wakeBoost: readNumber(source.wakeBoost, DEFAULT_VOICE_ASSISTANT_SETTINGS.wakeBoost, 0.5, 10),
    recognitionEngine:
      source.recognitionEngine === 'cloud'
        ? 'cloud'
        : DEFAULT_VOICE_ASSISTANT_SETTINGS.recognitionEngine,
    refineTranscript: readBool(
      source.refineTranscript,
      DEFAULT_VOICE_ASSISTANT_SETTINGS.refineTranscript,
    ),
    sttProviderProfileId,
    sttModelId,
    ttsProviderProfileId,
    ttsModelId,
    ttsVoice: typeof source.ttsVoice === 'string' ? source.ttsVoice.slice(0, 200) : '',
    ttsSpeed: readNumber(source.ttsSpeed, DEFAULT_VOICE_ASSISTANT_SETTINGS.ttsSpeed, 0.5, 2.0),
    ttsVol: readNumber(source.ttsVol, DEFAULT_VOICE_ASSISTANT_SETTINGS.ttsVol, 0, 10),
    ttsPitch: readNumber(source.ttsPitch, DEFAULT_VOICE_ASSISTANT_SETTINGS.ttsPitch, -12, 12),
    ttsEmotion: readString(source.ttsEmotion, DEFAULT_VOICE_ASSISTANT_SETTINGS.ttsEmotion, 40),
    sessionPermissionMode: permissionMode,
    voiceSystemPrompt: readBool(
      source.voiceSystemPrompt,
      DEFAULT_VOICE_ASSISTANT_SETTINGS.voiceSystemPrompt,
    ),
    soundCues: readBool(source.soundCues, DEFAULT_VOICE_ASSISTANT_SETTINGS.soundCues),
    utteranceConfirmMs: readNumber(
      source.utteranceConfirmMs,
      DEFAULT_VOICE_ASSISTANT_SETTINGS.utteranceConfirmMs,
      300,
      5000,
    ),
    browserDenoise: readBool(
      source.browserDenoise,
      DEFAULT_VOICE_ASSISTANT_SETTINGS.browserDenoise,
    ),
    voiceFocus:
      source.voiceFocus === 'off' ||
      source.voiceFocus === 'standard' ||
      source.voiceFocus === 'strict'
        ? source.voiceFocus
        : DEFAULT_VOICE_ASSISTANT_SETTINGS.voiceFocus,
    noisePipelineMigrated: readBool(
      source.noisePipelineMigrated,
      DEFAULT_VOICE_ASSISTANT_SETTINGS.noisePipelineMigrated,
    ),
    refineTranscriptMigrated: readBool(
      source.refineTranscriptMigrated,
      DEFAULT_VOICE_ASSISTANT_SETTINGS.refineTranscriptMigrated,
    ),
    sessionThinkingEnabled:
      typeof source.sessionThinkingEnabled === 'boolean'
        ? source.sessionThinkingEnabled
        : // 一次性迁移：旧版「轻量思考」布尔（v1 默认 true=minimal 档）。
          // 显式关闭过轻量思考（= 想跟随 Agent 档位）迁移为思考开关关闭；
          // 其余情况（开启/从未设置）迁移为新默认（开 + minimal）。
          source.lightweightThinking === false
          ? false
          : DEFAULT_VOICE_ASSISTANT_SETTINGS.sessionThinkingEnabled,
    sessionThinkingEffort: VOICE_ASSISTANT_THINKING_EFFORTS.includes(
      source.sessionThinkingEffort as SessionReasoningEffort,
    )
      ? (source.sessionThinkingEffort as SessionReasoningEffort)
      : DEFAULT_VOICE_ASSISTANT_SETTINGS.sessionThinkingEffort,
    fullDuplex: readBool(source.fullDuplex, DEFAULT_VOICE_ASSISTANT_SETTINGS.fullDuplex),
    firstResponseFeedback:
      source.firstResponseFeedback === 'voice' || source.firstResponseFeedback === 'off'
        ? source.firstResponseFeedback
        : source.firstResponseFeedback === 'cue'
          ? 'cue'
          : DEFAULT_VOICE_ASSISTANT_SETTINGS.firstResponseFeedback,
    ttsPrefetch: readBool(source.ttsPrefetch, DEFAULT_VOICE_ASSISTANT_SETTINGS.ttsPrefetch),
    firstSentenceFastCut: readBool(
      source.firstSentenceFastCut,
      DEFAULT_VOICE_ASSISTANT_SETTINGS.firstSentenceFastCut,
    ),
    ttsLocalFallback: readBool(
      source.ttsLocalFallback,
      DEFAULT_VOICE_ASSISTANT_SETTINGS.ttsLocalFallback,
    ),
    utteranceEndpointProfile: resolveEndpointProfile(source),
  }
  // v1→v2 噪音管线一次性迁移：存量设置仍是 v1 默认组合（browserDenoise=true +
  // voiceFocus=standard，均为 v1 发布默认值而非用户显式选择）时回退识别率优先的
  // 新默认。迁移后置标记，由调用方回写持久化；用户已调整过其他组合则只置标记。
  if (!settings.noisePipelineMigrated) {
    if (settings.browserDenoise && settings.voiceFocus === 'standard') {
      settings.browserDenoise = false
      settings.voiceFocus = 'off'
    }
    settings.noisePipelineMigrated = true
  }
  // 识别精修独立迁移：v1 死字段（无 UI 开关）时代持久化的 false 是默认值产物
  // 而非用户选择，首次经过本函数时统一翻回新默认 true；此后显式关闭不再重置。
  if (!settings.refineTranscriptMigrated) {
    if (!settings.refineTranscript) {
      settings.refineTranscript = true
    }
    settings.refineTranscriptMigrated = true
  }
  return settings
}

// ─── voice route 绑定 ────────────────────────────────────────────────────────

/** 语音助手会话绑定（独立 category 存储，语义仿 RemoteRouteBinding） */
export interface VoiceAssistantRouteBinding {
  defaultSessionId?: string
  defaultWorkspaceId?: string
  defaultProviderProfileId?: string
  defaultModelId?: string
  defaultAgentId?: string
  defaultPermissionMode?: SessionPermissionMode
  defaultReasoningEffort?: string
}

export function normalizeVoiceAssistantRouteBinding(raw: unknown): VoiceAssistantRouteBinding {
  const source = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const readOptionalId = (key: string, maxLength: number): string | undefined => {
    const value = source[key]
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined
  }
  const defaultSessionId = readOptionalId('defaultSessionId', 200)
  const defaultWorkspaceId = readOptionalId('defaultWorkspaceId', 200)
  const defaultProviderProfileId = readOptionalId('defaultProviderProfileId', 200)
  const defaultModelId = readOptionalId('defaultModelId', 300)
  const defaultAgentId = readOptionalId('defaultAgentId', 200)
  const defaultPermissionMode = readOptionalId('defaultPermissionMode', 40)
  const defaultReasoningEffort = readOptionalId('defaultReasoningEffort', 40)
  return {
    ...(defaultSessionId != null ? { defaultSessionId } : {}),
    ...(defaultWorkspaceId != null ? { defaultWorkspaceId } : {}),
    ...(defaultProviderProfileId != null ? { defaultProviderProfileId } : {}),
    ...(defaultModelId != null ? { defaultModelId } : {}),
    ...(defaultAgentId != null ? { defaultAgentId } : {}),
    ...(defaultPermissionMode != null
      ? { defaultPermissionMode: defaultPermissionMode as SessionPermissionMode }
      : {}),
    ...(defaultReasoningEffort != null ? { defaultReasoningEffort } : {}),
  }
}

// ─── 状态机 ──────────────────────────────────────────────────────────────────

export type VoiceAssistantState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  /** M2：常驻聆听中（KWS 待命，尚未命中） */
  | 'standby'

export interface VoiceAssistantStatus {
  state: VoiceAssistantState
  /** 当前 ASR 会话 id（listening 时有值） */
  captureSessionId: string | null
  /**
   * 渲染端麦克风是否真正就绪（capture-started 已上报且对应当前会话）。
   * false = 采集管道仍在建立，HUD 应显示「正在准备麦克风…」、唤醒提示音尚未播；
   * 可选字段：旧版本负载缺失时按已就绪处理（向后兼容）。
   */
  captureReady?: boolean
  /** listening 实时 partial（HUD 展示） */
  partialText: string
  /** speaking 时已播/待播句子计数 */
  speakingProgress: { played: number; pending: number } | null
  lastError: string | null
  /** 当前绑定会话 id（可能为 null = 尚未创建） */
  boundSessionId: string | null
  /** 全双工对话窗口是否在线（思考/播报期间采集+ASR 常开中；HUD 迷你麦显示条件） */
  duplexActive: boolean
  /** thinking/speaking 期捕获的排队输入（FIFO；HUD 队列框数据源，展示最新条） */
  queuedInputs: Array<{ id: string; text: string; capturedState: string; createdAt: number }>
  /** 确认窗口中的插话草稿（停顿确认中，尚未正式入队；HUD 队列框弱态数据源） */
  queueDraft: { text: string } | null
}

/** 状态迁移事件（stream 主→渲染），HUD 与调试依据 */
export interface VoiceAssistantStateEvent {
  state: VoiceAssistantState
  previous: VoiceAssistantState
  /** 触发原因：wake=唤醒 timeout=听超时 empty=转写为空 cancelled=打断 error=错误 completed=轮次完成 standby-on/standby-off=常驻开关 confirm=说完确认窗口期 queue-dispatch=队列自动派发 preempt=立即发送抢占 takeover-live=graceful 接管完成（新代首句开播，冲掉渲染端挂着的 queue-dispatch 衔接态） */
  reason:
    | 'wake'
    | 'timeout'
    | 'empty'
    | 'cancelled'
    | 'error'
    | 'completed'
    | 'standby-on'
    | 'standby-off'
    | 'command'
    | 'manual'
    | 'confirm'
    | 'queue-dispatch'
    | 'preempt'
    | 'takeover-live'
  /** listening 时的实时 partial / 错误信息等附加文本 */
  detail?: string
}

/**
 * 会话聚焦事件（stream 主→渲染）：语音活动发生时通知 UI 跳转到语音绑定会话，
 * 对齐命令面板切会话的行为（选中 + 侧栏定位）。渲染端据此调用 setActiveSession。
 */
export interface VoiceAssistantSessionFocusEvent {
  /** 语音绑定的会话 id */
  sessionId: string
  /**
   * 触发时机：
   * wake=唤醒进入聆听（绑定已存在时的预跳） turn=轮次提交
   * command-new/command-switch/command-workspace=语音命令改绑后
   */
  cause: 'wake' | 'turn' | 'command-new' | 'command-switch' | 'command-workspace'
}

// ─── 采集指令（stream 主→渲染） ─────────────────────────────────────────────

export interface VoiceAssistantCaptureCommand {
  action: 'start' | 'stop'
  /** 渲染端推流 chunk 需携带的 sessionId（主进程生成并校验归属） */
  sessionId: string
  /**
   * dialogue = M1 对话采集（起停由主进程指令驱动）
   * kws = M2 常驻采集（持续推流，主进程本地 KWS 检测）
   */
  mode: 'dialogue' | 'kws'
  /**
   * 浏览器级音频处理（dialogue 且设置 browserDenoise 开启时下发）：
   * 降噪 + 人声隔离在采集源头上压制稳态噪音与远场串音。
   * kws 常驻采集不下发（保持与唤醒词检测一致的原始灵敏度假设）。
   */
  audioProcessing?: {
    noiseSuppression: boolean
    voiceIsolation: boolean
    /** 全双工：显式要求浏览器回声消除（渲染端仍用 ideal 软约束防 OverconstrainedError，
     *  实际生效值经 capture-started 事件回传探测） */
    echoCancellation?: boolean
  }
  /**
   * 字头保护（pre-roll 回放）：true 时渲染端在建立/复用对话采集前，先把 KWS
   * 常驻采集期间缓存的最近约 2.5s 音频作为首批 chunk 回放给主进程，覆盖
   * 「唤醒词刚说完就接正文」的切换空窗，防止首句字头丢失。
   * 仅 standby→对话首次进入时置 true；全双工轮间续听不发 start 指令，
   * 天然不会回放（避免把 TTS 尾音回声喂进 ASR）。旧渲染端忽略该字段。
   */
  replayPreRoll?: boolean
}

// ─── TTS 播放指令（stream 主→渲染） ────────────────────────────────────────

export interface VoiceAssistantPlayPayload {
  kind: 'play'
  sentenceId: string
  /** 单调递增序号，渲染端按序无缝播放 */
  sequence: number
  /** 本地音频文件绝对路径（渲染端经 safe-file:// 协议读取） */
  filePath: string
}

export type VoiceAssistantPlayCommand =
  | VoiceAssistantPlayPayload
  /** 停止当前播放并清空播放队列（打断）。fadeMs=淡出时长（立即发送抢占≈120ms，
   *  缺省硬切）；graceful=true=当前句自然播完、余句清空（边播边处理让位新首句） */
  | { kind: 'stop'; fadeMs?: number; graceful?: boolean }
  /** 本地合成提示音（唤醒/失效/错误/提交确认，非 TTS 文件） */
  | { kind: 'cue'; cue: 'wake' | 'fail' | 'error' | 'ack' }

// ─── 渲染端反馈（fire-and-forget，渲染→主） ─────────────────────────────────

export const VOICE_ASSISTANT_RENDERER_EVENT_CHANNEL = 'voice-assistant:renderer-event'

export type VoiceAssistantRendererEvent =
  | {
      type: 'capture-started'
      sessionId: string
      /** AEC 实际生效值（track.getSettings().echoCancellation；全双工回声治理层 1 探测） */
      echoCancellationEffective?: boolean
    }
  | { type: 'capture-stopped'; sessionId: string }
  | { type: 'capture-failed'; sessionId?: string; message: string }
  | { type: 'playback-started'; sentenceId: string }
  | { type: 'playback-ended'; sentenceId: string }
  | { type: 'playback-error'; sentenceId: string; message?: string }

export function isVoiceAssistantRendererEvent(
  value: unknown,
): value is VoiceAssistantRendererEvent {
  if (value == null || typeof value !== 'object') return false
  const candidate = value as {
    type?: unknown
    sessionId?: unknown
    sentenceId?: unknown
    echoCancellationEffective?: unknown
  }
  switch (candidate.type) {
    case 'capture-started':
      return (
        typeof candidate.sessionId === 'string' &&
        candidate.sessionId.length <= 200 &&
        (candidate.echoCancellationEffective == null ||
          typeof candidate.echoCancellationEffective === 'boolean')
      )
    case 'capture-stopped':
      return typeof candidate.sessionId === 'string' && candidate.sessionId.length <= 200
    case 'capture-failed':
      return (
        (candidate.sessionId == null || typeof candidate.sessionId === 'string') &&
        typeof (value as { message?: unknown }).message === 'string'
      )
    case 'playback-started':
    case 'playback-ended':
    case 'playback-error':
      return typeof candidate.sentenceId === 'string' && candidate.sentenceId.length <= 200
    default:
      return false
  }
}

// ─── 音频 chunk 路由（复用 voice:feed-audio 通道） ──────────────────────────

/**
 * VoiceRecognitionService 的「内部会话」ownerId：语音助手由主进程直接调用
 * startVoiceSession/stopVoiceSession，识别事件经内部桥接回调消费而非推 webContents。
 * registerVoiceIpc 的事件分发器按该值路由。
 */
export const VOICE_ASSISTANT_INTERNAL_OWNER_ID = -1

/** 会话聚焦事件通道（主→渲染，UI 跟随语音会话跳转） */
export const VOICE_ASSISTANT_SESSION_FOCUS_CHANNEL = 'stream:voice-assistant:session-focus'

/** 对话模式采集 sessionId 前缀（主进程生成，渲染端只透传） */
export const VOICE_ASSISTANT_DIALOGUE_SESSION_PREFIX = 'voice-assistant:dialogue:'
/** M2 常驻 KWS 采集 sessionId（固定值） */
export const VOICE_ASSISTANT_KWS_SESSION_ID = 'voice-assistant:kws'

export function isVoiceAssistantCaptureSessionId(sessionId: string): boolean {
  return (
    sessionId.startsWith(VOICE_ASSISTANT_DIALOGUE_SESSION_PREFIX) ||
    sessionId === VOICE_ASSISTANT_KWS_SESSION_ID
  )
}

// ─── invoke 通道载荷 ─────────────────────────────────────────────────────────

export interface VoiceAssistantGetSettingsRequest extends Record<string, never> {}

export interface VoiceAssistantGetSettingsResponse {
  settings: VoiceAssistantSettings
  /**
   * 语音会话当前解析到的 Agent 适配器信息（绑定 Agent 优先，缺省走默认 Agent）：
   * 设置页按适配器展示对应的权限模式与推理档位选项；解析失败为 null（UI 回落 claude 选项）。
   */
  sessionAgent: VoiceAssistantSessionAgentInfo | null
}

export interface VoiceAssistantUpdateSettingsRequest {
  settings: VoiceAssistantSettings
}

export interface VoiceAssistantUpdateSettingsResponse {
  settings: VoiceAssistantSettings
}

export interface VoiceAssistantGetStatusRequest extends Record<string, never> {}

export interface VoiceAssistantGetStatusResponse {
  status: VoiceAssistantStatus
}

/** 手动触发唤醒（HUD 按钮/设置页试一试） */
export interface VoiceAssistantTriggerRequest extends Record<string, never> {}

export interface VoiceAssistantTriggerResponse {
  ok: boolean
  message: string
}

/** 手动打断（HUD 按钮；与快捷键打断等价） */
export interface VoiceAssistantInterruptRequest extends Record<string, never> {}

export interface VoiceAssistantInterruptResponse {
  ok: boolean
  message: string
}

/** 解绑当前语音会话（下次唤醒将新建会话） */
export interface VoiceAssistantResetRouteRequest extends Record<string, never> {}

export interface VoiceAssistantResetRouteResponse {
  ok: boolean
  message: string
}

/**
 * 立即发送（抢占）：中止当前轮次与播报（TTS 淡出），立即提交指定排队输入。
 * id 缺省 = 队首（HUD 队列框「立即发送」按钮指向最新展示条）。
 */
export interface VoiceAssistantDispatchQueuedRequest {
  id?: string
}

export interface VoiceAssistantDispatchQueuedResponse {
  ok: boolean
  message: string
}

/** 放弃排队输入：移除指定条目（HUD 队列框「放弃」按钮，仅移除当前展示条） */
export interface VoiceAssistantDiscardQueuedRequest {
  id: string
}

export interface VoiceAssistantDiscardQueuedResponse {
  ok: boolean
  message: string
}

// ─── 消息语音播报（会话消息底部按钮，复用语音助手 TTS 渠道/模型/音色设置） ───

/**
 * 消息语音播报：合成一句话为音频文件。
 * 渲染端把播报正文清洗切句后逐句调用（边合边播），文件落在语音助手 TTS 目录
 * （safe-file 白名单内），播完后由渲染端调用 tts-cleanup 删除。
 */
export interface VoiceAssistantTtsSynthesizeRequest {
  /** 单句朗读文本（调用方已做 speechify 清洗；主进程再兜底限长防滥用） */
  text: string
}

export interface VoiceAssistantTtsSynthesizeResponse {
  /** 本地音频文件绝对路径（渲染端经 safe-file:// 协议读取；缓存命中时为缓存文件） */
  filePath: string
  /**
   * 文件是否由 TTS 磁盘缓存接管（本轮命中缓存，或刚合成成功并移入缓存）：
   * 接管时文件生命周期归主进程 LRU 管理，渲染端不得登记在途、不得清理；
   * false 时为临时产物，播完需清理。命中与新鲜合成只差「本轮是否请求了
   * 渠道」，该区分仅体现在主进程日志（tts cache hit / tts synthesized）。
   */
  cached: boolean
}

/** 消息语音播报：删除合成产物。filePath 必须位于语音助手 TTS 目录内，否则拒绝。 */
export interface VoiceAssistantTtsCleanupRequest {
  filePath: string
}

export interface VoiceAssistantTtsCleanupResponse {
  ok: boolean
}
