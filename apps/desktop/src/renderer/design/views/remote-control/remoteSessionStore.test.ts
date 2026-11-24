import { describe, expect, it } from 'vitest'
import type {
  MobileBridgeEvent,
  MobileBridgeProjectSummary,
  MobileBridgeSessionSummary,
} from '@spark/protocol'
import {
  UNASSIGNED_PROJECT_ID,
  appendSessionPage,
  buildProjectRows,
  deriveLiveSessionPatch,
  filterSessions,
  formatRelativeTime,
  getRemoteSessionStore,
  groupSessionsByProject,
  insertSessionInStore,
  isStale,
  patchProjectInStore,
  patchSessionFromLiveEvents,
  patchSessionInStore,
  removeProjectFromStore,
  removeSessionFromStore,
  sortSessionRows,
  updateRemoteSessionStore,
} from './remoteSessionStore'

function project(
  partial: Partial<MobileBridgeProjectSummary> & { id: string; name: string },
): MobileBridgeProjectSummary {
  return {
    rootPath: '',
    projectKind: 'local',
    pinnedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    sessionCount: 0,
    ...partial,
  }
}

function session(
  partial: Partial<MobileBridgeSessionSummary> & { id: string },
): MobileBridgeSessionSummary {
  return {
    title: '会话',
    status: 'idle',
    updatedAt: '2026-01-01T00:00:00.000Z',
    preview: '',
    ...partial,
  }
}

describe('buildProjectRows', () => {
  it('项目直接映射成行，角标来自项目列表自身', () => {
    const rows = buildProjectRows(
      [
        project({ id: 'p1', name: '币安量化', sessionCount: 12, runningSessionCount: 2 }),
        project({ id: 'p2', name: 'react-component', sessionCount: 3 }),
      ],
      0,
      false,
    )
    expect(rows).toEqual([
      { id: 'p1', name: '币安量化', sessionCount: 12, runningCount: 2, kind: 'project' },
      { id: 'p2', name: 'react-component', sessionCount: 3, runningCount: 0, kind: 'project' },
    ])
  })

  it('未归属行只在需要时补到最后', () => {
    const projects = [project({ id: 'p1', name: 'A', sessionCount: 1 })]
    expect(buildProjectRows(projects, 0, false)).toHaveLength(1)

    const withUnassigned = buildProjectRows(projects, 2, true)
    expect(withUnassigned).toHaveLength(2)
    expect(withUnassigned[1]).toEqual({
      id: UNASSIGNED_PROJECT_ID,
      name: '未归属会话',
      sessionCount: 0,
      runningCount: 2,
      kind: 'unassigned',
    })
  })

  it('旧版目标端缺 sessionCount 时按 0 处理，不显示 NaN', () => {
    const rows = buildProjectRows([{ id: 'p1', name: 'A' } as MobileBridgeProjectSummary], 0, false)
    expect(rows[0]?.sessionCount).toBe(0)
    expect(rows[0]?.runningCount).toBe(0)
  })

  it('空名字兜底成「未命名项目」', () => {
    expect(buildProjectRows([project({ id: 'p1', name: '' })], 0, false)[0]?.name).toBe(
      '未命名项目',
    )
  })
})

describe('filterSessions', () => {
  const rows = [
    session({ id: 's1', title: '回测参数网格搜索', preview: '把 grid 收窄到 20 组' }),
    session({ id: 's2', title: '表格组件列宽自适应', preview: 'antd table 的 scroll' }),
    session({ id: 's3', title: 'Spark-Agent 远程协议', preview: '' }),
  ]

  it('空关键词原样返回', () => {
    expect(filterSessions(rows, '   ')).toBe(rows)
  })

  it('标题命中（大小写不敏感）', () => {
    expect(filterSessions(rows, 'spark-agent').map((row) => row.id)).toEqual(['s3'])
  })

  it('预览命中也算：记不住标题也能搜到', () => {
    expect(filterSessions(rows, 'GRID').map((row) => row.id)).toEqual(['s1'])
  })

  it('没有命中返回空数组', () => {
    expect(filterSessions(rows, '不存在的词')).toEqual([])
  })
})

describe('groupSessionsByProject', () => {
  const projects = [project({ id: 'p1', name: '币安量化' }), project({ id: 'p2', name: '前端' })]
  const rows = [
    session({ id: 's1', projectId: 'p2' }),
    session({ id: 's2', projectId: 'p1' }),
    session({ id: 's3', projectId: 'p1' }),
    session({ id: 's4' }),
  ]

  it('顺序跟着项目列表，未归属排最后', () => {
    const groups = groupSessionsByProject(rows, projects)
    expect(groups.map((group) => group.projectId)).toEqual(['p1', 'p2', UNASSIGNED_PROJECT_ID])
    expect(groups[0]?.sessions.map((row) => row.id)).toEqual(['s2', 's3'])
    expect(groups[2]?.name).toBe('未归属会话')
  })

  it('没有会话的项目不产生空分组', () => {
    const groups = groupSessionsByProject([session({ id: 's1', projectId: 'p1' })], projects)
    expect(groups.map((group) => group.projectId)).toEqual(['p1'])
  })

  it('项目已不在列表里（被归档）时用兜底名字', () => {
    const groups = groupSessionsByProject([session({ id: 's1', projectId: 'gone' })], projects)
    expect(groups[0]?.name).toBe('其它项目')
  })
})

describe('isStale', () => {
  it('从未拉过（fetchedAt=0）视为过期', () => {
    expect(isStale(0, 60_000, 1_000_000)).toBe(true)
  })

  it('TTL 内不算过期', () => {
    expect(isStale(1_000_000, 60_000, 1_030_000)).toBe(false)
  })

  it('超过 TTL 算过期', () => {
    expect(isStale(1_000_000, 60_000, 1_060_001)).toBe(true)
  })
})

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-11-12T12:00:00.000Z')
  const at = (ms: number) => new Date(now - ms).toISOString()

  it('按分钟/小时/天分档', () => {
    expect(formatRelativeTime(at(10_000), now)).toBe('刚刚')
    expect(formatRelativeTime(at(5 * 60_000), now)).toBe('5 分钟前')
    expect(formatRelativeTime(at(3 * 3_600_000), now)).toBe('3 小时前')
    expect(formatRelativeTime(at(2 * 86_400_000), now)).toBe('2 天前')
  })

  it('非法时间给空串，不显示 NaN', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('')
  })
})

describe('sortSessionRows', () => {
  it('置顶在前（置顶时间倒序），其余按更新时间倒序', () => {
    const rows = [
      session({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
      session({ id: 'new', updatedAt: '2026-03-01T00:00:00.000Z' }),
      session({
        id: 'pin-old',
        updatedAt: '2025-01-01T00:00:00.000Z',
        pinnedAt: '2026-01-05T00:00:00.000Z',
      }),
      session({
        id: 'pin-new',
        updatedAt: '2025-01-01T00:00:00.000Z',
        pinnedAt: '2026-02-05T00:00:00.000Z',
      }),
    ]
    expect(sortSessionRows(rows).map((row) => row.id)).toEqual(['pin-new', 'pin-old', 'new', 'old'])
  })

  it('不修改入参', () => {
    const rows = [
      session({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }),
      session({ id: 'b', updatedAt: '2026-02-01T00:00:00.000Z' }),
    ]
    sortSessionRows(rows)
    expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
  })
})

describe('本地写回', () => {
  const DEVICE = 'dev-write-back'

  const seed = () => {
    updateRemoteSessionStore(DEVICE, (store) => {
      store.projects = [project({ id: 'p1', name: '项目一', sessionCount: 2 })]
      store.sessions.p1 = {
        rows: [
          session({ id: 'a', title: '会话 A', projectId: 'p1' }),
          session({ id: 'b', title: '会话 B', projectId: 'p1' }),
        ],
        total: 2,
        fetchedAt: Date.now(),
      }
      store.allSessions = null
    })
    return getRemoteSessionStore(DEVICE)
  }

  it('改标题只动目标会话', () => {
    const store = seed()
    patchSessionInStore(DEVICE, 'a', { title: '新标题' })
    expect(store.sessions.p1?.rows.map((row) => row.title)).toEqual(['新标题', '会话 B'])
    expect(store.version).toBeGreaterThan(0)
  })

  it('置顶后重排到最前', () => {
    const store = seed()
    patchSessionInStore(DEVICE, 'b', { pinnedAt: new Date().toISOString() })
    expect(store.sessions.p1?.rows.map((row) => row.id)).toEqual(['b', 'a'])
  })

  it('删除会话同步减总数与项目角标', () => {
    const store = seed()
    const target = store.sessions.p1?.rows[0]
    if (target == null) throw new Error('seed 失败')
    removeSessionFromStore(DEVICE, target)
    expect(store.sessions.p1?.rows.map((row) => row.id)).toEqual(['b'])
    expect(store.sessions.p1?.total).toBe(1)
    expect(store.projects[0]?.sessionCount).toBe(1)
  })

  it('新建会话插到项目顶部并加角标', () => {
    const store = seed()
    insertSessionInStore(
      DEVICE,
      session({ id: 'c', title: '新会话', projectId: 'p1', updatedAt: new Date().toISOString() }),
    )
    expect(store.sessions.p1?.rows[0]?.id).toBe('c')
    expect(store.sessions.p1?.total).toBe(3)
    expect(store.projects[0]?.sessionCount).toBe(3)
  })

  it('项目改名 / 删除生效', () => {
    const store = seed()
    patchProjectInStore(DEVICE, 'p1', { name: '改名后' })
    expect(store.projects[0]?.name).toBe('改名后')
    removeProjectFromStore(DEVICE, 'p1')
    expect(store.projects).toHaveLength(0)
    expect(store.sessions.p1).toBeUndefined()
  })

  it('加载更多：去重追加、total 以服务端为准', () => {
    const store = seed()
    appendSessionPage(DEVICE, 'p1', {
      rows: [
        session({ id: 'b', title: '会话 B 重复页', projectId: 'p1' }),
        session({ id: 'c', title: '会话 C', projectId: 'p1' }),
      ],
      total: 3,
    })
    expect(store.sessions.p1?.rows.map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(store.sessions.p1?.total).toBe(3)
    expect(store.sessions.p1?.offsetUnsupported).toBeUndefined()
  })

  it('加载更多：目标端忽略 offset（整页都是已有行）时标记 offsetUnsupported', () => {
    const store = seed()
    appendSessionPage(DEVICE, 'p1', {
      rows: [session({ id: 'a', projectId: 'p1' }), session({ id: 'b', projectId: 'p1' })],
      total: 9,
    })
    expect(store.sessions.p1?.rows).toHaveLength(2)
    expect(store.sessions.p1?.offsetUnsupported).toBe(true)
  })

  it('加载更多：桶不存在时当作首页写入', () => {
    const store = seed()
    appendSessionPage(DEVICE, 'p2', {
      rows: [session({ id: 'z', projectId: 'p2' })],
      total: 1,
    })
    expect(store.sessions.p2?.rows.map((row) => row.id)).toEqual(['z'])
  })
})

describe('deriveLiveSessionPatch', () => {
  const event = (partial: Partial<MobileBridgeEvent> & { type: MobileBridgeEvent['type'] }) =>
    ({
      id: 'e1',
      seq: 1,
      turnId: 't1',
      timestamp: '2026-11-25T10:00:00.000Z',
      ...partial,
    }) as MobileBridgeEvent

  it('user_message 更新 preview 与 updatedAt（压缩空白、截 60 字）', () => {
    const long = `把  回测\n参数   收窄到${'x'.repeat(80)}`
    const patch = deriveLiveSessionPatch([
      event({ type: 'user_message', content: long, timestamp: '2026-11-25T10:01:00.000Z' }),
    ])
    expect(patch?.preview).toBe(`把 回测 参数 收窄到${'x'.repeat(49)}`)
    expect(patch?.preview).toHaveLength(60)
    expect(patch?.updatedAt).toBe('2026-11-25T10:01:00.000Z')
    expect(patch?.status).toBeUndefined()
  })

  it('纯空白 user_message 不产生补丁', () => {
    expect(deriveLiveSessionPatch([event({ type: 'user_message', content: '  \n ' })])).toBeNull()
  })

  it('agent_status 映射：running→running，completed/cancelled→idle，error→error', () => {
    expect(
      deriveLiveSessionPatch([event({ type: 'agent_status', status: 'running' })])?.status,
    ).toBe('running')
    expect(
      deriveLiveSessionPatch([event({ type: 'agent_status', status: 'completed' })])?.status,
    ).toBe('idle')
    expect(
      deriveLiveSessionPatch([event({ type: 'agent_status', status: 'cancelled' })])?.status,
    ).toBe('idle')
    expect(deriveLiveSessionPatch([event({ type: 'agent_status', status: 'error' })])?.status).toBe(
      'error',
    )
  })

  it('running 不动 updatedAt，结束态刷新 updatedAt', () => {
    expect(
      deriveLiveSessionPatch([
        event({ type: 'agent_status', status: 'running', timestamp: '2026-11-25T10:02:00.000Z' }),
      ])?.updatedAt,
    ).toBeUndefined()
    expect(
      deriveLiveSessionPatch([
        event({ type: 'agent_status', status: 'completed', timestamp: '2026-11-25T10:03:00.000Z' }),
      ])?.updatedAt,
    ).toBe('2026-11-25T10:03:00.000Z')
  })

  it('同批多事件按顺序覆盖（后者生效）', () => {
    const patch = deriveLiveSessionPatch([
      event({ type: 'user_message', content: '帮我跑一遍', timestamp: '2026-11-25T10:01:00.000Z' }),
      event({
        type: 'agent_status',
        status: 'completed',
        timestamp: '2026-11-25T10:05:00.000Z',
      }),
    ])
    expect(patch?.status).toBe('idle')
    expect(patch?.preview).toBe('帮我跑一遍')
    expect(patch?.updatedAt).toBe('2026-11-25T10:05:00.000Z')
  })

  it('无关事件（tool_call / assistant delta / 空批次）返回 null', () => {
    expect(deriveLiveSessionPatch([])).toBeNull()
    expect(deriveLiveSessionPatch([event({ type: 'tool_call', toolName: 'Bash' })])).toBeNull()
    expect(
      deriveLiveSessionPatch([
        event({ type: 'assistant_message', content: '半个字', mode: 'delta' }),
      ]),
    ).toBeNull()
  })

  it('未知 agent_status 值忽略', () => {
    expect(deriveLiveSessionPatch([event({ type: 'agent_status', status: 'thinking' })])).toBeNull()
  })
})

describe('patchSessionFromLiveEvents', () => {
  const DEVICE = 'dev-live-patch'

  const seed = () => {
    updateRemoteSessionStore(DEVICE, (store) => {
      store.projects = [project({ id: 'p1', name: '项目一', sessionCount: 1 })]
      store.sessions.p1 = {
        rows: [session({ id: 'a', title: '会话 A', projectId: 'p1' })],
        total: 1,
        fetchedAt: Date.now(),
      }
      store.allSessions = {
        rows: [session({ id: 'a', title: '会话 A', projectId: 'p1' })],
        total: 1,
        fetchedAt: Date.now(),
      }
    })
    return getRemoteSessionStore(DEVICE)
  }

  const event = (partial: Partial<MobileBridgeEvent> & { type: MobileBridgeEvent['type'] }) =>
    ({
      id: 'e1',
      seq: 1,
      turnId: 't1',
      timestamp: '2026-11-25T10:00:00.000Z',
      ...partial,
    }) as MobileBridgeEvent

  it('写回项目桶与全量窗口里的同一会话', () => {
    const store = seed()
    patchSessionFromLiveEvents(DEVICE, 'a', [
      event({ type: 'agent_status', status: 'running' }),
    ])
    expect(store.sessions.p1?.rows[0]?.status).toBe('running')
    expect(store.allSessions?.rows[0]?.status).toBe('running')
    expect(store.version).toBeGreaterThan(0)
  })

  it('会话不在任何桶里时安全 no-op', () => {
    const store = seed()
    const versionBefore = store.version
    patchSessionFromLiveEvents(DEVICE, 'ghost', [
      event({ type: 'agent_status', status: 'running' }),
    ])
    expect(store.version).toBe(versionBefore)
  })

  it('同批事件重放（订阅重连）结果幂等', () => {
    const store = seed()
    const batch = [
      event({ type: 'user_message', content: '重放我', timestamp: '2026-11-25T10:01:00.000Z' }),
      event({ type: 'agent_status', status: 'running', timestamp: '2026-11-25T10:02:00.000Z' }),
    ]
    patchSessionFromLiveEvents(DEVICE, 'a', batch)
    const afterFirst = store.sessions.p1?.rows[0]
    patchSessionFromLiveEvents(DEVICE, 'a', batch)
    expect(store.sessions.p1?.rows[0]).toEqual(afterFirst)
  })
})
