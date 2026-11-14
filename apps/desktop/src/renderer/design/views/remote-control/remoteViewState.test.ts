import { describe, expect, it } from 'vitest'
import { DEFAULT_REMOTE_FILTER } from './remoteSessionFilters'
import {
  MAX_CACHED_DEVICES,
  REMOTE_VIEW_STATE_KEY,
  forgetDevice,
  readTreeQuery,
  rememberTreeQuery,
  type RemoteViewStorage,
} from './remoteViewState'

/** 内存版 localStorage：测试之间互不影响，也能直接看落盘的 JSON */
function fakeStorage(): RemoteViewStorage & { raw: () => string | null } {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    raw: () => map.get(REMOTE_VIEW_STATE_KEY) ?? null,
  }
}

describe('readTreeQuery / rememberTreeQuery', () => {
  it('没有记录时返回一份全新的默认筛选', () => {
    const storage = fakeStorage()
    const query = readTreeQuery('d1', storage)
    expect(query).toEqual({ keyword: '', filter: DEFAULT_REMOTE_FILTER })
    // 默认值的数组不能是共享的那份，否则调用方一改就污染全局
    query.filter.statuses.push('running')
    expect(readTreeQuery('d1', storage).filter.statuses).toEqual([])
  })

  it('按设备分别记住，切视图回来还是原样', () => {
    const storage = fakeStorage()
    rememberTreeQuery(
      'd1',
      { keyword: '远程', filter: { ...DEFAULT_REMOTE_FILTER, statuses: ['running'] } },
      storage,
    )
    rememberTreeQuery(
      'd2',
      { keyword: '', filter: { ...DEFAULT_REMOTE_FILTER, activity: '7d', pinnedOnly: true } },
      storage,
    )

    expect(readTreeQuery('d1', storage)).toEqual({
      keyword: '远程',
      filter: { ...DEFAULT_REMOTE_FILTER, statuses: ['running'] },
    })
    expect(readTreeQuery('d2', storage)).toEqual({
      keyword: '',
      filter: { ...DEFAULT_REMOTE_FILTER, activity: '7d', pinnedOnly: true },
    })
  })

  it('写查询不动设备 / 会话 / 展开 / 输入区配置（向后兼容旧状态块）', () => {
    const storage = fakeStorage()
    storage.setItem(
      REMOTE_VIEW_STATE_KEY,
      JSON.stringify({
        version: 1,
        lastDeviceId: 'd1',
        lastSessionByDevice: { d1: { sessionId: 's1', projectId: 'p1' } },
        expandedByDevice: { d1: ['p1'] },
        composerByDevice: { d1: { agentId: 'a1' } },
        deviceSwitcher: 'tabs',
      }),
    )

    rememberTreeQuery(
      'd1',
      { keyword: '远程', filter: { ...DEFAULT_REMOTE_FILTER, pinnedOnly: true } },
      storage,
    )

    const stored = JSON.parse(storage.raw() ?? '{}')
    expect(stored).toMatchObject({
      version: 1,
      lastDeviceId: 'd1',
      lastSessionByDevice: { d1: { sessionId: 's1', projectId: 'p1' } },
      expandedByDevice: { d1: ['p1'] },
      composerByDevice: { d1: { agentId: 'a1' } },
      deviceSwitcher: 'tabs',
    })
  })

  it('清除筛选也会被记住：回来是不过滤的树，而不是上一次的条件', () => {
    const storage = fakeStorage()
    rememberTreeQuery(
      'd1',
      { keyword: '远程', filter: { ...DEFAULT_REMOTE_FILTER, statuses: ['idle'] } },
      storage,
    )
    rememberTreeQuery('d1', { keyword: '', filter: DEFAULT_REMOTE_FILTER }, storage)

    expect(readTreeQuery('d1', storage)).toEqual({ keyword: '', filter: DEFAULT_REMOTE_FILTER })
    // 空条件不占位
    expect(JSON.parse(storage.raw() ?? '{}').treeQueryByDevice?.d1).toBeUndefined()
  })

  it('脏数据按白名单收敛，不影响其它设备', () => {
    const storage = fakeStorage()
    storage.setItem(
      REMOTE_VIEW_STATE_KEY,
      JSON.stringify({
        version: 1,
        treeQueryByDevice: {
          d1: { keyword: 42, filter: { statuses: ['archived'], activity: 'forever' } },
          d2: 'not-an-object',
        },
      }),
    )

    expect(readTreeQuery('d1', storage)).toEqual({ keyword: '', filter: DEFAULT_REMOTE_FILTER })
    expect(readTreeQuery('d2', storage)).toEqual({ keyword: '', filter: DEFAULT_REMOTE_FILTER })
  })

  it('超限淘汰最旧的设备，但始终保留当前这台', () => {
    const storage = fakeStorage()
    for (let index = 0; index <= MAX_CACHED_DEVICES; index += 1) {
      rememberTreeQuery(
        `d${index}`,
        { keyword: `k${index}`, filter: DEFAULT_REMOTE_FILTER },
        storage,
      )
    }
    expect(readTreeQuery(`d${MAX_CACHED_DEVICES}`, storage).keyword).toBe(`k${MAX_CACHED_DEVICES}`)
    expect(readTreeQuery('d0', storage).keyword).toBe('')
    const stored = JSON.parse(storage.raw() ?? '{}')
    expect(Object.keys(stored.treeQueryByDevice)).toHaveLength(MAX_CACHED_DEVICES)
  })

  it('设备被删时这台设备的查询条件一起清掉', () => {
    const storage = fakeStorage()
    rememberTreeQuery('d1', { keyword: '远程', filter: DEFAULT_REMOTE_FILTER }, storage)
    forgetDevice('d1', storage)
    expect(readTreeQuery('d1', storage)).toEqual({ keyword: '', filter: DEFAULT_REMOTE_FILTER })
  })
})
