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
  it('预热期直通：高能量也原样放行（唤醒后立即开口不吃字头）', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard', disableSilero: true })
    gate.reset()
    // 预热期高能量直通——识别率优先，300ms 预热窗口不能切掉立即开口的字头
    const out = gate.process(tone(0.5))
    expect(isAllZero(out)).toBe(false)
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

  it('起音迟滞：字头爬坡期（门限-4dB 以上）持续放行不关门', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard', disableSilero: true })
    gate.reset()
    // 预热期在 -45dB 环境收敛 baseline → threshold=-39dB，attack 门限 -43dB
    for (let i = 0; i < 3; i += 1) gate.process(tone(0.0084)) // ≈ -45dB
    // 字头轻辅音 ≈ -41dB：低于关门门限(-39)但高于起音门限(-43)。
    // 旧逻辑（无迟滞）会在 6 个 hangover chunk 后关门置零；新逻辑持续放行
    const consonant = tone(0.0133) // ≈ -41dB
    for (let i = 0; i < 8; i += 1) {
      expect(isAllZero(gate.process(consonant))).toBe(false)
    }
    // 远低于起音门限的静音仍在 hangover 后被门控（关门语义不变）
    const faint = tone(0.0001) // ≈ -85dB
    for (let i = 0; i < 6; i += 1) gate.process(faint) // hangover 6 chunk 放行
    expect(isAllZero(gate.process(faint))).toBe(true)
  })

  it('hangover：语音结束后 6 chunk 内低能量仍放行（防字尾轻音被切）', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard', disableSilero: true })
    gate.reset()
    warmUp(gate)
    gate.process(tone(0.5))
    const faint = tone(0.0001) // 远低于门限的尾音
    // hangover 6 chunk 内放行（非全零）
    for (let i = 0; i < 6; i += 1) {
      expect(isAllZero(gate.process(faint))).toBe(false)
    }
    // 第 7 chunk 起门控生效（置零）
    expect(isAllZero(gate.process(faint))).toBe(true)
  })

  it('底噪自适应：预热于真实底噪的门限压住同强度噪音，人声放行', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard', disableSilero: true })
    gate.reset()
    // 预热期直接暴露在环境底噪中（唤醒时环境已有电视声，amp 0.02 ≈ -37dB）
    const ambient = tone(0.02)
    for (let i = 0; i < 3; i += 1) gate.process(ambient)
    // 预热后同强度音频还有 hangover 缓冲（warmup 直通把 quiet 计数清零），
    // 6 个 chunk 后同强度底噪被判为底噪（置零）
    for (let i = 0; i < 6; i += 1) gate.process(ambient)
    expect(isAllZero(gate.process(ambient))).toBe(true)
    // 显著更强的近场人声仍放行
    expect(isAllZero(gate.process(tone(0.5)))).toBe(false)
  })

  it('持续噪音自愈：安静预热后环境变吵，8s 重校准后门控恢复', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard', disableSilero: true })
    gate.reset()
    warmUp(gate) // 安静环境唤醒
    const ambient = tone(0.02)
    // warmup 直通把重校准提前 3 个 chunk（第 80 个），hangover 加长 3 个（6 chunk），
    // 两者抵消：仍放行到第 86 个 chunk（循环 83 次 = warmup 后第 83 个 ambient），
    // 第 87 个起门控恢复
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
    // hangover 6 chunk 后回落（第 7 个静音 chunk 翻转 false）
    for (let i = 0; i < 7; i += 1) gate.process(silence())
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

  it('shouldAcceptFinal 按放行样本覆盖率拦截，门控静音不稀释分母', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard' })
    gate.reset()
    // 构造时间轴：3 warmup 静音（直通）+ 4 个高能量 chunk + 6 个 hangover 静音
    // → 连续 active span [0, 13*1600)，之后静音被置零
    warmUp(gate)
    for (let i = 0; i < 4; i += 1) gate.process(tone(0.5))
    for (let i = 0; i < 6; i += 1) gate.process(silence())
    for (let i = 0; i < 3; i += 1) gate.process(silence()) // 置零段
    const vad = MockVad.instances[0]!
    const activeEnd = 13 * 1600
    // silero 只确认 [1600, 5600) 是人声：放行样本 20800 中覆盖 4000 ≈ 19%
    vad.emitSegment(1600, 4000)
    gate.flushSilero()
    // 19% < standard 30% → 噪音硬解拦截；分母不含置零静音（否则稀释成 4000/25600≈16%，
    // 旧语义下长停顿句子会被误杀——正是本修正要防的）
    expect(gate.shouldAcceptFinal(0, 20 * 1600)).toBe(false)
    // 同一区间若 silero 确认大部分放行段为人声 → 放行
    const gate2 = new VoiceNoiseGate({ mode: 'standard' })
    gate2.reset()
    warmUp(gate2)
    for (let i = 0; i < 4; i += 1) gate2.process(tone(0.5))
    for (let i = 0; i < 6; i += 1) gate2.process(silence())
    const vad2 = MockVad.instances[MockVad.instances.length - 1]!
    vad2.emitSegment(0, activeEnd - 3200) // 覆盖放行段 20800 中的 17600 ≈ 85%
    gate2.flushSilero()
    expect(gate2.shouldAcceptFinal(0, 20 * 1600)).toBe(true)

    // strict 档：45% 阈值
    const strictGate = new VoiceNoiseGate({ mode: 'strict' })
    strictGate.reset()
    warmUp(strictGate)
    for (let i = 0; i < 4; i += 1) strictGate.process(tone(0.5))
    for (let i = 0; i < 6; i += 1) strictGate.process(silence())
    const strictVad = MockVad.instances[MockVad.instances.length - 1]!
    strictVad.emitSegment(0, 11200) // 覆盖 20800 中的 11200 ≈ 54%：strict 放行
    strictGate.flushSilero()
    expect(strictGate.shouldAcceptFinal(0, 20 * 1600)).toBe(true)
    const strictGate2 = new VoiceNoiseGate({ mode: 'strict' })
    strictGate2.reset()
    warmUp(strictGate2)
    for (let i = 0; i < 4; i += 1) strictGate2.process(tone(0.5))
    for (let i = 0; i < 6; i += 1) strictGate2.process(silence())
    const strictVad2 = MockVad.instances[MockVad.instances.length - 1]!
    strictVad2.emitSegment(0, 8000) // 覆盖 20800 中的 8000 ≈ 38%：strict 拦截、standard 放行
    strictGate2.flushSilero()
    expect(strictGate2.shouldAcceptFinal(0, 20 * 1600)).toBe(false)
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
