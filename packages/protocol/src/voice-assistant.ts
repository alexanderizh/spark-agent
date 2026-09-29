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

import type { SessionPermissionMode } from './ipc/index.js'

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
  /** 停止后离线精修（SenseVoice，延迟换准确率，默认关） */
  refineTranscript: boolean
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
   * 浏览器级降噪（默认开）：采集时开启 Chromium 降噪与人声隔离（voiceIsolation），
   * 过滤风扇/空调/键盘等稳态噪音。旧语音输入保持原始人声（字头轻辅音更准），
   * 语音助手是远场对话场景，优先保噪音免疫。
   */
  browserDenoise: boolean
  /**
   * 人声聚焦（默认 standard）：主进程双层门控，尽量只保留用户本人的近场人声——
   * 能量层按自适应底噪门限把远场低能量音频静音（近场优先），silero 层校验
   * final 的人声覆盖率丢弃噪音硬解的句子。off = 关闭（门控与校验都不做）。
   */
  voiceFocus: 'off' | 'standard' | 'strict'
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
  refineTranscript: false,
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
  browserDenoise: true,
  voiceFocus: 'standard',
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
  return {
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
    ttsProviderProfileId,
    ttsModelId,
    ttsVoice: typeof source.ttsVoice === 'string' ? source.ttsVoice.slice(0, 200) : '',
    ttsSpeed: readNumber(source.ttsSpeed, DEFAULT_VOICE_ASSISTANT_SETTINGS.ttsSpeed, 0.5, 2.0),
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
      source.voiceFocus === 'off' || source.voiceFocus === 'strict'
        ? source.voiceFocus
        : DEFAULT_VOICE_ASSISTANT_SETTINGS.voiceFocus,
  }
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
  /** listening 实时 partial（HUD 展示） */
  partialText: string
  /** speaking 时已播/待播句子计数 */
  speakingProgress: { played: number; pending: number } | null
  lastError: string | null
  /** 当前绑定会话 id（可能为 null = 尚未创建） */
  boundSessionId: string | null
}

/** 状态迁移事件（stream 主→渲染），HUD 与调试依据 */
export interface VoiceAssistantStateEvent {
  state: VoiceAssistantState
  previous: VoiceAssistantState
  /** 触发原因：wake=唤醒 timeout=听超时 empty=转写为空 cancelled=打断 error=错误 completed=轮次完成 standby-on/standby-off=常驻开关 confirm=说完确认窗口期 */
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
  /** listening 时的实时 partial / 错误信息等附加文本 */
  detail?: string
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
  }
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
  /** 停止当前播放并清空播放队列（打断） */
  | { kind: 'stop' }
  /** 本地合成提示音（唤醒/失效/错误，非 TTS 文件） */
  | { kind: 'cue'; cue: 'wake' | 'fail' | 'error' }

// ─── 渲染端反馈（fire-and-forget，渲染→主） ─────────────────────────────────

export const VOICE_ASSISTANT_RENDERER_EVENT_CHANNEL = 'voice-assistant:renderer-event'

export type VoiceAssistantRendererEvent =
  | { type: 'capture-started'; sessionId: string }
  | { type: 'capture-stopped'; sessionId: string }
  | { type: 'capture-failed'; sessionId?: string; message: string }
  | { type: 'playback-started'; sentenceId: string }
  | { type: 'playback-ended'; sentenceId: string }
  | { type: 'playback-error'; sentenceId: string; message?: string }

export function isVoiceAssistantRendererEvent(
  value: unknown,
): value is VoiceAssistantRendererEvent {
  if (value == null || typeof value !== 'object') return false
  const candidate = value as { type?: unknown; sessionId?: unknown; sentenceId?: unknown }
  switch (candidate.type) {
    case 'capture-started':
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
