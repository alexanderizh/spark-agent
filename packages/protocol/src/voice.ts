/**
 * 语音输入（ASR）协议类型
 *
 * 基于 sherpa-onnx (OnlineRecognizer + Paraformer-streaming + silero-vad) 做离线流式
 * 语音识别：渲染进程 AudioWorklet 采集 16kHz/16bit PCM -> IPC 流式 chunk -> 主进程
 * OnlineRecognizer 增量解码 -> partial(整体替换)/final(追加) 文本回填到输入框。
 *
 * native 模块与模型文件均通过 MinIO 自建源按需下载到 userData，不打进 asar。
 *
 * 混合识别（方案A）：录音期间流式 partial/final 实时预览，主进程同时缓存整段 PCM；
 * 停止后若已安装离线精修模型（SenseVoice），对整段音频重新识别并以 refined 事件
 * 推送整段文本，由 UI 替换流式结果，显著提升准确率并补齐标点。
 */

// ─── 完整性 ─────────────────────────────────────────────────────────────────

/**
 * 语音包组件：跨平台 native 推理模块 + 流式识别模型 + 可选离线精修模型。
 * refine 为可选增强（说完后整段重识别替换流式结果），缺失时语音输入回退纯流式，不影响 ready。
 */
export type VoicePackComponent = 'native' | 'model' | 'refine'

export type VoicePackState = 'missing' | 'downloading' | 'ready' | 'error'

/** 单个语音包组件（native 模块 / 模型文件）的就绪状态 */
export interface VoiceComponentStatus {
  component: VoicePackComponent
  state: VoicePackState
  /** 已安装版本（ready 时有值） */
  installedVersion: string | null
  /** 云端最新版本（checkLatest 后才有） */
  latestVersion: string | null
  /** 对应的 manifest artifactId */
  artifactId: string | null
  /** 下载进度百分比（downloading 时 0-100，其余 null） */
  percent: number | null
  message: string | null
}

export interface VoiceIntegrityStatus {
  /** 整体就绪：native 与 model 均 ready 才为 true */
  ready: boolean
  /** 当前是否正在下载任一组件 */
  downloading: boolean
  /** 当前平台是否支持（sherpa-onnx-node 是否有对应 prebuilt） */
  supported: boolean
  /** supported=false 时的原因 */
  unsupportedReason: string | null
  components: VoiceComponentStatus[]
  /** 最近一次错误（整体） */
  lastError: string | null
}

export interface VoiceIntegrityCheckRequest {
  /** 是否同时查询云端最新版本 */
  checkLatest?: boolean
}

export interface VoiceIntegrityCheckResponse {
  status: VoiceIntegrityStatus
}

export interface VoiceInstallRequest {
  /** 强制重新下载（即使已就绪） */
  force?: boolean
}

export interface VoiceInstallResponse {
  success: boolean
  message: string
  status: VoiceIntegrityStatus
}

// ─── 麦克风权限 ─────────────────────────────────────────────────────────────

export type VoiceMicrophonePermissionStatus =
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unknown'

export type VoiceMicrophonePermissionRequest = Record<string, never>

export interface VoiceMicrophonePermissionResponse {
  /** 是否可以继续调用 getUserMedia；unknown 在 Linux 等平台上交由 Chromium 判断。 */
  granted: boolean
  status: VoiceMicrophonePermissionStatus
  /** denied/restricted 时面向用户的处理建议。 */
  message: string | null
}

/** 单个组件的安装进度（与 SdkIntegrityInstallProgress 同构，额外标注 component） */
export interface VoiceInstallProgress {
  /** 当前正在安装的组件 */
  component: VoicePackComponent
  state: 'preparing' | 'downloading' | 'verifying' | 'activating' | 'done' | 'error'
  downloaded: number
  total: number
  percent: number | null
  message: string
  artifactId?: string
  version?: string
}

// ─── 识别 ───────────────────────────────────────────────────────────────────

export type VoiceLanguage = 'auto' | 'zh' | 'en' | 'yue'

export interface VoiceStartRequest {
  /** 采样率，渲染进程 AudioWorklet 固定 16000 */
  sampleRate?: number
  /** 语种提示，缺省 auto 自动识别 */
  language?: VoiceLanguage
  /** 是否启用 VAD 端点检测（句尾静音自动切段，默认 true） */
  enableVad?: boolean
  /** VAD 句尾静音阈值（ms），缺省 800 */
  vadSilenceMs?: number
}

export interface VoiceStartResponse {
  success: boolean
  message: string
  /** 本次识别会话 id，用于关联后续音频 chunk 与识别事件 */
  sessionId: string | null
}

export interface VoiceStopRequest {
  sessionId?: string
}

export interface VoiceStopResponse {
  success: boolean
  message: string
  /**
   * true 表示主进程在停止流式识别后，正在用离线模型对整段音频重新识别。
   * 渲染端应保持事件订阅等待 refined + session-stopped，再完成收尾。
   */
  refining?: boolean
}

export type VoiceRecognitionEventType =
  | 'session-started'
  | 'partial'
  | 'final'
  | 'refined'
  | 'session-stopped'
  | 'error'

export interface VoiceRecognitionEvent {
  type: VoiceRecognitionEventType
  sessionId: string
  /**
   * partial: 当前句的实时识别结果（整体替换上一帧 partial，非追加）
   * final: VAD 句尾锁定后的完整句（由 UI 追加到已确认区）
   * refined: 离线精修后的整段文本（由 UI 整体替换本次会话流式写入的内容）
   * session-started / session-stopped / error: 空字符串
   */
  text?: string
  /** type==='error' 时的错误信息 */
  message?: string
}

// ─── 音频 chunk 通道（渲染 -> 主进程，高频流式，不走 invoke/response）──────────

/**
 * 渲染进程通过 ipcRenderer.send(VOICE_AUDIO_CHUNK_CHANNEL, payload) 推送 PCM chunk。
 * 该通道为 fire-and-forget，不进入 IpcChannelMap（非 invoke 语义）。
 */
export const VOICE_AUDIO_CHUNK_CHANNEL = 'voice:feed-audio'
/** Worklet 正常每帧 1600 samples；保留一倍余量并拒绝异常超大 IPC payload。 */
export const VOICE_AUDIO_CHUNK_MAX_SAMPLES = 3200

export interface VoiceAudioChunkPayload {
  sessionId: string
  /** 16kHz 单声道 16-bit PCM，little-endian */
  samples: Int16Array
}

export function isVoiceAudioChunkPayload(payload: unknown): payload is VoiceAudioChunkPayload {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Partial<VoiceAudioChunkPayload>
  return (
    typeof candidate.sessionId === 'string' &&
    /^voice-\d+-\d+$/.test(candidate.sessionId) &&
    candidate.sessionId.length <= 120 &&
    candidate.samples instanceof Int16Array &&
    candidate.samples.length > 0 &&
    candidate.samples.length <= VOICE_AUDIO_CHUNK_MAX_SAMPLES
  )
}
