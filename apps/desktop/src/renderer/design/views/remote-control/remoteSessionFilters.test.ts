import { describe, expect, it } from 'vitest'
import type { MobileBridgeSessionSummary } from '@spark/protocol'
import {
  DEFAULT_REMOTE_FILTER,
  countActiveFilterFacets,
  hasSessionLevelFilter,
  isRemoteFilterActive,
  matchRemoteSession,
  sortFilterValues,
  summarizeRemoteFilter,
  toggleFilterValue,
} from './remoteSessionFilters'

const NOW = new Date('2026-11-13T12:00:00+08:00').getTime()

function session(patch: Partial<MobileBridgeSessionSummary> = {}): MobileBridgeSessionSummary {
  return {
    id: 's1',
    title: '会话',
    status: 'idle',
    updatedAt: new Date(NOW - 60_000).toISOString(),
    preview: '',
    projectId: 'p1',
    pinnedAt: null,
    sessionLabel: null,
    ...patch,
  }
}

describe('matchRemoteSession', () => {
  it('默认筛选放行一切', () => {
    expect(matchRemoteSession(session(), DEFAULT_REMOTE_FILTER, NOW)).toBe(true)
  })

  it('状态多选是 OR；未知状态在开启筛选后不命中', () => {
    const running = { ...DEFAULT_REMOTE_FILTER, statuses: ['running' as const] }
    expect(matchRemoteSession(session({ status: 'running' }), running, NOW)).toBe(true)
    expect(matchRemoteSession(session({ status: 'idle' }), running, NOW)).toBe(false)
    // 目标端可能写入额外状态（archived 等）：筛选开启时不混进来
    expect(matchRemoteSession(session({ status: 'archived' }), running, NOW)).toBe(false)

    const either = {
      ...DEFAULT_REMOTE_FILTER,
      statuses: ['running' as const, 'completed' as const],
    }
    expect(matchRemoteSession(session({ status: 'completed' }), either, NOW)).toBe(true)
  })

  it('标记：未标记与具体标记同处一个维度', () => {
    const unlabeled = { ...DEFAULT_REMOTE_FILTER, labels: ['unlabeled' as const] }
    expect(matchRemoteSession(session(), unlabeled, NOW)).toBe(true)
    expect(matchRemoteSession(session({ sessionLabel: 'suspended' }), unlabeled, NOW)).toBe(false)

    const both = { ...DEFAULT_REMOTE_FILTER, labels: ['unlabeled' as const, 'suspended' as const] }
    expect(matchRemoteSession(session({ sessionLabel: 'suspended' }), both, NOW)).toBe(true)
    expect(matchRemoteSession(session({ sessionLabel: 'undelivered' }), both, NOW)).toBe(false)
  })

  it('最近活动：今天是自然日，3/7/30 天是滚动窗口', () => {
    // 昨天 23:30（今天的 0 点之前）
    const yesterdayLate = new Date(NOW - 13 * 3_600_000).toISOString()
    expect(
      matchRemoteSession(
        session({ updatedAt: yesterdayLate }),
        { ...DEFAULT_REMOTE_FILTER, activity: 'today' },
        NOW,
      ),
    ).toBe(false)
    expect(
      matchRemoteSession(
        session({ updatedAt: yesterdayLate }),
        { ...DEFAULT_REMOTE_FILTER, activity: '3d' },
        NOW,
      ),
    ).toBe(true)

    const tenDaysAgo = new Date(NOW - 10 * 86_400_000).toISOString()
    expect(
      matchRemoteSession(
        session({ updatedAt: tenDaysAgo }),
        { ...DEFAULT_REMOTE_FILTER, activity: '7d' },
        NOW,
      ),
    ).toBe(false)
    expect(
      matchRemoteSession(
        session({ updatedAt: tenDaysAgo }),
        { ...DEFAULT_REMOTE_FILTER, activity: '30d' },
        NOW,
      ),
    ).toBe(true)
  })

  it('项目：未归属走虚拟 id', () => {
    const filter = { ...DEFAULT_REMOTE_FILTER, projectIds: ['default'] }
    const unassigned = { ...session() }
    delete unassigned.projectId
    expect(matchRemoteSession(unassigned, filter, NOW)).toBe(true)
    expect(matchRemoteSession(session({ projectId: 'p2' }), filter, NOW)).toBe(false)
  })

  it('只看置顶', () => {
    const filter = { ...DEFAULT_REMOTE_FILTER, pinnedOnly: true }
    expect(matchRemoteSession(session(), filter, NOW)).toBe(false)
    expect(
      matchRemoteSession(session({ pinnedAt: new Date(NOW).toISOString() }), filter, NOW),
    ).toBe(true)
  })

  it('时间戳非法时不命中时间筛选（而不是抛错）', () => {
    expect(
      matchRemoteSession(
        session({ updatedAt: 'not-a-date' }),
        { ...DEFAULT_REMOTE_FILTER, activity: '7d' },
        NOW,
      ),
    ).toBe(false)
  })
})

describe('筛选状态判定', () => {
  it('只有项目筛选不算会话级筛选（树视图能就地生效）', () => {
    const onlyProject = { ...DEFAULT_REMOTE_FILTER, projectIds: ['p1'] }
    expect(hasSessionLevelFilter(onlyProject)).toBe(false)
    expect(isRemoteFilterActive(onlyProject)).toBe(true)
  })

  it('状态/标记/活动/置顶任一开启就是会话级筛选', () => {
    expect(hasSessionLevelFilter({ ...DEFAULT_REMOTE_FILTER, statuses: ['running'] })).toBe(true)
    expect(hasSessionLevelFilter({ ...DEFAULT_REMOTE_FILTER, labels: ['unlabeled'] })).toBe(true)
    expect(hasSessionLevelFilter({ ...DEFAULT_REMOTE_FILTER, activity: 'today' })).toBe(true)
    expect(hasSessionLevelFilter({ ...DEFAULT_REMOTE_FILTER, pinnedOnly: true })).toBe(true)
    expect(hasSessionLevelFilter(DEFAULT_REMOTE_FILTER)).toBe(false)
  })

  it('角标按维度计数，不按选项个数', () => {
    expect(countActiveFilterFacets(DEFAULT_REMOTE_FILTER)).toBe(0)
    expect(
      countActiveFilterFacets({
        statuses: ['running', 'idle', 'completed'],
        labels: ['unlabeled'],
        activity: 'today',
        projectIds: ['p1', 'p2'],
        pinnedOnly: true,
      }),
    ).toBe(5)
  })
})

describe('summarizeRemoteFilter', () => {
  it('输出中文摘要（项目只报个数）', () => {
    expect(
      summarizeRemoteFilter({
        statuses: ['running'],
        labels: ['unlabeled', 'pending-review'],
        activity: '7d',
        projectIds: ['p1', 'p2'],
        pinnedOnly: true,
      }),
    ).toEqual(['运行中', '未标记', '待审查', '近 7 天', '项目 2 个', '仅置顶'])
  })

  it('默认筛选是空摘要', () => {
    expect(summarizeRemoteFilter(DEFAULT_REMOTE_FILTER)).toEqual([])
  })
})

describe('toggleFilterValue / sortFilterValues', () => {
  it('多选切换保持顺序且不重复', () => {
    let list = toggleFilterValue<RemoteStatusList>(['idle'], 'running')
    expect(list).toEqual(['idle', 'running'])
    list = toggleFilterValue(list, 'idle')
    expect(list).toEqual(['running'])
    list = toggleFilterValue(list, 'running')
    expect(list).toEqual([])
  })

  it('按选项顺序归一化，点选顺序不影响结果', () => {
    const order: ReadonlyArray<{ value: 'a' | 'b' | 'c' }> = [
      { value: 'a' },
      { value: 'b' },
      { value: 'c' },
    ]
    expect(sortFilterValues<'a' | 'b' | 'c'>(['c', 'a'], order)).toEqual(['a', 'c'])
  })
})

type RemoteStatusList = 'running' | 'idle' | 'completed'
