import { describe, expect, it } from 'vitest'
import type { SessionId } from '@spark/protocol'
import { sortSessionsByPinned, type SessionSummary } from './sidebar-session-sort'

function session(
  id: string,
  opts: { pinnedAt?: string | null; updatedAt: string },
): SessionSummary {
  return {
    id: id as SessionId,
    title: id,
    updatedAt: opts.updatedAt,
    pinnedAt: opts.pinnedAt ?? null,
  } as unknown as SessionSummary
}

describe('sortSessionsByPinned', () => {
  it('置顶会话排在未置顶之前', () => {
    const sorted = sortSessionsByPinned([
      session('plain', { updatedAt: '2026-07-03T00:00:00.000Z' }),
      session('pinned', {
        pinnedAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      }),
    ])
    expect(sorted.map((s) => s.id)).toEqual(['pinned', 'plain'])
  })

  it('取消置顶后回落到 updatedAt 顺序（回归测试：复现取消置顶后顺序不变）', () => {
    // a 曾置顶但已取消（pinnedAt 为 null），b 一直未置顶但更新更近 → b 应排到 a 前面
    const sorted = sortSessionsByPinned([
      session('a', { pinnedAt: null, updatedAt: '2026-07-01T00:00:00.000Z' }),
      session('b', { pinnedAt: null, updatedAt: '2026-07-03T00:00:00.000Z' }),
    ])
    expect(sorted.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('多条置顶按 pinnedAt 倒序（近期置顶更靠前）', () => {
    const sorted = sortSessionsByPinned([
      session('old-pin', {
        pinnedAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
      session('new-pin', {
        pinnedAt: '2026-07-05T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
    ])
    expect(sorted.map((s) => s.id)).toEqual(['new-pin', 'old-pin'])
  })

  it('全部未置顶时按 updatedAt 倒序', () => {
    const sorted = sortSessionsByPinned([
      session('older', { updatedAt: '2026-07-01T00:00:00.000Z' }),
      session('newer', { updatedAt: '2026-07-10T00:00:00.000Z' }),
    ])
    expect(sorted.map((s) => s.id)).toEqual(['newer', 'older'])
  })

  it('不修改原数组', () => {
    const input = [
      session('plain', { updatedAt: '2026-07-03T00:00:00.000Z' }),
      session('pinned', {
        pinnedAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      }),
    ]
    sortSessionsByPinned(input)
    expect(input.map((s) => s.id)).toEqual(['plain', 'pinned'])
  })
})
