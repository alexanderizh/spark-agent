import { describe, expect, it } from 'vitest'
import type { MobileBridgeEvent } from '@spark/protocol'
import { resolvePendingQuickReplies } from './remoteQuickReplies'

function ev(
  overrides: Partial<MobileBridgeEvent> & { id: string; seq: number },
): MobileBridgeEvent {
  return {
    turnId: 't1',
    type: 'assistant_message',
    timestamp: '2026-11-14T10:00:00.000Z',
    content: '',
    ...overrides,
  }
}

describe('resolvePendingQuickReplies', () => {
  it('取最近一次建议', () => {
    const events = [
      ev({ id: 'u1', seq: 1, type: 'user_message', content: '帮我看看' }),
      ev({
        id: 't1',
        seq: 2,
        type: 'tool_call',
        toolName: 'x',
        toolCallId: 'call-1',
        quickReplies: ['继续'],
      }),
      ev({ id: 'a1', seq: 3, type: 'assistant_message', content: '做完了' }),
      ev({
        id: 't2',
        seq: 4,
        type: 'tool_call',
        toolName: 'x',
        toolCallId: 'call-2',
        quickReplies: ['再跑测试', '提交'],
      }),
    ]
    expect(resolvePendingQuickReplies(events)).toEqual({
      toolCallId: 'call-2',
      turnId: 't1',
      replies: ['再跑测试', '提交'],
    })
  })

  it('用户已经接着发言后，旧建议失效', () => {
    const events = [
      ev({ id: 'u1', seq: 1, type: 'user_message', content: '帮我看看' }),
      ev({
        id: 't1',
        seq: 2,
        type: 'tool_call',
        toolName: 'x',
        toolCallId: 'call-1',
        quickReplies: ['继续'],
      }),
      ev({ id: 'u2', seq: 3, type: 'user_message', content: '那就继续吧' }),
    ]
    expect(resolvePendingQuickReplies(events)).toBeNull()
  })

  it('有待回答的问答卡时不给建议（结构化问答优先）', () => {
    const events = [
      ev({
        id: 't1',
        seq: 1,
        type: 'tool_call',
        toolName: 'x',
        toolCallId: 'call-1',
        quickReplies: ['A'],
      }),
    ]
    expect(resolvePendingQuickReplies(events, { hasPendingQuestion: true })).toBeNull()
  })

  it('没有建议 / 建议为空数组时返回 null', () => {
    expect(resolvePendingQuickReplies([])).toBeNull()
    expect(
      resolvePendingQuickReplies([
        ev({ id: 't1', seq: 1, type: 'tool_call', toolName: 'bash', toolCallId: 'c1' }),
        ev({
          id: 't2',
          seq: 2,
          type: 'tool_call',
          toolName: 'x',
          toolCallId: 'c2',
          quickReplies: [],
        }),
      ]),
    ).toBeNull()
  })

  it('缺 toolCallId 时用事件 id 兜底（关闭标记与 key 仍需稳定）', () => {
    const events = [
      ev({ id: 'tool-ev-1', seq: 1, type: 'tool_call', toolName: 'x', quickReplies: ['好'] }),
    ]
    expect(resolvePendingQuickReplies(events)?.toolCallId).toBe('tool-ev-1')
  })
})
