/**
 * 语音采集 AudioWorklet 的同源资源 URL。
 *
 * 不使用 Blob URL：应用 CSP 为 `script-src 'self'`，Chromium 会把被 CSP 拦截的
 * audioWorklet.addModule(blobUrl) 报成误导性的 AbortError。
 */
export function getVoiceWorkletUrl(): string {
  return new URL('./voice-capture-processor.js', window.location.href).href
}

export const VOICE_WORKLET_PROCESSOR_NAME = 'voice-capture-processor'

export interface VoiceWorkletChunk {
  samples: Int16Array
  /** 0~1 的归一化 RMS 音量，只用于录音态波形展示。 */
  level: number
}
