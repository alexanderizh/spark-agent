/**
 * AudioWorklet global script. Keep this file as plain JavaScript in the Vite renderer publicDir (apps/desktop/public):
 * electron-vite copies it as a same-origin asset allowed by `script-src 'self'`.
 */
/* global AudioWorkletProcessor, sampleRate, registerProcessor */

// 4 阶 Butterworth 低通（两个 RBJ biquad 级联）。
// 48kHz→16kHz 抽取前先滤掉 8kHz 以上成分，避免风扇等高频噪声折叠进语音频带。
class AntiAliasLowpass {
  constructor(cutoffHz, rate) {
    this.stages = []
    for (let i = 0; i < 2; i += 1) {
      const w0 = (2 * Math.PI * cutoffHz) / rate
      const cosw0 = Math.cos(w0)
      const alpha = Math.sin(w0) / (2 * Math.SQRT1_2) // Q = 1/sqrt(2)
      const a0 = 1 + alpha
      this.stages.push({
        b0: (1 - cosw0) / 2 / a0,
        b1: (1 - cosw0) / a0,
        b2: (1 - cosw0) / 2 / a0,
        a1: (-2 * cosw0) / a0,
        a2: (1 - alpha) / a0,
        x1: 0,
        x2: 0,
        y1: 0,
        y2: 0,
      })
    }
  }

  process(x) {
    let value = x
    for (const s of this.stages) {
      const y = s.b0 * value + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2
      s.x2 = s.x1
      s.x1 = value
      s.y2 = s.y1
      s.y1 = y
      value = y
    }
    return value
  }
}

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.targetRate = 16000
    this.ratio = sampleRate / this.targetRate
    this.pos = 0
    // tail 保存的是低通滤波后的样本，滤波器状态跨块连续
    this.tail = new Float32Array(0)
    this.lp = new Float32Array(0)
    const nyquist = this.targetRate / 2
    this.antiAlias = new AntiAliasLowpass(Math.min(7200, nyquist - 400), sampleRate)
    this.emitN = 1600
    this.out = new Int16Array(this.emitN)
    this.outLength = 0
    this.energy = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const ch = input[0]
    if (!ch || ch.length === 0) return true

    if (this.lp.length < ch.length) this.lp = new Float32Array(ch.length)
    for (let i = 0; i < ch.length; i += 1) {
      this.lp[i] = this.antiAlias.process(ch[i])
    }

    const merged = new Float32Array(this.tail.length + ch.length)
    merged.set(this.tail)
    merged.set(this.lp.subarray(0, ch.length), this.tail.length)

    while (this.pos + 1 < merged.length) {
      const i0 = this.pos | 0
      const frac = this.pos - i0
      const sample = merged[i0] * (1 - frac) + merged[i0 + 1] * frac
      let value = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      if (value < -32768) value = -32768
      else if (value > 32767) value = 32767
      const pcm = value | 0
      this.out[this.outLength] = pcm
      this.outLength += 1
      const normalized = pcm / 32768
      this.energy += normalized * normalized
      this.pos += this.ratio

      if (this.outLength === this.emitN) {
        const samples = this.out
        const rms = Math.sqrt(this.energy / this.emitN)
        // 提升人声可视动态，安静环境保持接近 0，正常说话大多落在 0.25~0.9。
        const level = Math.min(1, Math.pow(rms * 3.6, 0.72))
        this.port.postMessage({ samples, level }, [samples.buffer])
        this.out = new Int16Array(this.emitN)
        this.outLength = 0
        this.energy = 0
      }
    }

    // Retain the final filtered sample for interpolation with the next 128-sample block.
    const consumed = Math.min(this.pos | 0, merged.length - 1)
    this.tail = merged.slice(consumed)
    this.pos -= consumed

    return true
  }
}

registerProcessor('voice-capture-processor', VoiceCaptureProcessor)
