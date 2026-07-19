/**
 * 语音输入（ASR）协议类型
 *
 * 基于 sherpa-onnx (OnlineRecognizer + Paraformer-streaming + silero-vad) 做离线流式
 * 语音识别：渲染进程 AudioWorklet 采集 16kHz/16bit PCM -> IPC 流式 chunk -> 主进程
 * OnlineRecognizer 增量解码 -> partial(整体替换)/final(追加) 文本回填到输入框。
 *
 * native 模块与模型文件均通过 MinIO 自建源按需下载到 userData，不打进 asar。
 */

// ─── 完整性 ─────────────────────────────────────────────────────────────────

/** 语音包由两个独立组件构成：跨平台 native 推理模块 + 跨平台模型文件 */
export type VoicePackComponent = 'native' | 'model'

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
  /** VAD 句尾静音阈值（ms），缺省 600 */
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
}

export type VoiceRecognitionEventType =
  | 'session-started'
  | 'partial'
  | 'final'
  | 'session-stopped'
  | 'error'

export interface VoiceRecognitionEvent {
  type: VoiceRecognitionEventType
  sessionId: string
  /**
   * partial: 当前句的实时识别结果（整体替换上一帧 partial，非追加）
   * final: VAD 句尾锁定后的完整句（由 UI 追加到已确认区）
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

export interface VoiceAudioChunkPayload {
  sessionId: string
  /** 16kHz 单声道 16-bit PCM，little-endian */
  samples: Int16Array
}
