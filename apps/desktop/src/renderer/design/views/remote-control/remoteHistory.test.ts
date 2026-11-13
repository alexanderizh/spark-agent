import { describe, expect, it } from 'vitest'
import type { MobileBridgeEvent } from '@spark/protocol'
import {
  HISTORY_FALLBACK_PAGE_SIZE,
  buildHistoryUrl,
  isHistoryCursorAdvancing,
  pickUnseenEvents,
  resolveHistoryCursor,
  resolveHistoryHasMore,
} from './remoteHistory'

function event(id: string, seq: number, type = 'assistant_message'): MobileBridgeEvent {
  return {
    id,
    seq,
    type,
    turnId: 't1',
    timestamp: '2026-01-01T00:00:00.000Z',
    content: id,
  } as MobileBridgeEvent
}

describe('resolveHistoryHasMore', () => {
  it('服务端给了就照服务端', () => {
    expect(resolveHistoryHasMore({ hasMore: false, events: [event('a', 1)] })).toBe(false)
    expect(resolveHistoryHasMore({ hasMore: true, events: [] })).toBe(true)
  })

  it('旧版目标端缺字段时按满页兜底', () => {
    const full = Array.from({ length: HISTORY_FALLBACK_PAGE_SIZE }, (_, index) =>
      event(`e${index}`, index),
    )
    expect(resolveHistoryHasMore({ events: full })).toBe(true)
    expect(resolveHistoryHasMore({ events: full.slice(0, 10) })).toBe(false)
    expect(resolveHistoryHasMore({})).toBe(false)
  })
})

describe('resolveHistoryCursor', () => {
  it('优先用 nextBeforeSeq', () => {
    expect(resolveHistoryCursor({ nextBeforeSeq: 42, events: [event('a', 90)] })).toBe(42)
  })

  it('没有游标字段时退回本页最小 seq', () => {
    expect(resolveHistoryCursor({ events: [event('b', 30), event('a', 12)] })).toBe(12)
  })

  it('空页没有游标', () => {
    expect(resolveHistoryCursor({ events: [] })).toBeNull()
    expect(resolveHistoryCursor({})).toBeNull()
  })
})

describe('isHistoryCursorAdvancing', () => {
  it('必须严格更早', () => {
    expect(isHistoryCursorAdvancing(10, 20)).toBe(true)
    expect(isHistoryCursorAdvancing(20, 20)).toBe(false)
    expect(isHistoryCursorAdvancing(30, 20)).toBe(false)
    expect(isHistoryCursorAdvancing(null, 20)).toBe(false)
  })
})

describe('pickUnseenEvents', () => {
  it('按 id 去重（同页重复也只留一次）', () => {
    const fresh = pickUnseenEvents(['a'], [event('a', 1), event('b', 2), event('b', 2)])
    expect(fresh.map((item) => item.id)).toEqual(['b'])
  })
})

describe('buildHistoryUrl', () => {
  it('首页不带 beforeSeq，翻页带上', () => {
    expect(buildHistoryUrl('s1')).toBe(
      '/v1/sessions/s1/messages?limit=200&turnLimit=12&eventLimit=1200',
    )
    expect(buildHistoryUrl('s/1', 88)).toContain('beforeSeq=88')
    expect(buildHistoryUrl('s/1', 88)).toContain('/v1/sessions/s%2F1/messages')
  })
})
