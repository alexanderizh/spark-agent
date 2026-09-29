/**
 * VoiceNoiseGate 单元测试
 *
 * 覆盖：
 * 1. 能量层：预热期不激活 / 静音置零 / 高能量放行 / hangover 尾音保持 /
 *    底噪自适应（高底噪环境门限随之上抬）
 * 2. speech-activity 回调：active 翻转时机
 * 3. silero 确认层（mock Vad）：段 drain 进时间轴 / coverageRatio 区间计算 /
 *    shouldAcceptFinal 档位阈值 / reset 隔离
 * 4. 降级：disableSilero 时 coverage 恒 1（不拦截）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setVadModuleForTests, VoiceNoiseGate } from './VoiceNoiseGate'

// ─── 测试音频构造 ────────────────────────────────────────────────────────────

const CHUNK = 1600 // 100ms @16k

function silence(): Int16Array {
  return new Int16Array(CHUNK)
}

function tone(amplitude: number): Int16Array {
  const out = new Int16Array(CHUNK)
  for (let i = 0; i < CHUNK; i += 1) {
    out[i] = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * 220 * i) / 16000))
  }
  return out
}

function isAllZero(samples: Int16Array): boolean {
  return samples.every((v) => v === 0)
}

/** 3 个预热 chunk（静音），进入稳态判定阶段 */
function warmUp(gate: VoiceNoiseGate): void {
  for (let i = 0; i < 3; i += 1) gate.process(silence())
}

// ─── silero mock ─────────────────────────────────────────────────────────────

interface MockSpan {
  start: number
  samples: Float32Array
}

class MockVad {
  static instances: MockVad[] = []
  segments: MockSpan[] = []

  constructor() {
    MockVad.instances.push(this)
  }

  acceptWaveform(): void {
    // 段由测试通过 emitSegment 显式注入
  }

  isEmpty(): boolean {
    return this.segments.length === 0
  }

  front(): MockSpan {
    return this.segments[0] as MockSpan
  }

  pop(): void {
    this.segments.shift()
  }

  reset(): void {
    this.segments = []
  }

  flush(): void {
    // 段已在队列中，drain 由调用方触发
  }

  emitSegment(start: number, lengthSamples: number): void {
    this.segments.push({ start, samples: new Float32Array(lengthSamples) })
  }
}

beforeEach(() => {
  MockVad.instances = []
  setVadModuleForTests({
    Vad: MockVad as unknown as new (config: unknown, bufferSeconds: number) => MockVad,
  })
})

describe('能量层门控', () => {
  it('预热期不激活：输出置零且不触发 speech-activity', () => {
    const activities: boolean[] = []
    const gate = new VoiceNoiseGate({
      mode: 'standard',
      onSpeechActivity: (active) => activities.push(active),
    })
    gate.reset()
    // 预热期喂高能量也不激活（防唤醒提示音残留误判）
    const out = gate.process(tone(0.5))
    expect(isAllZero(out)).toBe(true)
    expect(activities).toEqual([])
  })

  it('高能量人声放行 + 静音置零（长度不变）', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard', disableSilero: true })
    gate.reset()
    warmUp(gate)
    const speech = tone(0.5)
    const outSpeech = gate.process(speech)
    expect(outSpeech.length).toBe(CHUNK)
    expect(isAllZero(outSpeech)).toBe(false)
    const outSilence = gate.process(silence())
    // 静音本身即全零，验证的是长度与不抛错
    expect(outSilence.length).toBe(CHUNK)
  })

  it('hangover：语音结束后短窗口内低能量仍放行（防字尾轻音被切）', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard', disableSilero: true })
    gate.reset()
    warmUp(gate)
    gate.process(tone(0.5))
    const faint = tone(0.002) // 远低于门限的尾音
    // hangover 3 chunk 内放行（非全零）
    expect(isAllZero(gate.process(faint))).toBe(false)
    expect(isAllZero(gate.process(faint))).toBe(false)
    expect(isAllZero(gate.process(faint))).toBe(false)
    // 第 4 chunk 起门控生效（置零）
    expect(isAllZero(gate.process(faint))).toBe(true)
  })

  it('底噪自适应：预热于真实底噪的门限压住同强度噪音，人声放行', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard', disableSilero: true })
    gate.reset()
    // 预热期直接暴露在环境底噪中（唤醒时环境已有电视声，amp 0.02 ≈ -38dB）
    const ambient = tone(0.02)
    for (let i = 0; i < 3; i += 1) gate.process(ambient)
    // 预热后同强度音频被判为底噪（置零）
    expect(isAllZero(gate.process(ambient))).toBe(true)
    // 显著更强的近场人声仍放行
    expect(isAllZero(gate.process(tone(0.5)))).toBe(false)
  })

  it('持续噪音自愈：安静预热后环境变吵，8s 重校准后门控恢复', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard', disableSilero: true })
    gate.reset()
    warmUp(gate) // 安静环境唤醒
    const ambient = tone(0.02)
    // 前 8s：门限还停在安静基线，噪音全放行（宁可放行不误杀）。
    // 第 80 个 chunk 触发重校准（重校准发生在本 chunk 判定之后，本 chunk 仍放行）；
    // 随后还有 3 个 chunk 的尾音保持窗口
    for (let i = 0; i < 83; i += 1) {
      expect(isAllZero(gate.process(ambient))).toBe(false)
    }
    // 重校准 + hangover 结束后，同强度噪音开始被门控
    expect(isAllZero(gate.process(ambient))).toBe(true)
    // 人声仍放行
    expect(isAllZero(gate.process(tone(0.5)))).toBe(false)
  })

  it('speech-activity 回调在 active 翻转时触发', () => {
    const activities: boolean[] = []
    const gate = new VoiceNoiseGate({
      mode: 'standard',
      disableSilero: true,
      onSpeechActivity: (active) => activities.push(active),
    })
    gate.reset()
    warmUp(gate)
    gate.process(tone(0.5))
    // hangover 3 chunk 后回落
    for (let i = 0; i < 4; i += 1) gate.process(silence())
    gate.process(silence())
    expect(activities).toEqual([true, false])
  })
})

describe('silero 确认层', () => {
  it('段 drain 进时间轴 + coverageRatio 区间计算', async () => {
    const gate = new VoiceNoiseGate({ mode: 'standard' })
    gate.reset()
    const vad = MockVad.instances[0]!
    expect(vad).toBeDefined()
    // 模拟 silero 检出 [16000, 32000) 的人声段（1s–2s）
    vad.emitSegment(16000, 16000)
    gate.flushSilero()
    // 区间 [0, 32000)：覆盖 16000 → 0.5
    expect(gate.coverageRatio(0, 32000)).toBeCloseTo(0.5, 5)
    // 区间完全在人声段内 → 1
    expect(gate.coverageRatio(16000, 32000)).toBe(1)
    // 区间完全无人声 → 0
    expect(gate.coverageRatio(32000, 48000)).toBe(0)
  })

  it('shouldAcceptFinal 按档位阈值拦截（standard 35% / strict 55%）', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard' })
    gate.reset()
    const vad = MockVad.instances[0]!
    vad.emitSegment(16000, 16000)
    gate.flushSilero()
    // 30% 覆盖：standard 拦截
    expect(gate.shouldAcceptFinal(0, 53333)).toBe(false)
    // 60% 覆盖：standard 放行
    expect(gate.shouldAcceptFinal(0, 26666)).toBe(true)

    const strictGate = new VoiceNoiseGate({ mode: 'strict' })
    strictGate.reset()
    const strictVad = MockVad.instances[0]!
    strictVad.emitSegment(0, 16000)
    strictGate.flushSilero()
    // 60% 覆盖：strict 放行；45% 覆盖：strict 拦截、standard 会放行
    expect(strictGate.shouldAcceptFinal(0, 26666)).toBe(true)
    expect(strictGate.shouldAcceptFinal(0, 35555)).toBe(false)
  })

  it('reset 隔离会话状态：段时间轴与底噪基线清空', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard' })
    gate.reset()
    const vad = MockVad.instances[0]!
    vad.emitSegment(0, 16000)
    gate.flushSilero()
    expect(gate.coverageRatio(0, 16000)).toBe(1)
    gate.reset()
    expect(gate.coverageRatio(0, 16000)).toBe(0)
    expect(vad.segments.length).toBe(0)
  })

  it('降级：disableSilero 时 coverage 恒 1（final 不被拦截）', () => {
    const gate = new VoiceNoiseGate({ mode: 'strict', disableSilero: true })
    gate.reset()
    expect(gate.coverageRatio(0, 16000)).toBe(1)
    expect(gate.shouldAcceptFinal(0, 16000)).toBe(true)
  })
})
