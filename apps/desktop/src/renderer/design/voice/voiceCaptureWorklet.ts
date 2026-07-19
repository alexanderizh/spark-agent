/**
 * 语音采集 AudioWorklet 处理器
 *
 * 处理器运行在 AudioWorkletGlobalScope（独立线程，无 DOM/主线程 API）：
 *   - 输入：AudioContext 原生采样率（通常 44.1k/48k）的 Float32 [-1,1] 块
 *   - 输出：16kHz 单声道 16-bit PCM（Int16Array），每 ~100ms（1600 样本）post 一次
 *
 * 采用线性插值降采样，保留跨 process() 调用的分数读指针与尾部样本，避免相位抖动。
 *
 * 以 Blob URL 形式加载（而非 Vite 静态资源），确保不依赖打包器对 AudioWorklet 的特殊处理，
 * 在 Electron 渲染进程里行为可预期。
 */

const WORKLET_SOURCE = `
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.targetRate = 16000
    this.ratio = sampleRate / this.targetRate
    this.pos = 0           // 输入缓冲区中的分数读指针
    this.tail = new Float32Array(0)  // 上次未消费完的尾部样本
    this.emitN = 1600      // 累计到 1600 样本（~100ms @16k）post 一次
    this.out = []          // 降采样后的 Int16 暂存
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const ch = input[0]
    if (!ch || ch.length === 0) return true

    // 合并上次尾部 + 本次输入
    const merged = new Float32Array(this.tail.length + ch.length)
    merged.set(this.tail)
    merged.set(ch, this.tail.length)

    // 线性插值降采样
    while (this.pos + 1 < merged.length) {
      const i0 = this.pos | 0
      const frac = this.pos - i0
      const s = merged[i0] * (1 - frac) + merged[i0 + 1] * frac
      let v = s < 0 ? s * 0x8000 : s * 0x7fff
      if (v < -32768) v = -32768
      else if (v > 32767) v = 32767
      this.out.push(v | 0)
      this.pos += this.ratio
    }

    // 保留未消费尾部，调整读指针到尾部坐标系
    const consumed = this.pos | 0
    this.tail = merged.slice(consumed)
    this.pos -= consumed

    // 攒够一帧就 post
    while (this.out.length >= this.emitN) {
      const chunk = this.out.splice(0, this.emitN)
      this.port.postMessage(new Int16Array(chunk))
    }
    return true
  }
}

registerProcessor('voice-capture-processor', VoiceCaptureProcessor)
`

let cachedUrl: string | null = null

/**
 * 取 worklet 模块 URL（首次调用创建 Blob URL，后续复用）。
 * URL 在进程生命周期内常驻，不主动 revoke（worklet 加载是异步的，提前 revoke 有风险）。
 */
export function getVoiceWorkletUrl(): string {
  if (cachedUrl) return cachedUrl
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
  cachedUrl = URL.createObjectURL(blob)
  return cachedUrl
}

export const VOICE_WORKLET_PROCESSOR_NAME = 'voice-capture-processor'
