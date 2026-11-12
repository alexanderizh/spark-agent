import { describe, expect, it } from 'vitest'
import type { MobileBridgeEvent } from '@spark/protocol'
import { buildRemoteTimeline } from './remoteEventMerge'
import { SMOOTH_THRESHOLD_CHARS, findSmoothTarget, smoothStep } from './remoteSmoothReveal'

let seed = 0

function ev(partial: Partial<MobileBridgeEvent> & { id: string; seq: number }): MobileBridgeEvent {
  seed += 1
  return {
    turnId: 'turn-1',
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seed)).toISOString(),
    type: 'assistant_message',
    ...partial,
  } as MobileBridgeEvent
}

describe('smoothStep', () => {
  it('剩余为 0 或负数时不推进', () => {
    expect(smoothStep(0)).toBe(0)
    expect(smoothStep(-5)).toBe(0)
  })

  it('步长不小于最小值，且不超过剩余量', () => {
    expect(smoothStep(1)).toBe(1)
    expect(smoothStep(SMOOTH_THRESHOLD_CHARS)).toBeGreaterThanOrEqual(12)
    expect(smoothStep(5000)).toBeLessThanOrEqual(5000)
  })

  it('剩余越多步长越大（约五帧追平）', () => {
    expect(smoothStep(500)).toBeGreaterThan(smoothStep(50))
    expect(smoothStep(500) * 5).toBeGreaterThanOrEqual(500)
  })
})

describe('findSmoothTarget', () => {
  it('取最后一条仍在流式的正文', () => {
    const items = buildRemoteTimeline([
      ev({ id: '1', seq: 1, content: '你好', mode: 'delta', segmentId: 's' }),
    ])
    const target = findSmoothTarget(items)
    expect(target).toMatchObject({ key: 'assistant-1', index: 0, length: 2 })
  })

  it('回合收到终态后不再有揭示目标', () => {
    const items = buildRemoteTimeline([
      ev({ id: '1', seq: 1, content: '你好', mode: 'delta', segmentId: 's' }),
      ev({ id: '2', seq: 2, type: 'agent_status', status: 'completed' }),
    ])
    expect(findSmoothTarget(items)).toBeNull()
  })

  it('最后一条是工具调用时不揭示（正文已完成）', () => {
    const items = buildRemoteTimeline([
      ev({ id: '1', seq: 1, content: '开始', mode: 'delta', segmentId: 's' }),
      ev({ id: '2', seq: 2, type: 'tool_call', toolName: 'bash', toolCallId: 'c1' }),
    ])
    expect(findSmoothTarget(items)).toBeNull()
  })

  it('思考段同样可以按帧揭示', () => {
    const items = buildRemoteTimeline([
      ev({
        id: '1',
        seq: 1,
        type: 'agent_thinking',
        content: '想想',
        mode: 'delta',
        segmentId: 't',
      }),
    ])
    expect(findSmoothTarget(items)).toMatchObject({ key: 'thinking-1' })
  })
})
