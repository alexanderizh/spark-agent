import { describe, expect, it } from 'vitest'
import { VoiceBargeInGate } from './VoiceBargeInGate.js'

/** 生成指定能量的 chunk：恒定幅度正弦近似（能量判定用恒幅即可） */
function makeChunk(amplitude: number, length = 1600): Int16Array {
  const samples = new Int16Array(length)
  for (let i = 0; i < length; i += 1) {
    samples[i] = Math.round(amplitude * Math.sin((i / length) * Math.PI * 2 * 10))
  }
  return samples
}

/** dB 换算辅助：给定 dBFS 求幅度 */
function amplitudeForDb(db: number): number {
  return 32768 * Math.pow(10, db / 20) * Math.SQRT2 // RMS → 峰值（正弦）
}

describe('VoiceBargeInGate', () => {
  it('未 armed 时原样放行（非播报期无回声风险）', () => {
    const gate = new VoiceBargeInGate()
    const chunk = makeChunk(amplitudeForDb(-20))
    expect(gate.process(chunk)).toBe(chunk)
  })

  it('armed 后安静音频被置零压制（保时间推进）', () => {
    const gate = new VoiceBargeInGate()
    gate.setPlaybackActive(true, false)
    const quiet = makeChunk(amplitudeForDb(-45))
    const out = gate.process(quiet)
    expect(out.length).toBe(quiet.length)
    expect(Array.from(out).every((v) => v === 0)).toBe(true)
  })

  it('回声级能量（略高于底噪）被压制：standard 档 +10dB 门限', () => {
    const gate = new VoiceBargeInGate()
    gate.setPlaybackActive(true, false)
    // 预热 3 chunk 学习底噪（-50dB 附近）
    for (let i = 0; i < 5; i += 1) gate.process(makeChunk(amplitudeForDb(-50)))
    // 回声残余：底噪 +5dB（低于 +10dB 门限）→ 压制
    for (let i = 0; i < 6; i += 1) {
      const out = gate.process(makeChunk(amplitudeForDb(-45)))
      expect(Array.from(out).every((v) => v === 0)).toBe(true)
    }
  })

  it('强人声（远高于门限）连续 3 chunk 确认后放行，且确认期 chunk 后补（字头零丢失）', () => {
    const gate = new VoiceBargeInGate()
    gate.setPlaybackActive(true, false)
    for (let i = 0; i < 5; i += 1) gate.process(makeChunk(amplitudeForDb(-50)))
    const voice = makeChunk(amplitudeForDb(-25))
    const out1 = gate.process(voice) // 确认期 1：置零
    expect(Array.from(out1).every((v) => v === 0)).toBe(true)
    gate.process(voice) // 确认期 2：置零
    const out3 = gate.process(voice) // 确认期 3：通过 → 返回拼接的 3 chunk
    expect(out3.length).toBe(voice.length * 3)
    // 首段即确认期第 1 个 chunk 的原数据（字头后补、零丢失）
    for (let i = 0; i < voice.length; i += 1) {
      expect(out3[i]).toBe(voice[i])
    }
    // 放行态持续（hangover 未耗尽前能量跌落也放行）
    const out4 = gate.process(makeChunk(amplitudeForDb(-40)))
    expect(out4.length).toBeGreaterThan(0)
  })

  it('短尖峰（1 chunk 后跌落）不确认：缓存丢弃回到压制', () => {
    const gate = new VoiceBargeInGate()
    gate.setPlaybackActive(true, false)
    for (let i = 0; i < 5; i += 1) gate.process(makeChunk(amplitudeForDb(-50)))
    gate.process(makeChunk(amplitudeForDb(-20))) // 尖峰 1
    const out = gate.process(makeChunk(amplitudeForDb(-45))) // 跌落 → 确认作废
    expect(Array.from(out).every((v) => v === 0)).toBe(true)
    expect(gate.isAdmitting()).toBe(false)
  })

  it('strict 档门限更高：standard 能放行的能量被压制', () => {
    const gate = new VoiceBargeInGate()
    gate.setPlaybackActive(true, true) // strict +20dB
    for (let i = 0; i < 5; i += 1) gate.process(makeChunk(amplitudeForDb(-50)))
    // 底噪 +12dB（standard 可过、strict 不可过）
    for (let i = 0; i < 6; i += 1) {
      const out = gate.process(makeChunk(amplitudeForDb(-38)))
      expect(Array.from(out).every((v) => v === 0)).toBe(true)
    }
  })

  it('disarm 后恢复直通', () => {
    const gate = new VoiceBargeInGate()
    gate.setPlaybackActive(true, false)
    gate.process(makeChunk(amplitudeForDb(-50)))
    gate.setPlaybackActive(false, false)
    const chunk = makeChunk(amplitudeForDb(-30))
    expect(gate.process(chunk)).toBe(chunk)
  })
})
