import { describe, expect, it } from 'vitest'
import type { SessionId } from '@spark/protocol'
import {
  composeProjectGroupSessions,
  resolveSessionGroupId,
  sortSessionsByPinned,
  type SessionSummary,
} from './sidebar-session-sort'

function session(
  id: string,
  opts: { pinnedAt?: string | null; updatedAt: string; workspaceIds?: string[] },
): SessionSummary {
  return {
    id: id as SessionId,
    title: id,
    updatedAt: opts.updatedAt,
    pinnedAt: opts.pinnedAt ?? null,
    workspaceIds: opts.workspaceIds ?? [],
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

describe('composeProjectGroupSessions', () => {
  it('置顶段在前、普通段在后；无 manualOrder 时保持各自预排（pinnedAt/updatedAt 倒序）', () => {
    const sessions = sortSessionsByPinned([
      session('normal-new', { updatedAt: '2026-07-10T00:00:00.000Z' }),
      session('pin-new', {
        pinnedAt: '2026-07-09T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
      session('normal-old', { updatedAt: '2026-07-01T00:00:00.000Z' }),
      session('pin-old', {
        pinnedAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
    ])
    const composed = composeProjectGroupSessions(sessions, undefined, undefined)
    expect(composed.map((s) => s.id)).toEqual(['pin-new', 'pin-old', 'normal-new', 'normal-old'])
  })

  it('两段独立套用各自的 manualOrder，互不污染', () => {
    const sessions = sortSessionsByPinned([
      session('pin-a', {
        pinnedAt: '2026-07-09T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
      session('pin-b', {
        pinnedAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
      session('nrm-a', { updatedAt: '2026-07-10T00:00:00.000Z' }),
      session('nrm-b', { updatedAt: '2026-07-01T00:00:00.000Z' }),
    ])
    // pinned 段与 normal 段都手动逆序
    const composed = composeProjectGroupSessions(sessions, ['nrm-b', 'nrm-a'], ['pin-b', 'pin-a'])
    expect(composed.map((s) => s.id)).toEqual(['pin-b', 'pin-a', 'nrm-b', 'nrm-a'])
  })

  it('段内未登记在 manualOrder 的新项落在该段最前（保持预排 fallback）', () => {
    const sessions = sortSessionsByPinned([
      session('pin-old', {
        pinnedAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
      session('pin-new', {
        pinnedAt: '2026-07-09T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
    ])
    // pin-new 未登记在 pinnedIds → 按 fallback（pinnedAt 倒序预排）排在已登记项之前
    const composed = composeProjectGroupSessions(sessions, undefined, ['pin-old'])
    expect(composed.map((s) => s.id)).toEqual(['pin-new', 'pin-old'])
  })
})

describe('resolveSessionGroupId', () => {
  it('普通 workspace 取自身 id', () => {
    const s = session('s1', { updatedAt: '2026-07-01T00:00:00.000Z', workspaceIds: ['ws1'] })
    expect(resolveSessionGroupId(s, [{ id: 'ws1' }])).toBe('ws1')
  })

  it('worktree 归并到 base workspace id', () => {
    const s = session('s1', { updatedAt: '2026-07-01T00:00:00.000Z', workspaceIds: ['wt1'] })
    const workspaces = [{ id: 'wt1', worktreeMeta: { baseWorkspaceId: 'base1' } }, { id: 'base1' }]
    expect(resolveSessionGroupId(s, workspaces)).toBe('base1')
  })

  it('孤儿 worktree（base 不存在）回落到自身', () => {
    const s = session('s1', { updatedAt: '2026-07-01T00:00:00.000Z', workspaceIds: ['wt1'] })
    expect(
      resolveSessionGroupId(s, [{ id: 'wt1', worktreeMeta: { baseWorkspaceId: 'gone' } }]),
    ).toBe('wt1')
  })
})
