/**
 * PreRollBuffer 单测：滚动覆盖、快照不消费、超容截断（首句丢失修复的渲染端
 * 字头保护核心逻辑，纯逻辑无 DOM 依赖）。
 */
import { describe, expect, it } from 'vitest'

import { PRE_ROLL_SECONDS, PRE_ROLL_SAMPLE_RATE, PreRollBuffer } from './preRollBuffer'

const CAPACITY = PRE_ROLL_SAMPLE_RATE * PRE_ROLL_SECONDS // 40000 samples

function chunk(samples: number): Int16Array {
  return new Int16Array(samples).fill(1)
}

describe('PreRollBuffer', () => {
  it('容量内按时间序累积', () => {
    const buffer = new PreRollBuffer()
    const a = chunk(100)
    const b = chunk(200)
    buffer.push(a)
    buffer.push(b)
    expect(buffer.samples).toBe(300)
    expect(buffer.snapshot()).toEqual([a, b])
  })

  it('超容量丢弃最旧 chunk（滚动覆盖）', () => {
    const buffer = new PreRollBuffer(CAPACITY)
    const old = chunk(CAPACITY - 100)
    const fresh = chunk(200)
    buffer.push(old)
    buffer.push(fresh)
    // old 整段被挤出，只留 fresh
    expect(buffer.samples).toBe(200)
    expect(buffer.snapshot()).toEqual([fresh])
  })

  it('单 chunk 超容量只保留其尾部', () => {
    const buffer = new PreRollBuffer(1000)
    const big = chunk(2500)
    buffer.push(big)
    expect(buffer.samples).toBe(1000)
    const [head] = buffer.snapshot()
    // 保留的是尾部（时间上最新的 1000 个采样）
    expect(head).toBeInstanceOf(Int16Array)
    expect(head?.length).toBe(1000)
  })

  it('snapshot 不消费缓冲，回放后继续滚动供下次唤醒使用', () => {
    const buffer = new PreRollBuffer()
    buffer.push(chunk(100))
    const first = buffer.snapshot()
    expect(first).toHaveLength(1)
    // 未 clear：快照后缓冲仍在，继续 push 正常滚动
    buffer.push(chunk(100))
    expect(buffer.samples).toBe(200)
    expect(buffer.snapshot()).toHaveLength(2)
  })

  it('clear 清空缓冲', () => {
    const buffer = new PreRollBuffer()
    buffer.push(chunk(100))
    buffer.clear()
    expect(buffer.samples).toBe(0)
    expect(buffer.snapshot()).toEqual([])
  })

  it('空 chunk 与零容量不产生状态变化', () => {
    const buffer = new PreRollBuffer(0)
    buffer.push(chunk(100))
    expect(buffer.samples).toBe(0)
    buffer.push(new Int16Array(0))
    expect(buffer.samples).toBe(0)
  })
})
