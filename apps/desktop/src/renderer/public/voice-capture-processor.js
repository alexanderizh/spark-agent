/**
 * AudioWorklet global script. Keep this file as plain JavaScript and in renderer/public:
 * electron-vite copies it as a same-origin asset allowed by `script-src 'self'`.
 */
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.targetRate = 16000
    this.ratio = sampleRate / this.targetRate
    this.pos = 0
    this.tail = new Float32Array(0)
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

    const merged = new Float32Array(this.tail.length + ch.length)
    merged.set(this.tail)
    merged.set(ch, this.tail.length)

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

    // Retain the final sample for interpolation with the next 128-sample block.
    const consumed = Math.min(this.pos | 0, merged.length - 1)
    this.tail = merged.slice(consumed)
    this.pos -= consumed

    return true
  }
}

registerProcessor('voice-capture-processor', VoiceCaptureProcessor)
