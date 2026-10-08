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
 * 5. 句级出字支撑：闭合 span 待取队列 / isSileroVadAvailable 探针 /
 *    confirm-only 的 speech-activity 信号（音频直通）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isSileroVadAvailable,
  resetVoiceGateCoverageRelax,
  setVadModuleForTests,
  VoiceNoiseGate,
} from './VoiceNoiseGate'

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
  // 自愈降档的跨会话粘性窗口是模块级状态：用例间必须清零，否则先行用例触发的
  // 降档会让后续用例的新 gate 直接继承半档阈值（断言全乱）
  resetVoiceGateCoverageRelax()
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

  it('连续拦截自愈：3 个 final 被覆盖率拦截后本会话降半档放行（说话不发送修复）', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard' })
    gate.reset()
    warmUp(gate)
    for (let i = 0; i < 4; i += 1) gate.process(tone(0.5))
    for (let i = 0; i < 6; i += 1) gate.process(silence())
    for (let i = 0; i < 3; i += 1) gate.process(silence()) // 置零段
    const vad = MockVad.instances[MockVad.instances.length - 1]!
    // silero 覆盖放行段 20800 中的 4160 ≈ 20%（实测故障日志的真话覆盖区间）：
    // standard 满档 30% 拦截；连续 3 次后自愈降半档 15% 放行
    vad.emitSegment(1600, 4160)
    gate.flushSilero()
    expect(gate.shouldAcceptFinal(0, 20 * 1600)).toBe(false) // 连续第 1 次拦截
    expect(gate.shouldAcceptFinal(0, 20 * 1600)).toBe(false) // 连续第 2 次拦截
    expect(gate.shouldAcceptFinal(0, 20 * 1600)).toBe(false) // 第 3 次 → 触发自愈
    expect(gate.shouldAcceptFinal(0, 20 * 1600)).toBe(true) // 20% ≥ 15%，真话不再被吞
  })

  it('零星拦截不误触发自愈：放行归零连续计数', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard' })
    gate.reset()
    warmUp(gate)
    for (let i = 0; i < 4; i += 1) gate.process(tone(0.5))
    for (let i = 0; i < 6; i += 1) gate.process(silence())
    for (let i = 0; i < 3; i += 1) gate.process(silence())
    const vad = MockVad.instances[MockVad.instances.length - 1]!
    vad.emitSegment(1600, 4160) // 低覆盖 ≈ 20% + 高覆盖子区间 [1600, 5760) = 100%
    gate.flushSilero()
    // 高覆盖子区间放行 → 连续计数归零
    expect(gate.shouldAcceptFinal(1600, 5760)).toBe(true)
    expect(gate.shouldAcceptFinal(0, 20 * 1600)).toBe(false) // 零星 1
    expect(gate.shouldAcceptFinal(0, 20 * 1600)).toBe(false) // 零星 2
    expect(gate.shouldAcceptFinal(1600, 5760)).toBe(true) // 再次放行 → 计数再归零
    expect(gate.shouldAcceptFinal(0, 20 * 1600)).toBe(false) // 零星 1'
    expect(gate.shouldAcceptFinal(0, 20 * 1600)).toBe(false) // 零星 2'
    // 若放行未归零计数，此刻累计早已 ≥3 触发自愈，20% 会以 15% 半档放行；
    // 仍按满档拦截 = 计数确实被放行归零过
    expect(gate.shouldAcceptFinal(0, 20 * 1600)).toBe(false)
  })

  it('自愈降档跨会话粘性：半双工下一轮新 gate 在窗口内继承半档，过期恢复满档', () => {
    // 第一轮 ASR 会话：连续 3 次覆盖率拦截触发自愈（同时写模块级粘性时间戳）
    const gate1 = new VoiceNoiseGate({ mode: 'standard' })
    gate1.reset()
    warmUp(gate1)
    for (let i = 0; i < 4; i += 1) gate1.process(tone(0.5))
    for (let i = 0; i < 6; i += 1) gate1.process(silence())
    for (let i = 0; i < 3; i += 1) gate1.process(silence()) // 置零段
    const vad1 = MockVad.instances[MockVad.instances.length - 1]!
    vad1.emitSegment(1600, 4160) // 放行段覆盖率 ≈20%（实测故障日志的真话区间）
    gate1.flushSilero()
    expect(gate1.shouldAcceptFinal(0, 20 * 1600)).toBe(false) // 连续第 1 次拦截
    expect(gate1.shouldAcceptFinal(0, 20 * 1600)).toBe(false) // 连续第 2 次拦截
    expect(gate1.shouldAcceptFinal(0, 20 * 1600)).toBe(false) // 第 3 次 → 自愈 + 粘性

    // 第二轮（半双工续听重建 ASR 会话 = 全新 gate 实例）：粘性窗口内直接半档
    // 放行——低增益/远场用户不必每轮重新被吞 3 个 final
    const gate2 = new VoiceNoiseGate({ mode: 'standard' })
    gate2.reset()
    warmUp(gate2)
    for (let i = 0; i < 4; i += 1) gate2.process(tone(0.5))
    for (let i = 0; i < 6; i += 1) gate2.process(silence())
    for (let i = 0; i < 3; i += 1) gate2.process(silence())
    const vad2 = MockVad.instances[MockVad.instances.length - 1]!
    vad2.emitSegment(1600, 4160)
    gate2.flushSilero()
    expect(gate2.shouldAcceptFinal(0, 20 * 1600)).toBe(true) // 20% ≥ 15%

    // 粘性窗口过期（10 分钟）：新会话恢复满档拦截——环境好转自愈可逆
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 11 * 60_000)
      const gate3 = new VoiceNoiseGate({ mode: 'standard' })
      gate3.reset()
      warmUp(gate3)
      for (let i = 0; i < 4; i += 1) gate3.process(tone(0.5))
      for (let i = 0; i < 6; i += 1) gate3.process(silence())
      for (let i = 0; i < 3; i += 1) gate3.process(silence())
      const vad3 = MockVad.instances[MockVad.instances.length - 1]!
      vad3.emitSegment(1600, 4160)
      gate3.flushSilero()
      expect(gate3.shouldAcceptFinal(0, 20 * 1600)).toBe(false) // 恢复 30% 满档
    } finally {
      vi.useRealTimers()
    }
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

describe('句级出字支撑（闭合 span 队列 + silero 探针 + confirm-only 信号）', () => {
  it('闭合 span 入队 + take 取走清空（重复调用返回空数组）', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard' })
    gate.reset()
    const vad = MockVad.instances[MockVad.instances.length - 1]!
    // 初始无闭合段
    expect(gate.takeClosedSpeechSpans()).toEqual([])
    // silero 检出 [0, 16000) 人声段，flush 后 drain 入队
    vad.emitSegment(0, 16000)
    gate.flushSilero()
    expect(gate.takeClosedSpeechSpans()).toEqual([{ start: 0, end: 16000 }])
    // 取走后清空，不再重复产出
    expect(gate.takeClosedSpeechSpans()).toEqual([])
    // 第二段（与上一段首尾相接，验证 lastSpanEnd 推进时的钳制语义）
    vad.emitSegment(15000, 16000)
    gate.flushSilero()
    expect(gate.takeClosedSpeechSpans()).toEqual([{ start: 16000, end: 31000 }])
  })

  it('process 期间 drain 的段同样入队（不依赖 flushSilero）', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard' })
    gate.reset()
    const vad = MockVad.instances[MockVad.instances.length - 1]!
    vad.emitSegment(0, 1600)
    // 下一个 chunk 的 process 触发 drainSpans → 段入队
    gate.process(silence())
    expect(gate.takeClosedSpeechSpans()).toEqual([{ start: 0, end: 1600 }])
  })

  it('reset 清空待取队列（跨会话隔离）', () => {
    const gate = new VoiceNoiseGate({ mode: 'standard' })
    gate.reset()
    const vad = MockVad.instances[MockVad.instances.length - 1]!
    vad.emitSegment(0, 8000)
    gate.flushSilero()
    expect(gate.takeClosedSpeechSpans().length).toBe(1)
    vad.emitSegment(8000, 8000)
    gate.flushSilero()
    gate.reset()
    expect(gate.takeClosedSpeechSpans()).toEqual([])
  })

  it('isSileroVadAvailable：mock 注入可用时为 true，构造抛错降级时为 false', () => {
    // beforeEach 已注入可用 mock
    expect(isSileroVadAvailable()).toBe(true)
    // 构造抛错 → loadVad 返回 null（warn 一次并降级）
    setVadModuleForTests({
      Vad: (() => {
        throw new Error('boom')
      }) as unknown as new (config: unknown, bufferSeconds: number) => MockVad,
    })
    expect(isSileroVadAvailable()).toBe(false)
  })

  it('confirm-only：音频原样直通 + speech-activity 回调照常触发（句级模式信号源）', () => {
    const activities: boolean[] = []
    const gate = new VoiceNoiseGate({
      mode: 'standard',
      confirmOnly: true,
      onSpeechActivity: (active) => activities.push(active),
    })
    gate.reset()
    warmUp(gate) // 预热 3 chunk（静音）→ 首个 chunk 即翻转 true
    const speech = tone(0.5)
    const out = gate.process(speech)
    // confirm-only 音频不动：原样返回（非全零、同一内容）
    expect(out.length).toBe(CHUNK)
    expect(out).toEqual(speech)
    // hangover 6 chunk 后静音回落（第 7 个静音 chunk 翻转 false）
    for (let i = 0; i < 7; i += 1) gate.process(silence())
    expect(activities).toEqual([true, false])
  })
})
